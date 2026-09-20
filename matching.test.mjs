import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCase, rankDoctors, buildSchedule } from './matching.mjs';

const doctors = [
  { id: 'coronary', name: '冠脉示例医生', title: '主任医师', department: '心内科', photo: '/photos/coronary.jpg', bio: '从事心血管诊疗，擅长复杂冠心病介入与PCI。', expertise: ['冠心病', '冠脉介入', 'PCI'], education: '', sourceUrls: [] },
  { id: 'af', name: '房颤示例医生', title: '副主任医师', department: '心内科', photo: '/photos/af.jpg', bio: '专长为房颤、房扑的导管消融及心脏电生理。', expertise: ['房颤', '导管消融'], education: '', sourceUrls: [] },
  { id: 'pacing', name: '起搏示例医生', title: '主任医师', department: '心内科', photo: '/photos/pacing.jpg', bio: '主要处理心动过缓，开展起搏器植入。', expertise: ['心动过缓', '起搏器植入'], education: '', sourceUrls: [] },
  { id: 'surgery', name: '搭桥示例医生', title: '主任医师', department: '心外科', photo: '/photos/surgery.jpg', bio: '擅长冠脉搭桥、瓣膜置换及主动脉手术。', expertise: ['冠脉搭桥', '瓣膜置换'], education: '', sourceUrls: [] },
  { id: 'generic', name: '资料不足示例医生', title: '主任医师、教授', department: '冠脉介入中心', photo: '/photos/generic.jpg', bio: '长期从事教学工作。', expertise: [], education: '', sourceUrls: [] },
  { id: 'no-photo', name: '无照片示例医生', title: '主任医师', department: '心内科', photo: '', bio: '擅长冠脉介入及PCI。', expertise: ['冠心病', 'PCI'], education: '', sourceUrls: [] },
];

test('empty, placeholder, and non-substantive input cannot produce matches', () => {
  for (const input of ['', '   ', '帮我看看病例', '冠心病', null, '测试测试测试测试测试测试测试']) {
    const result = analyzeCase(input);
    assert.equal(result.valid, false, String(input));
    assert.equal(result.urgent, false);
    assert.deepEqual(rankDoctors(doctors, result), []);
  }
});

test('unrelated disease cannot be matched to a cardiovascular doctor', () => {
  const result = analyzeCase('患者35岁，反复鼻炎3年，近期鼻塞加重，拟转诊耳鼻喉科评估。');
  assert.equal(result.valid, false);
  assert.equal(result.category, 'unrelated');
  assert.deepEqual(rankDoctors(doctors, result), []);
  const orthopedic = analyzeCase('患者65岁，膝关节置换术后康复2个月，拟进行运动康复评估。');
  assert.equal(orthopedic.valid, false);
  assert.deepEqual(rankDoctors(doctors, orthopedic), []);
});

test('acute myocardial infarction uses immediate contact and prioritizes documented PCI evidence', () => {
  const result = analyzeCase('患者男65岁，急性胸痛4小时，心电图ST段抬高，考虑急性心肌梗死，当前医院无PCI资质，申请转院。');
  assert.equal(result.valid, true);
  assert.equal(result.urgent, true);
  assert.equal(result.category, 'coronary');
  assert.match(result.referralReason, /立即对接/);
  assert.match(result.referralReason, /不等待普通排班/);
  const ranked = rankDoctors(doctors, result);
  assert.equal(ranked[0].id, 'coronary');
  assert.ok(ranked[0].score > ranked.find(d => d.id === 'surgery').score);
  assert.ok(ranked[0].matchedTerms.includes('PCI'));
  assert.ok(ranked[0].reasons.some(r => /匹配参考分/.test(r)));
  assert.ok(!ranked.some(d => d.id === 'generic'));
});

test('explicit acute ST and non-ST infarction stays urgent when chest pain has resolved', () => {
  const cases = [
    ['急性ST段抬高型心肌梗死，当前胸痛已缓解，本院无急诊PCI条件，需立即转诊', false],
    ['急性非ST段抬高型心肌梗死，目前无胸痛', true],
    ['患者62岁，急性非 ST 段抬高性心梗，目前无胸痛，拟转院。', true],
    ['患者62岁，诊断急性NSTEMI，目前无胸痛，需转诊评估。', true],
    ['患者62岁，NSTEMI，目前胸痛已缓解，需转诊。', true],
    ['患者62岁，STEMI，目前胸痛已缓解，需转诊。', false],
  ];
  for (const [input, nonSt] of cases) {
    const result = analyzeCase(input);
    assert.equal(result.valid, true, input);
    assert.equal(result.urgent, true, input);
    assert.equal(result.category, 'coronary', input);
    assert.match(result.referralReason, /立即对接.*不等待普通排班/);
    if (nonSt) {
      assert.ok(!result.tags.includes('ST段抬高'), input);
      assert.ok(!result.tags.includes('STEMI'), input);
    }
    assert.equal(rankDoctors(doctors, result)[0].id, 'coronary');
  }
  assert.ok(analyzeCase(cases[0][0]).tags.includes('当前医院无PCI条件（病例自述）'));
});

