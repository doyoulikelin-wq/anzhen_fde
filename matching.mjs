/**
 * Referral prototype rules. These outputs are UI demonstrations, not diagnoses,
 * clinical capacity assessments, treatment advice, or real appointment data.
 */

// An explicitly acute infarction does not require ongoing chest pain. Keep the
// ST/non-ST modifier inside the recognized phrase so its negation and history
// are evaluated together, and the UI can retain the supplied diagnosis label.
const ACUTE_INFARCTION_TERMS = [
  '急性心肌梗死', '急性心梗', 'STEMI', 'NSTEMI',
  ...['ST段抬高', '非ST段抬高'].flatMap(type =>
    ['型', '性', ''].flatMap(suffix =>
      ['心肌梗死', '心梗'].map(diagnosis => `急性${type}${suffix}${diagnosis}`))),
];

const CATEGORIES = {
  coronary: {
    label: '冠心病与冠脉介入',
    caseTerms: [...ACUTE_INFARCTION_TERMS, '心肌梗死', '心梗', 'ST段抬高', '冠状动脉狭窄', '冠脉狭窄', '冠心病', '心绞痛', '冠脉病变', '冠状动脉病变'],
    domainTerms: ['冠心病', '冠状动脉', '冠脉', '心肌梗死', '心梗', '心绞痛', 'PCI', '搭桥'],
    methods: ['冠心病介入', '冠脉介入', '冠状动脉介入', '经皮冠状动脉介入', 'PCI', '冠脉支架', '冠状动脉支架'],
    otherMethods: ['冠脉搭桥', '冠状动脉搭桥', '冠状动脉旁路移植', '搭桥'],
    reason: '病例涉及冠脉相关问题，可据公开专业方向核实冠心病专科的接诊需求。',
  },
  arrhythmia: {
    label: '心律失常与房颤',
    caseTerms: ['心房颤动', '房颤', '心房扑动', '房扑', '心律失常', '室上速', '室性心动过速', '室速', '心动过速', '心动过缓', '心悸'],
    domainTerms: ['心房颤动', '房颤', '房扑', '心律失常', '心动过速', '心动过缓', '室速', '室上速', '心脏电生理', '起搏器'],
    methods: ['房颤消融', '导管消融', '射频消融', '脉冲消融', '脉冲电场消融', '心脏电生理', '绿色电生理', '起搏器植入', '心脏起搏'],
    otherMethods: [],
    reason: '病例涉及房颤或其他心律失常，可据公开专业方向核实心律失常专科接诊需求。',
  },
  heart_failure: {
    label: '心力衰竭',
    caseTerms: ['心力衰竭', '心衰', '射血分数降低', '缺血性心肌病', '扩张型心肌病'],
    domainTerms: ['心力衰竭', '心衰', '心肌病', '终末期心脏病'],
    methods: ['心衰管理', '心力衰竭管理', '心衰治疗', '机械循环支持', '心室辅助', '人工心脏', '心脏移植'],
    otherMethods: [],
    reason: '病例涉及心衰或心肌病，可进一步核实心衰评估及连续管理的专科接诊需求。',
  },
  valve: {
    label: '心脏瓣膜病',
    caseTerms: ['瓣膜病', '主动脉瓣', '二尖瓣', '三尖瓣', '肺动脉瓣', '瓣膜狭窄', '瓣膜关闭不全', '瓣膜置换'],
    domainTerms: ['瓣膜', '主动脉瓣', '二尖瓣', '三尖瓣', '肺动脉瓣', '结构性心脏病'],
    methods: ['瓣膜修复', '瓣膜置换', '瓣膜成形', '经导管瓣膜', 'TAVR', 'TAVI', 'TEER'],
    otherMethods: [],
    reason: '病例涉及心脏瓣膜问题，可据公开专业方向核实瓣膜病专科评估需求。',
  },
  vascular: {
    label: '主动脉与血管疾病',
    caseTerms: ['主动脉夹层', '主动脉瘤', '主动脉疾病', '胸腹主动脉', '下肢动脉', '外周血管', '肺栓塞', '深静脉血栓', '静脉曲张'],
    domainTerms: ['主动脉', '大血管', '外周血管', '血管外科', '下肢动脉', '肺栓塞', '深静脉', '静脉曲张'],
    methods: ['主动脉手术', '大血管手术', '主动脉置换', '腔内修复', '血管介入', '主动脉夹层', '主动脉瘤'],
    otherMethods: [],
    reason: '病例涉及主动脉或其他血管问题，可据公开专业方向核实相应专科接诊需求。',
  },
  rehabilitation: {
    label: '心脏术后与康复',
    caseTerms: ['心脏康复', '心肺康复', '术后康复', '运动康复', '心脏术后'],
    domainTerms: ['心脏康复', '心肺康复', '术后康复', '心血管康复', '运动康复'],
    methods: ['心脏康复', '心肺康复', '运动处方', '运动评估', '康复评估', '康复管理', '心血管康复'],
    otherMethods: [],
    reason: '病例涉及心脏术后随访或康复，可据公开专业方向核实康复评估与随访需求。',
  },
  cardiovascular: {
    label: '心血管综合评估',
    caseTerms: ['高血压', '血压控制', '高脂血症', '血脂异常', '心血管疾病', '心血管病'],
    domainTerms: ['高血压', '血脂', '心血管', '冠心病', '心力衰竭'],
    methods: ['高血压管理', '高血压诊治', '血脂管理', '心血管疾病诊治', '慢病管理'],
    otherMethods: [],
    reason: '病例暂适合心血管综合方向核实；补充具体诊断与转诊目的后可进一步细分。',
  },
};

