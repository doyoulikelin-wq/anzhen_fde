import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { storageKey, parseRecords, mergeRecords, sameReferral, newRecordId, updateRecords } from './record-store.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
function record(id = 'AZ-20260919-001', fields = {}) {
  return {
    id, doctor: { id: 'd1', name: '医生甲', department: '心血管内科' },
    snapshot: { text: '脱敏病例摘要', patient: { name: '患者甲' }, sourceHospital: '来源医院甲', sourceDoctor: '医生乙' },
    date: '2026-09-20', slotId: 'day-am', session: '上午', time: '09:00–11:30', status: 'pending',
    createdAt: '2026-09-19T01:00:00.000Z', events: [{ label: '申请已保存', at: '2026-09-19T01:00:00.000Z' }], ...fields,
  };
}
function storage(initial = []) {
  let value = JSON.stringify(initial);
  return { getItem(key) { assert.equal(key, storageKey); return value; }, setItem(key, next) { assert.equal(key, storageKey); value = next; } };
}

function withCrypto(crypto, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
  try { return run(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
}

test('existing record format and IDs remain readable', () => {
  const existing = record();
  assert.deepEqual(parseRecords(JSON.stringify([existing, { id: 'invalid' }])), [existing]);
  assert.deepEqual(parseRecords(null), []);
});

test('duplicate identity includes source hospital and initiating doctor', () => {
  const original = record();
  assert.equal(sameReferral(original, copy(original)), true);
  for (const field of ['sourceHospital', 'sourceDoctor']) {
    const changed = copy(original); changed.snapshot[field] += '不同';
    assert.equal(sameReferral(original, changed), false);
  }
  const padded = copy(original); padded.snapshot.sourceHospital += '  ';
  assert.equal(sameReferral(original, padded), true);
});

test('new record IDs do not reuse array lengths or collide between tabs', () => {
  const ids = Array.from({ length: 1000 }, () => newRecordId('2026-09-19'));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => /^AZ-20260919-[0-9A-F]{32}$/.test(id)));
});

test('HTTP contexts without randomUUID generate unique UUIDv4 record IDs with getRandomValues', () => {
  withCrypto({ getRandomValues: bytes => webcrypto.getRandomValues(bytes) }, () => {
    const ids = Array.from({ length: 1000 }, () => newRecordId('2026-09-19'));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every(id => /^AZ-20260919-[0-9A-F]{12}4[0-9A-F]{3}[89AB][0-9A-F]{15}$/.test(id)));
  });
});

test('secure contexts continue using native randomUUID', () => {
  withCrypto({
    randomUUID: () => '12345678-1234-4123-8123-123456789abc',
    getRandomValues: () => { throw new Error('fallback must not run'); },
  }, () => {
    assert.equal(newRecordId('2026-09-19'), 'AZ-20260919-12345678123441238123123456789ABC');
  });
});

test('missing secure random generators fail explicitly without creating a weak ID', () => {
  for (const crypto of [undefined, {}]) {
    withCrypto(crypto, () => assert.throws(() => newRecordId('2026-09-19'), /无法安全生成转诊编号/));
  }
});

test('explicit UUIDs remain supported even without browser crypto', () => {
  withCrypto(undefined, () => {
    assert.equal(newRecordId('2026-09-19', '12345678-1234-4123-8123-123456789abc'), 'AZ-20260919-12345678123441238123123456789ABC');
  });
});

test('stale pending references cannot downgrade accepted records and events are preserved', () => {
  const pending = record();
  const accepted = record(undefined, { status: 'accepted', acceptedAt: '2026-09-19T02:00:00.000Z', acceptedDepartment: '心内科', acceptedLocation: '门诊', events: [...pending.events, { label: '协调已登记', at: '2026-09-19T02:00:00.000Z' }] });
  for (const groups of [[[accepted], [pending]], [[pending], [accepted]]]) {
    const [merged] = mergeRecords(...groups);
    assert.equal(merged.status, 'accepted'); assert.equal(merged.acceptedLocation, '门诊'); assert.equal(merged.events.length, 2);
  }
});

test('newer acceptance fields win while both event histories are retained', () => {
  const old = record(undefined, { status: 'accepted', acceptedAt: '2026-09-19T02:00:00.000Z', acceptedLocation: '旧安排' });
  const newer = record(undefined, { status: 'accepted', acceptedAt: '2026-09-19T03:00:00.000Z', acceptedLocation: '新安排', events: [...old.events, { label: '新协调安排', at: '2026-09-19T03:00:00.000Z' }] });
  const [merged] = mergeRecords([newer], [old]);
  assert.equal(merged.acceptedLocation, '新安排'); assert.equal(merged.events.length, 2);
});

test('saving from a stale tab preserves records created by another tab', async () => {
  const first = record('first'), second = record('second');
  const disk = storage([first]);
  const result = await updateRecords(disk, () => [], latest => ({ records: [second, ...latest] }), null);
  assert.deepEqual(new Set(result.records.map(r => r.id)), new Set(['first', 'second']));
  assert.equal(parseRecords(disk.getItem(storageKey)).length, 2);
});

test('shared browser lock serializes concurrent tab saves and duplicate checks', async () => {
  const disk = storage(); let chain = Promise.resolve();
  const locks = { request(name, fn) { assert.equal(name, storageKey); const result = chain.then(fn); chain = result.catch(() => {}); return result; } };
  const save = candidate => updateRecords(disk, () => [], latest => {
    const duplicate = latest.find(existing => sameReferral(existing, candidate));
    return { records: duplicate ? latest : [...latest, candidate], duplicate: Boolean(duplicate) };
  }, locks);
  const [first, duplicate] = await Promise.all([save(record('one')), save(record('two'))]);
  assert.equal(first.duplicate, false); assert.equal(duplicate.duplicate, true);
  assert.equal(parseRecords(disk.getItem(storageKey)).length, 1);
});

test('failed storage writes and invalid stored JSON never report saved results', async () => {
  const local = [record('local')], before = copy(local);
  const disk = storage(); disk.setItem = () => { throw Error('storage full'); };
  await assert.rejects(updateRecords(disk, () => local, latest => ({ records: [...latest, record('new')] }), null), /storage full/);
  assert.deepEqual(local, before);
  let wrote = false;
  await assert.rejects(updateRecords({ getItem: () => '{broken', setItem: () => { wrote = true; } }, () => local, latest => ({ records: latest }), null));
  assert.equal(wrote, false);
});

test('different patient identities and supplemental draft contents are never silently deduplicated',()=>{
 const a=record();for(const change of [r=>r.snapshot.patient.name='另一位患者',r=>r.inputSource={sourceSystem:'嘉和',sourcePatientId:'CASE2'},r=>r.attachments=[{id:'newfile'}],r=>r.insurance={type:'自费'}]){const b=copy(a);change(b);assert.equal(sameReferral(a,b),false);}
});
