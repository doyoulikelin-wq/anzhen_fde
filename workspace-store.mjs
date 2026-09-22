import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from './llm.mjs';
import {createDownwardSeed} from './downward.mjs';
import {attachmentId,ATTACHMENT_FILE_LIMIT} from './attachment-store.mjs';

export const WORKSPACE_BODY_LIMIT=2*1024*1024;
const copy=value=>structuredClone(value);
const invalid=()=>new AppError(400,'INVALID_WORKSPACE','共享记录内容无效或超出容量，请刷新后重试。');
const unavailable=()=>new AppError(503,'WORKSPACE_UNAVAILABLE','共享记录暂时无法保存或读取，请稍后重试；原有记录保留。');
const check=(value)=>{if(!value)throw invalid();};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=2000,empty=false)=>typeof value==='string'&&value.length<=max&&(empty||value.trim().length>0);
const id=value=>text(value,160)&&/^[a-zA-Z0-9][a-zA-Z0-9._:~-]*$/.test(value);
const day=value=>text(value,10)&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const moment=value=>text(value,40)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)&&day(value.slice(0,10))&&Number.isFinite(Date.parse(value));
const unique=items=>items.every(object)&&new Set(items.map(x=>x.id)).size===items.length;
const strings=(value,max=2000,count=20)=>Array.isArray(value)&&value.length<=count&&value.every(x=>text(x,max));
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:object(value)?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const latest=(a,b,fields)=>{const time=x=>Math.max(0,...fields.map(k=>Date.parse(x[k])||0));return time(a)!==time(b)?time(a)>time(b)?a:b:canonical(a)>=canonical(b)?a:b;};
const byId=(items)=>items.sort((a,b)=>a.id.localeCompare(b.id));

