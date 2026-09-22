import {escapeHtml} from './shared-ui.mjs';

export const INTAKE_SOURCES=['东华','嘉和','其他'];
export const INTAKE_EXAMPLES=[
  {sourceSystem:'东华',sourcePatientId:'EXAMPLE-OP-0922',name:'陈女士',sex:'女',age:58,diagnosis:'冠状动脉粥样硬化性心脏病，劳力性胸痛',caseSummary:'女，58岁。反复活动后胸闷、胸痛2个月，休息后约5分钟缓解。既往高血压病史8年，目前静息状态无胸痛，生命体征平稳。当地医院冠状动脉CTA提示前降支中段约75%狭窄，肌钙蛋白未升高。拟转至上级医院心血管专科进一步评估及制定诊疗方案。',sourceHospital:'青禾协作医院',sourceDoctor:'李医生',service:'专科评估',goal:'评估冠状动脉病变及后续诊疗方案'},
  {sourceSystem:'嘉和',sourcePatientId:'EXAMPLE-IP-0922',name:'王先生',sex:'男',age:67,diagnosis:'冠心病，PCI术后恢复期',caseSummary:'男，67岁。因冠心病在上级医院完成冠状动脉介入治疗，术后第7天，目前无胸痛及呼吸困难，生命体征平稳。近期超声提示左心室射血分数55%。计划由下级医院继续住院观察、心脏康复与用药依从性管理，并按日期记录血压、心率、体重及症状变化，供上级专科团队随访。',sourceHospital:'北京安贞医院安徽医院',sourceDoctor:'张医生',service:'心脏康复',goal:'接续住院观察与心脏康复，持续记录病情变化'}
];

