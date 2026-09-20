import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createAppServer } from './server.mjs';
import { createLlmService, AppError, validateMatch } from './llm.mjs';

// All upstream calls are injected mocks. These tests never load .env or call
// Moonshot; the only network traffic is HTTP to an ephemeral loopback server.
const config = {
  apiKey: 'test-only-key-not-a-real-credential', baseURL: 'https://api.moonshot.cn/v1',
  model: 'kimi-k3', effort: 'low', port: 4173, timeoutMs: 1000,
};
const caseText = '患者65岁，冠心病病史10年，近期冠脉狭窄，拟转诊进行专科评估。';
const acuteCase = '急性非ST段抬高型心肌梗死，目前无胸痛，本院无急诊PCI条件，需立即转诊。';
const doctors = [
  { id: 'd-pci', name: '冠脉示例', title: '主任医师', department: '心内科', photo: '/photo.jpg', bio: '长期从事冠心病诊治，开展冠脉介入和PCI。', expertise: ['冠心病', '冠脉介入'], profile: { officialClinics: ['心血管内科门诊(安贞)'] } },
  { id: 'd-af', name: '房颤示例', title: '副主任医师', department: '心内科', photo: '/photo2.jpg', bio: '从事房颤的射频消融与心脏电生理。', expertise: ['房颤', '射频消融'] },
  { id: 'd-hidden', name: '无图示例', title: '主任医师', department: '心内科', photo: '', bio: '开展冠脉介入和PCI。', expertise: ['冠脉介入'] },
];
const jsonClone = value => JSON.parse(JSON.stringify(value));
function matchOutput() {
  return {
    analysis: { valid: true, urgent: false, category: 'coronary', categoryLabel: '冠脉问题', summary: '病例涉及冠心病专科评估。', referralReason: '依据公开专长核实转诊需求。', tags: ['冠心病'], missing: ['关键检查摘要'] },
    matches: [{ doctorId: 'd-pci', score: 85, scores: { specialty: 40, technique: 25, purpose: 12, evidence: 8 }, reasons: ['公开资料记载冠脉介入。'], evidenceQuotes: ['冠脉介入和PCI'] }],
  };
}
function modelMatchOutput() {
  const raw=matchOutput();
  for (const match of raw.matches) {
    delete match.evidenceQuotes;
    match.evidenceRefs=['bio'];
  }
  return raw;
}
function completion(content, { finishReason = 'stop', reasoning = 'PRIVATE_REASONING_MUST_NOT_LEAK' } = {}) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: finishReason, message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content), reasoning_content: reasoning } }],
    usage: { prompt_tokens: 123, completion_tokens: 45 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function mockedService(content = modelMatchOutput(), overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, payload: JSON.parse(options.body) });
    return completion(typeof content === 'function' ? content() : content);
  };
  return { service: createLlmService({ config: { ...config, ...overrides }, doctors, fetchImpl }), calls };
}
function errorIs(code, status) {
  return error => { assert.ok(error instanceof AppError); assert.equal(error.code, code); assert.equal(error.status, status); return true; };
}
async function localServer(t, fetchImpl, overrides = {}) {
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'anzhen-api-store-'));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  const server = await createAppServer({ config: { ...config, ...overrides }, fetchImpl, dataDir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { server, port: server.address().port };
}
function request(port, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const content = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: { ...(content === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { /* Static content can be text. */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('Local test request timed out')));
    req.end(content);
  });
}
function abortableFetch(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

test('release symlink starts the server while importing it has no startup side effect', { timeout: 15000 }, async () => {
  // Copy only runtime modules into a temporary release: never load a real .env.
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'anzhen-entry-test-'));
  const release = path.join(sandbox, 'releases', 'test-release');
  const current = path.join(sandbox, 'current');
  const children = [];
  const startChild = entry => {
    const child = spawn(process.execPath, [entry], {
      cwd: sandbox,
      env: { PORT: String(port), MOONSHOT_API_KEY: '', KIMI_API_KEY: '', PUBLIC_ORIGIN: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    // Cleanup retains the promise even if a startup assertion fails.
    children.push({ child, closed });
    return { child, closed, output: () => output };
  };
  let port;
  try {
    await fs.mkdir(path.join(release, 'data'), { recursive: true });
    for (const file of ['server.mjs', 'config.mjs', 'llm.mjs', 'care-ai.mjs', 'matching.mjs', 'downward.mjs', 'workspace-store.mjs', 'data/doctors.json']) {
      await fs.copyFile(new URL(file, import.meta.url), path.join(release, file));
    }
    await fs.symlink(release, current, 'dir');
    const reservation = http.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));

    const running = startChild(path.join(current, 'server.mjs'));
    let health;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(running.child.exitCode, null, `Symlink entry exited before listening: ${running.output()}`);
      try { health = await request(port, '/api/health'); break; }
      catch (error) { if (error.code !== 'ECONNREFUSED') throw error; }
      await delay(25);
    }
    assert.equal(health?.status, 200, `Symlink entry did not start: ${running.output()}`);
    assert.deepEqual(health.json, { service: 'anzhen-referral-workspace', status: 'ok' });
    assert.equal((await request(port, '/api/config')).json.configured, false);
    running.child.kill('SIGTERM');
    await running.closed;

    const wrapper = path.join(sandbox, 'import-only.mjs');
    await fs.writeFile(wrapper, 'await import("./current/server.mjs");\nprocess.stdout.write("IMPORTED_ONLY\\n");\n');
    const imported = startChild(wrapper);
    const result = await Promise.race([imported.closed, delay(3000, undefined, { ref: false }).then(() => ({ timedOut: true }))]);
    assert.deepEqual(result, { code: 0, signal: null }, 'Importing the server must finish without opening a listener');
    assert.equal(imported.output(), 'IMPORTED_ONLY\n');
  } finally {
    for (const { child, closed } of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed.catch(() => {});
    }
    await fs.rm(sandbox, { recursive: true, force: true });
  }
});