export function createWorkspaceValidator(doctors,seed=createDownwardSeed()){
  const roster=new Map(doctors.filter(d=>d.photo).map(d=>[d.id,d]));
  const seedPatients=new Map(seed.patients.map(p=>[p.id,p]));
  function record(r){
    check(object(r)&&id(r.id)&&object(r.doctor)&&roster.has(r.doctor.id));
    const d=roster.get(r.doctor.id);check(r.doctor.name===d.name&&r.doctor.department===d.department);
    check(object(r.snapshot)&&text(r.snapshot.text,10000)&&object(r.snapshot.patient)&&text(r.snapshot.patient.name,100)&&text(r.snapshot.sourceHospital,200)&&text(r.snapshot.sourceDoctor,100));
    const p=r.snapshot.patient;
    check((p.age==null||Number.isFinite(p.age)&&p.age>=0&&p.age<=150)&&(p.sex==null||['男','女','未知',''].includes(p.sex)));
    check(day(r.date)&&text(r.slotId,160)&&text(r.session,100)&&text(r.time,100)&&moment(r.createdAt)&&['review','returned','pending','accepted'].includes(r.status));
    check(Array.isArray(r.events)&&r.events.length>0&&r.events.length<=200&&r.events.every(e=>object(e)&&text(e.label,3000)&&moment(e.at)));
    for(const key of ['category','provider','model'])if(r.snapshot[key]!==undefined)check(text(r.snapshot[key],200,true));
    if(r.snapshot.score!==undefined)check(Number.isFinite(r.snapshot.score)&&r.snapshot.score>=0&&r.snapshot.score<=100);
    if(r.snapshot.urgent!==undefined)check(typeof r.snapshot.urgent==='boolean');
    if(r.snapshot.reasons!==undefined)check(strings(r.snapshot.reasons));
    if(r.status==='accepted')check(moment(r.acceptedAt)&&text(r.acceptedDepartment,100)&&text(r.acceptedLocation,200));
    if(r.approval!==undefined){
      const a=r.approval;check(object(a)&&['pending','approved','returned'].includes(a.status)&&text(a.reviewer,100,true)&&text(a.note,2000,true));
      check((r.status==='review'&&a.status==='pending')||(r.status==='returned'&&a.status==='returned')||(['pending','accepted'].includes(r.status)&&a.status==='approved'));
      if(a.status!=='pending')check(text(a.reviewer,100)&&text(a.note,2000)&&moment(a.at));
      if(a.at!==undefined)check(moment(a.at));
    }else check(['pending','accepted'].includes(r.status));
    // Accept historical optional metadata without requiring it in current referrals.
    if(r.insurance!==undefined){check(object(r.insurance));for(const key of ['type','settlement','materialStatus'])check(text(r.insurance[key],100,true));check(text(r.insurance.note,2000,true));}
    if(r.attachments!==undefined){check(Array.isArray(r.attachments)&&r.attachments.length<=10&&unique(r.attachments));for(const a of r.attachments)check(attachmentId(a.id)&&text(a.name,180)&&!/[\x00-\x1f\x7f/\\]/.test(a.name)&&['image/png','image/jpeg','image/webp','application/pdf','application/dicom'].includes(a.type)&&Number.isSafeInteger(a.size)&&a.size>0&&a.size<=ATTACHMENT_FILE_LIMIT&&moment(a.uploadedAt)&&a.url===`/api/attachments/${a.id}`);}
    if(r.notifications!==undefined){check(Array.isArray(r.notifications)&&r.notifications.length<=100&&unique(r.notifications));for(const n of r.notifications){check(id(n.id)&&['in_app','sms','wechat'].includes(n.channel)&&text(n.title,300)&&text(n.recipient,400)&&moment(n.createdAt));check(n.channel==='in_app'?['unread','read'].includes(n.status):n.status==='not_configured');if(n.status==='read')check(moment(n.readAt));if(n.readAt!==undefined)check(moment(n.readAt));}}
    return r;
  }
  function records(value){check(Array.isArray(value)&&value.length<=500&&unique(value));value.forEach(record);return value;}
  function downward(value){
    check(object(value)&&value.version===1&&Array.isArray(value.patients)&&value.patients.length>=seedPatients.size&&value.patients.length<=500&&unique(value.patients)&&Array.isArray(value.plans)&&value.plans.length<=500&&unique(value.plans)&&Array.isArray(value.alerts)&&value.alerts.length<=500&&unique(value.alerts));
    const patients=new Map(value.patients.map(p=>[p.id,p]));check([...seedPatients.keys()].every(id=>patients.has(id)));
    for(const p of value.patients){
      check(id(p.id)&&(seedPatients.has(p.id)||/^patient-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(p.id))&&text(p.name,100)&&['男','女','未知'].includes(p.sex)&&Number.isFinite(p.age)&&p.age>=0&&p.age<=150);
      for(const key of ['diagnosis','stage','service','upperDoctor','caseSummary','goal'])check(text(p[key],4000));
      if(p.handoff!==undefined)check(text(p.handoff,4000,true));for(const key of ['createdAt','updatedAt'])if(p[key]!==undefined)check(moment(p[key]));
      check(Array.isArray(p.measurements)&&p.measurements.length<=1000&&unique(p.measurements));
      for(const m of p.measurements){check(object(m)&&id(m.id)&&moment(m.date)&&text(m.symptoms,1000,true)&&text(m.source,100));for(const [k,min,max]of [['sbp',40,300],['dbp',20,200],['heartRate',20,250],['spo2',40,100],['weight',10,300]])check(Number.isFinite(m[k])&&m[k]>=min&&m[k]<=max);check(m.dbp<m.sbp);}
    }
    for(const p of value.plans){
      check(object(p)&&id(p.id)&&patients.has(p.patientId)&&['down-lincheng','down-zhouzhiyuan','down-guanning'].includes(p.doctorId)&&['住院延续治疗','心脏康复','术后护理','慢病随访'].includes(p.service)&&day(p.date)&&['pending','arranged','monitoring'].includes(p.status)&&moment(p.createdAt)&&moment(p.updatedAt));
      for(const key of ['doctorName','hospital','department'])check(text(p[key],200));
      check(text(p.goal,2000)&&text(p.handoff,2000,true));
      if(p.status!=='pending')check(text(p.acceptedDepartment,100)&&text(p.location,200)&&text(p.arrangement,2000));
    }
    for(const a of value.alerts){
      check(object(a)&&id(a.id)&&patients.has(a.patientId)&&moment(a.at)&&text(a.note,1000)&&a.severity==='urgent'&&['processing','failed','ready','handled'].includes(a.status));
      check(value.patients.find(p=>p.id===a.patientId).measurements.some(m=>m.id===a.measurementId));
      if(a.error!==undefined)check(text(a.error,2000,true));
      if(a.ai!==undefined)check(object(a.ai)&&a.ai.source==='ai'&&text(a.ai.summary,4000)&&text(a.ai.handoff,4000)&&strings(a.ai.changes,2000)&&strings(a.ai.missing,2000));
      if(a.status==='ready')check(a.ai);
      if(a.status==='handled')check(moment(a.handledAt)&&text(a.handledNote,2000)&&text(a.handledBy,100));
      if(a.updatedAt!==undefined)check(moment(a.updatedAt));
    }
    return value;
  }
  function snapshot(value){check(object(value)&&Number.isSafeInteger(value.revision)&&value.revision>=0&&Buffer.byteLength(JSON.stringify(value))<=WORKSPACE_BODY_LIMIT);records(value.records);downward(value.downward);return value;}
  return {records,downward,snapshot};
}