const unique = values => [...new Set(values)];
const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function lastClauseStart(text, index) {
  const before = text.slice(0, index);
  const punctuation = Math.max(...['，', ',', '。', '；', ';', '\n', '！', '？'].map(s => before.lastIndexOf(s)));
  return punctuation + 1;
}

// Small, explicit negation rules for the prototype. A negated symptom is kept
// out of positive tags, and cannot independently trigger an urgent branch.
function isNegated(text, index, length) {
  const prefix = text.slice(Math.max(lastClauseStart(text, index), index - 22), index).replace(/\s/g, '');
  const suffix = text.slice(index + length, index + length + 10).replace(/\s/g, '');
  if (/(?:不能|尚不能|无法|待|需|需要|有待)排除$/.test(prefix)) return false;
  if (/^(?:已|已被)?排除|^(?:为)?阴性|^不存在|^未见/.test(suffix)) return true;
  if (/(?:否认|未见|未诉|没有|不伴|不考虑|已排除|排除|未出现|不存在|并无|未发现|无)(?:有|明显|近期|持续性|急性|新发|典型|相关|的|任何|心电图|提示|显示|改变|非?ST段抬高(?:型|性)?)*$/i.test(prefix)) return true;
  // Negation can cover a short list: “否认胸痛及 ST 段抬高”.
  if (/(?:否认|未见|没有|无)[^但却伴并现示]{0,14}(?:、|以及|及|和|或)$/.test(prefix)) return true;
  return false;
}

function isHistorical(text, index) {
  const start = lastClauseStart(text, index);
  const endOffset = text.slice(index).search(/[，,。；;\n！？]/);
  const clause = text.slice(start, endOffset < 0 ? text.length : index + endOffset);
  const before = text.slice(start, index);
  if (/(?:现|今日|今天|本次|新发|再次|突发|加重)/.test(before)) return false;
  return /既往|曾患|曾发生|陈旧性|年前|病史|恢复期|康复期|术后|随访|复查/.test(clause);
}

function affirmedHits(text, terms, ignoreHistorical = false) {
  const hits = [];
  for (const term of terms) {
    // Allow written spaces in ECG labels and English abbreviations.
    const pattern = [...term].map(escapeRegex).join('\\s*');
    for (const match of text.matchAll(new RegExp(pattern, 'giu'))) {
      // STEMI must not be extracted from NSTEMI, and “非 ST 段抬高” is
      // explicitly a non-elevation label rather than positive ECG evidence.
      if (/^[A-Z]+$/i.test(term) && (/[A-Z]/i.test(text[match.index - 1] || '') || /[A-Z]/i.test(text[match.index + match[0].length] || ''))) continue;
      if ((term === 'ST段抬高' || term === 'STEMI') && /(?:非|NON[-－]?)$/i.test(text.slice(Math.max(0, match.index - 8), match.index).replace(/\s/g, ''))) continue;
      if (isNegated(text, match.index, match[0].length)) continue;
      if (ignoreHistorical && isHistorical(text, match.index)) continue;
      hits.push({ term, index: match.index });
      break;
    }
  }
  return hits;
}

