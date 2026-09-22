import test from 'node:test';
import assert from 'node:assert/strict';
import {createDownwardSeed,validateMeasurement,validateDownwardPatient,createDownwardWorkspace} from './downward.mjs';
const reading={date:'2026-09-20T14:30',sbp:'126',dbp:'78',heartRate:'74',spo2:'98',weight:'68.1',symptoms:' 暂无新发不适 '};
test('监测输入转为有限数值并保留录入日期',()=>{
  const value=validateMeasurement(reading);
  assert.equal(value.sbp,126);assert.equal(value.weight,68.1);assert.equal(value.date,reading.date);assert.equal(value.symptoms,'暂无新发不适');
});
test('空数值和非有限数值不能成为监测记录',()=>{
  for(const key of ['sbp','dbp','heartRate','spo2','weight'])for(const value of ['',null,'NaN','Infinity'])assert.throws(()=>validateMeasurement({...reading,[key]:value}));
});
test('明显无效的体征输入和颠倒血压被拦截',()=>{
  for(const change of [{sbp:301},{dbp:250},{heartRate:0},{spo2:101},{weight:-1},{sbp:80,dbp:100}])assert.throws(()=>validateMeasurement({...reading,...change}));
});
test('缺失或不可读日期被拦截',()=>{
  for(const date of ['','today','2026-13-01T09:00','2026-09-20'])assert.throws(()=>validateMeasurement({...reading,date}));
});
test('三位患者监测记录隔离，连续七日按日期保存',()=>{
  const state=createDownwardSeed();assert.equal(state.patients.length,3);assert.equal(new Set(state.patients.map(p=>p.id)).size,3);
  const measurementIds=state.patients.flatMap(p=>p.measurements.map(m=>m.id));assert.equal(new Set(measurementIds).size,21);
  for(const p of state.patients){assert.equal(p.measurements.length,7);for(let i=1;i<p.measurements.length;i++)assert.ok(p.measurements[i].date>p.measurements[i-1].date);for(const m of p.measurements)assert.doesNotThrow(()=>validateMeasurement(m));}
});