function mergeEntries(left,right,choose){const result=new Map(left.map(x=>[x.id,x]));for(const entry of right){const previous=result.get(entry.id);result.set(entry.id,previous?choose(previous,entry):entry);}return byId([...result.values()]);}
function mergeRecords(left,right,isImport){return mergeEntries(left,right,(a,b)=>{
  const winner=(a.approval||b.approval)?(isImport?a:b):a.status!==b.status?(a.status==='accepted'?a:b):latest(a,b,['createdAt','acceptedAt']);
  const events=isImport&&a.approval?a.events:[...new Map([...a.events,...b.events].map(e=>[canonical(e),e])).values()].sort((a,b)=>a.at.localeCompare(b.at)||a.label.localeCompare(b.label));
  const notifications=mergeEntries(a.notifications||[],isImport&&a.approval?[]:b.notifications||[],(old,next)=>old.status==='read'?old:next);
  return {...winner,events,...(a.notifications||b.notifications?{notifications}:{})};
}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));}
function mergeDownward(left,right,isImport){
  const measurementIds=new Map();
  const patients=mergeEntries(left.patients,right.patients,(p,other)=>{
    const entries=new Map(p.measurements.map(m=>[m.id,m]));
    for(let m of other.measurements){const originalId=m.id,old=entries.get(m.id);if(old&&old.date!==m.date){m={...m,id:`${m.id}--${m.date.replace(/\D/g,'')}`};}measurementIds.set(`${p.id}:${originalId}`,m.id);const existing=entries.get(m.id);entries.set(m.id,existing?latest(existing,m,['date']):m);}
    return {...(isImport?p:other),measurements:[...entries.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))};
  }).sort((a,b)=>{const index=id=>{const i=left.patients.findIndex(p=>p.id===id);return i<0?Number.MAX_SAFE_INTEGER:i;};return index(a.id)-index(b.id)||a.id.localeCompare(b.id);});
  const planRank={pending:0,arranged:1,monitoring:2};
  // A current-revision plan edit intentionally requests a fresh lower-hospital
  // arrangement. Only legacy imports protect against stale pending copies.
  const plans=mergeEntries(left.plans,right.plans,(a,b)=>!isImport?b:planRank[a.status]!==planRank[b.status]?(planRank[a.status]>planRank[b.status]?a:b):latest(a,b,['updatedAt','createdAt']));
  const alertRank={processing:0,failed:1,ready:2,handled:3};
  const incomingAlerts=right.alerts.map(a=>({...a,measurementId:measurementIds.get(`${a.patientId}:${a.measurementId}`)||a.measurementId}));
  const alerts=mergeEntries(left.alerts,incomingAlerts,(a,b)=>a.status==='handled'||b.status==='handled'?(a.status===b.status?latest(a,b,['handledAt','updatedAt','at']):a.status==='handled'?a:b):isImport?(alertRank[a.status]!==alertRank[b.status]?alertRank[a.status]>alertRank[b.status]?a:b:latest(a,b,['updatedAt','at'])):b);
  return {version:1,patients,plans,alerts};
}
function contains(previous,next){const ids=new Set(next.map(x=>x.id));check(previous.every(x=>ids.has(x.id)));}

