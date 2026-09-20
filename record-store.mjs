export const storageKey = 'anzhen-referral-demo-v1';

export function parseRecords(raw) {
  const records = JSON.parse(raw || '[]');
  const text = value => typeof value === 'string' && value.trim().length > 0;
  return Array.isArray(records) ? records.filter(record =>
    text(record?.id) && text(record?.doctor?.id) && text(record?.doctor?.name) && text(record?.doctor?.department) &&
    text(record?.snapshot?.text) && text(record?.snapshot?.patient?.name) && text(record?.snapshot?.sourceHospital) && text(record?.snapshot?.sourceDoctor) &&
    /^\d{4}-\d{2}-\d{2}$/.test(record?.date) && text(record?.session) && text(record?.time) && Number.isFinite(Date.parse(record?.createdAt)) &&
    Array.isArray(record?.events) && record.events.every(event => text(event?.label) && Number.isFinite(Date.parse(event?.at))) &&
    ['pending', 'accepted'].includes(record.status)) : [];
}

function revision(record) {
  return Math.max(Date.parse(record.createdAt) || 0, Date.parse(record.acceptedAt) || 0, ...record.events.map(event => Date.parse(event.at) || 0));
}

// Acceptance is irreversible in this workspace. A stale pending copy cannot undo it.
export function mergeRecords(...groups) {
  const merged = new Map();
  for (const record of groups.flat()) {
    const previous = merged.get(record.id);
    if (!previous) { merged.set(record.id, record); continue; }
    const winner = previous.status !== record.status
      ? (record.status === 'accepted' ? record : previous)
      : (revision(record) >= revision(previous) ? record : previous);
    const events = [...new Map([...previous.events, ...record.events].map(event => [JSON.stringify([event.at, event.label]), event])).values()]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    merged.set(record.id, { ...winner, events });
  }
  return [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
}

export function sameReferral(left, right) {
  return left.doctor.id === right.doctor.id && left.snapshot.text === right.snapshot.text &&
    left.date === right.date && left.slotId === right.slotId &&
    left.snapshot.sourceHospital.trim() === right.snapshot.sourceHospital.trim() &&
    left.snapshot.sourceDoctor.trim() === right.snapshot.sourceDoctor.trim();
}

export function newRecordId(day, uuid = globalThis.crypto.randomUUID()) {
  return `AZ-${day.replaceAll('-', '')}-${uuid.replaceAll('-', '').toUpperCase()}`;
}

// Re-read under a same-origin lock. Failed writes never return a saved result.
export async function updateRecords(storage, getLocalRecords, mutate, locks = globalThis.navigator?.locks) {
  const commit = () => {
    const latest = mergeRecords(getLocalRecords(), parseRecords(storage.getItem(storageKey)));
    const result = mutate(latest);
    const records = mergeRecords(result.records);
    storage.setItem(storageKey, JSON.stringify(records));
    return { ...result, records };
  };
  return locks?.request ? locks.request(storageKey, commit) : commit();
}