function missingDetails(text) {
  const missing = [];
  if (!/\d{1,3}\s*岁|年龄[：:]?\s*\d/.test(text)) missing.push('年龄');
  if (!/\d+\s*(?:分(?:钟)?|小时|天|周|个?月|年)|今[日天]|昨[日天]|病史|术后|持续|反复|突发/.test(text)) missing.push('症状起始时间或病程');
  if (!/心电图|ST\s*段|STEMI|肌钙蛋白|超声|心超|射血分数|LVEF|EF\s*[:：=]?\s*\d|造影|血压|检查|CT|MRI/i.test(text)) missing.push('关键检查摘要');
  if (!/转诊|转院|评估|复查|随访|康复|希望|拟|无\s*PCI|无.*资质|不能开展|无法开展/i.test(text)) missing.push('转诊目的或当前医院能力');
  return missing;
}

function invalidAnalysis(summary, missing, category = 'unknown') {
  return {
    valid: false, urgent: false, category,
    categoryLabel: category === 'unrelated' ? '未识别到心血管转诊问题' : '病例信息不足',
    tags: [], summary,
    referralReason: '请补充有实质内容的心血管病例后再进行匹配。',
    missing,
  };
}

/** Analyze the user-supplied case with transparent demonstration rules. */
export function analyzeCase(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return invalidAnalysis('尚未填写病例。', ['主要症状或诊断', '病程', '关键检查摘要', '转诊目的']);
  const compact = normalized(text);
  if (compact.length < 12 || /^(?:测试|你好|帮我|随便|看看|病例|转诊|心血管|心脏|医生|推荐|分析|谢谢|\p{P}|\s)+$/u.test(text)) {
    return invalidAnalysis('现有内容不足以描述一例具体病例。', ['主要症状或诊断', ...missingDetails(text)]);
  }

  const hitsByCategory = Object.fromEntries(Object.entries(CATEGORIES).map(([key, config]) => [key, affirmedHits(text, config.caseTerms)]));
  const acutePain = affirmedHits(text, ['急性胸痛', '突发胸痛', '胸痛']).some(hit => {
    const nearby = text.slice(Math.max(0, hit.index - 8), hit.index + 28);
    return !isHistorical(text, hit.index) && /急性|突发|持续|\d+\s*(?:分钟|小时)|今[日天]/.test(nearby);
  });
  const acuteInfarction = affirmedHits(text, ACUTE_INFARCTION_TERMS, true).length > 0;
  const currentInfarction = affirmedHits(text, ['心肌梗死', '心梗'], true).length > 0;
  const stElevation = affirmedHits(text, ['ST段抬高'], true).length > 0;
  const acuteDissection = affirmedHits(text, ['主动脉夹层'], true).some(hit => /急性|突发|新发/.test(text.slice(Math.max(0, hit.index - 12), hit.index + 18)));
  const urgentCoronary = acuteInfarction || (acutePain && (currentInfarction || stElevation));
  const urgent = urgentCoronary || acuteDissection;
  const cardiacRehabContext = affirmedHits(text, ['心脏康复', '心肺康复', '心脏术后', '心脏手术', '冠脉搭桥', '支架术后', 'PCI术后']).length > 0
    || ['coronary', 'arrhythmia', 'heart_failure', 'valve', 'cardiovascular'].some(key => hitsByCategory[key].length > 0);
  const needsRehab = (hitsByCategory.rehabilitation.length > 0 && cardiacRehabContext) || (
    /(?:支架|PCI|搭桥|瓣膜|心脏|冠脉).{0,8}术后/i.test(text) && /康复|随访|复查|运动评估/.test(text)
  );

  let category;
  if (urgentCoronary) category = 'coronary';
  else if (acuteDissection) category = 'vascular';
  else if (needsRehab) category = 'rehabilitation';
  else category = ['arrhythmia', 'heart_failure', 'valve', 'vascular', 'coronary', 'cardiovascular'].find(key => hitsByCategory[key].length);

  if (!category) return invalidAnalysis('现有记录未提供可识别的心血管转诊问题，暂不推荐医生。', ['具体心血管症状或诊断'], 'unrelated');
  const hasContext = /\d|病史|反复|持续|突发|新发|目前|近期|检查|诊断|控制|术后|评估|转诊|转院|复查|随访|康复|需要|拟|加重/.test(text);
  if (!hasContext) return invalidAnalysis('检测到心血管词语，但尚缺少患者情况、病程或转诊诉求。', ['患者情况', '病程', '转诊目的']);

  const tags = unique([
    ...hitsByCategory[category].map(hit => hit.term),
    ...(acutePain && category === 'coronary' ? ['急性胸痛'] : []),
    ...(needsRehab && category === 'rehabilitation' ? ['心脏术后或康复需求'] : []),
  ]).filter((term, _i, all) => !all.some(other => other !== term && other.includes(term)));
  const noPci = /(?:无|没有|不具备|未具备|缺乏)\s*(?:急诊\s*)?PCI\s*(?:资质|条件|能力)|(?:不能|无法|未能)\s*开展\s*PCI/i.test(text);
  if (noPci) tags.push('当前医院无PCI条件（病例自述）');
  const label = CATEGORIES[category].label;
  return {
    valid: true, urgent, category, categoryLabel: label, tags,
    summary: `病例要点：${tags.slice(0, 5).join('、') || label}。`,
    referralReason: urgent
      ? '识别到急危重心血管相关线索，请由医生立即复核，并立即对接接收方，不等待普通排班；本提示不构成诊断或治疗建议。'
      : CATEGORIES[category].reason,
    missing: missingDetails(text),
  };
}

