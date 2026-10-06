import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TEST_NFC_VEHICLE,
  VEHICLE_ALIASES,
  getDatabaseVehicleName,
  getVehicleNameFromCode
} from './fleet-data.js';

const records = new Map();

function snapshot(value) {
  return {
    exists: () => value !== null && value !== undefined,
    val: () => value
  };
}

globalThis.__firebaseMocks = {
  ref: (_db, path) => path,
  get: async path => snapshot(records.get(path) ?? null),
  runTransaction: async (path, update) => {
    // Reproduce Firebase's initial callback with no locally cached value.
    if (update(null) === undefined) {
      return { committed: false, snapshot: snapshot(null) };
    }

    const serverValue = records.get(path) ?? null;
    const nextValue = update(structuredClone(serverValue));
    if (nextValue === undefined) {
      return { committed: false, snapshot: snapshot(serverValue) };
    }

    if (nextValue === null) records.delete(path);
    else records.set(path, nextValue);
    return { committed: true, snapshot: snapshot(nextValue) };
  }
};

const source = (await readFile(new URL('./fleet-workflow.js', import.meta.url), 'utf8'))
  .replace(
    /import \{ ref, get, runTransaction \} from '[^']+';/,
    'const { ref, get, runTransaction } = globalThis.__firebaseMocks;'
  );
const workflow = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const vehicle = '07-21 2021 White Terrain CN466';
const vehiclePath = `vehicles/${vehicle}`;
const userEmail = 'driver@example.com';

assert.equal(
  getDatabaseVehicleName('07-21 2021 White Terrain CN466 Early Years Only'),
  vehicle
);
assert.equal(getDatabaseVehicleName(vehicle), vehicle);
for (const [databaseName, alternateName] of Object.entries(VEHICLE_ALIASES)) {
  assert.equal(getDatabaseVehicleName(alternateName), databaseName);
}
assert.equal(getVehicleNameFromCode('test'), TEST_NFC_VEHICLE);

const prematureVehicle = 'Premature Signout Test';
records.set(`vehicles/${prematureVehicle}`, {
  status: 'available',
  keyStatus: 'withStaff',
  keyHeldBy: userEmail,
  workflowStage: 'keyPickedUp'
});
await assert.rejects(
  workflow.signOutVehicle({}, prematureVehicle, userEmail),
  error => error.code === 'CHECKLIST_REQUIRED'
);

records.set(vehiclePath, {
  status: 'available',
  keyStatus: 'atFrontDesk'
});

await workflow.claimKey({}, vehicle, userEmail);
assert.equal(records.get(vehiclePath).keyStatus, 'withStaff');
assert.equal(records.get(vehiclePath).keyHeldBy, userEmail);
assert.equal(workflow.isRecentPinkPickup(records.get(vehiclePath), userEmail), true);
assert.equal(
  workflow.isRecentPinkPickup(
    records.get(vehiclePath),
    userEmail,
    records.get(vehiclePath).keyPickedUpAt + workflow.PINK_SCAN_GUARD_MS + 1
  ),
  false
);

await workflow.completeChecklist({}, vehicle, userEmail);
assert.equal(records.get(vehiclePath).status, 'available');
assert.equal(
  records.get(vehiclePath).workflowStage,
  workflow.WORKFLOW_STAGE.CHECKLIST_COMPLETED
);

await workflow.signOutVehicle({}, vehicle, userEmail);
assert.equal(records.get(vehiclePath).status, 'signedOut');

await workflow.returnVehicle({}, vehicle, userEmail);
assert.equal(records.get(vehiclePath).workflowStage, workflow.WORKFLOW_STAGE.VEHICLE_RETURNED);

await workflow.returnKey({}, vehicle, userEmail);
assert.equal(records.get(vehiclePath).keyStatus, 'atFrontDesk');
assert.equal(records.get(vehiclePath).keyReturnedBy, userEmail);

const repeatedPinkScan = await workflow.claimKey({}, vehicle, userEmail, 'pinkNfc');
assert.equal(repeatedPinkScan.outcome, 'recentlyReturned');
assert.equal(records.get(vehiclePath).keyStatus, 'atFrontDesk');
assert.equal(records.get(vehiclePath).workflowStage, workflow.WORKFLOW_STAGE.KEY_RETURNED);

records.set(vehiclePath, {
  ...records.get(vehiclePath),
  keyReturnedAt: Date.now() - workflow.PINK_SCAN_GUARD_MS - 1
});
const laterPinkScan = await workflow.claimKey({}, vehicle, userEmail, 'pinkNfc');
assert.equal(laterPinkScan.outcome, 'claimed');
assert.equal(records.get(vehiclePath).keyStatus, 'withStaff');

await assert.rejects(
  workflow.claimKey({}, 'Missing Vehicle', userEmail),
  error => error.code === 'VEHICLE_NOT_FOUND'
);

console.log('fleet-workflow transaction regression tests passed');
