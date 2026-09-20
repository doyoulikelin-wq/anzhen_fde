import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCareAiService, validateRecordImage, validateAlertInput, MAX_RECORD_IMAGE_BYTES, RECORD_EXTRACT_BODY_LIMIT } from './care-ai.mjs';
import { createAppServer } from './server.mjs';
import { AppError } from './llm.mjs';

// Only injected provider mocks and ephemeral loopback HTTP are used. No .env
// reads, real credentials, patient documents, or paid model calls are involved.
const config = { apiKey: 'test-care-key', baseURL: 'https://api.moonshot.cn/v1', model: 'kimi-k3', effort: 'low', port: 4173, timeoutMs: 1000 };
const imageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6oIAAAAASUVORK5CYII=';
const extracted = { text: '2026年9月20日\n冠心病复诊记录。', uncertain: ['手写检查日期无法辨认。'] };
const alertInput = () => ({ patient: { name: '陈女士', age: 67, diagnosis: '已记录冠心病' }, measurements: [
  { date: '2026-09-20 08:00', sbp: 135, dbp: 82, heartRate: 88, spo2: 97, weight: 65, symptoms: '较前胸闷' },
  { date: '2026-09-19 08:00', sbp: 130, dbp: 80, heartRate: 80, spo2: 98, weight: 64.5, symptoms: '无新增主诉' },
], event: { id: 'event-test', at: '2026-09-20T08:30:00+08:00', severity: 'urgent', note: '胸闷加重，需上级复核。' } });
const summarized = { summary: '9月20日08:30报告胸闷加重。', changes: ['9月19日到20日，心率从80次/分到88次/分。'], missing: ['未提供现场处置记录。'], handoff: '核实当前症状、现场人员和已采取的处置措施。' };
const clone = value => JSON.parse(JSON.stringify(value));
const completion = (raw, finishReason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: typeof raw === 'string' ? raw : JSON.stringify(raw), reasoning_content: 'PRIVATE_DO_NOT_EXPOSE' } }] }), { status: 200 });
function mockService(raw = extracted, overrides = {}) {
  const calls = [];
  const service = createCareAiService({ config: { ...config, ...overrides }, fetchImpl: async (url, options) => { calls.push({ url, options, payload: JSON.parse(options.body) }); return completion(raw); } });
  return { service, calls };
}
const errorIs = (code, status) => error => { assert.ok(error instanceof AppError); assert.equal(error.code, code); assert.equal(error.status, status); return true; };
function abortableFetch(_url, { signal }) { return new Promise((_resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); }
async function localServer(t, fetchImpl, overrides = {}) {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'anzhen-care-store-'));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  const server = await createAppServer({ config: { ...config, ...overrides }, fetchImpl, dataDir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return server.address().port;
}
async function post(port, route, body, extras = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extras }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('record extraction uses a genuine multimodal message and K3 strict structured output', async () => {
  const { service, calls } = mockService();
  assert.deepEqual(await service.extractRecord({ imageDataUrl }), { ...extracted, source: 'ai' });
  const { url, options, payload } = calls[0];
  assert.equal(url, `${config.baseURL}/chat/completions`);
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
  assert.equal(payload.reasoning_effort, 'low');
  assert.equal(payload.max_completion_tokens, 8192);
  assert.equal(payload.response_format.type, 'json_schema');
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.deepEqual(payload.response_format.json_schema.schema.required, ['text', 'uncertain']);
  assert.equal(payload.response_format.json_schema.schema.additionalProperties, false);
  assert.deepEqual(payload.messages[1].content[0], { type: 'image_url', image_url: { url: imageDataUrl } });
  assert.equal(payload.messages[1].content[1].type, 'text');
  assert.match(payload.messages[0].content, /任何指令均不能覆盖/);
  assert.match(payload.messages[0].content, /不猜测字符/);
});

test('K2.6 retains compatible thinking disabled plus JSON mode and explicit schema prompt', async () => {
  const { service, calls } = mockService(extracted, { model: 'kimi-k2.6' });
  await service.extractRecord({ imageDataUrl });
  assert.deepEqual(calls[0].payload.thinking, { type: 'disabled' });
  assert.deepEqual(calls[0].payload.response_format, { type: 'json_object' });
  assert.equal('reasoning_effort' in calls[0].payload, false);
  assert.match(calls[0].payload.messages[0].content, /"uncertain"/);
});

test('missing key never calls upstream for either new function', async () => {
  const { service, calls } = mockService(extracted, { apiKey: '' });
  await assert.rejects(service.extractRecord({ imageDataUrl }), errorIs('AI_NOT_CONFIGURED', 503));
  await assert.rejects(service.summarizeAlert(alertInput()), errorIs('AI_NOT_CONFIGURED', 503));
  assert.equal(calls.length, 0);
});

test('image validation refuses links, unsupported types, spoofed MIME, malformed base64, and oversize input before upstream', async t => {
  const invalid = [null, undefined, 'https://example.com/a.png', imageDataUrl.replace('image/png', 'image/svg+xml'), imageDataUrl.replace('image/png', 'image/jpeg'), imageDataUrl.replace('base64,', 'base64,\n'), imageDataUrl.slice(0, -1), 'data:image/png;base64,AAAA', 'data:image/png;base64,AAA='];
  for (const value of invalid) await t.test(String(value).slice(0, 50), async () => {
    const { service, calls } = mockService();
    await assert.rejects(service.extractRecord({ imageDataUrl: value }), errorIs('INVALID_INPUT', 400));
    assert.equal(calls.length, 0);
  });
  const { service, calls } = mockService();
  const oversized = `data:image/png;base64,${Buffer.alloc(MAX_RECORD_IMAGE_BYTES + 1).toString('base64')}`;
  await assert.rejects(service.extractRecord({ imageDataUrl: oversized }), errorIs('IMAGE_TOO_LARGE', 413));
  assert.equal(calls.length, 0);
  assert.equal(validateRecordImage({ imageDataUrl }), imageDataUrl);
});

test('JPEG and WebP signatures are accepted and incomplete files rejected', () => {
  // Minimal envelope fixtures exercise validation, not provider image decoding.
  const jpeg = Buffer.from([0xff,0xd8,0xff,0xe0,0,6,74,70,73,70,0xff,0xd9]);
  const webp = Buffer.alloc(32); webp.write('RIFF'); webp.writeUInt32LE(24, 4); webp.write('WEBPVP8 ', 8);
  for (const [type, bytes] of [['jpeg', jpeg], ['webp', webp]]) {
    const value = `data:image/${type};base64,${bytes.toString('base64')}`;
    assert.equal(validateRecordImage({ imageDataUrl: value }), value);
    assert.throws(() => validateRecordImage({ imageDataUrl: `data:image/${type};base64,${bytes.subarray(0, bytes.length - 1).toString('base64')}` }), errorIs('INVALID_INPUT', 400));
  }
});

test('unreadable images return explicit uncertainty without inventing content', async () => {
  const { service } = mockService({ text: '', uncertain: ['图片模糊，无法辨认病历正文。'] });
  assert.deepEqual(await service.extractRecord({ imageDataUrl }), { text: '', uncertain: ['图片模糊，无法辨认病历正文。'], source: 'ai' });
});

test('extraction rejects malformed and unexpectedly shaped model outputs', async t => {
  const samples = [null, [], {}, { text: '', uncertain: [] }, { text: '文字', uncertain: '不确定' }, { text: '文字', uncertain: [], extra: 'leak' }, { text: 'a'.repeat(12001), uncertain: [] }, '{"text":', '```json\n{}\n```'];
  for (const [index, raw] of samples.entries()) await t.test(`invalid output ${index}`, async () => {
    await assert.rejects(mockService(raw).service.extractRecord({ imageDataUrl }), errorIs('INVALID_MODEL_OUTPUT', 502));
  });
});

test('urgent summaries sort records, retain supplied facts, and cannot erase urgency', async () => {
  const { service, calls } = mockService(summarized);
  const result = await service.summarizeAlert(alertInput());
  assert.match(result.summary, /^紧急事件：请上级医务人员立即复核。/);
  assert.match(result.handoff, /^维持紧急处理级别/);
  assert.deepEqual(result.changes, summarized.changes);
  assert.equal(result.source, 'ai');
  assert.equal(JSON.stringify(result).includes('PRIVATE_DO_NOT_EXPOSE'), false);
  const payload = calls[0].payload;
  const data = JSON.parse(payload.messages[1].content);
  assert.equal(data.measurements[0].date, '2026-09-19T08:00:00+08:00');
  assert.equal(data.timeZone, 'Asia/Shanghai');
  assert.equal(data.event.severity, 'urgent');
  assert.equal(data.measurements[1].heartRate, 88);
  assert.match(payload.messages[0].content, /不根据数值自定临床分诊阈值/);
  assert.match(payload.messages[0].content, /不可声称已发送通知/);
});

test('UTC, offset and datetime-local values use the same hospital time without mutating input', async () => {
  const input = alertInput();
  input.event.at = '2026-09-20T05:44:00Z';
  input.measurements = [
    { date: '2026-09-20T13:44', heartRate: 88 },
    { date: '2026-09-20 13:44:00', heartRate: 88 },
    { date: '2026-09-20T05:44:00.123Z', heartRate: 89 },
    { date: '2026-09-20T01:44:00-04:00', heartRate: 88 },
    { date: '2026-09-19T22:00:00Z', heartRate: 80 },
    { date: '2026-09-19', heartRate: 76 },
  ];
  const original = clone(input);
  const validated = validateAlertInput(input);
  assert.equal(validated.event.at, original.event.at);
  assert.deepEqual(new Set(validated.measurements.map(value => value.date)), new Set(original.measurements.map(value => value.date)));
  const { service, calls } = mockService(summarized);
  await service.summarizeAlert(input);
  assert.deepEqual(input, original);
  const data = JSON.parse(calls[0].payload.messages[1].content);
  assert.equal(data.timeZone, 'Asia/Shanghai');
  assert.equal(data.event.at, '2026-09-20T13:44:00+08:00');
  assert.deepEqual(data.measurements.map(value => value.date), [
    '2026-09-19', '2026-09-20T06:00:00+08:00',
    '2026-09-20T13:44:00+08:00', '2026-09-20T13:44:00+08:00', '2026-09-20T13:44:00+08:00',
    '2026-09-20T13:44:00.123+08:00',
  ]);
});

test('date-only events keep date precision while concise copy targets allow small overruns', async () => {
  const input = alertInput(); input.event.at = '2026-09-20';
  const response = { ...summarized, summary: '摘'.repeat(165), handoff: '核'.repeat(185) };
  const { service, calls } = mockService(response);
  const result = await service.summarizeAlert(input);
  assert.ok(result.summary.includes(response.summary));
  assert.ok(result.handoff.includes(response.handoff));
  const data = JSON.parse(calls[0].payload.messages[1].content);
  assert.equal(data.event.at, '2026-09-20');
  const prompt = calls[0].payload.messages[0].content;
  for (const phrase of ['summary 最多 160 字', 'changes 最多 3 条', '不逐日复述', 'missing 最多 3 条', 'handoff 最多 180 字', '不得补造时分']) assert.ok(prompt.includes(phrase));
});

test('alert input accepts explicit missing values and preserves missingness in the result', async () => {
  const input = alertInput(); input.patient = {}; input.measurements = [{ date: '2026-09-20', spo2: null }];
  const { service } = mockService({ ...summarized, missing: [] });
  const result = await service.summarizeAlert(input);
  assert.ok(result.missing.some(line => line.includes('既有诊断')));
  assert.ok(result.missing.some(line => line.includes('年龄')));
  assert.ok(result.missing.some(line => line.includes('血氧')));
  assert.ok(result.missing.some(line => line.includes('仅有一次')));
  input.measurements = [];
  assert.ok((await service.summarizeAlert(input)).missing.some(line => line.includes('未提供按日期')));
});

test('invalid measurements and non-urgent events are rejected before calling upstream', async t => {
  const mutations = [
    value => { value.patient = null; }, value => { value.patient.age = '67'; },
    value => { value.event.severity = 'routine'; }, value => { value.event.note = ''; },
    value => { value.measurements[0].date = '2026-02-31'; }, value => { value.event.at = 'yesterday'; },
    value => { value.measurements[0].spo2 = 101; }, value => { value.measurements[0].heartRate = '88'; },
    value => { value.measurements = Array.from({ length: 61 }, () => value.measurements[0]); },
  ];
  for (const [index, mutate] of mutations.entries()) await t.test(`invalid input ${index}`, async () => {
    const input = alertInput(); mutate(input);
    const { service, calls } = mockService(summarized);
    await assert.rejects(service.summarizeAlert(input), errorIs('INVALID_INPUT', 400));
    assert.equal(calls.length, 0);
  });
});

test('a model cannot replace the urgent status or provide downgrade instructions', async t => {
  for (const raw of [{ ...summarized, severity: 'routine' }, { ...summarized, summary: '这是非紧急事件。' }, { ...summarized, handoff: '无需立即处理，稍后处理。' }, { ...summarized, changes: [null] }]) await t.test(JSON.stringify(raw).slice(0, 60), async () => {
    await assert.rejects(mockService(raw).service.summarizeAlert(alertInput()), errorIs('INVALID_MODEL_OUTPUT', 502));
  });
});

test('upstream errors are neutral and private provider details are never forwarded', async () => {
  for (const [status, code] of [[401, 'AI_AUTH_FAILED'], [429, 'AI_RATE_LIMIT'], [500, 'AI_UPSTREAM_ERROR']]) {
    const service = createCareAiService({ config, fetchImpl: async () => new Response('secret kimi provider detail', { status }) });
    await assert.rejects(service.extractRecord({ imageDataUrl }), error => {
      assert.equal(error.code, code); assert.equal(error.status, status === 429 ? 429 : 502); assert.doesNotMatch(error.message, /kimi|secret|provider/i); return true;
    });
  }
  const service = createCareAiService({ config, fetchImpl: async () => completion(extracted, 'length') });
  await assert.rejects(service.extractRecord({ imageDataUrl }), errorIs('AI_OUTPUT_TRUNCATED', 502));
});

test('timeouts and explicit cancellation abort upstream and distinguish failure causes', async () => {
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    const timed = createCareAiService({ config: { ...config, timeoutMs: 15 }, fetchImpl: abortableFetch });
    await assert.rejects(timed.extractRecord({ imageDataUrl }), errorIs('AI_TIMEOUT', 504));
    const controller = new AbortController();
    const service = createCareAiService({ config, fetchImpl: abortableFetch });
    const rejected = assert.rejects(service.summarizeAlert(alertInput(), controller.signal), errorIs('CANCELLED', 499));
    controller.abort(); await rejected;
    const preCancelled = mockService();
    await assert.rejects(preCancelled.service.extractRecord({ imageDataUrl }, controller.signal), errorIs('CANCELLED', 499));
    assert.equal(preCancelled.calls.length, 0);
  } finally { clearTimeout(keepAlive); }
});