test('K3 match requests use strict schema, low reasoning effort and completion-token budget', async () => {
  const { service, calls } = mockedService();
  const result = await service.match({ caseText });
  assert.equal(calls.length, 1);
  const { url, options, payload } = calls[0];
  assert.equal(url, 'https://api.moonshot.cn/v1/chat/completions');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
  assert.equal(payload.model, 'kimi-k3');
  assert.equal(payload.reasoning_effort, 'low');
  assert.equal(payload.max_completion_tokens, 16384);
  assert.equal(payload.stream, false);
  assert.equal('max_tokens' in payload, false);
  assert.equal(payload.response_format.type, 'json_schema');
  assert.equal(payload.response_format.json_schema.strict, true);
  const schema = payload.response_format.json_schema.schema;
  const visit = node => {
    if (node.type === 'object') { assert.equal(node.additionalProperties, false); assert.deepEqual(node.required, Object.keys(node.properties)); Object.values(node.properties).forEach(visit); }
    if (node.items) visit(node.items);
  };
  visit(schema);
  assert.deepEqual(schema.properties.matches.items.properties.doctorId.enum, ['d-pci', 'd-af']);
  assert.deepEqual(schema.properties.matches.items.properties.evidenceRefs.items.enum, ['bio','expertise:0','expertise:1','clinic:0']);
  assert.equal('evidenceQuotes' in schema.properties.matches.items.properties,false);
  assert.equal(payload.messages[0].content.includes('d-hidden'), false);
  assert.equal(result.ranked[0].id, 'd-pci');
  assert.equal(result.ranked[0].score, result.ranked[0].breakdown.reduce((sum, part) => sum + part.value, 0));
  assert.ok(result.ranked[0].reasons.some(reason => reason.includes('资料原文')));
  assert.deepEqual(result.meta, { provider: 'kimi', model: 'kimi-k3', usage: { promptTokens: 123, completionTokens: 45 } });
  assert.equal(JSON.stringify(result).includes('PRIVATE_REASONING'), false);
});