test('qualified infarction negation and historical diagnoses stay nonurgent', () => {
  const cases = [
    '患者62岁，胸痛4小时，已排除急性非ST段抬高型心肌梗死，拟门诊评估。',
    '患者62岁，胸痛4小时，排除急性ST段抬高型心肌梗死，拟门诊评估。',
    '患者62岁，排除NSTEMI，目前无胸痛，拟门诊评估。',
    '患者62岁，既往急性ST段抬高型心肌梗死，目前无胸痛，拟复查。',
    '患者62岁，急性非ST段抬高型心肌梗死术后1个月，目前稳定，拟随访。',
    '患者62岁，5年前曾患NSTEMI，目前无胸痛，拟复查。',
    '患者62岁，无非ST段抬高型心肌梗死病史，目前无胸痛。',
    '患者62岁，非ST段抬高，目前无胸痛，拟门诊咨询。',
  ];
  for (const input of cases) assert.equal(analyzeCase(input).urgent, false, input);
  assert.equal(analyzeCase(cases.at(-1)).valid, false);
});

test('explicit negation and elective coronary follow-up do not trigger urgent flags', () => {
  const cases = [
    '患者62岁，冠心病病史8年，无胸痛，无ST段抬高，排除心梗，拟择期复查。',
    '患者60岁，冠心病长期稳定，否认胸痛，心梗已排除，心电图未见ST段抬高，拟门诊评估。',
    '患者60岁，冠心病长期稳定，无明显胸痛，未发现心电图有ST段抬高，拟择期转诊。',
    '患者68岁，5年前发生急性心肌梗死，目前病情稳定，门诊复查。',
    '患者60岁，急性心梗术后1个月恢复良好，拟复查随访。',
  ];
  for (const input of cases) assert.equal(analyzeCase(input).urgent, false, input);
  const negatedOnly = analyzeCase('患者无胸痛，否认胸痛，排除心梗，无ST段抬高，来院咨询。');
  assert.equal(negatedOnly.urgent, false);
  assert.equal(negatedOnly.valid, false);
  assert.deepEqual(rankDoctors(doctors, negatedOnly), []);
});

test('new acute symptoms after a historical infarction remain recognizable', () => {
  const result = analyzeCase('患者65岁，既往心肌梗死5年。今日新发胸痛4小时，心电图ST段抬高，当前医院无法开展PCI。');
  assert.equal(result.urgent, true);
});

test('AF sorting follows actual AF evidence rather than title or pacing alone', () => {
  const analysis = analyzeCase('患者女性58岁，反复心悸2年，已诊断房颤，近期发作增多，拟转诊进行专科评估。');
  assert.equal(analysis.category, 'arrhythmia');
  assert.equal(analysis.urgent, false);
  const ranked = rankDoctors(doctors, analysis);
  assert.equal(ranked[0].id, 'af');
  assert.ok(ranked[0].score > ranked.find(d => d.id === 'pacing').score);
  assert.ok(ranked[0].matchedTerms.includes('房颤'));
  assert.ok(ranked[0].reasons.some(r => r.includes('导管消融')));
  const oncology = { ...doctors[0], id: 'oncology', bio: '从事肝癌射频消融。', expertise: ['肿瘤射频消融'] };
  assert.deepEqual(rankDoctors([oncology], analysis), []);
});

test('photos are required and title/department alone are insufficient clinical evidence', () => {
  const result = analyzeCase('患者65岁，冠心病10年，近期复查提示冠脉狭窄，拟转诊专科评估。');
  const ranked = rankDoctors(doctors, result);
  assert.ok(!ranked.some(d => d.id === 'no-photo'));
  assert.ok(!ranked.some(d => d.id === 'generic'));
  const diseaseOnly = { ...doctors[0], bio: '从事冠心病一般诊疗。', expertise: ['冠心病'] };
  assert.ok(rankDoctors([diseaseOnly], result)[0].score < 70);
});