function termsIn(text, terms) {
  const comparable = normalized(text);
  return terms.filter(term => comparable.includes(normalized(term)));
}

/**
 * Integer demonstration rule scores, never probabilities. Bio/expertise supply
 * clinical evidence. A verified Anzhen rehabilitation clinic may support a
 * limited affiliation candidate; department and title never imply expertise.
 */
export function rankDoctors(doctors, analysis) {
  if (!analysis?.valid || !CATEGORIES[analysis.category] || !Array.isArray(doctors)) return [];
  const config = CATEGORIES[analysis.category];
  const ranked = [];
  for (const doctor of doctors) {
    if (!doctor || typeof doctor.photo !== 'string' || !doctor.photo.trim()) continue;
    const expertise = Array.isArray(doctor.expertise) ? doctor.expertise.filter(v => typeof v === 'string').join('；') : '';
    const bio = typeof doctor.bio === 'string' ? doctor.bio : '';
    const evidence = `${expertise}\n${bio}`;
    const domain = termsIn(evidence, config.domainTerms);
    if (analysis.category === 'rehabilitation' && (!domain.length || !/心脏|心肺|心血管|冠心病|心衰/.test(evidence))) {
      const officialClinics = Array.isArray(doctor.profile?.officialClinics) ? doctor.profile.officialClinics : [];
      const clinic = officialClinics.find(value => typeof value === 'string' && normalized(value) === '心脏康复中心门诊(安贞)');
      if (clinic) ranked.push({
        ...doctor, score: 55,
        reasons: [
          '官方安贞名录收录于心脏康复中心；具体康复技术需核实。',
          '本项仅作为门诊归属候选，未据此推断康复专长或具体技术能力。',
          '分数为匹配参考分，不是诊疗概率、成功率或资质认证。',
        ],
        matchedTerms: [clinic],
        breakdown: [
          { label: '官方门诊归属证据', value: 45, max: 45 },
          { label: '具体康复技术证据', value: 0, max: 30 },
          { label: '病例与门诊方向对应', value: 10, max: 15 },
          { label: '明确康复专长表述', value: 0, max: 10 },
        ],
      });
      continue;
    }
    // A standalone technique such as “射频消融” may belong to a noncardiac field.
    if (!domain.length) continue;
    const methods = termsIn(evidence, config.methods);
    const otherMethods = termsIn(evidence, config.otherMethods);
    const caseTerms = termsIn(evidence, listTags(analysis.tags).filter(term => !term.includes('病例自述') && !term.includes('需求')));
    const explicitExpertise = termsIn(expertise, [...domain, ...methods]).length > 0;
    const exactAf = analysis.category === 'arrhythmia' && listTags(analysis.tags).some(t => /房颤|心房颤动/.test(t));
    const afEvidence = /房颤|心房颤动/.test(evidence);
    const domainPoints = methods.length ? 40 : otherMethods.length ? 30 : 25;
    let methodPoints = methods.length ? 28 : otherMethods.length ? 14 : 0;
    // An AF case should not rank an isolated pacing description above AF evidence.
    if (exactAf && !afEvidence) methodPoints = Math.min(methodPoints, 10);
    const overlapPoints = caseTerms.length ? 15 : exactAf && afEvidence ? 15 : 0;
    const sourcePoints = explicitExpertise ? 10 : 5;
    let score = domainPoints + methodPoints + overlapPoints + sourcePoints;
    if (!methods.length) score = Math.min(score, 64);
    if (exactAf && !afEvidence) score = Math.min(score, 59);
    // Broad general cardiology alone remains a modest demonstration match.
    if (analysis.category === 'cardiovascular') score = Math.min(score, 75);
    score = Math.min(95, score);
    // Report the capped total through the last component, so the visible
    // breakdown always adds up to the displayed integer rule score.
    const adjustedMethod = Math.max(0, Math.min(methodPoints, score - domainPoints - overlapPoints));
    const adjustedSource = score - domainPoints - adjustedMethod - overlapPoints;
    const matchedTerms = unique([...caseTerms, ...methods, ...otherMethods, ...domain]);
    const reasons = [
      `公开${explicitExpertise ? '专长' : '简介'}提到“${unique([...caseTerms, ...domain]).slice(0, 3).join('、')}”，与${config.label}方向相关。`,
      ...(methods.length ? [`公开资料列有“${methods.slice(0, 3).join('、')}”相关经历或专长。`] : otherMethods.length ? [`公开资料列有“${otherMethods.slice(0, 2).join('、')}”；未据此推断冠脉介入资质。`] : ['未查见与本次方向对应的具体技术描述，匹配参考分保持较低。']),
      ...(analysis.urgent && analysis.category === 'coronary' && methods.length ? ['冠脉介入相关公开证据优先展示；接诊能力与当前值班仍需实际对接确认。'] : []),
      '分数为匹配参考分，不是诊疗概率、成功率或资质认证。',
    ];
    ranked.push({
      ...doctor, score, reasons, matchedTerms,
      breakdown: [
        { label: '公开专业方向证据', value: domainPoints, max: 45 },
        { label: '相关技术描述', value: adjustedMethod, max: 30 },
        { label: '病例关键词对应', value: overlapPoints, max: 15 },
        { label: '明确专长表述', value: adjustedSource, max: 10 },
      ],
    });
  }
  return ranked.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name), 'zh-CN') || String(a.id).localeCompare(String(b.id)));
}