test('model output rejects score mismatch, invalid IDs, fabricated evidence, hidden photos and duplicate IDs', async t => {
  const mutations = {
    'score mismatch': raw => { raw.matches[0].score++; },
    'unknown doctor': raw => { raw.matches[0].doctorId = 'invented-id'; },
    'fabricated quote': raw => { raw.matches[0].evidenceQuotes = ['具备国际首创心脏移植资质']; },
    'hidden photo': raw => { raw.matches[0].doctorId = 'd-hidden'; },
    'duplicate doctor': raw => { raw.matches.push(jsonClone(raw.matches[0])); },
    'dimension beyond maximum': raw => { raw.matches[0].scores.specialty = 46; raw.matches[0].score = 91; },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const raw = modelMatchOutput(); mutate(raw);
    const { service } = mockedService(raw);
    await assert.rejects(service.match({ caseText }), errorIs('INVALID_MODEL_OUTPUT', 502));
  });
});

test('matching and chat share the same scoring rubric and forbid availability or education scoring', async () => {
  const match=mockedService();
  await match.service.match({caseText});
  const chat=mockedService('四项匹配分并非成功概率。');
  await chat.service.chat({caseText,messages:[{role:'user',content:'评分依据是什么？'}]});
  for(const prompt of [match.calls[0].payload.messages[0].content,chat.calls[0].payload.messages[0].content]){
    for(const phrase of ['专业方向 specialty 0–45','相关技术 technique 0–30','转诊目的 purpose 0–15','资料充分性 evidence 0–10','排班、号源、医生职称、姓名、学历','具体技术能力需核实']) assert.ok(prompt.includes(phrase));
  }
  assert.ok(match.calls[0].payload.messages[0].content.includes('reasons 为1–4条'));
  assert.ok(match.calls[0].payload.messages[0].content.includes('evidenceRefs 为1–3条'));
});

test('malformed match items produce a controlled upstream-output error', async () => {
  const raw = modelMatchOutput(); raw.matches = [null];
  const { service } = mockedService(raw);
  await assert.rejects(service.match({ caseText }), errorIs('INVALID_MODEL_OUTPUT', 502));
});

test('evidence references resolve only to the selected doctor original source fields', async () => {
  const raw=modelMatchOutput();
  raw.matches[0].evidenceRefs=['bio','expertise:1','clinic:0'];
  const first=await mockedService(raw).service.match({caseText});
  assert.deepEqual(first.ranked[0].evidenceQuotes,[doctors[0].bio,doctors[0].expertise[1],doctors[0].profile.officialClinics[0]]);
  assert.equal('evidenceRefs' in first.ranked[0],false);
  const second=modelMatchOutput();
  second.matches[0].doctorId='d-af';
  second.matches[0].evidenceRefs=['bio','expertise:0'];
  const result=await mockedService(second).service.match({caseText});
  assert.deepEqual(result.ranked[0].evidenceQuotes,[doctors[1].bio,doctors[1].expertise[0]]);
  assert.equal(result.ranked[0].evidenceQuotes.includes(doctors[0].bio),false);
});