test('heart failure, valve, vascular, and rehabilitation categories remain supported', () => {
  const cases = [
    ['患者70岁，慢性心衰3年，近期超声提示射血分数降低，拟转诊评估。', 'heart_failure'],
    ['患者62岁，超声提示二尖瓣重度关闭不全，病情稳定，拟转诊评估。', 'valve'],
    ['患者72岁，主动脉瘤随访2年，近期复查稳定，拟专科评估。', 'vascular'],
    ['患者66岁，冠脉搭桥术后3个月，恢复稳定，希望转诊心脏康复评估。', 'rehabilitation'],
  ];
  for (const [input, category] of cases) {
    const analysis = analyzeCase(input);
    assert.equal(analysis.valid, true);
    assert.equal(analysis.category, category);
    assert.equal(analysis.urgent, false);
  }
});

test('rehabilitation affiliation fallback requires the verified Anzhen clinic and a photo', () => {
  const analysis = analyzeCase('患者66岁，冠脉搭桥术后3个月，恢复稳定，希望转诊心脏康复评估。');
  const affiliationOnly = {
    ...doctors[0], id: 'rehab-clinic', department: '心脏康复中心',
    bio: '从事冠心病与高血压诊疗。', expertise: ['冠心病', '高血压'],
    profile: { officialClinics: ['心脏康复中心门诊(安贞)'] },
  };
  assert.deepEqual(rankDoctors([{ ...affiliationOnly, profile: undefined }], analysis), []);
  assert.deepEqual(rankDoctors([{ ...affiliationOnly, photo: '' }], analysis), []);
  assert.deepEqual(rankDoctors([{ ...affiliationOnly, profile: { officialClinics: ['心脏康复中心门诊(高新)'] } }], analysis), []);
  const specificRehab = { ...doctors[0], id: 'rehab-expertise', bio: '从事心脏康复、运动评估。', expertise: ['心脏康复', '康复评估'] };
  const ranked = rankDoctors([affiliationOnly, specificRehab], analysis);
  assert.deepEqual(ranked.map(doctor => doctor.id), ['rehab-expertise', 'rehab-clinic']);
  assert.ok(ranked[0].score > ranked[1].score);
  assert.equal(ranked[1].score, 55);
  assert.deepEqual(ranked[1].matchedTerms, ['心脏康复中心门诊(安贞)']);
  assert.ok(ranked[1].reasons.includes('官方安贞名录收录于心脏康复中心；具体康复技术需核实。'));
  assert.equal(ranked[1].breakdown.reduce((total, part) => total + part.value, 0), 55);
  assert.equal(ranked[1].breakdown.find(part => part.label === '具体康复技术证据').value, 0);
});

test('scores and explanations are deterministic, bounded, and add up', () => {
  const analysis = analyzeCase('患者58岁，房颤病史2年，反复心悸，拟转诊评估。');
  const snapshot = JSON.stringify(doctors);
  const first = rankDoctors(doctors, analysis);
  assert.deepEqual(first, rankDoctors(doctors, analysis));
  assert.equal(JSON.stringify(doctors), snapshot);
  for (const doctor of first) {
    assert.ok(Number.isInteger(doctor.score) && doctor.score >= 0 && doctor.score <= 95);
    assert.equal(doctor.breakdown.reduce((total, part) => total + part.value, 0), doctor.score);
    for (const part of doctor.breakdown) assert.ok(part.value >= 0 && part.value <= part.max);
  }
});

test('synthetic schedule uses seven future local calendar days across a year boundary', () => {
  const base = new Date(2026, 11, 28, 23, 30);
  const originalTime = base.getTime();
  const schedule = buildSchedule('af', base);
  assert.equal(schedule.length, 7);
  assert.deepEqual(schedule.map(d => d.date), ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04']);
  assert.equal(schedule[0].weekday, '周二');
  assert.equal(schedule[3].monthDay, '1月1日');
  assert.equal(base.getTime(), originalTime);
  const slots = schedule.flatMap(d => d.slots);
  assert.ok(slots.filter(s => s.remaining > 0).length >= 3);
  assert.equal(new Set(slots.map(s => s.id)).size, slots.length);
  for (const slot of slots) {
    assert.match(slot.id, /^demo-/);
    assert.ok(Number.isInteger(slot.remaining) && slot.remaining >= 0);
    assert.ok(['上午', '下午'].includes(slot.session));
  }
});

test('same doctor and local day produce identical synthetic slots', () => {
  const morning = buildSchedule('coronary', new Date(2026, 8, 16, 7, 5));
  const evening = buildSchedule('coronary', new Date(2026, 8, 16, 22, 40));
  assert.deepEqual(morning, evening);
  assert.notDeepEqual(morning, buildSchedule('af', new Date(2026, 8, 16, 7, 5)));
  assert.throws(() => buildSchedule('', new Date()), TypeError);
  assert.throws(() => buildSchedule('af', new Date('invalid')), TypeError);
});