// One writer queue per running server. A write is acknowledged only after the
// temporary file has been flushed and atomically renamed over the primary file.
export async function createWorkspaceStore({dataDir,doctors,fsImpl=fs,seed=createDownwardSeed(),verifyAttachment}={}){
  const validate=createWorkspaceValidator(doctors,seed);
  const primary=path.join(dataDir,'workspace.json'),backup=path.join(dataDir,'workspace.backup.json');
  let state,queue=Promise.resolve();
  await fsImpl.mkdir(dataDir,{recursive:true,mode:0o700});
  async function read(file){try{return {value:validate.snapshot(JSON.parse(await fsImpl.readFile(file,'utf8')))}}catch(error){return {error};}}
  async function atomic(file,value){const temp=`${file}.${randomUUID()}.tmp`;let handle;try{handle=await fsImpl.open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(value));await handle.sync();await handle.close();handle=null;await fsImpl.rename(temp,file);}finally{await handle?.close().catch(()=>{});await fsImpl.unlink(temp).catch(()=>{});}}
  const loaded=await read(primary);
  if(loaded.value)state=loaded.value;
  else{
    const saved=await read(backup);
    if(saved.value){
      // Retain a corrupt file for recovery/inspection; never replace it by seed.
      if(loaded.error.code!=='ENOENT')await fsImpl.rename(primary,`${primary}.corrupt-${Date.now()}`);
      await atomic(primary,saved.value);state=saved.value;
      console.warn('共享记录已从最近备份恢复；请核查数据目录中的恢复文件。');
    }else if(loaded.error.code==='ENOENT'&&saved.error.code==='ENOENT'){
      state=validate.snapshot({revision:0,records:[],downward:seed});await atomic(primary,state);await atomic(backup,state);
    }else throw new Error('共享记录文件及备份无法读取，已停止启动以保留原始数据。');
  }
  const serial=operation=>{const result=queue.then(operation);queue=result.catch(()=>{});return result;};
  async function change(body,isImport){
    check(object(body)&&Object.keys(body).every(k=>['revision','records','downward'].includes(k))&&(Object.hasOwn(body,'records')||Object.hasOwn(body,'downward')));
    if(!isImport){check(Number.isSafeInteger(body.revision)&&body.revision>=0);if(body.revision!==state.revision)throw new AppError(409,'WORKSPACE_CONFLICT','共享记录已由其他人更新，请刷新后重试。');}
    if(Object.hasOwn(body,'records'))validate.records(body.records);
    if(Object.hasOwn(body,'downward'))validate.downward(body.downward);
    if(isImport&&body.records)body={...body,records:body.records.map(r=>{
      if(state.records.some(x=>x.id===r.id)||r.approval)return r;
      const at=new Date().toISOString();
      return {...r,status:'review',approval:{status:'pending',reviewer:'',note:'历史浏览器记录已迁入，需重新完成院内审核。'},events:[...r.events,{label:r.status==='accepted'?'历史接收记录已迁入，保留原信息并转入院内补审核':'历史申请已迁入，等待院内审核',at}],notifications:[...(r.notifications||[]),{id:`NOTICE-${randomUUID()}`,channel:'in_app',status:'unread',createdAt:at,title:'历史转诊记录待院内审核',recipient:'医务处 / 院内负责人'}]};
    })};
    if(body.records)for(const r of body.records){
      const previous=state.records.find(x=>x.id===r.id);
      if(!previous)check(r.status==='review'&&r.approval?.status==='pending');
      else if(previous.approval&&!isImport){
        check(r.approval);
        const transitions={review:['review','returned','pending'],returned:['returned','review'],pending:['pending','accepted'],accepted:['accepted']};
        check(transitions[previous.status].includes(r.status));
        if(previous.approval.status==='approved')check(canonical(previous.approval)===canonical(r.approval));
      }else if(!previous.approval&&!isImport&&r.approval)check(r.status==='review'&&r.approval.status==='pending');
      if(verifyAttachment)for(const attachment of r.attachments||[])await verifyAttachment(attachment);
    }
    if(!isImport){
      if(body.records)contains(state.records,body.records);
      if(body.downward){contains(state.downward.patients,body.downward.patients);contains(state.downward.plans,body.downward.plans);contains(state.downward.alerts,body.downward.alerts);for(const p of state.downward.patients)contains(p.measurements,body.downward.patients.find(x=>x.id===p.id).measurements);}
    }
    const next={revision:state.revision,records:body.records?mergeRecords(state.records,body.records,isImport):state.records,downward:body.downward?mergeDownward(state.downward,body.downward,isImport):state.downward};
    if(canonical(next)===canonical(state))return copy(state);
    next.revision++;validate.snapshot(next);
    try{await atomic(backup,state);await atomic(primary,next);}catch{throw unavailable();}
    state=next;return copy(state);
  }
  return {read:()=>serial(()=>copy(state)),commit:body=>serial(()=>change(body,false)),import:body=>serial(()=>change(body,true))};
}