test('invalid or cross-doctor evidence references cannot become accepted quotes', async t => {
  const mutations={
    'missing references': match=>{delete match.evidenceRefs;},
    'empty references': match=>{match.evidenceRefs=[];},
    'too many references': match=>{match.evidenceRefs=['bio','expertise:0','expertise:1','clinic:0'];},
    'duplicate references': match=>{match.evidenceRefs=['bio','bio'];},
    'unknown field': match=>{match.evidenceRefs=['department'];},
    'negative index': match=>{match.evidenceRefs=['expertise:-1'];},
    'padded index': match=>{match.evidenceRefs=['expertise:01'];},
    'out of bounds': match=>{match.evidenceRefs=['expertise:99'];},
    'another doctor reference': match=>{match.evidenceRefs=['d-af:bio'];},
    'clinic only present on another doctor': match=>{match.doctorId='d-af';match.evidenceRefs=['clinic:0'];},
    'hidden doctor': match=>{match.doctorId='d-hidden';},
    'missing doctor ID': match=>{delete match.doctorId;},
    'quotes without references': match=>{delete match.evidenceRefs;match.evidenceQuotes=[doctors[0].bio];},
    'extra fabricated quote': match=>{match.evidenceQuotes=['可完成心脏移植'];},
  };
  for(const [name,mutate] of Object.entries(mutations)) await t.test(name,async()=>{
    const raw=modelMatchOutput();mutate(raw.matches[0]);
    await assert.rejects(mockedService(raw).service.match({caseText}),errorIs('INVALID_MODEL_OUTPUT',502));
  });
  const legacy=matchOutput();legacy.matches[0].evidenceQuotes=['具备国际首创心脏移植资质'];
  assert.throws(()=>validateMatch(legacy,doctors,caseText),errorIs('INVALID_MODEL_OUTPUT',502));
});

test('explicit procedure evidence limits unsupported scores and replaces unsupported reasons', () => {
  const raw=matchOutput();
  const candidate={...doctors[0],bio:'房颤及心脏电生理评估。',expertise:['房颤','心脏电生理']};
  raw.matches[0].evidenceQuotes=['心脏电生理评估'];
  raw.matches[0].reasons=['可完成导管消融。'];
  const current='患者反复房颤6个月，拟转诊评估导管消融。';
  const result=validateMatch(raw,[candidate],current).ranked[0];
  assert.equal(result.breakdown[1].value,10);
  assert.equal(result.score,70);
  assert.match(result.reasons.join(' '),/具体技术能力需.*核实/);
  assert.doesNotMatch(result.reasons.join(' '),/可完成导管消融/);
  for(const history of ['既往导管消融术后，现转诊随访。','反复房颤，目前无需导管消融，转诊药物评估。','既往房颤行导管消融术后1年，本次仅需随访，不评估再次消融。']){
    assert.equal(validateMatch(raw,[candidate],history).ranked[0].score,85);
  }
  const established={...candidate,bio:'开展房颤射频消融与心脏电生理评估。',expertise:['射频消融']};
  assert.equal(validateMatch(raw,[established],current).ranked[0].score,85);
  assert.equal(validateMatch(raw,[established],'房颤反复发作，拟转诊评估脉冲电场消融。').ranked[0].score,70);
});

test('clinic membership alone gives no technique points and cannot imply appointment convenience', () => {
  const raw=matchOutput();
  raw.matches[0].reasons=['开设特需门诊，便于择期就诊安排。'];
  raw.matches[0].evidenceQuotes=['心血管内科门诊(安贞)'];
  const unknown={...doctors[0],bio:'暂无公开详细简介',expertise:[]};
  const result=validateMatch(raw,[unknown],caseText).ranked[0];
  assert.equal(result.breakdown[1].value,0);
  assert.equal(result.score,60);
  assert.doesNotMatch(result.reasons.join(' '),/便于择期/);
  assert.match(result.reasons.join(' '),/门诊归属不能证明技术能力/);
});

test('truncated JSON and finish_reason length never return partial matches', async () => {
  const { service } = mockedService('{"analysis":');
  await assert.rejects(service.match({ caseText }), errorIs('INVALID_MODEL_OUTPUT', 502));
  const truncated = createLlmService({ config, doctors, fetchImpl: async () => completion(modelMatchOutput(), { finishReason: 'length' }) });
  await assert.rejects(truncated.match({ caseText }), errorIs('KIMI_OUTPUT_TRUNCATED', 502));
});