function listTags(tags) { return Array.isArray(tags) ? tags.filter(t => typeof t === 'string') : []; }

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.codePointAt(0), 16777619) >>> 0;
  return result;
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Seven future local calendar days of synthetic slots; no live schedule reads. */
export function buildSchedule(doctorId, baseDate = new Date(), {includeToday=false} = {}) {
  if ((typeof doctorId !== 'string' && typeof doctorId !== 'number') || !String(doctorId).trim()) throw new TypeError('doctorId is required');
  if (!(baseDate instanceof Date) || !Number.isFinite(baseDate.getTime())) throw new TypeError('baseDate must be a valid Date');
  const result = [];
  for (let offset = includeToday ? 0 : 1; offset < (includeToday ? 7 : 8); offset++) {
    const day = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offset, 12);
    const date = localDate(day);
    const slots = [['am', '上午', '09:00–11:30'], ['pm', '下午', '14:00–16:30']].map(([key, session, time]) => ({
      id: `demo-${hash(doctorId).toString(16)}-${date}-${key}`,
      session, time, remaining: hash(`${doctorId}|${date}|${key}`) % 7,
      ...(includeToday?{elapsed:new Date(`${date}T${key==='am'?'11:30':'16:30'}`).getTime()<=baseDate.getTime()}:{}),
    }));
    result.push({ date, weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day.getDay()], monthDay: `${day.getMonth() + 1}月${day.getDate()}日`, slots });
  }
  const slots = result.flatMap(day => day.slots);
  let available = slots.filter(slot => slot.remaining > 0).length;
  for (const slot of slots) {
    if (available >= 3) break;
    if (slot.remaining === 0) { slot.remaining = 3; available++; }
  }
  if(includeToday)for(const day of result)for(const slot of day.slots)if(slot.elapsed)slot.remaining=0;
  return result;
}