function workspaceHarness(t,{state=createDownwardSeed(),api=async()=>{throw Error('offline');}}={}){
  const priorDocument=globalThis.document,priorFormData=globalThis.FormData,priorStorage=globalThis.localStorage;
  t.after(()=>{globalThis.document=priorDocument;globalThis.FormData=priorFormData;if(priorStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=priorStorage;});
  let snapshot={revision:0,records:[],downward:structuredClone(state)},nextGate=null,nextFailure=null,currentForm=null;
  const listeners=new Set(),messages=[],forms=new Map();
  const stats={writes:0,closed:0,renders:0,modalHTML:'',navigation:[]};
  globalThis.localStorage={getItem(){throw Error('shared view must not read browser storage');},setItem(){throw Error('shared view must not write browser storage');}};
  globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name]??null;}*[Symbol.iterator](){yield* Object.entries(this.values);}};
  const elements=new Map();
  globalThis.document={querySelector(selector){if(forms.has(selector))return forms.get(selector);if(!elements.has(selector))elements.set(selector,{});return elements.get(selector);}};
  const container={isConnected:true,buttons:[],html:'',set innerHTML(value){this.html=value;stats.renders++;this.buttons=[...value.matchAll(/<button\b([^>]*)>/g)].map(([,attributes])=>{const dataset={};for(const [,key,val]of attributes.matchAll(/data-([a-z-]+)="([^"]*)"/g))dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=val;return {dataset};});},get innerHTML(){return this.html;},querySelectorAll(selector){const key=selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return this.buttons.filter(button=>key in button.dataset);},querySelector(){return {};}};
  const workspace={isShared:true,getSnapshot:()=>snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},async updateDownward(mutator){stats.writes++;const gate=nextGate,failure=nextFailure;nextGate=null;nextFailure=null;if(gate)await gate;if(failure)throw Error(failure);const next=structuredClone(snapshot);mutator(next.downward);next.revision++;snapshot=next;listeners.forEach(listener=>listener(snapshot));}};
  const controller=createDownwardWorkspace({workspace,escape:value=>String(value),icon:()=>'',toast:value=>messages.push(value),api,onUpdate(){},renderSchedule:()=>'',navigate(page){stats.navigation.push(page);if(page==='downward')controller.render(container);if(page==='down-receive')controller.renderReceiving(container);},openModal(html){stats.modalHTML=html;const id=html.match(/<form id="([^"]+)"/)?.[1];if(!id)return;const submit={disabled:false};const form={id,values:{},isConnected:true,submit,attributes:{},querySelectorAll:()=>[submit],setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];}};forms.set(`#${id}`,form);currentForm=form;},closeModal(){stats.closed++;if(currentForm)currentForm.isConnected=false;}});
  controller.render(container);
  return {controller,container,stats,messages,element:selector=>elements.get(selector),get state(){return snapshot.downward;},get form(){return currentForm;},click(key,value){const button=container.buttons.find(button=>button.dataset[key]===value);assert.ok(button,`missing control ${key}=${value}`);return button.onclick();},submit(values){currentForm.values=values;return currentForm.onsubmit({target:currentForm,preventDefault(){}});},holdNextWrite(){let resolve;nextGate=new Promise(done=>resolve=done);return resolve;},failNextWrite(message='连接中断'){nextFailure=message;},remoteUpdate(mutator){const next=structuredClone(snapshot);mutator(next.downward);next.revision++;snapshot=next;listeners.forEach(listener=>listener(snapshot));}};
}
test('共享照护读取服务器种子并订阅跨客户端更新，不访问浏览器存储',t=>{
  const seed=createDownwardSeed();seed.patients[0].name='服务器档案';
  const h=workspaceHarness(t,{state:seed});
  assert.match(h.container.innerHTML,/服务器档案/);assert.match(h.container.innerHTML,/共享服务器上的照护记录/);
  h.click('downAction','plan');const form=h.form;form.values.goal='正在编辑的交接目标';
  h.remoteUpdate(state=>state.alerts.push({id:'remote-alert',patientId:'patient-wang',at:new Date().toISOString(),note:'另一客户端提交的原始情况',severity:'urgent',status:'failed'}));
  assert.equal(h.controller.summary().urgent,1);assert.match(h.container.innerHTML,/另一客户端提交的原始情况/);
  assert.equal(h.form,form);assert.equal(form.values.goal,'正在编辑的交接目标');assert.equal(form.isConnected,true);
  h.controller.onLeave();const count=h.stats.renders;h.remoteUpdate(state=>state.alerts[0].status='handled');assert.equal(h.stats.renders,count);assert.equal(h.controller.summary().urgent,0);
});

const arrangedPlan={id:'plan-1',patientId:'patient-wang',doctorId:'down-zhouzhiyuan',doctorName:'周知远',hospital:'青禾康复医院',department:'康复医学科',service:'心脏康复',date:'2026-10-01',goal:'连续康复',handoff:'核对出院小结',status:'pending',createdAt:'2026-09-20T00:00:00Z'};
const pendingAlert={id:'alert-1',patientId:'patient-wang',at:'2026-09-20T08:00:00Z',severity:'urgent',note:'患者新发不适，已联系接诊团队。',status:'ready',ai:{summary:'待医生复核。',changes:[],missing:[],handoff:'继续沟通。',source:'ai'}};
const formCases=[
  {label:'下转申请',action:['downAction','plan'],values:{doctorId:'down-zhouzhiyuan',service:'心脏康复',date:'2026-10-01',goal:'继续康复',handoff:'复核出院小结'},verify:s=>assert.equal(s.plans.length,1)},
  {label:'接收安排',prepare:s=>s.plans.push(structuredClone(arrangedPlan)),role:'lower',action:['downAction','receive'],values:{department:'康复医学科',location:'2病区',arrangement:'每日观察'},verify:s=>assert.equal(s.plans[0].status,'arranged')},
  {label:'连续监测',action:['downAction','measurement'],values:reading,verify:s=>assert.equal(s.patients[0].measurements.length,8)},
  {label:'处理反馈',prepare:s=>s.alerts.push(structuredClone(pendingAlert)),action:['downHandle','alert-1'],values:{note:'已联系协作团队，安排人工复核。'},verify:s=>assert.equal(s.alerts[0].status,'handled')}
];
for(const scenario of formCases){
  test(`${scenario.label}等服务端确认后才关闭，提交期间防止重复写入`,async t=>{
    const seed=createDownwardSeed();scenario.prepare?.(seed);const h=workspaceHarness(t,{state:seed});if(scenario.role)h.click('downRole',scenario.role);h.click(...scenario.action);
    const acknowledge=h.holdNextWrite(),saving=h.submit(scenario.values),form=h.form;
    assert.equal(h.stats.writes,1);assert.equal(h.stats.closed,0);assert.equal(form.submit.disabled,true);assert.equal(form.attributes['aria-busy'],'true');
    await h.submit(scenario.values);assert.equal(h.stats.writes,1);assert.equal(h.messages.length,0);
    acknowledge();await saving;assert.equal(h.stats.closed,1);assert.equal(form.submit.disabled,false);assert.equal(form.attributes['aria-busy'],undefined);scenario.verify(h.state);
  });
  test(`${scenario.label}服务器保存失败保留输入且允许重试`,async t=>{
    const seed=createDownwardSeed();scenario.prepare?.(seed);const h=workspaceHarness(t,{state:seed});if(scenario.role)h.click('downRole',scenario.role);h.click(...scenario.action);
    h.failNextWrite();await h.submit(scenario.values);assert.equal(h.stats.closed,0);assert.equal(h.form.isConnected,true);assert.deepEqual(h.form.values,scenario.values);assert.equal(h.form.submit.disabled,false);assert.match(h.messages.at(-1),/保存未完成/);assert.deepEqual(h.state,seed);
    await h.submit(scenario.values);assert.equal(h.stats.closed,1);scenario.verify(h.state);
  });
}

test('紧急摘要异步写回时保留其他客户端已登记的处理结果',async t=>{
  const seed=createDownwardSeed();seed.alerts.push(structuredClone(pendingAlert));let resolveSummary;
  const output={summary:'新的交接摘要。',changes:['新的变化'],missing:[],handoff:'与上级团队复核。',source:'ai'};
  const h=workspaceHarness(t,{state:seed,api:()=>new Promise(resolve=>resolveSummary=resolve)});
  const task=h.click('downRetry','alert-1');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.state.alerts[0].status,'processing');assert.equal(h.messages.length,0);
  h.remoteUpdate(s=>Object.assign(s.alerts[0],{status:'handled',handledNote:'其他医生已登记处理',handledAt:new Date().toISOString()}));
  resolveSummary(output);await task;assert.equal(h.state.alerts[0].status,'handled');assert.equal(h.state.alerts[0].handledNote,'其他医生已登记处理');assert.deepEqual(h.state.alerts[0].ai,output);
});
test('紧急摘要服务失败仍在服务器保留原始情况和可重试状态',async t=>{
  const seed=createDownwardSeed();seed.alerts.push(structuredClone(pendingAlert));const h=workspaceHarness(t,{state:seed});
  await h.click('downRetry','alert-1');assert.equal(h.state.alerts[0].status,'failed');assert.equal(h.state.alerts[0].note,pendingAlert.note);assert.match(h.state.alerts[0].error,/原始记录已保留/);assert.equal(h.stats.writes,2);
});

const newPatient={name:'下转流程测试患者',sex:'女',age:'58',diagnosis:'冠脉介入治疗后',stage:'出院衔接期',service:'心脏康复',upperDoctor:'测试专科团队',caseSummary:'已完成院内治疗，后续安排康复评估与随访。',goal:'就近落实康复与监测计划。',handoff:'请核对出院记录与用药清单。'};
test('新建患者输入校验拦截缺失信息和无效年龄',()=>{
  assert.equal(validateDownwardPatient({...newPatient,name:'  新患者  '}).name,'新患者');
  for(const changed of [{name:''},{age:''},{age:-1},{age:121},{age:'1.5'},{caseSummary:''},{service:'未提供的服务'},{sex:'不合法'}])assert.throws(()=>validateDownwardPatient({...newPatient,...changed}));
});
test('新建患者直到服务端确认才新增，失败保留输入并可重试',async t=>{
  const h=workspaceHarness(t);h.click('downAction','new-patient');h.failNextWrite();
  await h.submit(newPatient);assert.equal(h.state.patients.length,3);assert.equal(h.form.id,'down-patient-form');assert.equal(h.form.isConnected,true);assert.deepEqual(h.form.values,newPatient);
  const confirm=h.holdNextWrite(),saving=h.submit(newPatient);assert.equal(h.state.patients.length,3);assert.equal(h.form.submit.disabled,true);
  confirm();await saving;assert.equal(h.state.patients.length,4);assert.equal(h.form.id,'down-plan-form');
  const p=h.state.patients.at(-1);assert.match(p.id,/^patient-/);assert.deepEqual(p.measurements,[]);assert.equal(p.name,newPatient.name);assert.equal(p.handoff,newPatient.handoff);
  assert.match(h.container.innerHTML,/等待第一条监测记录/);assert.doesNotMatch(h.container.innerHTML,/NaN|Infinity|undefined/);
});
test('新增患者下转、明确下一步、接收登记和首条监测形成同一档案',async t=>{
  const h=workspaceHarness(t);h.controller.openNewPatient(newPatient);await h.submit(newPatient);const id=h.state.patients.at(-1).id;
  await h.submit({doctorId:'down-zhouzhiyuan',service:'心脏康复',date:'2026-10-01',goal:newPatient.goal,handoff:newPatient.handoff});
  const plan=h.state.plans.at(-1);assert.equal(plan.patientId,id);assert.equal(plan.status,'pending');assert.match(h.stats.modalHTML,/前往下转接收中心/);
  h.element('#down-go-receiving').onclick();assert.equal(h.stats.navigation.at(-1),'down-receive');assert.match(h.container.innerHTML,/下转接收中心/);assert.match(h.container.innerHTML,/下转流程测试患者/);
  h.click('downReceivePlan',plan.id);await h.submit({department:'康复医学科',location:'康复病区 8 床',arrangement:'接收后每日监测并对接上级团队。'});
  assert.equal(h.state.plans.at(-1).status,'arranged');assert.match(h.container.innerHTML,/当前没有待接收申请/);assert.doesNotMatch(h.container.innerHTML,/照护患者/);
  h.click('downReceiveFilter','arranged');assert.match(h.container.innerHTML,/康复病区 8 床/);h.click('downTimeline',id);assert.match(h.container.innerHTML,/等待第一条监测记录/);
  h.click('downAction','measurement');assert.match(h.stats.modalHTML,/请输入本次测量值/);assert.doesNotMatch(h.stats.modalHTML,/undefined/);await h.submit(reading);
  assert.equal(h.state.patients.find(p=>p.id===id).measurements.length,1);assert.equal(h.state.patients[0].measurements.length,7);assert.match(h.container.innerHTML,/126\/78/);
});
test('编辑既有患者不覆盖已有监测、计划、异常事件或编辑期间新增的记录',async t=>{
  const seed=createDownwardSeed();seed.plans.push(structuredClone(arrangedPlan));seed.alerts.push(structuredClone(pendingAlert));const h=workspaceHarness(t,{state:seed});
  h.click('downAction','edit-patient');const first=h.state.patients[0];
  h.remoteUpdate(s=>s.patients[0].measurements.push({...validateMeasurement(reading),id:'remote-measurement',source:'另一团队'}));
  await h.submit({...first,name:'更新后的患者名',goal:'更新后的照护目标',handoff:'新增交接信息'});
  const p=h.state.patients[0];assert.equal(p.id,'patient-wang');assert.equal(p.name,'更新后的患者名');assert.equal(p.measurements.length,8);assert.equal(p.measurements.at(-1).id,'remote-measurement');assert.deepEqual(h.state.plans,seed.plans);assert.deepEqual(h.state.alerts,seed.alerts);assert.match(h.container.innerHTML,/更新后的患者名/);
});
test('接收中心订阅另一团队的申请更新，正在编辑的接收表单仍保留',t=>{
  const h=workspaceHarness(t);h.controller.renderReceiving(h.container);assert.match(h.container.innerHTML,/当前没有待接收申请/);
  h.remoteUpdate(s=>s.plans.push(structuredClone(arrangedPlan)));assert.match(h.container.innerHTML,/王先生/);
  h.click('downReceivePlan','plan-1');const form=h.form;form.values.location='正在填写的地点';
  h.remoteUpdate(s=>s.patients[0].diagnosis='更新后的诊断');assert.equal(h.form,form);assert.equal(form.values.location,'正在填写的地点');assert.match(h.container.innerHTML,/更新后的诊断/);assert.match(h.container.innerHTML,/下转接收中心/);
});

test('导入患者保留院内来源，并将来源医生带入上级责任团队',async t=>{
  const h=workspaceHarness(t);
  h.controller.importPatient({...newPatient,upperDoctor:'',sourceDoctor:'来源医生甲',sourceSystem:'HIS',sourcePatientId:'VISIT-001',sourceHospital:'上级医院'});
  assert.match(h.stats.modalHTML,/来源医生甲/);
  await h.submit({...newPatient,upperDoctor:'来源医生甲'});
  const patient=h.state.patients.at(-1);
  assert.equal(patient.sourceSystem,'HIS');assert.equal(patient.sourcePatientId,'VISIT-001');assert.equal(patient.sourceDoctor,'来源医生甲');assert.equal(patient.sourceHospital,'上级医院');
  assert.match(patient.id,/^patient-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});