test('local acute guard prevents a model from routing explicit acute MI to ordinary scheduling', async () => {
  const { service } = mockedService();
  const result = await service.match({ caseText: acuteCase });
  assert.equal(result.analysis.urgent, true);
  assert.match(result.analysis.referralReason, /立即.*不等待普通排班/);
  const raw = modelMatchOutput(); raw.analysis.valid = false; raw.analysis.category = 'unrelated'; raw.matches = [];
  const second = await mockedService(raw).service.match({ caseText: acuteCase });
  assert.equal(second.analysis.valid, true);
  assert.equal(second.analysis.urgent, true);
  assert.equal(second.analysis.category, 'coronary');
});

test('acute guard rejects a model match with a conflicting specialty', async () => {
  const raw = modelMatchOutput();
  raw.analysis.category = 'arrhythmia'; raw.analysis.categoryLabel = '房颤';
  raw.matches[0].doctorId = 'd-af';
  const { service } = mockedService(raw);
  await assert.rejects(service.match({ caseText: acuteCase }), errorIs('INVALID_MODEL_OUTPUT', 502));
});

test('chat carries visible history, case and selected doctor without replaying or exposing reasoning', async () => {
  const { service, calls } = mockedService('资料显示该医生从事冠脉介入。');
  const messages = [
    { role: 'user', content: '这位医生的方向是什么？', reasoning_content: 'INJECTED_PRIVATE_REASONING' },
    { role: 'assistant', content: '公开资料显示冠脉介入。', reasoning_content: 'OLD_PRIVATE_REASONING' },
    { role: 'user', content: '请说明依据。' },
  ];
  const result = await service.chat({ caseText, doctorId: 'd-pci', messages });
  assert.equal(result.answer, '资料显示该医生从事冠脉介入。');
  const payload = calls[0].payload;
  assert.match(payload.messages[0].content,/中文纯文本/);
  assert.match(payload.messages[0].content,/不使用 Markdown 加粗、标题、表格或星号标记/);
  assert.equal(payload.max_completion_tokens, 8192);
  assert.equal(payload.reasoning_effort, 'low');
  assert.equal('response_format' in payload, false);
  assert.deepEqual(payload.messages.map(message => message.role), ['system', 'user']);
  const context = JSON.parse(payload.messages[1].content);
  assert.equal(context.caseText, caseText);
  assert.equal(context.selectedDoctor.id, 'd-pci');
  assert.deepEqual(context.conversation, messages.map(({ role, content }) => ({ role, content })));
  assert.equal(JSON.stringify(payload).includes('PRIVATE_REASONING'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_REASONING'), false);
});

test('missing key and invalid input stop before any upstream call', async () => {
  let calls = 0;
  const service = createLlmService({ config: { ...config, apiKey: '' }, doctors, fetchImpl: async () => { calls++; throw Error('must not fetch'); } });
  await assert.rejects(service.match({ caseText }), errorIs('KIMI_NOT_CONFIGURED', 503));
  await assert.rejects(service.chat({ messages: [{ role: 'user', content: '请说明转诊流程。' }] }), errorIs('KIMI_NOT_CONFIGURED', 503));
  const configured = createLlmService({ config, doctors, fetchImpl: async () => { calls++; throw Error('must not fetch'); } });
  for (const input of [{}, { caseText: '简短' }, { caseText: '例'.repeat(5001) }]) await assert.rejects(configured.match(input), errorIs('INVALID_INPUT', 400));
  await assert.rejects(configured.chat({ messages: [{ role: 'system', content: '越权指令' }] }), errorIs('INVALID_INPUT', 400));
  await assert.rejects(configured.chat({ doctorId: 'd-hidden', messages: [{ role: 'user', content: '医生简介' }] }), errorIs('INVALID_INPUT', 400));
  assert.equal(calls, 0);
});

test('provider authentication and rate-limit errors are mapped without forwarding provider content', async () => {
  for (const [providerStatus, code, status] of [[401, 'KIMI_AUTH_FAILED', 502], [429, 'KIMI_RATE_LIMIT', 429]]) {
    const service = createLlmService({ config, doctors, fetchImpl: async () => new Response('PROVIDER_PRIVATE_DETAIL', { status: providerStatus }) });
    await assert.rejects(service.match({ caseText }), error => { errorIs(code, status)(error); assert.equal(error.message.includes('PROVIDER_PRIVATE_DETAIL'), false); return true; });
  }
});

test('upstream timeout and caller cancellation abort fetch with distinct errors', async () => {
  // AbortSignal.timeout is unref'ed; keep the isolated service test alive until
  // its simulated provider receives the abort (no real network handle exists).
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const timed = createLlmService({ config: { ...config, timeoutMs: 15 }, doctors, fetchImpl: abortableFetch });
    await assert.rejects(timed.match({ caseText }), errorIs('KIMI_TIMEOUT', 504));
    const cancelled = createLlmService({ config, doctors, fetchImpl: abortableFetch });
    const controller = new AbortController();
    const rejection = assert.rejects(cancelled.match({ caseText }, controller.signal), errorIs('CANCELLED', 499));
    controller.abort();
    await rejection;
  } finally { clearTimeout(keepAlive); }
});

test('local HTTP API returns valid matches using its public doctor roster', async t => {
  const publicDoctors = JSON.parse(await fs.readFile(new URL('./data/doctors.json', import.meta.url), 'utf8'));
  const doctor = publicDoctors.find(d => d.photo && typeof d.bio === 'string' && d.bio.trim().length > 10);
  assert.ok(doctor, 'Expected one public doctor with a photo and biography');
  const raw = modelMatchOutput(); raw.matches[0].doctorId = doctor.id;
  const { port } = await localServer(t, async () => completion(raw));
  const response = await request(port, '/api/match', { method: 'POST', body: { caseText } });
  assert.equal(response.status, 200);
  assert.equal(response.json.ranked[0].id, doctor.id);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.text.includes(config.apiKey), false);
});

