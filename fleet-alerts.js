export const FLEET_ALERT_TYPE = Object.freeze({
  CHECKLIST: 'checklist',
  MAINTENANCE: 'maintenance'
});

// Add or remove notification recipients here. Email matching is case-insensitive.
export const FLEET_ALERT_RECIPIENTS = Object.freeze([
  'it@yfned.ca'
]);

export function isFleetAlertRecipient(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return FLEET_ALERT_RECIPIENTS.includes(normalizedEmail);
}

export function getFleetAlertDestination(alert) {
  const params = new URLSearchParams({
    type: alert.type,
    vehicle: alert.vehicle,
    record: alert.logId,
    timestamp: String(alert.timestamp || '')
  });
  return `records.html?${params.toString()}`;
}