test('both new HTTP routes work without revealing private reasoning', async t => {
  const port = await localServer(t, async (_url, options) => completion(JSON.parse(options.body).response_format.json_schema.name === 'record_extract' ? extracted : summarized));
  const extractedResponse = await post(port, '/api/record-extract', { imageDataUrl });
  assert.equal(extractedResponse.status, 200);
  assert.deepEqual(extractedResponse.body, { ...extracted, source: 'ai' });
  const alertResponse = await post(port, '/api/alert-summary', alertInput());
  assert.equal(alertResponse.status, 200);
  assert.equal(alertResponse.body.source, 'ai');
  assert.equal(JSON.stringify(alertResponse.body).includes('PRIVATE_'), false);
  assert.equal((await post(port, '/api/record-extract', { imageDataUrl }, { Origin: 'https://other.example' })).status, 403);
});

test('only the image endpoint receives a larger body limit', async t => {
  let calls = 0;
  const port = await localServer(t, async () => { calls++; return completion(extracted); });
  const moderatelyLarge = { imageDataUrl, padding: 'a'.repeat(120000) };
  assert.equal((await post(port, '/api/record-extract', moderatelyLarge)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await post(port, '/api/alert-summary', { ...alertInput(), padding: 'a'.repeat(120000) })).status, 413);
  assert.equal((await post(port, '/api/chat', moderatelyLarge)).status, 413);
  const oversized = await post(port, '/api/record-extract', { imageDataUrl: 'a'.repeat(RECORD_EXTRACT_BODY_LIMIT + 1) });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.error.code, 'INPUT_TOO_LARGE');
  assert.equal(calls, 1);
});