test('health reports local service identity without credentials or upstream calls', async t => {
  let upstreamCalls = 0;
  for (const apiKey of [config.apiKey, '']) {
    const { port } = await localServer(t, async () => { upstreamCalls++; throw Error('unexpected fetch'); }, { apiKey });
    const response = await request(port, '/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, { service: 'anzhen-referral-workspace', status: 'ok' });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(upstreamCalls, 0);
});

test('private files, encoded traversal and unexpected Host or Origin are blocked', async t => {
  let upstreamCalls = 0;
  const { port } = await localServer(t, async () => { upstreamCalls++; throw Error('unexpected fetch'); });
  for (const path of ['/.env', '/config.mjs', '/server.mjs', '/llm.mjs', '/api.test.mjs', '/package.json', '/%2eenv', '/%2e%2e/.env', '/..%2F.env', '/assets/doctors/..%2F..%2F.env', '/%252e%252e%252f.env']) {
    const response = await request(port, path);
    assert.equal(response.status, 404, path);
    assert.equal(response.json.error.code, 'NOT_FOUND', path);
  }
  for (const path of ['/api/config', '/api/health']) {
    const badHost = await request(port, path, { headers: { Host: 'attacker.example' } });
    assert.equal(badHost.status, 403);
    assert.equal(badHost.json.error.code, 'FORBIDDEN_HOST');
  }
  for (const path of ['/api/config', '/api/health', '/api/match']) {
    const response = await request(port, path, { method: path.endsWith('match') ? 'POST' : 'GET', body: path.endsWith('match') ? { caseText } : undefined, headers: { Origin: 'https://attacker.example' } });
    assert.equal(response.status, 403);
    assert.equal(response.json.error.code, 'FORBIDDEN_ORIGIN');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  const allowed = await request(port, '/api/config', { headers: { Origin: `http://127.0.0.1:${port}` } });
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.json, { configured: true, provider: 'kimi', model: 'kimi-k3', maxCaseLength: 5000 });
  assert.equal(allowed.text.includes(config.apiKey), false);
  assert.equal(upstreamCalls, 0);
});

test('explicit HTTPS public origin works behind a loopback proxy and keeps local health accessible', async t => {
  let upstreamCalls = 0;
  const publicOrigin = 'https://referral.example:8443';
  const { port } = await localServer(t, async () => { upstreamCalls++; throw Error('unexpected fetch'); }, { publicOrigin, apiKey: '' });
  const headers = { Host: 'referral.example:8443', Origin: publicOrigin };
  const homepage = await request(port, '/', { headers });
  assert.equal(homepage.status, 200);
  assert.match(homepage.headers['content-type'], /^text\/html/);
  const configResponse = await request(port, '/api/config', { headers });
  assert.equal(configResponse.status, 200);
  assert.equal(configResponse.json.configured, false);
  const match = await request(port, '/api/match', { method: 'POST', body: { caseText }, headers });
  assert.equal(match.status, 503);
  assert.equal(match.json.error.code, 'KIMI_NOT_CONFIGURED');
  for (const privatePath of ['/.env', '/server.mjs', '/config.mjs']) {
    assert.equal((await request(port, privatePath, { headers })).status, 404);
  }
  assert.equal((await request(port, '/api/health')).status, 200);
  assert.equal((await request(port, '/api/config', { headers: { Origin: `http://127.0.0.1:${port}` } })).status, 200);
  assert.equal(upstreamCalls, 0);
});

test('configured public Host and Origin require exact host, port and scheme matches', async t => {
  let upstreamCalls = 0;
  const publicOrigin = 'https://referral.example:8443';
  const { port } = await localServer(t, async () => { upstreamCalls++; throw Error('unexpected fetch'); }, { publicOrigin });
  for (const Host of ['referral.example', 'referral.example:443', 'sub.referral.example:8443', 'referral.example:8443.attacker.example', 'attacker.example']) {
    const response = await request(port, '/api/health', { headers: { Host } });
    assert.equal(response.status, 403, Host);
    assert.equal(response.json.error.code, 'FORBIDDEN_HOST', Host);
  }
  for (const Origin of ['http://referral.example:8443', 'https://referral.example', 'https://referral.example:8443/', 'https://attacker.example', 'null']) {
    const response = await request(port, '/api/match', { method: 'POST', body: { caseText }, headers: { Host: 'referral.example:8443', Origin } });
    assert.equal(response.status, 403, Origin);
    assert.equal(response.json.error.code, 'FORBIDDEN_ORIGIN', Origin);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(upstreamCalls, 0);
});

test('forwarded headers cannot bypass local or public origin checks', async t => {
  let upstreamCalls = 0;
  const publicOrigin = 'https://referral.example';
  for (const publicOriginOption of ['', publicOrigin]) {
    const { port } = await localServer(t, async () => { upstreamCalls++; throw Error('unexpected fetch'); }, { publicOrigin: publicOriginOption });
    const forwarded = { 'X-Forwarded-Host': 'referral.example', 'X-Forwarded-Proto': 'https', Forwarded: 'host=referral.example;proto=https' };
    const badHost = await request(port, '/api/health', { headers: { Host: 'attacker.example', Origin: publicOrigin, ...forwarded } });
    assert.equal(badHost.status, 403);
    assert.equal(badHost.json.error.code, 'FORBIDDEN_HOST');
    const loopback = await request(port, '/api/config', { headers: { Origin: publicOrigin, ...forwarded } });
    assert.equal(loopback.status, 403);
    assert.equal(loopback.json.error.code, 'FORBIDDEN_ORIGIN');
    const spoofed = await request(port, '/api/config', { headers: { Host: 'referral.example', Origin: 'http://referral.example', ...forwarded } });
    assert.equal(spoofed.status, 403);
    assert.equal(spoofed.json.error.code, publicOriginOption ? 'FORBIDDEN_ORIGIN' : 'FORBIDDEN_HOST');
  }
  assert.equal(upstreamCalls, 0);
});

test('an explicit HTTP IP origin is accepted without allowing an implicit HTTPS variant', async t => {
  const { port } = await localServer(t, async () => { throw Error('unexpected fetch'); }, { publicOrigin: 'http://8.147.71.90' });
  const response = await request(port, '/api/health', { headers: { Host: '8.147.71.90', Origin: 'http://8.147.71.90' } });
  assert.equal(response.status, 200);
  const wrongScheme = await request(port, '/api/health', { headers: { Host: '8.147.71.90', Origin: 'https://8.147.71.90' } });
  assert.equal(wrongScheme.status, 403);
  assert.equal(wrongScheme.json.error.code, 'FORBIDDEN_ORIGIN');
});

test('HTTP input errors and missing-key status have controlled JSON responses', async t => {
  let upstreamCalls = 0;
  const { port } = await localServer(t, async () => { upstreamCalls++; throw Error('unexpected fetch'); }, { apiKey: '' });
  const fixtures = [
    [{ method: 'GET' }, 405, 'METHOD_NOT_ALLOWED'],
    [{ method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } }, 415, 'JSON_REQUIRED'],
    [{ method: 'POST', body: '{' }, 400, 'INVALID_JSON'],
    [{ method: 'POST', body: [] }, 400, 'INVALID_JSON'],
    [{ method: 'POST', body: { caseText } }, 503, 'KIMI_NOT_CONFIGURED'],
  ];
  for (const [options, status, code] of fixtures) {
    const response = await request(port, '/api/match', options);
    assert.equal(response.status, status);
    assert.equal(response.json.error.code, code);
  }
  assert.equal(upstreamCalls, 0);
});

test('an oversized HTTP request returns an explicit 413 without calling the provider', async t => {
  let upstreamCalls = 0;
  const { port } = await localServer(t, async () => { upstreamCalls++; throw Error('unexpected fetch'); });
  const response = await request(port, '/api/match', { method: 'POST', body: { caseText: 'a'.repeat(120000) } });
  assert.equal(response.status, 413);
  assert.equal(response.json.error.code, 'INPUT_TOO_LARGE');
  assert.equal(upstreamCalls, 0);
});

test('an oversized streaming upload gets a 413 before the client finishes uploading', async t => {
  const { port } = await localServer(t, async () => { throw Error('unexpected fetch'); });
  const response = await new Promise((resolve, reject) => {
    let timer;
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/match', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { clearTimeout(timer); req.destroy(); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
      res.on('error', error => { clearTimeout(timer); reject(error); });
    });
    req.on('error', error => { clearTimeout(timer); reject(error); });
    timer = setTimeout(() => req.destroy(Error('Oversized upload received no early rejection')), 500);
    req.write('{"caseText":"');
    req.write('a'.repeat(110000));
    // Deliberately leave the upload open: exceeding the limit is already known.
  });
  assert.equal(response.status, 413);
  assert.equal(JSON.parse(response.body).error.code, 'INPUT_TOO_LARGE');
});

test('disconnecting an HTTP client cancels the outstanding provider request', async t => {
  let resolveStarted, resolveAborted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const aborted = new Promise(resolve => { resolveAborted = resolve; });
  const { port } = await localServer(t, (_url, options) => {
    resolveStarted();
    options.signal.addEventListener('abort', resolveAborted, { once: true });
    return abortableFetch(_url, options);
  });
  const req = http.request({ hostname: '127.0.0.1', port, path: '/api/match', method: 'POST', headers: { 'Content-Type': 'application/json' } });
  req.on('error', () => {});
  req.end(JSON.stringify({ caseText }));
  await started;
  req.destroy();
  let timer;
  try { await Promise.race([aborted, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('Client disconnect did not cancel upstream')), 500); })]); }
  finally { clearTimeout(timer); }
});