export function normalizeIntakePayload(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('请提供一位患者的 JSON 对象。');
  const result={};
  const fields={sourceSystem:[20,true,'来源系统'],sourcePatientId:[100,true,'来源患者编号'],name:[60,true,'患者姓名'],sex:[4,true,'性别'],diagnosis:[500,true,'诊断'],caseSummary:[5000,true,'病例摘要'],sourceHospital:[100,true,'来源医院'],sourceDoctor:[60,false,'经治医生'],service:[100,false,'接续服务'],goal:[1000,false,'转诊目的']};
  for(const [field,[max,required,label]] of Object.entries(fields)){
    const raw=value[field];
    if(raw!==undefined&&typeof raw!=='string')throw Error(`${label}应为文字。`);
    const text=(raw||'').trim();
    if(required&&!text)throw Error(`请补充${label}。`);
    if(text.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error(`${label}内容过长或包含无效字符。`);
    if(text||required)result[field]=text;
  }
  if(!INTAKE_SOURCES.includes(result.sourceSystem))throw Error('来源系统请填写“东华”“嘉和”或“其他”。');
  if(!['男','女','未知'].includes(result.sex))throw Error('性别请填写“男”“女”或“未知”。');
  const age=typeof value.age==='string'&&/^\d{1,3}$/.test(value.age.trim())?Number(value.age):value.age;
  if(!Number.isInteger(age)||age<0||age>120)throw Error('年龄应为 0 至 120 的整数。');
  result.age=age;
  if(result.caseSummary.length<12)throw Error('病例摘要至少填写 12 个字，请补充病情和转诊需求。');
  return result;
}

export function parseIntakeJson(text) {
  if(typeof text!=='string'||text.length>20000)throw Error('JSON 内容不能超过 20,000 个字符。');
  let value;try{value=JSON.parse(text);}catch{throw Error('JSON 格式无法读取，请检查逗号、引号和括号。');}
  return normalizeIntakePayload(value);
}

export function createDataIntake(context) {
  const esc=context.escape||escapeHtml,icon=context.icon||(()=>''),toast=context.toast||(()=>{});
  let root=null,active=false,source='东华',draft='',payload=null,direction='upward',error='',pending=false,generation=0;
  const query=selector=>root?.querySelector(selector);
  const example=()=>INTAKE_EXAMPLES.find(item=>item.sourceSystem===source)||INTAKE_EXAMPLES[0];
  function render(container) {
    onLeave();root=container;active=true;
    root.innerHTML=`<div class="intake-workspace"><section class="intake-intro"><div><span class="intake-kicker">诊疗信息 · 一次核对 · 连续流转</span><h2>从当前就诊，接入转诊协同</h2><p>带入患者诊疗信息，核对后进入上转评估或下转接续安排。</p></div><span class="intake-connection">接口待接入</span></section><div class="intake-layout"><div><section class="panel intake-source-panel"><div class="panel-title"><h2>${icon('hospital')}诊疗工作台入口</h2><small>来源系统</small></div><div class="intake-panel-body"><div class="intake-vendors" role="group" aria-label="选择来源系统">${['东华','嘉和'].map(vendor=>`<button type="button" data-intake-vendor="${vendor}" class="${source===vendor?'active':''}" aria-pressed="${source===vendor}">${vendor}诊疗系统</button>`).join('')}</div><div data-intake-current></div><p class="intake-source-note">当前展示示例就诊信息。东华、嘉和正式接口接通后，可从院内工作台读取当前患者资料。</p></div></section><section class="panel intake-manual-panel"><div class="panel-title"><h2>${icon('file')}导入诊疗信息</h2><small>JSON 文件 / 粘贴</small></div><div class="intake-panel-body"><label class="intake-file-label">${icon('file')}选择 JSON 文件<input type="file" data-intake-file accept="application/json,.json" aria-label="选择患者 JSON 文件"></label><label class="field-label" for="intake-json">患者信息</label><textarea id="intake-json" data-intake-json spellcheck="false" maxlength="20000" placeholder="粘贴约定格式的 JSON 患者信息">${esc(draft)}</textarea><div class="intake-json-actions"><button class="text-button" type="button" data-intake-template>填入格式示例</button><button class="secondary" type="button" data-intake-preview>核对导入内容 ${icon('arrow')}</button></div><details class="intake-format"><summary>查看字段说明</summary><p>必填：sourceSystem（东华 / 嘉和 / 其他）、sourcePatientId、name、sex（男 / 女 / 未知）、age、diagnosis、caseSummary、sourceHospital。</p><p>选填：sourceDoctor、service、goal。JSON 文件只带入上述字段，其他字段不进入病例。</p></details></div></section></div><section class="panel intake-preview-panel" aria-label="患者信息核对"><div class="panel-title"><h2>${icon('check')}核对与转入</h2><small>确认后进入对应工作台</small></div><div class="intake-panel-body"><div data-intake-error role="alert"></div><div data-intake-preview-content></div></div></section></div></div>`;
    root.addEventListener('click',onClick);root.addEventListener('change',onChange);root.addEventListener('input',onInput);
    renderCurrent();renderPreview();
  }
  function renderCurrent() {
    const node=query('[data-intake-current]');if(!node)return;
    const item=example();
    node.innerHTML=`<div class="intake-current"><div class="intake-current-heading"><span>当前就诊患者</span><small>示例就诊信息</small></div><div class="intake-patient-heading"><span class="intake-patient-avatar">${esc(item.name[0])}</span><div><h3>${esc(item.name)}<small>${item.sex} · ${item.age} 岁</small></h3><p>${esc(item.sourcePatientId)}</p></div></div><dl><div><dt>诊断</dt><dd>${esc(item.diagnosis)}</dd></div><div><dt>来源</dt><dd>${esc(item.sourceHospital)}</dd></div><div><dt>经治医生</dt><dd>${esc(item.sourceDoctor)}</dd></div></dl><button type="button" class="primary block" data-intake-example>${icon('file')}载入示例就诊信息 ${icon('arrow')}</button></div>`;
  }
  function renderPreview() {
    const issue=query('[data-intake-error]');if(issue)issue.innerHTML=error?`<p class="intake-error">${esc(error)}</p>`:'';
    const node=query('[data-intake-preview-content]');if(!node)return;
    if(!payload){node.innerHTML=`<div class="intake-empty"><div>${icon('file')}</div><h3>先接入本次就诊信息</h3><p>从诊疗工作台载入，或上传 JSON 文件。<br>核对患者、病情和来源后选择转诊方向。</p><ol><li>接入患者诊疗信息</li><li>核对病例与来源</li><li>进入上转或下转工作台</li></ol></div>`;return;}
    node.innerHTML=`<div class="intake-preview-source"><span>${esc(payload.sourceSystem)} · ${esc(payload.sourceHospital)}</span><small>${esc(payload.sourcePatientId)}</small></div><div class="intake-patient-heading"><span class="intake-patient-avatar">${esc(payload.name[0])}</span><div><h3>${esc(payload.name)}<small>${esc(payload.sex)} · ${payload.age} 岁</small></h3><p>经治医生：${esc(payload.sourceDoctor||'未提供')}</p></div></div><dl class="intake-preview-diagnosis"><dt>诊断</dt><dd>${esc(payload.diagnosis)}</dd></dl><div class="intake-case-summary"><strong>病例摘要</strong><p>${esc(payload.caseSummary)}</p></div>${payload.goal?`<p class="intake-goal"><strong>转诊目的</strong>${esc(payload.goal)}</p>`:''}<fieldset class="intake-direction"><legend>选择转诊方向</legend><label><input type="radio" name="intake-direction" data-intake-direction value="upward" ${direction==='upward'?'checked':''}><span><strong>下级转上级</strong><small>专科评估、复杂诊疗与接诊协调</small></span></label><label><input type="radio" name="intake-direction" data-intake-direction value="downward" ${direction==='downward'?'checked':''}><span><strong>上级转下级</strong><small>住院接续、康复与连续监测</small></span></label></fieldset><button type="button" class="primary block intake-confirm" data-intake-confirm ${pending?'disabled':''}>${pending?'正在转入…':`确认信息，进入${direction==='upward'?'上转':'下转'}工作台`} ${icon('arrow')}</button><p class="intake-preview-note">确认将带入工作台草稿；完成转诊提交后，资料才进入共享业务记录。</p>`;
  }
  function preview(text) {try{payload=parseIntakeJson(text);error='';}catch(failure){payload=null;error=failure.message;}renderPreview();}
  function onInput(event) {if(event.target.matches?.('[data-intake-json]')){generation++;draft=event.target.value;payload=null;error='';renderPreview();}}
  async function onChange(event) {
    if(event.target.matches?.('[data-intake-direction]')){direction=event.target.value==='downward'?'downward':'upward';renderPreview();return;}
    if(!event.target.matches?.('[data-intake-file]'))return;
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    const serial=++generation;
    if(!/\.json$/i.test(file.name)||file.size>30000){error='请选择不超过 30 KB 的 JSON 文件。';payload=null;renderPreview();return;}
    try{const text=await file.text();if(serial!==generation||!active)return;draft=text;query('[data-intake-json]').value=draft;preview(text);}catch{if(serial!==generation||!active)return;error='文件无法读取，请重新选择或直接粘贴内容。';payload=null;renderPreview();}
  }
  async function onClick(event) {
    const target=event.target.closest?.('button');if(!target||!root?.contains(target)||pending)return;
    if(target.hasAttribute('data-intake-vendor')){const next=target.dataset.intakeVendor;if(!['东华','嘉和'].includes(next))return;if(next!==source){generation++;source=next;payload=null;error='';direction=source==='嘉和'?'downward':'upward';renderPreview();}root.querySelectorAll('[data-intake-vendor]').forEach(button=>{button.classList.toggle('active',button.dataset.intakeVendor===source);button.setAttribute('aria-pressed',String(button.dataset.intakeVendor===source));});renderCurrent();return;}
    if(target.hasAttribute('data-intake-example')){generation++;payload=normalizeIntakePayload(example());direction=source==='嘉和'?'downward':'upward';error='';renderPreview();return;}
    if(target.hasAttribute('data-intake-template')){generation++;draft=JSON.stringify(example(),null,2);query('[data-intake-json]').value=draft;payload=null;error='';renderPreview();return;}
    if(target.hasAttribute('data-intake-preview')){generation++;preview(draft);return;}
    if(target.hasAttribute('data-intake-confirm')&&payload){
      pending=true;error='';renderPreview();
      try{await context.onImport(normalizeIntakePayload(payload),direction);toast('诊疗信息已带入，请继续核对并完成转诊安排。');}catch{error='信息转入未完成，当前资料已保留，请重试。';}finally{pending=false;if(active)renderPreview();}
    }
  }
  function onLeave() {generation++;active=false;root?.removeEventListener('click',onClick);root?.removeEventListener('change',onChange);root?.removeEventListener('input',onInput);root=null;}
  return {render,onLeave};
}