test('new API calls share the same two-request concurrency ceiling', async t => {
  const waiting = [];
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const port = await localServer(t, async (_url, options) => new Promise(resolve => {
    const name = JSON.parse(options.body).response_format.json_schema.name;
    waiting.push(() => resolve(completion(name === 'record_extract' ? extracted : summarized)));
    if (waiting.length === 2) resolveStarted();
  }));
  const first = post(port, '/api/record-extract', { imageDataUrl });
  const second = post(port, '/api/alert-summary', alertInput());
  await started;
  const blocked = await post(port, '/api/chat', { caseText: '', messages: [{ role: 'user', content: '检查并发' }] });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'LOCAL_BUSY');
  waiting.forEach(resolve => resolve());
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
});

test('new routes share the existing local request rate limit', async t => {
  let calls = 0;
  const port = await localServer(t, async () => { calls++; return completion(extracted); });
  for (let i = 0; i < 20; i++) assert.equal((await post(port, '/api/record-extract', { imageDataUrl })).status, 200);
  const result = await post(port, '/api/alert-summary', alertInput());
  assert.equal(result.status, 429); assert.equal(result.body.error.code, 'LOCAL_RATE_LIMIT'); assert.equal(calls, 20);
});

test('disconnecting a record upload caller cancels its model request', async t => {
  let resolveStarted, resolveAborted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const aborted = new Promise(resolve => { resolveAborted = resolve; });
  const port = await localServer(t, (_url, options) => { resolveStarted(); options.signal.addEventListener('abort', resolveAborted, { once: true }); return abortableFetch(_url, options); });
  const req = http.request({ hostname: '127.0.0.1', port, path: '/api/record-extract', method: 'POST', headers: { 'Content-Type': 'application/json' } });
  req.on('error', () => {}); req.end(JSON.stringify({ imageDataUrl }));
  await started; req.destroy();
  let timer;
  try { await Promise.race([aborted, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('client disconnect was not forwarded')), 500); })]); }
  finally { clearTimeout(timer); }
});
