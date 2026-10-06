import { ref, get, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

export const WORKFLOW_STAGE = Object.freeze({
  KEY_PICKED_UP: 'keyPickedUp',
  CHECKLIST_COMPLETED: 'checklistCompleted',
  VEHICLE_SIGNED_OUT: 'vehicleSignedOut',
  VEHICLE_RETURNED: 'vehicleReturned',
  KEY_RETURNED: 'keyReturned'
});

// NFC readers and mobile browsers can retry the same tag URL. Keep recent pink
// pickup/return actions idempotent so a retry cannot immediately reverse them.
export const PINK_SCAN_GUARD_MS = 60 * 1000;

export class FleetAccessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FleetAccessError';
    this.code = code;
    this.details = details;
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isRecentPinkPickup(state, userEmail, now = Date.now()) {
  const keyPickedUpAt = Number(state?.keyPickedUpAt);
  return state?.keyCheckoutSource === 'pinkNfc'
    && state?.keyStatus === 'withStaff'
    && state?.workflowStage === WORKFLOW_STAGE.KEY_PICKED_UP
    && normalizeEmail(state?.keyHeldBy) === normalizeEmail(userEmail)
    && Number.isFinite(keyPickedUpAt)
    && now - keyPickedUpAt >= 0
    && now - keyPickedUpAt <= PINK_SCAN_GUARD_MS;
}

function bookingOwner(booking) {
  return booking?.userName || booking?.userEmail || booking?.email || booking?.creatorEmail || '';
}

function bookingTime(booking, kind) {
  const iso = kind === 'start' ? booking?.startTimeISO : booking?.endTimeISO;
  const fallbackTime = kind === 'start' ? booking?.startTime : booking?.endTime;
  const value = iso || (booking?.date && fallbackTime ? `${booking.date}T${fallbackTime}` : '');
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export async function getActiveBookings(db, vehicle, atTime = Date.now()) {
  const snapshot = await get(ref(db, `bookings/${vehicle}`));
  if (!snapshot.exists()) return [];

  return Object.entries(snapshot.val() || {}).flatMap(([id, booking]) => {
    const start = bookingTime(booking, 'start');
    const end = bookingTime(booking, 'end');
    if (start === null || end === null || atTime < start || atTime >= end) return [];
    return [{ id, ...booking, ownerEmail: bookingOwner(booking) }];
  });
}

export async function assertNoOtherActiveBooking(db, vehicle, userEmail, atTime = Date.now()) {
  const activeBookings = await getActiveBookings(db, vehicle, atTime);
  const normalizedUser = normalizeEmail(userEmail);
  const conflictingBooking = activeBookings.find(booking =>
    normalizeEmail(booking.ownerEmail) !== normalizedUser
  );

  if (conflictingBooking) {
    throw new FleetAccessError(
      'BOOKED_BY_OTHER',
      `This vehicle is currently booked by ${conflictingBooking.ownerEmail || 'another user'}.`,
      { bookingId: conflictingBooking.id, bookedBy: conflictingBooking.ownerEmail || null }
    );
  }

  return activeBookings;
}

export async function getVehicleState(db, vehicle) {
  const snapshot = await get(ref(db, `vehicles/${vehicle}`));
  if (!snapshot.exists()) {
    throw new FleetAccessError('VEHICLE_NOT_FOUND', 'Vehicle not found in database.');
  }
  return snapshot.val() || {};
}

function transactionError(denial, fallbackMessage) {
  return new FleetAccessError(
    denial?.code || 'STATE_CHANGED',
    denial?.message || fallbackMessage,
    denial?.details || {}
  );
}

export async function claimKey(db, vehicle, userEmail, source = 'pinkNfc') {
  await assertNoOtherActiveBooking(db, vehicle, userEmail);

  let denial = null;
  let outcome = 'claimed';
  const operationTime = Date.now();
  const result = await runTransaction(ref(db, `vehicles/${vehicle}`), current => {
    denial = null;
    outcome = 'claimed';
    // A transaction can run once with a locally cached null before Firebase
    // has loaded the server value. Returning null lets Firebase compare with
    // the server and retry with the real vehicle instead of aborting early.
    if (current === null) {
      denial = { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found in database.' };
      return current;
    }

    const holder = normalizeEmail(current.keyHeldBy);
    const user = normalizeEmail(userEmail);
    const keyStatus = current.keyStatus || 'atFrontDesk';
    const vehicleStatus = current.status || 'available';
    const keyReturnedAt = Number(current.keyReturnedAt);
    const isRecentPinkReturn = source === 'pinkNfc'
      && keyStatus === 'atFrontDesk'
      && current.workflowStage === WORKFLOW_STAGE.KEY_RETURNED
      && normalizeEmail(current.keyReturnedBy) === user
      && Number.isFinite(keyReturnedAt)
      && operationTime - keyReturnedAt >= 0
      && operationTime - keyReturnedAt <= PINK_SCAN_GUARD_MS;

    if (isRecentPinkReturn) {
      outcome = 'recentlyReturned';
      return current;
    }

    if (current.maintenanceStatus === 'outForMaintenance') {
      denial = { code: 'MAINTENANCE', message: 'This vehicle is currently out for maintenance.' };
      return;
    }
    if (keyStatus === 'withStaff') {
      if (holder === user) {
        outcome = 'alreadyHeld';
        return current;
      }
      denial = {
        code: 'KEY_HELD_BY_OTHER',
        message: current.keyHeldBy
          ? `The key is already assigned to ${current.keyHeldBy}.`
          : 'The key is already marked as out with another staff member.'
      };
      return;
    }
    if (vehicleStatus !== 'available') {
      denial = {
        code: 'VEHICLE_IN_USE',
        message: current.CurrentlySignedOutBy
          ? `This vehicle is currently signed out by ${current.CurrentlySignedOutBy}.`
          : 'This vehicle is currently signed out.'
      };
      return;
    }

    return {
      ...current,
      keyStatus: 'withStaff',
      keyHeldBy: userEmail,
      lastKeyChange: operationTime,
      alarm: true,
      workflowStage: WORKFLOW_STAGE.KEY_PICKED_UP,
      keyCheckoutSource: source,
      keyPickedUpAt: operationTime
    };
  });

  if (!result.committed || !result.snapshot.exists()) {
    throw transactionError(denial, 'The key could not be assigned because its status changed. Please try again.');
  }
  return { outcome, state: result.snapshot.val() || {} };
}

export async function completeChecklist(db, vehicle, userEmail) {
  await assertNoOtherActiveBooking(db, vehicle, userEmail);

  let denial = null;
  let outcome = 'completed';
  const operationTime = Date.now();
  const result = await runTransaction(ref(db, `vehicles/${vehicle}`), current => {
    denial = null;
    outcome = 'completed';
    if (current === null) {
      denial = { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found in database.' };
      return current;
    }

    const user = normalizeEmail(userEmail);
    const holder = normalizeEmail(current.keyHeldBy);
    if (current.maintenanceStatus === 'outForMaintenance') {
      denial = { code: 'MAINTENANCE', message: 'This vehicle is currently out for maintenance.' };
      return;
    }
    if (current.keyStatus !== 'withStaff' || holder !== user) {
      denial = {
        code: 'KEY_NOT_HELD',
        message: 'You must pick up this key from the front desk before completing the checklist.'
      };
      return;
    }
    if ((current.status || 'available') !== 'available') {
      denial = { code: 'VEHICLE_IN_USE', message: 'This vehicle is already signed out.' };
      return;
    }
    if (current.workflowStage === WORKFLOW_STAGE.CHECKLIST_COMPLETED) {
      outcome = 'alreadyCompleted';
      return current;
    }
    if (current.workflowStage !== WORKFLOW_STAGE.KEY_PICKED_UP) {
      denial = {
        code: 'CHECKLIST_NOT_READY',
        message: 'Pick up the key before completing the vehicle checklist.'
      };
      return;
    }

    return {
      ...current,
      workflowStage: WORKFLOW_STAGE.CHECKLIST_COMPLETED,
      checklistCompletedAt: operationTime
    };
  });

  if (!result.committed || !result.snapshot.exists()) {
    throw transactionError(denial, 'The checklist could not be completed because the vehicle status changed.');
  }
  return { outcome, state: result.snapshot.val() || {} };
}

export async function signOutVehicle(db, vehicle, userEmail) {
  await assertNoOtherActiveBooking(db, vehicle, userEmail);

  let denial = null;
  let outcome = 'signedOut';
  const operationTime = Date.now();
  const result = await runTransaction(ref(db, `vehicles/${vehicle}`), current => {
    denial = null;
    outcome = 'signedOut';
    if (current === null) {
      denial = { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found in database.' };
      return current;
    }

    const user = normalizeEmail(userEmail);
    const holder = normalizeEmail(current.keyHeldBy);
    const signedOutBy = normalizeEmail(current.CurrentlySignedOutBy);
    if (current.maintenanceStatus === 'outForMaintenance') {
      denial = { code: 'MAINTENANCE', message: 'This vehicle is currently out for maintenance.' };
      return;
    }
    if (current.keyStatus !== 'withStaff' || holder !== user) {
      denial = {
        code: 'KEY_NOT_HELD',
        message: 'You must pick up this key from the front desk before opening the checklist.'
      };
      return;
    }
    if (current.status === 'signedOut') {
      if (signedOutBy === user) {
        outcome = 'alreadySignedOut';
        return current;
      }
      denial = { code: 'VEHICLE_IN_USE', message: 'This vehicle is already signed out by another user.' };
      return;
    }
    if (current.workflowStage !== WORKFLOW_STAGE.CHECKLIST_COMPLETED) {
      denial = {
        code: 'CHECKLIST_REQUIRED',
        message: 'Complete the vehicle checklist before tapping the green card to sign out.'
      };
      return;
    }

    return {
      ...current,
      status: 'signedOut',
      CurrentlySignedOutBy: userEmail,
      alarm: false,
      workflowStage: WORKFLOW_STAGE.VEHICLE_SIGNED_OUT,
      vehicleSignedOutAt: operationTime
    };
  });

  if (!result.committed || !result.snapshot.exists()) {
    throw transactionError(denial, 'The vehicle could not be signed out because its status changed. Please try again.');
  }
  return { outcome, state: result.snapshot.val() || {} };
}

export async function returnVehicle(db, vehicle, userEmail, hasMaintenanceComment = false) {
  let denial = null;
  let outcome = 'returned';
  const operationTime = Date.now();
  const result = await runTransaction(ref(db, `vehicles/${vehicle}`), current => {
    denial = null;
    outcome = 'returned';
    if (current === null) {
      denial = { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found in database.' };
      return current;
    }

    const user = normalizeEmail(userEmail);
    if (current.keyStatus !== 'withStaff' || normalizeEmail(current.keyHeldBy) !== user) {
      denial = { code: 'KEY_NOT_HELD', message: 'Only the staff member holding this key can return the vehicle.' };
      return;
    }
    if (current.status !== 'signedOut') {
      if (current.workflowStage === WORKFLOW_STAGE.VEHICLE_RETURNED) {
        outcome = 'alreadyReturned';
        return current;
      }
      denial = { code: 'VEHICLE_NOT_OUT', message: 'This vehicle is not currently signed out.' };
      return;
    }
    if (normalizeEmail(current.CurrentlySignedOutBy) !== user) {
      denial = { code: 'SIGNED_OUT_BY_OTHER', message: 'Only the staff member who signed out the vehicle can return it.' };
      return;
    }

    return {
      ...current,
      status: 'available',
      CurrentlySignedOutBy: null,
      workflowStage: WORKFLOW_STAGE.VEHICLE_RETURNED,
      vehicleReturnedAt: operationTime,
      ...(hasMaintenanceComment ? { maintenanceAlert: true, alarm: true } : {})
    };
  });

  if (!result.committed || !result.snapshot.exists()) {
    throw transactionError(denial, 'The vehicle could not be returned because its status changed. Please try again.');
  }
  return { outcome, state: result.snapshot.val() || {} };
}

export async function returnKey(db, vehicle, userEmail, { allowUnused = false } = {}) {
  let denial = null;
  let outcome = 'returned';
  const operationTime = Date.now();
  const result = await runTransaction(ref(db, `vehicles/${vehicle}`), current => {
    denial = null;
    outcome = 'returned';
    if (current === null) {
      denial = { code: 'VEHICLE_NOT_FOUND', message: 'Vehicle not found in database.' };
      return current;
    }

    if ((current.keyStatus || 'atFrontDesk') === 'atFrontDesk') {
      outcome = 'alreadyReturned';
      return current;
    }
    if (normalizeEmail(current.keyHeldBy) !== normalizeEmail(userEmail)) {
      denial = { code: 'KEY_HELD_BY_OTHER', message: 'Only the staff member holding this key can return it.' };
      return;
    }
    if ((current.status || 'available') === 'signedOut') {
      denial = { code: 'RETURN_VEHICLE_FIRST', message: 'Return the vehicle with the green card or manual vehicle-access button before returning the key.' };
      return;
    }
    if (current.workflowStage === WORKFLOW_STAGE.KEY_PICKED_UP && !allowUnused) {
      denial = { code: 'CHECKLIST_PENDING', message: 'This key is already assigned to you. Scan the green card at the vehicle to open the checklist.' };
      return;
    }

    return {
      ...current,
      keyStatus: 'atFrontDesk',
      keyHeldBy: null,
      lastKeyChange: operationTime,
      alarm: current.maintenanceAlert === true,
      workflowStage: WORKFLOW_STAGE.KEY_RETURNED,
      keyReturnedAt: operationTime,
      keyReturnedBy: userEmail
    };
  });

  if (!result.committed || !result.snapshot.exists()) {
    throw transactionError(denial, 'The key could not be returned because its status changed. Please try again.');
  }
  return { outcome, state: result.snapshot.val() || {} };
}
