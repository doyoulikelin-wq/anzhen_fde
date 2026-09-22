import { analyzeCase, rankDoctors } from './matching.mjs';
import { currentSchedule, nextAppointment, sortCandidateDoctors } from './schedule-policy.mjs';
import { referralStatusLabel, referralNotifications } from './referral-workflow.mjs';
import { createApprovalWorkspace, renderInsuranceFields } from './approval-ui.mjs';
import { createAttachmentController, renderAttachmentList } from './attachments.mjs';
import { createDataIntake } from './data-intake.mjs';
import { storageKey, parseRecords, mergeRecords, sameReferral, newRecordId, updateRecords } from './record-store.mjs';
import { renderWorkingSchedule } from './shared-ui.mjs';
import { createPortal } from './portal.mjs';
import { createDownwardWorkspace } from './downward.mjs';
import { createGuidanceWorkspace } from './guidance.mjs';
import { createSharedWorkspace, migrateLegacyWorkspace } from './shared-client.mjs';

const $ = (s, root = document) => root.querySelector(s);
const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Translate previously generated labels at display time; stored records are retained.
const recordText = (value='') => String(value).replace(/（(?:虚拟|演示|模拟)）/g,'').replaceAll('虚拟患者','患者信息').replaceAll('下级医院提交模拟转诊申请','转诊申请已保存，待联系院方').replaceAll('转诊中心完成模拟接收','协调安排已登记，待院方核实').replaceAll('模拟床位','待核实床位').replaceAll('模拟门诊','待核实门诊');
const paths = {
  home:'M3 11l9-8 9 8 M5 10v11h14V10 M9 21v-7h6v7', upward:'M5 19V9h6 M5 9l7-7 7 7 M12 2v15 M16 19h5', downward:'M5 5h6 M12 7v15 M5 15l7 7 7-7 M19 15V5h-4', compass:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M16 8l-3 5-5 3 3-5 5-3', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  pulse:'M2 12h5l3-8 4 16 3-8h5', grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  receive:'M4 4h16v16H4z M8 11l4 4 4-4 M12 7v8', records:'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4',
  hospital:'M5 21V7h14v14 M9 7V3h6v4 M2 21h20 M9 11h1 M14 11h1 M9 15h1 M14 15h1 M11 21v-3h2v3',
  arrow:'M4 12h16 M14 6l6 6-6 6', chevron:'M9 5l7 7-7 7', clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  calendar:'M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16 M8 14h2 M14 14h2 M8 18h2',
  info:'M12 11v6 M12 7v.1 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  check:'M5 12l4 4L19 6', close:'M6 6l12 12 M6 18L18 6', file:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6',
  user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-3a8 8 0 0 1 16 0v3',
  spark:'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z', shield:'M12 2l8 3v7c0 5-8 10-8 10S4 17 4 12V5z M8 12l3 3 5-6',
  search:'M16 16l6 6 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8',
};
const icon = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name] || paths.info}"/></svg>`;
const presets = [
  {id:'acute',label:'急性心梗',name:'张先生',sex:'男',age:58,text:'患者，男，58岁。持续胸痛4小时，伴大汗、恶心。心电图提示急性ST段抬高型心肌梗死。\n\n已在青禾县人民医院完成基础评估与急救准备。本院不具备急诊冠脉介入（PCI）的设备与团队，无法完成急诊介入治疗。\n\n转诊目的：紧急对接上级医院冠脉介入团队，转入具备救治条件的心血管中心。需接收方确认接诊团队、床位与转运衔接。'},
  {id:'af',label:'房颤转诊',name:'陈女士',sex:'女',age:67,text:'患者，女，67岁。反复心悸、乏力6个月，动态心电图提示阵发性房颤，近一个月发作次数增加。既往有高血压病史，现规律随访。\n\n目前生命体征平稳，无持续胸痛，无晕厥。下级医院缺少复杂心律失常电生理评估和导管消融团队。\n\n转诊目的：预约上级医院心律失常及房颤专病医生，评估进一步诊疗方案，计划择期转诊。'},
  {id:'rehab',label:'术后康复',name:'王先生',sex:'男',age:62,text:'患者，男，62岁。冠状动脉搭桥术后6周，目前病情稳定，切口愈合良好，无胸痛。近期活动耐量下降，拟开展规范的心脏康复与运动评估。\n\n本院尚无系统的心脏康复团队及运动评估条件。\n\n转诊目的：转至心脏康复门诊进行术后康复评估，形成方案后回原医院继续随访。预约普通门诊，无急诊转运需求。'},
];
let doctors = [], analysis = null, ranked = [], page = 'home', filter = 'all', limit = 6, timer, activePreset = 'acute';
const offlineBuild = window.__OFFLINE_DEMO__ === true;
let mode = offlineBuild ? 'offline' : 'kimi', config = {status:offlineBuild?'ready':'loading', configured:false, model:'', maxCaseLength:5000, error:''};
let caseVersion = 0, matchedVersion = -1, matchState = 'idle', matchError = '', matchMeta = null, matchController = null, matchRequest = 0, configRequest = 0;
let chatMessages = [], chatDraft = '', chatDoctorId = '', chatPending = false, chatError = '', chatController = null, chatRequest = 0, chatFailedMessages = null;
let caseText = presets[0].text, patient = {...presets[0]}, sourceHospital = '青禾县人民医院', sourceDoctor = '李明';
let selectedDoctor = null, selectedDate = null, selectedSlot = null, modalType = null, currentRecord = null, restoreFocus = null;
let records = readRecords(), recordSaving = false;
let sortOrder='score',onlyAvailable=false,importedPatient=null,inputSource=null;
let insurance={type:'待核实',settlement:'待医保办核实',materialStatus:'待核实',note:''};
let attachmentController,approvalWorkspace,intakeWorkspace;
const buildSchedule=(id,now=new Date())=>currentSchedule(id,now,records);
let portalWorkspace, downwardWorkspace, guidanceWorkspace, sharedWorkspace=null, sharedStatus='loading';
function renderSharedStatus(){const node=$('#shared-status');if(node){node.textContent=sharedStatus==='synced'?'云端已同步':sharedStatus==='error'?'连接中断，请重试':'正在同步';node.classList.toggle('sync-error',sharedStatus==='error');node.title=sharedStatus==='error'?'暂时无法同步，保存时会再次尝试连接。':'此网址下的记录由服务器统一保存。';}}
function readRecords(){try{return parseRecords(localStorage.getItem(storageKey));}catch{return [];}}
async function saveRecordChange(change){const result=sharedWorkspace?await sharedWorkspace.updateRecords(change):await updateRecords(localStorage,()=>records,change);records=result.records;if(currentRecord)currentRecord=records.find(r=>r.id===currentRecord.id)||currentRecord;return result;}
function syncRecordViews(){const nav=document.querySelector('[data-nav="receive"]');if(nav){const count=pendingCount();let badge=nav.querySelector('.count');if(count){if(!badge){badge=document.createElement('b');badge.className='count';nav.append(badge);}badge.textContent=count;}else badge?.remove();}if(['receive','records'].includes(page)&&$('#page-content'))renderQueue();if(['approval','messages'].includes(page))approvalWorkspace?.refresh();if(page==='home'&&portalWorkspace)portalWorkspace.render($('#page-content'));}
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(timer);timer=setTimeout(()=>el.classList.remove('visible'),3500);}
function localDay(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function formatDate(date){return new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});}
function timeText(date){return new Date(date).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
function pendingCount(){return records.filter(r=>r.status==='pending').length;}
function updatePatient(){const sex=caseText.match(/(?:患者|性别)[，,：:\s]*(男|女)|(?:^|[，,\s])(男|女)(?:性|[，,\s])/);const age=caseText.match(/(\d{1,3})\s*岁/);patient={...patient,name:activePreset?presets.find(p=>p.id===activePreset).name:importedPatient?.name||'待转诊患者',sex:sex?.[1]||sex?.[2]||importedPatient?.sex||null,age:age?Number(age[1]):importedPatient?.age??null};}
function patientLabel(p){return `${p.name} · ${p.sex||'性别未提供'} · ${p.age==null?'年龄未提供':`${p.age}岁`}`;}
function photo(doc,detail=false){const f=doc.photoFrame;const cl=detail?'detail-photo':'doctor-photo';if(f){const w=100*f.imageWidth/f.width;const h=100*f.imageHeight/f.height;return `<span class="${cl} framed-photo"><img alt="${esc(doc.name)}医生照片" src="${esc(doc.photo)}" style="width:${w}%;height:${h}%;left:${-100*f.x/f.width}%;top:${-100*f.y/f.height}%" data-photo-id="${esc(doc.id)}"></span>`;}return `<img class="${cl}" src="${esc(doc.photo)}" alt="${esc(doc.name)}医生照片" data-photo-id="${esc(doc.id)}">`;}
function score(doc){const value=Math.max(0,Math.min(100,Math.round(Number(doc.score)||0)));return `<div class="match-score" title="100 分制匹配分，不是临床概率、疗效或医生能力排名"><div class="score-ring" style="--score:${value}"><span>${value}<b>分</b></span></div><small>${mode==='kimi'?'AI 匹配分':'匹配参考分'}</small></div>`;}
function hasCurrentMatch(){return matchState==='ready'&&matchedVersion===caseVersion&&analysis?.valid;}
function cancelChat(clear=true){chatController?.abort();chatController=null;chatRequest++;chatPending=false;chatError='';chatFailedMessages=null;if(clear){chatMessages=[];chatDraft='';}}
function invalidateCase(){caseVersion++;matchRequest++;matchController?.abort();matchController=null;matchedVersion=-1;matchState='stale';matchError='';matchMeta=null;analysis=null;ranked=[];limit=6;cancelChat();chatDoctorId='';if(modalType==='doctor'||modalType==='confirm')closeModal();updatePatient();updatePatientSummary();renderProvider();renderResults();renderChat();}
async function api(path,body,signal){
  if(offlineBuild)throw Error('智能分析功能请通过本地工作台网址使用。');
  const response=await fetch(path,{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal});
  let data;try{data=await response.json();}catch{throw Error('服务返回了无法读取的内容，请检查启动程序后重试。');}
  if(!response.ok){const error=Error(data?.error?.message||`请求失败（${response.status}），请稍后重试。`);error.status=response.status;error.code=data?.error?.code;throw error;}
  return data;
}
async function loadConfig(){
  const request=++configRequest;config={...config,status:'loading',error:''};renderProvider();renderChat();
  try{const data=await api('/api/config');if(request!==configRequest)return;if(typeof data?.configured!=='boolean'||data.provider!=='kimi')throw Error('配置服务返回格式不正确。');config={status:'ready',configured:data.configured,model:typeof data.model==='string'?data.model:'',maxCaseLength:Math.min(5000,Math.max(1,Number(data.maxCaseLength)||5000)),error:''};}
  catch(error){if(request!==configRequest)return;config={...config,status:'error',configured:false,error:error.message||'暂时无法连接智能匹配服务。'};}
  renderProvider();renderChat();
}
function updateMatchButton(){const b=$('#match-button');if(!b)return;const unavailable=mode==='kimi'&&(config.status!=='ready'||!config.configured);b.disabled=matchState==='loading'||unavailable||!caseText.trim()||caseText.length>config.maxCaseLength;b.innerHTML=matchState==='loading'?'<span class="spinner"></span>正在匹配…':`${icon('spark')}匹配接诊医生 ${icon('arrow')}`;}
function renderProvider(){
  const node=$('#service-notice');
  if(node){
    const unavailable=mode!=='offline'&&config.status!=='loading'&&(config.status==='error'||!config.configured);
    node.hidden=!unavailable;
    node.innerHTML=unavailable?`<span>${icon('info')}智能匹配服务暂不可用，请联系管理员或稍后重试。</span><button class="text-button" data-action="refresh-config">重新连接</button>`:'';
  }
  updateMatchButton();
}
function normalizeMatch(payload){
  const a=payload?.analysis;if(!a||typeof a.valid!=='boolean'||typeof a.urgent!=='boolean'||!Array.isArray(payload.ranked))throw Error('匹配结果格式不完整，请重试。');
  const strings=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'):[];
  const local=new Map(doctors.map(d=>[d.id,d]));const seen=new Set();
  const result=payload.ranked.flatMap(item=>{const d=local.get(item?.id);if(!d||!d.photo||seen.has(d.id))return [];if(!Number.isFinite(item.score)||!Array.isArray(item.reasons))throw Error('医生评分格式不完整，请重试。');seen.add(d.id);return [{...d,score:Math.max(0,Math.min(100,Math.round(item.score))),reasons:strings(item.reasons),breakdown:(Array.isArray(item.breakdown)?item.breakdown:[]).filter(b=>typeof b?.label==='string'&&Number.isFinite(b.value)&&Number.isFinite(b.max)&&b.max>0).map(b=>({...b,value:Math.max(0,Math.min(b.max,b.value))}))}];});
  return {analysis:{valid:a.valid,urgent:a.urgent,category:String(a.category||''),categoryLabel:String(a.categoryLabel||''),summary:String(a.summary||''),referralReason:String(a.referralReason||''),tags:strings(a.tags),missing:strings(a.missing)},ranked:a.valid?result:[],meta:{provider:'kimi',model:typeof payload.meta?.model==='string'?payload.meta.model:config.model}};
}
async function runMatch(){
  if(matchState==='loading')return;
  if(mode==='kimi'&&(config.status!=='ready'||!config.configured)){toast('智能匹配服务暂不可用，请联系管理员。');return;}
  if(!caseText.trim()||caseText.length>config.maxCaseLength){toast(`请填写不超过 ${config.maxCaseLength} 字的病例摘要。`);return;}
  const request=++matchRequest,version=caseVersion,text=caseText,requestMode=mode;matchController?.abort();const controller=new AbortController();matchController=controller;if(modalType==='doctor'||modalType==='confirm')closeModal();
  analysis=null;ranked=[];matchedVersion=-1;matchError='';matchState='loading';limit=6;updatePatient();updatePatientSummary();renderProvider();renderResults();
  try{
    let result;
    if(requestMode==='offline'){const a=analyzeCase(text);result={analysis:a,ranked:rankDoctors(doctors,a)};}
    else result=normalizeMatch(await api('/api/match',{caseText:text},controller.signal));
    if(request!==matchRequest||version!==caseVersion||requestMode!==mode||controller.signal.aborted)return;
    analysis=result.analysis;ranked=result.ranked;matchedVersion=version;matchState='ready';matchMeta=result.meta||{provider:requestMode,model:'local-rules'};
  }catch(error){if(request!==matchRequest||version!==caseVersion||controller.signal.aborted)return;matchState='error';matchError=error.message||'匹配失败，请重试。';}
  finally{if(request===matchRequest){matchController=null;renderProvider();renderResults();renderChat();}}
}
function renderChat(){
  const node=$('#chat-panel');if(!node)return;const enabled=mode==='kimi'&&config.status==='ready'&&config.configured;
  node.innerHTML=`<div class="panel-title"><h2>${icon('spark')}转诊问答</h2><button class="text-button" data-action="clear-chat" type="button">清空问答</button></div><div class="chat-body"><p class="chat-intro">${mode==='offline'?'当前工作方式暂不支持在线问答。':'询问转诊资料、医生专长与匹配依据，辅助完成转诊准备。'}</p><label class="field-label" for="chat-doctor">讨论对象</label><select id="chat-doctor" ${chatPending?'disabled':''}><option value="">当前病例与转诊流程</option>${doctors.map(d=>`<option value="${esc(d.id)}" ${chatDoctorId===d.id?'selected':''}>${esc(d.name)} · ${esc(d.department)}</option>`).join('')}</select><div class="chat-messages" aria-live="polite" aria-busy="${chatPending}">${chatMessages.length?chatMessages.map(m=>`<div class="chat-message ${m.role==='user'?'from-user':'from-assistant'}"><strong>${m.role==='user'?'我':'转诊助手'}</strong><p>${esc(m.content)}</p></div>`).join(''):'<p class="chat-placeholder">例如：转诊前还需要补充哪些资料？为什么推荐这位医生？</p>'}${chatPending?'<div class="pending-match"><span class="spinner"></span>正在整理回答…</div>':''}</div>${chatError?`<div class="request-error" role="alert"><p>${esc(chatError)}</p><button class="secondary" data-action="retry-chat" ${!enabled?'disabled':''}>重试这条问题</button></div>`:''}<form id="chat-form"><label class="field-label" for="chat-input">输入问题</label><textarea id="chat-input" rows="3" maxlength="1200" placeholder="请输入转诊相关问题，勿包含身份信息" ${!enabled||chatPending?'disabled':''}>${esc(chatDraft)}</textarea><div class="chat-actions"><small>回答供医生复核；病例变更后开始新的问答。</small><button class="primary" id="chat-send" type="submit" ${!enabled||chatPending||!chatDraft.trim()||!caseText.trim()?'disabled':''}>${chatPending?'正在回答…':'发送问题'} ${icon('arrow')}</button></div></form></div>`;
  const messages=$('.chat-messages',node);messages.scrollTop=messages.scrollHeight;
}
function chatContext(history){
  const messages=history.slice(-12).map(m=>({role:m.role,content:m.content.slice(0,2000)}));
  let length=messages.reduce((sum,m)=>sum+m.content.length,0);
  while(messages.length>1&&length>16000)length-=messages.shift().content.length;
  while(messages.length>1&&messages[0].role==='assistant')messages.shift();
  return messages;
}
async function sendChat(retry=false){
  if(chatPending||mode!=='kimi'||config.status!=='ready'||!config.configured)return;
  if(!caseText.trim()||caseText.length>config.maxCaseLength){toast('请先填写符合长度要求的病例摘要。');return;}
  const question=chatDraft.trim();if(!retry&&!question)return;if(retry&&!chatFailedMessages)return;
  if(!retry){chatMessages.push({role:'user',content:question});chatDraft='';}
  const messages=chatContext(retry?chatFailedMessages:chatMessages);
  const request=++chatRequest,version=caseVersion,doctorId=chatDoctorId;const controller=new AbortController();chatController=controller;chatPending=true;chatError='';chatFailedMessages=null;renderChat();
  try{const result=await api('/api/chat',{caseText,messages,...(doctorId?{doctorId}:{})},controller.signal);if(request!==chatRequest||version!==caseVersion||mode!=='kimi'||doctorId!==chatDoctorId||controller.signal.aborted)return;if(typeof result?.answer!=='string'||!result.answer.trim())throw Error('暂未获得有效回答，请重试。');chatMessages.push({role:'assistant',content:result.answer});}
  catch(error){if(request!==chatRequest||version!==caseVersion||controller.signal.aborted)return;chatError=error.message||'问答失败，请重试。';chatFailedMessages=messages;}
  finally{if(request===chatRequest){chatPending=false;chatController=null;renderChat();}}
}
const pageInfo={
  home:{title:'协同服务首页',eyebrow:'ANZHEN CARE NETWORK',description:'从专科诊疗到基层接续，让每一步照护彼此相连。'},
  workbench:{title:'下级转上级',eyebrow:'UPWARD REFERRAL',description:'从患者病情出发，找到适合的上级接诊医生。'},
  downward:{title:'上级转下级',eyebrow:'CONTINUITY OF CARE',description:'诊疗完成后，衔接基层住院、康复与后续医疗服务。'},
  guidance:{title:'患者导诊',eyebrow:'YOUR CARE GUIDE',description:'带上你的病历，找到医生、诊室和下一步方向。'},
  receive:{title:'上转接收中心',eyebrow:'REFERRAL COORDINATION',description:'查看来源医院与病情摘要，协调科室及床位。'},
  'down-receive':{title:'下转接收中心',eyebrow:'DOWNWARD COORDINATION',description:'复核上级交接资料，安排下级接收与后续照护。'},
  approval:{title:'医务审核',eyebrow:'REFERRAL REVIEW',description:'来源医院复核转诊、交接材料与医保事项。'},
  messages:{title:'消息提醒',eyebrow:'REFERRAL MESSAGES',description:'跟进审批与接诊待办，直达对应申请。'},
  'data-intake':{title:'院内数据接入',eyebrow:'CLINICAL DATA INTAKE',description:'核对当前就诊信息，衔接转诊工作台。'},
  records:{title:'上转记录',eyebrow:'REFERRAL HISTORY',description:'跟踪每一次上转，从发起到接收。'},
};
function initializeWorkspaces(){
  const context={workspace:sharedWorkspace,getDoctors:()=>doctors,api,openModal:(html,label)=>setModal(html,'extension',label),closeModal,toast,navigate,renderSchedule:renderWorkingSchedule,escape:esc,icon,photo,onUpdate:updateGlobalSummaries};
  attachmentController=createAttachmentController({api,toast,escape:esc,offline:offlineBuild,onChange:()=>{updateMatchButton();}});
  approvalWorkspace=createApprovalWorkspace({...context,offline:offlineBuild,getRecords:()=>records,saveRecordChange,openRecord,onUpdate:()=>{syncRecordViews();updateGlobalSummaries();}});
  intakeWorkspace=createDataIntake({...context,onImport:async(payload,direction)=>{if(direction==='downward'){if(payload.caseSummary.length>4000)throw Error('下转病情摘要不能超过 4000 字，请在导入内容中精简后重试。');navigate('downward');downwardWorkspace.importPatient(payload);return;}importedPatient={name:payload.name,sex:payload.sex,age:payload.age};inputSource={sourceSystem:payload.sourceSystem,sourcePatientId:payload.sourcePatientId};activePreset=null;sourceHospital=payload.sourceHospital;sourceDoctor=payload.sourceDoctor||'';insurance={type:'待核实',settlement:'待医保办核实',materialStatus:'待核实',note:''};caseText=`患者，${payload.sex}，${payload.age}岁。诊断：${payload.diagnosis}。\n\n${payload.caseSummary}`;attachmentController.clear();invalidateCase();navigate('workbench');toast('就诊信息已带入，请复核转诊目的并补充附件。');}});
  downwardWorkspace=createDownwardWorkspace(context);
  guidanceWorkspace=createGuidanceWorkspace(context);
  portalWorkspace=createPortal({...context,getUpStats:()=>({total:records.length,pending:pendingCount()}),getDownStats:()=>downwardWorkspace.summary?.()||{patients:0,pending:0,urgent:0}});
}
function updateGlobalSummaries(){
  renderSharedStatus();
  for(const [id,count]of [['approval',approvalWorkspace?.count()||0],['messages',approvalWorkspace?.unreadCount()||0],['down-receive',downwardWorkspace?.summary().pending||0]]){const nav=document.querySelector(`[data-nav="${id}"]`);if(nav){let badge=nav.querySelector('.count');if(count){if(!badge){badge=document.createElement('b');badge.className='count';nav.append(badge);}badge.textContent=count;}else badge?.remove();}}
  const urgent=downwardWorkspace?.summary?.().urgent||0;
  const notification=$('#global-notification');
  if(notification){notification.classList.toggle('urgent',urgent>0);notification.innerHTML=`${icon('bell')}<span>${urgent?'紧急待处理':'照护通知'}</span>${urgent?`<b>${urgent}</b>`:''}`;notification.setAttribute('aria-label',urgent?`${urgent} 条紧急照护通知`:'查看照护通知');}
  if(page==='home'&&portalWorkspace&&$('#page-content'))portalWorkspace.render($('#page-content'));
}
function navigate(next){
  if(!pageInfo[next])return;
  if(page!==next){if(['downward','down-receive'].includes(page))downwardWorkspace?.onLeave?.();if(['approval','messages'].includes(page))approvalWorkspace?.onLeave?.();if(page==='data-intake')intakeWorkspace?.onLeave?.();if(page==='guidance')guidanceWorkspace?.onLeave?.();}
  closeModal();page=next;shell();window.scrollTo({top:0});
}
function shell(){
  const info=pageInfo[page]||pageInfo.home;
  const nav=[['home','home','服务首页'],['workbench','upward','下级转上级'],['downward','downward','上级转下级'],['guidance','compass','患者导诊'],['receive','receive','上转接收中心'],['down-receive','receive','下转接收中心'],['approval','shield','医务审核'],['records','records','上转记录'],['messages','bell','消息提醒'],['data-intake','grid','院内数据接入']];
  const person=page==='guidance'?['患','患者服务','就诊信息与院内指引']:page==='downward'?['协','连续照护团队','上级指导 · 下级接续']:page==='receive'?['接','转诊中心工作人员','北京安贞医院安徽医院']:['李','李明 · 协同工作台','医联体医疗服务'];
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><button class="brand-home" data-nav="home" aria-label="返回服务首页"><div class="brand-symbol">${icon('pulse')}</div><div><strong>安贞医联</strong><small>ANZHEN CONNECT</small></div></button></div><div class="nav-heading">CARE WORKSPACE</div><nav aria-label="主导航">${nav.map(([id,ic,label],index)=>`${index===4?'<div class="nav-group-divider"></div>':''}<button class="nav-item ${page===id?'active':''}" data-nav="${id}" ${page===id?'aria-current="page"':''}>${icon(ic)}<span>${label}</span>${id==='receive'&&pendingCount()?`<b class="count">${pendingCount()}</b>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="network-card">${icon('hospital')}<strong>北京安贞医院安徽医院</strong><p>双向转诊 · 连续照护<br>围绕患者，连接诊疗与康复</p></div><div class="sidebar-footer">医联体协同服务平台</div></div></aside><div class="main-shell"><header class="topbar"><div class="breadcrumb">医联体协同 ${icon('chevron')} <b>${info.title}</b></div><div class="topbar-right">${sharedWorkspace?'<span class="shared-status" id="shared-status" role="status"></span>':''}<button class="global-alert" id="global-notification" data-action="open-down-alerts" aria-label="查看照护通知">${icon('bell')}<span>照护通知</span></button><div class="user"><div class="avatar">${person[0]}</div><div><strong>${person[1]}</strong><small>${person[2]}</small></div></div></div></header><main class="page page-${page}"><div class="page-heading"><div><div class="eyebrow">${info.eyebrow}</div><h1>${info.title}</h1><p>${info.description}</p></div><div class="date-label">${icon('calendar')}${new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</div></div><div id="page-content"></div></main></div></div>`;
  const container=$('#page-content');
  if(page==='home')portalWorkspace.render(container);
  else if(page==='workbench')renderWorkbench();
  else if(page==='downward')downwardWorkspace.render(container);
  else if(page==='guidance')guidanceWorkspace.render(container);
  else if(page==='down-receive')downwardWorkspace.renderReceiving(container);
  else if(page==='approval')approvalWorkspace.render(container);
  else if(page==='messages')approvalWorkspace.renderNotifications(container);
  else if(page==='data-intake')intakeWorkspace.render(container);
  else renderQueue();
  updateGlobalSummaries();
}
function renderWorkbench(){
  $('#page-content').innerHTML=`<div class="steps"><span class="done"><i>1</i>录入病例</span><b></b><span class="current"><i>2</i>匹配接诊医生</span><b></b><span><i>3</i>医务审核与接收</span></div><div class="workspace"><div><section class="panel"><div class="panel-title"><h2>${icon('file')}转诊病例</h2><button class="text-button" data-nav="data-intake">从院内系统导入 ${icon('receive')}</button></div><div class="case-body"><label class="field-label">病例模板 <span class="example-label">· 快速填写</span></label><div class="example-tabs">${presets.map(p=>`<button data-preset="${p.id}" class="${activePreset===p.id?'active':''}">${p.label}</button>`).join('')}</div><div class="patient-block" id="patient-summary"></div><div class="input-group"><label class="field-label" for="source-hospital">来源医院</label><input id="source-hospital" maxlength="80" value="${esc(sourceHospital)}"></div><div class="input-group"><label class="field-label" for="source-doctor">发起医生</label><input id="source-doctor" maxlength="40" value="${esc(sourceDoctor)}"></div><div class="input-group"><label class="field-label" for="case-input">患者病情与转诊原因</label><textarea id="case-input" maxlength="5000" placeholder="请输入患者症状、检查结果、本院能力缺口及转诊目的…">${esc(caseText)}</textarea><div class="case-footer"><span>请填写脱敏病例摘要</span><span id="case-length">${caseText.length} / 5000</span></div></div><div id="case-attachments">${attachmentController.render()}</div><details class="insurance-details"><summary>医保与转诊材料</summary>${renderInsuranceFields(insurance,esc,'draft-insurance')}</details><div id="service-notice" class="service-notice" role="status" hidden></div><button class="primary block" id="match-button">${icon('spark')}匹配接诊医生 ${icon('arrow')}</button></div></section><div class="tip-card">${icon('shield')}<span>提供检查结果和本院能力缺口，可以让匹配依据更清楚。最终转诊由医生复核、接收方确认。</span></div></div><div class="results-column"><section id="results" aria-live="polite" aria-busy="false"></section><section id="chat-panel" class="panel chat-panel" aria-label="转诊问答"></section></div></div>`;
  attachmentController.bind($('#case-attachments'));updatePatientSummary();renderProvider();renderResults();renderChat();
}
function updatePatientSummary(){if($('#patient-summary'))$('#patient-summary').innerHTML=`<div class="patient-avatar">${icon('user')}</div><div><strong>${esc(patientLabel(patient))}</strong><p>心血管专科 · 转诊评估</p></div>`;}
function renderResults(){
  const container=$('#results');if(!container)return;container.setAttribute('aria-busy',String(matchState==='loading'));
  const valid=hasCurrentMatch();
  const current=sortCandidateDoctors(ranked,{order:analysis?.urgent?'score':sortOrder,onlyAvailable:analysis?.urgent?false:onlyAvailable,records}).filter(d=>filter==='all'||(filter==='internal'&&d.department.includes('内科'))||(filter==='surgery'&&d.department.includes('外科'))||(filter==='rehab'&&d.department.includes('康复')));
  const heading=`<div class="result-header"><h2>推荐接诊医生 <span>${valid?`${ranked.length} 位匹配`:''}</span></h2><button class="text-button" data-action="method">匹配依据 ${icon('info')}</button></div>`;
  const note=`<div class="source-note">${icon('info')}医生照片及简介来自已收集的公开资料。匹配结果供转诊医生参考，可查看医生详情了解具体依据。</div>`;
  if(matchState==='loading'){container.innerHTML=heading+'<div class="empty matching-empty"><span class="spinner"></span><h3>正在分析病例并匹配医生</h3><p>正在结合病情、转诊目的与医生专长进行分析，请稍候。</p></div>'+note;return;}
  if(matchState==='error'){container.innerHTML=heading+`<div class="empty request-error" role="alert">${icon('info')}<h3>本次匹配未完成</h3><p>${esc(matchError)}</p><button class="primary" data-action="retry-match">重试匹配</button><p class="retry-note">病例内容已保留，可稍后重试。</p></div>`+note;return;}
  if(matchState==='idle'||matchState==='stale'){container.innerHTML=heading+`<div class="empty">${icon('file')}<h3>${matchState==='stale'?'病例已更新，请重新匹配':'准备好病例后开始匹配'}</h3><p>填写病情与转诊目的，点击“匹配接诊医生”获取建议。${matchState==='stale'?'旧结果已失效，不能用于转诊。':''}</p></div>`+note;return;}
  container.innerHTML=heading+`${valid?`<div class="clinical-summary"><div class="summary-top"><div class="summary-title">${icon('spark')}病例分析</div><span class="urgency ${analysis.urgent?'':'routine'}">${analysis.urgent?'需紧急对接':'择期转诊'}</span></div><p>${esc(analysis.summary||analysis.categoryLabel)}</p><div class="tags summary-tags">${(analysis.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>${analysis.referralReason?`<p class="referral-reason">转诊依据：${esc(analysis.referralReason)}</p>`:''}${analysis.urgent?'<p class="missing-info">本病例需立即对接，不使用普通门诊日期等待急症救治。</p>':''}${analysis.missing?.length?`<p class="missing-info">可补充：${analysis.missing.map(esc).join('、')}</p>`:''}</div><div class="filter-bar"><span>专业方向</span>${[['all','综合匹配'],['internal','心内科'],['surgery','心外科'],['rehab','心脏康复']].map(([id,l])=>`<button class="filter-button ${filter===id?'active':''}" data-filter="${id}">${l}</button>`).join('')}<span class="filter-count">仅展示有照片的医生</span></div><div class="schedule-sort ${analysis.urgent?'is-urgent':''}">${analysis.urgent?`<div class="urgent-sort-notice" id="urgent-sort-reason" role="note">${icon('info')}<div><strong>紧急转诊：暂不可切换排序或筛选时段</strong><p>已按专业匹配排序，请立即对接接诊团队，不等待普通门诊排班。</p></div></div>`:''}<label>排序方式<select id="doctor-sort" ${analysis.urgent?'disabled aria-describedby="urgent-sort-reason"':''}><option value="score" ${analysis.urgent||sortOrder==='score'?'selected':''}>专业匹配优先</option><option value="time" ${!analysis.urgent&&sortOrder==='time'?'selected':''}>最近接诊时间优先</option><option value="intents" ${!analysis.urgent&&sortOrder==='intents'?'selected':''}>意向登记较少优先</option></select></label><label class="inline-check"><input id="doctor-available" type="checkbox" ${!analysis.urgent&&onlyAvailable?'checked':''} ${analysis.urgent?'disabled aria-describedby="urgent-sort-reason"':''}>仅看近期可登记</label>${analysis.urgent?'':'<small>时间与余量为预设参考，挂号系统待接入</small>'}</div>`:''}${!valid?`<div class="empty">${icon('file')}<h3>病例信息不足或不适合匹配</h3><p>${esc(analysis?.summary||'请补充病情、检查及转诊目的，再点击匹配。')}</p></div>`:!current.length?`<div class="empty">${icon('search')}<h3>暂未找到有依据的匹配</h3><p>当前资料库未找到与这份病例及筛选条件对应的医生。请补充病情或调整专业方向。</p>${filter!=='all'?'<button class="secondary" data-filter="all" style="margin-top:18px">查看全部匹配</button>':''}</div>`:`<div class="doctor-grid">${current.slice(0,limit).map((d,i)=>doctorCard(d,i)).join('')}</div>${current.length>limit?`<div class="load-more"><button data-action="more">查看更多医生（还有 ${current.length-limit} 位）</button></div>`:''}`} ${note}`;
}
function doctorCard(d,i){const first=nextAppointment(d.id,new Date(),records);return `<article class="doctor-card ${i===0&&filter==='all'?'recommended':''}" data-doctor-card="${esc(d.id)}">${i===0&&filter==='all'?`<span class="card-rank">${sortOrder==='time'&&!analysis.urgent?'近期可接诊优先':sortOrder==='intents'&&!analysis.urgent?'意向登记较少':'专业方向优先匹配'}</span>`:''}<div class="doctor-card-inner"><div class="doctor-head">${photo(d)}<div class="doctor-head-info"><h3>${esc(d.name)}<span>${esc(d.title)}</span></h3><p>${esc(d.department)}</p></div>${score(d)}</div><div class="tags">${d.expertise.slice(0,3).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div><p class="doctor-bio">${esc(d.bio)}</p>${d.reasons.slice(0,2).map(r=>`<p class="match-reason">${icon('check')}<span>${esc(r)}</span></p>`).join('')}</div><div class="card-footer"><span class="available"><span class="status-dot"></span>${analysis.urgent?'需立即对接':first?`近期 ${esc(first.date.slice(5).replace('-','/'))} ${first.session} · 参考余量 ${first.remaining}`:'接诊安排待确认'}</span><button class="card-action" data-detail="${esc(d.id)}">查看详情与接诊安排 ${icon('arrow')}</button></div></article>`;}
function setModal(html,type,label){if(!modalType)restoreFocus=document.activeElement;modalType=type;$('#modal-root').innerHTML=`<div class="modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(label||(type==='doctor'?'医生详情与接诊安排':type==='confirm'?'确认转诊':type==='success'?'转诊申请已创建':type==='record'?'转诊详情':'匹配说明'))}" tabindex="-1"><button class="modal-close" data-action="close" aria-label="关闭">${icon('close')}</button>${html}</section></div>`;document.body.classList.add('modal-open');requestAnimationFrame(()=>$('.modal')?.focus({preventScroll:true}));}
function closeModal(){approvalWorkspace?.onModalClose?.();modalType=null;selectedDoctor=null;selectedDate=null;selectedSlot=null;currentRecord=null;$('#modal-root').innerHTML='';document.body.classList.remove('modal-open');if(restoreFocus?.isConnected)restoreFocus.focus();}
function openDoctor(id){if(!hasCurrentMatch()){toast('当前结果已失效，请重新匹配后选择医生。');return;}selectedDoctor=ranked.find(d=>d.id===id);if(!selectedDoctor){toast('病例匹配已更新，请重新选择医生');return;}selectedDate=null;selectedSlot=null;renderDoctor();}
function renderDoctor(){if(!hasCurrentMatch()||!selectedDoctor){closeModal();toast('请先完成当前病例的匹配。');return;}const d=selectedDoctor;const schedule=buildSchedule(d.id);const day=schedule.find(s=>s.date===selectedDate);const urgent=analysis.urgent;
  const body=`<div class="detail-top">${photo(d,true)}<div><h2>${esc(d.name)}<span>${esc(d.title)}</span></h2><p>北京安贞医院安徽医院 · ${esc(d.department)}</p><div class="tags">${d.expertise.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div></div>${score(d)}</div><div class="detail-body"><div class="detail-section"><h3>医生简介</h3><p>${esc(d.bio)}</p>${d.education?`<p style="margin-top:10px">学历与经历：${esc(d.education)}</p>`:''}<div class="reason-panel"><h3>与本病例的匹配依据</h3>${d.reasons.map(r=>`<p class="match-reason">${icon('check')}<span>${esc(r)}</span></p>`).join('')}<div class="breakdown">${(d.breakdown||[]).map(b=>`<div class="breakdown-line"><span>${esc(b.label)}</span><span class="track"><i style="width:${Math.max(0,Math.min(100,b.value/b.max*100))}%"></i></span><b>${esc(b.value)}/${esc(b.max)}</b></div>`).join('')}</div><p>100 分制匹配分用于辅助复核专业方向，不是临床概率；仍需转诊医生判断。</p></div><details class="sources"><summary>查看资料来源</summary><p>资料更新于 2026 年 9 月 14 日，专业信息以院方最新发布为准。</p>${d.sourceUrls.slice(0,4).map((u,i)=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">公开资料 ${i+1} ↗</a>`).join('')}</details></div><div class="detail-section"><h3>${urgent?'紧急转诊安排':'选择意向日期与时段'}<span class="schedule-status">待院方确认</span></h3>${urgent?`<div class="urgent-callout"><strong>${icon('clock')}本病例需要立即对接</strong><p>紧急联系与院内审核同步开展，不等待普通门诊时段。请接收方核实接诊团队、床位与转运衔接。</p></div><div class="immediate-slot">${icon('receive')}<div><strong>立即发起 · 转诊中心协调</strong><p>无需选择普通门诊；下表用于查阅医生工作时间。</p></div></div>`:'<p>点击下表中的可选时段，登记接诊意向。</p>'}${renderWorkingSchedule(d.id,{selectable:!urgent,selectedSlotId:selectedSlot?.id||'',records})}</div></div><div class="modal-footer"><p>${urgent?'<b>紧急转诊 · 立即对接</b><br>提交后仍需接收方确认':selectedSlot?`<b>${esc(formatDate(selectedDate))} ${esc(selectedSlot.session)}</b><br>${esc(selectedSlot.time)} · 接诊意向`:'<b>请选择意向日期与时段</b><br>转诊资料会在下一步供你复核'}</p><button class="primary" data-action="review" ${!urgent&&!selectedSlot?'disabled':''}>${urgent?'复核并立即对接':'复核转诊信息'} ${icon('arrow')}</button></div>`;
  setModal(body,'doctor');
}
function validateTransfer(){if(attachmentController.isPending()){toast('附件仍在上传，请完成后再提交。');return false;}if(!hasCurrentMatch()||!selectedDoctor||!ranked.some(d=>d.id===selectedDoctor.id)){toast('病例或匹配已变更，请重新匹配后再转诊。');return false;}if(!sourceHospital.trim()||!sourceDoctor.trim()){toast('请补充来源医院和发起医生');return false;}if(!analysis?.valid||!selectedDoctor)return false;if(!analysis.urgent){const slot=buildSchedule(selectedDoctor.id).find(d=>d.date===selectedDate)?.slots.find(s=>s.id===selectedSlot?.id);if(!slot||slot.remaining<=0||selectedDate<localDay()){toast('所选时段已不可用，请重新选择');return false;}}return true;}
function reviewTransfer(){if(!validateTransfer())return;const d=selectedDoctor;setModal(`<div class="modal-title-bar"><small>最后一步 · 医生复核</small><h2>确认转诊信息</h2></div><div class="confirmation"><div class="confirm-banner">${analysis.urgent?'紧急联系同步进行；提交后进入来源医院医务审核，不等待页面审批开展紧急对接。':'申请先进入来源医院医务审核，通过后进入上级接收中心。'}</div><div class="confirm-grid">${[['患者信息',patientLabel(patient)],['接收医院','北京安贞医院安徽医院'],['来源医院',sourceHospital],['发起医生',sourceDoctor],['意向接诊医生',`${d.name} · ${d.department}`],['附件数量',`${attachmentController.getAttachments().length} 份`],['转诊安排',analysis.urgent?'紧急 · 立即对接':`${formatDate(selectedDate)} ${selectedSlot.session} ${selectedSlot.time}`]].map(([l,v])=>`<div class="confirm-field"><small>${l}</small><strong>${esc(v)}</strong></div>`).join('')}</div><div class="confirm-case">${esc(caseText)}</div><label class="consent"><input type="checkbox" id="reviewed"><span>我已复核病例、附件与转诊意向，提交来源医院医务审核。</span></label></div><div class="modal-footer"><button class="secondary" data-action="back-detail">返回修改</button><button class="primary" data-action="submit" id="submit-referral" disabled>提交医务审核 ${icon('check')}</button></div>`,'confirm');}
async function submitTransfer(){
  if(recordSaving||!$('#reviewed')?.checked||!validateTransfer())return;
  $('#submit-referral').disabled=true;recordSaving=true;
  const version=caseVersion,d=selectedDoctor,createdAt=new Date().toISOString();
  const r={id:newRecordId(localDay()),doctor:{id:d.id,name:d.name,title:d.title,department:d.department},snapshot:{text:caseText,patient:{name:patient.name,sex:patient.sex,age:patient.age},sourceHospital,sourceDoctor,category:analysis.categoryLabel,score:d.score,provider:mode,model:matchMeta?.model||'',urgent:analysis.urgent,reasons:d.reasons},date:analysis.urgent?localDay():selectedDate,slotId:analysis.urgent?'immediate':selectedSlot.id,session:analysis.urgent?'立即对接':selectedSlot.session,time:analysis.urgent?'由接收中心协调':selectedSlot.time,status:'review',createdAt,approval:{status:'pending',reviewer:'',note:''},insurance:{...insurance},attachments:attachmentController.getAttachments(),...(inputSource?{inputSource:{...inputSource}}:{}),events:[{label:'转诊申请已保存，待来源医院医务审核',at:createdAt}]};
  r.notifications=referralNotifications(r,'review',createdAt);
  try{
    const result=await saveRecordChange(latest=>{
      if(version!==caseVersion||modalType!=='confirm')throw Error('cancelled');
      const duplicate=latest.find(existing=>sameReferral(existing,r));
      return {records:duplicate?latest:[r,...latest],recordId:duplicate?.id||r.id,duplicate:Boolean(duplicate)};
    });
    currentRecord=records.find(record=>record.id===result.recordId);shell();showSuccess(currentRecord,result.duplicate);
  }catch(error){if(error.message!=='cancelled')toast(sharedWorkspace?'转诊申请未保存，请检查网络并重试。':'转诊申请未保存，请检查浏览器存储后重试。');}
  finally{recordSaving=false;if($('#submit-referral'))$('#submit-referral').disabled=!$('#reviewed')?.checked||!hasCurrentMatch();}
}
function showSuccess(r,duplicate=false){setModal(`<div class="success"><div class="success-icon">${icon('check')}</div><h2>${duplicate?'已存在相同转诊申请':'转诊申请已保存'}</h2><p>${esc(r.doctor.name)} · ${esc(r.doctor.department)}<br>${r.snapshot.urgent?'紧急转诊，等待接收中心协调':esc(`${formatDate(r.date)} ${r.session} ${r.time}`)}</p><div class="receipt-number">转诊单号 ${esc(r.id)}</div><div class="timeline"><span class="complete">已保存申请</span><i></i><span>${referralStatusLabel(r.status)}</span><i></i><span>上级接收与诊疗衔接</span></div><p style="font-size:10px;margin-top:20px">${sharedWorkspace?'记录已保存至服务器，同一网址下可共同查看。院方接收需另行确认。':'记录已保存在当前浏览器，尚未发送院方。'}</p></div><div class="modal-footer"><button class="secondary" data-action="close">继续查看医生</button><button class="primary" data-nav="approval">进入医务审核 ${icon('arrow')}</button></div>`,'success');}
function renderQueue(){const list=page==='receive'?records.filter(r=>r.status==='pending'):records;$('#page-content').innerHTML=`<div class="queue-toolbar"><div><h2>${page==='receive'?'待协调的转诊申请':'全部转诊申请'}</h2><p>${page==='receive'?'复核病情与来源信息，登记科室、就诊地点及协调安排。':'汇总转诊申请与协调记录，跟进后续接诊安排。'}</p></div><span class="queue-count">${list.length} 条${page==='receive'?'待接收':'记录'}</span></div>${!list.length?`<div class="empty">${icon(page==='receive'?'receive':'records')}<h3>${page==='receive'?'暂无待接收的申请':'尚未创建转诊申请'}</h3><p>转诊申请经来源医院医务审核通过后，在这里登记接诊协调情况。</p><button class="primary" data-nav="workbench">前往转诊工作台 ${icon('arrow')}</button>${page==='receive'&&records.length?'<button class="secondary" data-nav="records" style="margin-left:10px">查看已接收记录</button>':''}</div>`:`<div class="referral-list">${list.map(r=>`<article class="referral-card"><div class="avatar">${esc(r.snapshot.patient.name.slice(0,1))}</div><div class="referral-info"><h3>${esc(recordText(r.snapshot.patient.name))} <span class="status-pill ${r.status==='accepted'?'accepted':''}">${referralStatusLabel(r.status)}</span>${r.snapshot.urgent?'<span class="urgency">紧急</span>':''}</h3><p>${esc(recordText(r.snapshot.sourceHospital))} → 北京安贞医院安徽医院<br>${esc(r.doctor.name)} · ${esc(r.doctor.department)} · ${esc(r.date)} ${esc(r.session)}</p><div class="referral-meta">${esc(r.id)} · ${timeText(r.createdAt)}创建 · 转诊申请</div></div><div class="record-actions"><button class="${page==='receive'?'primary':'secondary'}" data-record="${esc(r.id)}">${page==='receive'?'查看并协调接收':'查看转诊详情'} ${icon('arrow')}</button></div></article>`).join('')}</div>`}`;}
function openRecord(id){currentRecord=records.find(r=>r.id===id);if(!currentRecord)return;if(['review','returned'].includes(currentRecord.status)){approvalWorkspace.openRecord(id);return;}const r=currentRecord;setModal(`<div class="modal-title-bar"><small>${esc(r.id)} · ${referralStatusLabel(r.status)}</small><h2>转诊申请详情</h2></div><div class="confirmation"><div class="confirm-grid">${[['患者信息',recordText(patientLabel(r.snapshot.patient))],['来源医院',recordText(r.snapshot.sourceHospital)],['发起医生',recordText(r.snapshot.sourceDoctor)],['意向接诊',`${r.doctor.name} · ${r.doctor.department}`],['安排',`${r.date} ${r.session} ${r.time}`],['匹配摘要',`${r.snapshot.category||'专病转诊'} · ${r.snapshot.provider==='kimi'?'AI 匹配分':'匹配参考分'} ${r.snapshot.score}/100`]].map(([l,v])=>`<div class="confirm-field"><small>${l}</small><strong>${esc(v)}</strong></div>`).join('')}</div><div class="case-data"><label class="field-label">来源医院提供的病情与治疗摘要</label><p>${esc(r.snapshot.text)}</p></div>${r.status==='pending'?`<div class="receive-arrange"><label>意向接收科室<select id="receive-department"><option>${esc(r.doctor.department)}</option><option>心血管内科</option><option>心脏大血管外科</option><option>心脏康复中心</option></select></label><label>拟安排床位或就诊地点<input id="receive-location" maxlength="60" placeholder="请填写待与院方核实的安排" value=""></label></div><label class="consent"><input type="checkbox" id="receive-checked"><span>我已复核协调信息；院方接收结果另行核实。</span></label>`:`<div class="accepted-info">登记科室：${esc(r.acceptedDepartment)}<br>拟安排：${esc(recordText(r.acceptedLocation))}<br>后续诊疗记录与康复下转可基于这张转诊单继续衔接。</div>`}<h3 class="section-small-heading">病历与影像附件</h3>${renderAttachmentList(r.attachments||[],{escape:esc})}${r.approval?`<div class="accepted-info">医务审核：${esc(r.approval.reviewer||'待审核')} · ${esc(r.approval.note||'')}<br>医保事项：${esc(r.insurance?.type||'待核实')} · ${esc(r.insurance?.settlement||'待核实')} · ${esc(r.insurance?.materialStatus||'待核实')}</div>`:''}<div class="history-timeline">${r.events.map(e=>`<div>${icon('check')}${esc(recordText(e.label))}<span>${timeText(e.at)}</span></div>`).join('')}</div></div><div class="modal-footer"><p>${sharedWorkspace?'协调信息已同步至服务器':'协调信息保存在当前浏览器'}<br>院方尚未确认接收</p>${r.status==='pending'?'<button class="primary" data-action="accept" id="accept-referral" disabled>保存协调安排</button>':'<button class="secondary" data-action="close">关闭详情</button>'}</div>`,'record');}
async function acceptReferral(){
  if(recordSaving||!currentRecord||currentRecord.status!=='pending'||!$('#receive-checked')?.checked)return;
  const location=$('#receive-location').value.trim();
  if(!location){toast('请填写拟安排的床位或就诊地点');$('#receive-location').focus();return;}
  const id=currentRecord.id,department=$('#receive-department').value;
  recordSaving=true;$('#accept-referral').disabled=true;
  try{
    const result=await saveRecordChange(latest=>{
      const record=latest.find(r=>r.id===id);if(!record)throw Error('missing');
      if(record.approval&&record.approval.status!=='approved')throw Error('请先完成来源医院医务审核。');
      if(record.status==='accepted')return {records:latest,alreadyAccepted:true};
      const acceptedAt=new Date().toISOString();
      const accepted={...record,status:'accepted',acceptedDepartment:department,acceptedLocation:location,acceptedAt,events:[...record.events,{label:'协调安排已登记，待院方核实',at:acceptedAt}]};
      return {records:latest.map(r=>r.id===id?accepted:r),alreadyAccepted:false};
    });
    shell();openRecord(id);toast(result.alreadyAccepted?'这份申请的协调安排已在其他页面保存。':'已保存协调安排，可在转诊记录中查看');
  }catch{toast(sharedWorkspace?'协调安排未保存，请检查网络并重试。':'协调安排未保存，请检查浏览器存储后重试。');}
  finally{recordSaving=false;if($('#accept-referral'))$('#accept-referral').disabled=!$('#receive-checked')?.checked;}
}
function showMethod(){setModal(`<div class="modal-title-bar"><small>智能转诊助手</small><h2>匹配依据与使用说明</h2></div><div class="method-modal"><p>根据病例、转诊目的与医生公开专业资料，提供候选医生、匹配分及资料依据，供转诊医生复核。</p><h3>评分依据</h3><p>专业方向 45 分、相关技术 30 分、转诊目的 15 分、资料充分性 10 分。缺少技术证据时限制相应分值；排班、学历和职称不参与评分。匹配分不代表疗效、接收概率或医生能力排名。</p><h3>病例信息</h3><p>请填写脱敏的病情与检查摘要。点击匹配或发送问题后，相关内容交由外部智能分析服务处理；修改病例会使原匹配结果失效。</p><h3>接诊安排</h3><p>当前未同步院方排班，日期与时段由本地生成，仅用于登记接诊意向，不代表实际号源。紧急病例需立即联系接收方核实团队、床位和转运安排。</p><h3>记录与资料</h3><p>${sharedWorkspace?'当前记录由服务器统一保存，同一网址下可共同查看和协作；':'当前操作仅保存至本浏览器，尚未发送院方；'}协调登记不等于医院确认接收。当前收录 ${doctors.length} 位有照片医生，公开专业资料于 2026 年 9 月 14 日核实，实际接诊安排以院方确认为准。</p></div><div class="modal-footer"><p>转诊前请复核病例与接诊安排</p><button class="primary" data-action="close">我知道了</button></div>`,'method');}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.nav){navigate(b.dataset.nav);return;}
  if(b.dataset.action==='open-down-alerts'){navigate('downward');downwardWorkspace.openAlerts?.();return;}
  if(b.dataset.preset){insurance={type:'待核实',settlement:'待医保办核实',materialStatus:'待核实',note:''};importedPatient=null;inputSource=null;attachmentController.clear();activePreset=b.dataset.preset;patient={...presets.find(p=>p.id===activePreset)};caseText=patient.text;filter='all';invalidateCase();renderWorkbench();return;}
  if(b.dataset.filter){filter=b.dataset.filter;limit=6;renderResults();return;}
  if(b.id==='match-button'){void runMatch();return;}
  if(b.dataset.detail){openDoctor(b.dataset.detail);return;}
  if(b.dataset.workSlot){if(!hasCurrentMatch()||!selectedDoctor)return;selectedDate=b.dataset.workDate;selectedSlot=buildSchedule(selectedDoctor.id).find(d=>d.date===selectedDate)?.slots.find(s=>s.id===b.dataset.workSlot);const y=$('.modal').scrollTop;renderDoctor();$('.modal').scrollTop=y;return;}
  if(b.dataset.date){if(!hasCurrentMatch())return;selectedDate=b.dataset.date;selectedSlot=null;const y=$('.modal').scrollTop;renderDoctor();$('.modal').scrollTop=y;return;}
  if(b.dataset.slot){if(!hasCurrentMatch()||!selectedDoctor)return;selectedSlot=buildSchedule(selectedDoctor.id).find(s=>s.date===selectedDate)?.slots.find(s=>s.id===b.dataset.slot);const y=$('.modal').scrollTop;renderDoctor();$('.modal').scrollTop=y;return;}
  if(b.dataset.record){openRecord(b.dataset.record);return;}
  switch(b.dataset.action){case 'close':closeModal();break;case 'method':showMethod();break;case 'more':limit+=6;renderResults();break;case 'review':reviewTransfer();break;case 'back-detail':renderDoctor();break;case 'submit':submitTransfer();break;case 'accept':acceptReferral();break;case 'go-receive':closeModal();page='receive';shell();window.scrollTo({top:0});break;case 'refresh-config':void loadConfig();break;case 'retry-match':void runMatch();break;case 'retry-chat':void sendChat(true);break;case 'clear-chat':cancelChat();renderChat();break;}
});
document.addEventListener('input',e=>{
  if(e.target.id==='case-input'){caseText=e.target.value;activePreset=null;$('#case-length').textContent=`${caseText.length} / ${config.maxCaseLength}`;document.querySelectorAll('[data-preset]').forEach(x=>x.classList.remove('active'));invalidateCase();}
  if(e.target.id==='draft-insurance-note')insurance.note=e.target.value;
  if(e.target.id==='chat-input'){chatDraft=e.target.value;const b=$('#chat-send');if(b)b.disabled=chatPending||!chatDraft.trim()||!caseText.trim()||mode!=='kimi'||!config.configured;}
  if(e.target.id==='source-hospital')sourceHospital=e.target.value;if(e.target.id==='source-doctor')sourceDoctor=e.target.value;
});
document.addEventListener('submit',e=>{if(e.target.id==='chat-form'){e.preventDefault();void sendChat();}});
document.addEventListener('change',e=>{if(e.target.id==='doctor-sort'){sortOrder=e.target.value;limit=6;renderResults();}if(e.target.id==='doctor-available'){onlyAvailable=e.target.checked;renderResults();}for(const key of ['type','settlement','materialStatus'])if(e.target.id===`draft-insurance-${key}`)insurance[key]=e.target.value;if(e.target.id==='reviewed')$('#submit-referral').disabled=!e.target.checked||!hasCurrentMatch();if(e.target.id==='receive-checked')$('#accept-referral').disabled=!e.target.checked;if(e.target.id==='chat-doctor'){chatDoctorId=e.target.value;cancelChat();renderChat();}});
window.addEventListener('storage',e=>{
  if(sharedWorkspace||e.key!==storageKey||!e.newValue)return;
  try{
    const previous=currentRecord;
    records=mergeRecords(records,parseRecords(e.newValue),parseRecords(localStorage.getItem(storageKey)));
    if(currentRecord)currentRecord=records.find(r=>r.id===currentRecord.id)||currentRecord;
    syncRecordViews();
    if(modalType==='record'&&previous&&currentRecord&&(previous.status!==currentRecord.status||previous.acceptedAt!==currentRecord.acceptedAt)){
      openRecord(currentRecord.id);toast('这份申请的协调安排已在其他页面更新。');
    }
  }catch{toast('暂时无法同步其他页面的转诊记录。');}
});
document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement&&e.target.dataset.photoId){const id=e.target.dataset.photoId;doctors=doctors.filter(d=>d.id!==id);ranked=ranked.filter(d=>d.id!==id);e.target.closest('[data-doctor-card]')?.remove();if(selectedDoctor?.id===id){closeModal();toast('该医生照片无法显示，已从医生列表移除');}if(chatDoctorId===id){chatDoctorId='';cancelChat();renderChat();}}},true);
document.addEventListener('keydown',e=>{if(!modalType)return;if(e.key==='Escape'){closeModal();return;}if(e.key==='Tab'){const controls=[...$('.modal').querySelectorAll('button:not(:disabled),a,input,select,textarea,summary,[tabindex="0"]')].filter(x=>x.getClientRects().length);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===$('.modal'))){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
try{
  doctors=window.__DOCTOR_DATA__||await fetch('data/doctors.json').then(r=>{if(!r.ok)throw Error('医生资料加载失败。');return r.json();});
  doctors=doctors.filter(d=>d.photo&&d.name);
  if(!offlineBuild){
    sharedWorkspace=createSharedWorkspace({request:api,onStatus:status=>{sharedStatus=status;renderSharedStatus();}});
    await sharedWorkspace.refresh();
    await migrateLegacyWorkspace({workspace:sharedWorkspace,storage:localStorage,parseRecords,recordKey:storageKey});
    records=sharedWorkspace.getSnapshot().records;
  }
  initializeWorkspaces();shell();
  if(sharedWorkspace){
    sharedWorkspace.subscribe(snapshot=>{
      const previous=currentRecord;records=snapshot.records;
      if(currentRecord)currentRecord=records.find(r=>r.id===currentRecord.id)||currentRecord;
      syncRecordViews();updateGlobalSummaries();
      if(!recordSaving&&modalType==='record'&&previous&&currentRecord&&previous.status!==currentRecord.status){openRecord(currentRecord.id);toast('这份申请的协调安排已由协作方更新。');}
    });
    sharedWorkspace.startPolling();
    window.addEventListener('focus',()=>{void sharedWorkspace.refresh().catch(()=>{});});
    void loadConfig();
  }
}catch(error){
  $('#app').innerHTML=`<div class="boot"><p>暂时无法加载共享工作台，请检查网络后重试。</p><p>${esc(error.message)}</p><button class="primary" id="reload-workspace">重新加载</button></div>`;
  $('#reload-workspace')?.addEventListener('click',()=>window.location.reload());
  console.error(error);
}
