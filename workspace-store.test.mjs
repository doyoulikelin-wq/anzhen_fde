import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWorkspaceStore,WORKSPACE_BODY_LIMIT} from './workspace-store.mjs';
import {createAppServer} from './server.mjs';
import {createDownwardSeed} from './downward.mjs';

const doctors=JSON.parse(await fs.readFile(new URL('./data/doctors.json',import.meta.url),'utf8'));
const clone=value=>structuredClone(value);
async function setup(t,options={}){const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'anzhen-workspace-test-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));if(options.legacyRecords)await fs.writeFile(path.join(dataDir,'workspace.json'),JSON.stringify({revision:0,records:options.legacyRecords,downward:createDownwardSeed()}),{mode:0o600});const store=await createWorkspaceStore({dataDir,doctors,...options});return {store,dataDir};}
function record(id='AZ-TEST-1',status='review'){
  const d=doctors.find(d=>d.photo);
  return {id,doctor:{id:d.id,name:d.name,department:d.department,title:d.title},snapshot:{text:'虚构患者心脏康复转诊记录，仅用于自动化验证。',patient:{name:'验证患者',sex:'男',age:60},sourceHospital:'验证来源医院',sourceDoctor:'验证医生',score:85,urgent:false,reasons:['专科方向相关']},date:'2026-09-20',slotId:'2026-09-20-am',session:'上午',time:'09:00–11:30',status,createdAt:'2026-09-20T01:00:00.000Z',events:[{label:'申请已保存',at:'2026-09-20T01:00:00.000Z'}],...(status==='review'?{approval:{status:'pending',reviewer:'',note:''}}:{}),...(status==='accepted'?{acceptedAt:'2026-09-20T02:00:00.000Z',acceptedDepartment:'心血管内科',acceptedLocation:'门诊协调台'}:{})};
}
const failure=code=>error=>error.code===code;
function addCare(state){
  const down=clone(state.downward),p=down.patients[0];
  down.plans.push({id:'DOWN-TEST',patientId:p.id,doctorId:'down-zhouzhiyuan',doctorName:'周知远',hospital:'青禾康复医院',department:'康复医学科',service:'心脏康复',date:'2026-09-21',goal:'落实康复衔接',handoff:'核对交接材料',status:'arranged',createdAt:'2026-09-20T01:00:00Z',updatedAt:'2026-09-20T02:00:00Z',acceptedDepartment:'康复医学科',location:'接待台',arrangement:'每天记录监测'});
  down.alerts.push({id:'ALERT-TEST',patientId:p.id,measurementId:p.measurements.at(-1).id,at:'2026-09-20T01:00:00Z',note:'虚构事件记录',severity:'urgent',status:'handled',handledAt:'2026-09-20T02:00:00Z',handledNote:'已核查记录',handledBy:'验证团队'});
  return down;
}

test('first bootstrap is durably shared and survives a new server store',async t=>{
  const {store,dataDir}=await setup(t);
  const initial=await store.read();assert.equal(initial.revision,0);assert.equal(initial.downward.patients.length,3);assert.equal(initial.downward.patients[0].measurements.length,7);
  const saved=await store.commit({revision:0,records:[record()]});assert.equal(saved.revision,1);
  const restarted=await createWorkspaceStore({dataDir,doctors});assert.deepEqual(await restarted.read(),saved);
  const leaked=await store.read();leaked.records.length=0;assert.equal((await store.read()).records.length,1);
  assert.equal((await fs.stat(path.join(dataDir,'workspace.json'))).mode&0o777,0o600);
  assert.equal((await fs.stat(path.join(dataDir,'workspace.backup.json'))).mode&0o777,0o600);
});

test('concurrent same-revision writes serialize; losing caller receives409 without lost entries',async t=>{
  const {store}=await setup(t);
  const results=await Promise.allSettled([store.commit({revision:0,records:[record('AZ-A')]}),store.commit({revision:0,records:[record('AZ-B')]})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);const failed=results.find(x=>x.status==='rejected').reason;assert.equal(failed.status,409);assert.equal(failed.code,'WORKSPACE_CONFLICT');
  const latest=await store.read(),winner=latest.records[0].id;const missing=winner==='AZ-A'?'AZ-B':'AZ-A';
  const next=await store.commit({revision:latest.revision,records:[...latest.records,record(missing)]});assert.equal(next.records.length,2);
});

test('commits update only a supplied slice and reject deletion attempts',async t=>{
  const {store}=await setup(t);const initial=await store.read();
  const a=await store.commit({revision:0,records:[record()]});assert.deepEqual(a.downward,initial.downward);
  const b=await store.commit({revision:a.revision,downward:addCare(a)});assert.deepEqual(b.records,a.records);
  await assert.rejects(store.commit({revision:b.revision,records:[]}),failure('INVALID_WORKSPACE'));
  const down=clone(b.downward);down.patients[0].measurements.pop();await assert.rejects(store.commit({revision:b.revision,downward:down}),failure('INVALID_WORKSPACE'));
  assert.deepEqual(await store.read(),b);
});

test('legacy imports merge every slice idempotently and never downgrade accepted/handled/arranged',async t=>{
  const {store}=await setup(t,{legacyRecords:[record('AZ-TEST','accepted')]});const before=await store.read();const down=addCare(before);
  const imported=await store.import({records:[record('AZ-TEST','accepted')],downward:down});
  const stale=clone(down);stale.plans[0].status='pending';stale.plans[0].updatedAt='2026-09-21T04:00:00Z';stale.alerts[0].status='processing';
  const after=await store.import({records:[record('AZ-TEST','pending')],downward:stale});
  assert.equal(after.records[0].status,'accepted');assert.equal(after.downward.plans[0].status,'arranged');assert.equal(after.downward.alerts[0].status,'handled');
  assert.deepEqual(after,imported);assert.deepEqual(await store.import({records:[record('AZ-TEST','pending')],downward:stale}),after);
});

test('imports preserve dated baseline histories from different browser initialization days',async t=>{
  const {store}=await setup(t);const before=await store.read(),old=clone(before.downward);
  old.patients[0].measurements[0].date='2020-01-01T09:00';
  old.alerts.push({id:'ALERT-OLD-BASELINE',patientId:old.patients[0].id,measurementId:old.patients[0].measurements[0].id,at:'2020-01-01T09:01:00+08:00',severity:'urgent',status:'processing',note:'旧浏览器的基线事件'});
  const after=await store.import({downward:old});assert.equal(after.downward.patients[0].measurements.length,8);assert.ok(after.downward.patients[0].measurements.some(m=>m.date==='2020-01-01T09:00'));
  assert.equal(after.downward.patients[0].measurements.find(m=>m.id===after.downward.alerts[0].measurementId).date,'2020-01-01T09:00');
  assert.deepEqual(await store.import({downward:old}),after);
});

test('current-revision edits replace an arranged plan and reopen lower-hospital coordination',async t=>{
  const {store}=await setup(t,{legacyRecords:[record('AZ-ACCEPTED','accepted')]}),initial=await store.read();
  const arranged=await store.import({records:[record('AZ-ACCEPTED','accepted')],downward:addCare(initial)});
  const down=clone(arranged.downward),previous=down.plans[0];
  down.plans[0]={id:previous.id,patientId:previous.patientId,doctorId:'down-lincheng',doctorName:'林澄',hospital:'青禾县人民医院',department:'心血管内科',service:'住院延续治疗',date:'2026-09-23',goal:'修改为住院衔接，请重新确认',handoff:'补充出院材料',status:'pending',createdAt:previous.createdAt,updatedAt:'2026-09-22T02:00:00Z'};
  down.alerts[0].status='processing';
  const edited=await store.commit({revision:arranged.revision,downward:down,records:[record('AZ-ACCEPTED','pending')]});
  assert.deepEqual(edited.downward.plans[0],down.plans[0]);assert.equal(edited.downward.plans[0].location,undefined);
  assert.equal(edited.records[0].status,'accepted');assert.equal(edited.downward.alerts[0].status,'handled');
  await assert.rejects(store.commit({revision:arranged.revision,downward:arranged.downward}),failure('WORKSPACE_CONFLICT'));
});

test('same-revision retry can reorganize a ready summary but cannot unhandle an event',async t=>{
  const {store}=await setup(t),initial=await store.read();let down=addCare(initial);down.alerts[0].status='ready';down.alerts[0].ai={summary:'已整理',changes:[],missing:[],handoff:'人工复核',source:'ai'};
  const saved=await store.import({downward:down});down=clone(saved.downward);down.alerts[0].status='processing';
  const retried=await store.commit({revision:saved.revision,downward:down});assert.equal(retried.downward.alerts[0].status,'processing');
  down=clone(retried.downward);down.alerts[0].status='handled';const handled=await store.commit({revision:retried.revision,downward:down});down=clone(handled.downward);down.alerts[0].status='ready';
  assert.equal((await store.commit({revision:handled.revision,downward:down})).downward.alerts[0].status,'handled');
});

test('invalid records, patient references, duplicate IDs and unbounded values leave state unchanged',async t=>{
  const {store}=await setup(t),initial=await store.read();
  const attempts=[{records:[null]},{records:[record(),record()]},{records:[{...record(),doctor:{id:'unknown',name:'虚构',department:'未知'}}]},{records:[{...record(),events:[]}]},{records:[{...record(),snapshot:{...record().snapshot,text:'x'.repeat(10001)}}]}];
  for(const mutate of [d=>d.patients[0].sex='无效',d=>d.patients[0].measurements[0].spo2=999,d=>d.patients[0].measurements[0].date='2026-02-30T09:00',d=>d.alerts.push({id:'invalid'})]){const downward=clone(initial.downward);mutate(downward);attempts.push({downward});}
  for(const body of attempts)await assert.rejects(store.import(body),failure('INVALID_WORKSPACE'));
  assert.deepEqual(await store.read(),initial);
});

test('atomic write failure never reports success and preserves confirmed state on disk',async t=>{
  let fail=false;const fsImpl={...fs,open:async(file,...args)=>{if(fail&&file.includes('workspace.json.')&&file.endsWith('.tmp'))throw Object.assign(new Error('injected disk failure'),{code:'ENOSPC'});return fs.open(file,...args);}};
  const {store,dataDir}=await setup(t,{fsImpl});const initial=await store.read();fail=true;
  await assert.rejects(store.commit({revision:0,records:[record()]}),failure('WORKSPACE_UNAVAILABLE'));assert.deepEqual(await store.read(),initial);
  const reopened=await createWorkspaceStore({dataDir,doctors});assert.deepEqual(await reopened.read(),initial);
  fail=false;assert.equal((await store.commit({revision:0,records:[record()]})).revision,1);
});

test('corruption recovers last valid backup and preserves damaged file, never silently reseeds',async t=>{
  const {store,dataDir}=await setup(t);const saved=await store.commit({revision:0,records:[record()]});await store.commit({revision:saved.revision,records:[...saved.records,record('AZ-SECOND')]});
  await fs.writeFile(path.join(dataDir,'workspace.json'),'{broken-json');
  const recovered=await createWorkspaceStore({dataDir,doctors});assert.deepEqual(await recovered.read(),saved);assert.ok((await fs.readdir(dataDir)).some(x=>x.startsWith('workspace.json.corrupt-')));
  await fs.writeFile(path.join(dataDir,'workspace.json'),'broken');await fs.writeFile(path.join(dataDir,'workspace.backup.json'),'also-broken');
  await assert.rejects(createWorkspaceStore({dataDir,doctors}),/已停止启动/);assert.equal(await fs.readFile(path.join(dataDir,'workspace.json'),'utf8'),'broken');
});

test('HTTP shared APIs persist and enforce revision/body limits without exposing private paths',async t=>{
  const {store,dataDir}=await setup(t);
  const config={apiKey:'test-private-key',baseURL:'https://api.moonshot.cn/v1',model:'kimi-k3',effort:'low',port:4173,timeoutMs:1000};
  const server=await createAppServer({config,workspaceStore:store,dataDir,fetchImpl:()=>{throw Error('No model calls in storage tests');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}`;const post=(endpoint,body)=>fetch(url+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await (await fetch(url+'/api/workspace')).json()).downward.patients.length,3);
  assert.equal((await post('/api/workspace/commit',{revision:0,records:[record()]})).status,200);
  const conflict=await post('/api/workspace/commit',{revision:0,records:[record()]});assert.equal(conflict.status,409);assert.equal((await conflict.json()).error.code,'WORKSPACE_CONFLICT');
  assert.equal((await post('/api/workspace/import',{records:[record('AZ-HTTP')]})).status,200);
  assert.equal((await (await fetch(url+'/api/workspace')).json()).records.length,2);
  const large=await post('/api/workspace/import',{records:[],unused:'x'.repeat(WORKSPACE_BODY_LIMIT)});assert.equal(large.status,413);
  for(const endpoint of ['/.env','/.env.deploy','/workspace-store.mjs','/var/workspace.json','/workspace.json','/data/workspace.json']){const response=await fetch(url+endpoint);assert.equal(response.status,404);assert.equal((await response.text()).includes('test-private-key'),false);}
  assert.equal((await fetch(url+'/api/workspace/commit')).status,405);
});

test('referral review requires approval before onward transfer and preserves the complete audit trail',async t=>{
  const {store}=await setup(t);let current=await store.commit({revision:0,records:[record()]});
  const notice={id:'NOTICE-REVIEW',channel:'in_app',status:'unread',createdAt:'2026-09-22T01:00:00Z',title:'转诊申请待审核',recipient:'来源医院医务处'};
  let row=clone(current.records[0]);row.insurance={type:'职工基本医疗保险',settlement:'异地备案待核实',materialStatus:'已上传',note:'由医保办核实报销范围'};row.notifications=[notice];
  current=await store.commit({revision:current.revision,records:[row]});
  let skipped={...row,status:'accepted',approval:{status:'approved',reviewer:'负责人',note:'同意转出',at:'2026-09-22T01:10:00Z'},acceptedAt:'2026-09-22T01:20:00Z',acceptedDepartment:'心内科',acceptedLocation:'门诊'};
  await assert.rejects(store.commit({revision:current.revision,records:[skipped]}),failure('INVALID_WORKSPACE'));
  row={...row,status:'returned',approval:{status:'returned',reviewer:'王主任',note:'请补齐检查报告',at:'2026-09-22T01:10:00Z'},events:[...row.events,{label:'院内退回补充材料',at:'2026-09-22T01:10:00Z'}]};
  current=await store.commit({revision:current.revision,records:[row]});assert.equal(current.records[0].status,'returned');
  await assert.rejects(store.commit({revision:current.revision,records:[{...row,status:'pending',approval:{status:'approved',reviewer:'王主任',note:'直接放行',at:'2026-09-22T01:12:00Z'}}]}),failure('INVALID_WORKSPACE'));
  row={...row,status:'review',approval:{status:'pending',reviewer:'',note:''},events:[...row.events,{label:'补充后重新提交审核',at:'2026-09-22T01:15:00Z'}]};
  current=await store.commit({revision:current.revision,records:[row]});
  row={...row,status:'pending',approval:{status:'approved',reviewer:'王主任',note:'资料完整，同意转出',at:'2026-09-22T01:18:00Z'},events:[...row.events,{label:'院内审核通过，转入接收中心',at:'2026-09-22T01:18:00Z'}]};
  current=await store.commit({revision:current.revision,records:[row]});assert.equal(current.records[0].status,'pending');
  row={...row,status:'accepted',acceptedAt:'2026-09-22T01:20:00Z',acceptedDepartment:'心内科',acceptedLocation:'门诊',notifications:[{...notice,status:'read',readAt:'2026-09-22T01:21:00Z'},{...notice,id:'NOTICE-SMS',channel:'sms',status:'not_configured'}]};
  current=await store.commit({revision:current.revision,records:[row]});assert.equal(current.records[0].status,'accepted');assert.equal(current.records[0].events.length,4);
  const changedApproval={...row,approval:{...row.approval,reviewer:'替换审核人'}};
  await assert.rejects(store.commit({revision:current.revision,records:[changedApproval]}),failure('INVALID_WORKSPACE'));
  const downgrade={...row,status:'pending'};await assert.rejects(store.commit({revision:current.revision,records:[downgrade]}),failure('INVALID_WORKSPACE'));
});

test('new commits cannot use legacy schemas or import endpoints to bypass review',async t=>{
  const {store}=await setup(t);const initial=await store.read();
  for(const status of ['pending','accepted'])await assert.rejects(store.commit({revision:initial.revision,records:[record(`AZ-${status}`,status)]}),failure('INVALID_WORKSPACE'));
  const imported=await store.import({records:[record('AZ-OLD-PENDING','pending'),record('AZ-OLD-ACCEPTED','accepted')]});
  for(const r of imported.records){assert.equal(r.status,'review');assert.equal(r.approval.status,'pending');assert.ok(r.events.some(e=>e.label.includes('迁入')));assert.equal(r.notifications[0].status,'unread');}
  assert.ok(imported.records.find(r=>r.id==='AZ-OLD-ACCEPTED').acceptedAt);
  assert.deepEqual(await store.import({records:[record('AZ-OLD-PENDING','pending'),record('AZ-OLD-ACCEPTED','accepted')]}),imported);
  const forged={...record('AZ-FORGED'),status:'pending',approval:{status:'approved',reviewer:'绕过审核',note:'绕过审核',at:'2026-09-22T01:00:00Z'}};
  await assert.rejects(store.import({records:[forged]}),failure('INVALID_WORKSPACE'));
  const current=imported.records[0],incoming={...current,status:'pending',approval:forged.approval,events:[...current.events,{label:'伪造通过',at:'2026-09-22T01:00:00Z'}]};
  assert.deepEqual(await store.import({records:[incoming]}),imported);
});

test('notifications cannot claim external delivery and read notices cannot become unread again',async t=>{
  const {store}=await setup(t);const notice={id:'NOTICE-1',channel:'in_app',status:'read',createdAt:'2026-09-22T01:00:00Z',readAt:'2026-09-22T01:05:00Z',title:'接诊安排已更新',recipient:'转出医生'};
  let current=await store.commit({revision:0,records:[{...record(),notifications:[notice]}]});
  const row={...current.records[0],notifications:[{...notice,status:'unread'}]};current=await store.commit({revision:current.revision,records:[row]});assert.equal(current.records[0].notifications[0].status,'read');
  for(const channel of ['sms','wechat'])await assert.rejects(store.commit({revision:current.revision,records:[{...row,notifications:[{...notice,channel,status:'read'}]}]}),failure('INVALID_WORKSPACE'));
});

test('new downward patients can be entered and edited without losing existing dated monitoring histories',async t=>{
  const {store,dataDir}=await setup(t);const initial=await store.read();let down=clone(initial.downward);
  const patient={...clone(down.patients[0]),id:'patient-a351b1c1-1765-4987-82bd-4b26a6dfda4d',name:'新患者',sex:'女',age:45,measurements:[],handoff:'补充出院记录',createdAt:'2026-09-22T01:00:00Z',updatedAt:'2026-09-22T01:00:00Z'};
  down.patients.push(patient);let saved=await store.commit({revision:0,downward:down});assert.equal(saved.downward.patients.length,4);assert.deepEqual(saved.downward.patients.find(p=>p.id===patient.id).measurements,[]);
  down=clone(saved.downward);down.patients[0].name='更新姓名';down.patients[0].age=63;down.patients[0].caseSummary='完善后的交接摘要';down.patients.find(p=>p.id===patient.id).measurements.push({...clone(down.patients[0].measurements[0]),id:'MONITOR-NEW',date:'2026-09-22T09:00'});
  saved=await store.commit({revision:saved.revision,downward:down});assert.equal(saved.downward.patients[0].name,'更新姓名');assert.equal(saved.downward.patients[0].measurements.length,7);
  const old=clone(initial.downward);old.patients[0].name='过期姓名';const merged=await store.import({downward:old});assert.equal(merged.downward.patients[0].name,'更新姓名');assert.equal(merged.downward.patients.length,4);assert.equal(merged.downward.patients.find(p=>p.id===patient.id).measurements.length,1);
  down=clone(merged.downward);down.patients.pop();await assert.rejects(store.commit({revision:merged.revision,downward:down}),failure('INVALID_WORKSPACE'));
  assert.deepEqual(await (await createWorkspaceStore({dataDir,doctors})).read(),merged);
});
