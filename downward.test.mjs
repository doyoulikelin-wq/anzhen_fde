import test from 'node:test';
import assert from 'node:assert/strict';
import {createDownwardSeed,validateMeasurement,validateDownwardPatient,createDownwardWorkspace,sortCarePatients} from './downward.mjs';
import {PARTNER_DOCTORS,PARTNER_HOSPITALS} from './partner-roster.mjs';
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
  function element(selector){
    if(forms.has(selector))return forms.get(selector);
    const nested=selector.match(/^(#[\w-]+)\s+(.+)$/);
    if(nested&&forms.has(nested[1]))return forms.get(nested[1]).querySelector(nested[2]);
    if(!elements.has(selector))elements.set(selector,{});
    return elements.get(selector);
  }
  function createForm(id,html){
    const submit={disabled:false},fields=new Map();
    const form={id,values:{},isConnected:true,submit,attributes:{},querySelectorAll:()=>[submit],setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];}};
    form.querySelector=selector=>{
      const name=selector.match(/\[name=["']?([^"'\]]+)["']?\]/)?.[1];
      return name?fields.get(name)||null:element(selector);
    };
    for(const match of html.matchAll(/<(input|select|textarea)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)){
      const [,tag,attributes,content='']=match,name=attributes.match(/\bname="([^"]+)"/)?.[1];
      if(!name)continue;
      let innerHTML='';
      const field={name,tagName:tag.toUpperCase(),disabled:/\bdisabled\b/.test(attributes),options:[],get value(){return form.values[name]??'';},set value(value){form.values[name]=String(value);},get innerHTML(){return innerHTML;},set innerHTML(value){innerHTML=value;if(tag==='select'){this.options=[...value.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(([,attrs,text])=>({value:attrs.match(/\bvalue="([^"]*)"/)?.[1]??text,selected:/\bselected\b/.test(attrs),disabled:/\bdisabled\b/.test(attrs)}));this.value=(this.options.find(option=>option.selected)||this.options[0])?.value||'';}}};
      fields.set(name,field);
      if(tag==='select')field.innerHTML=content;else field.value=tag==='textarea'?content:attributes.match(/\bvalue="([^"]*)"/)?.[1]||'';
    }
    return form;
  }
  globalThis.document={querySelector:element};
  const container={isConnected:true,buttons:[],html:'',set innerHTML(value){this.html=value;stats.renders++;this.buttons=[...value.matchAll(/<button\b([^>]*)>/g)].map(([,attributes])=>{const dataset={};for(const [,key,val]of attributes.matchAll(/data-([a-z-]+)="([^"]*)"/g))dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=val;return {dataset};});},get innerHTML(){return this.html;},querySelectorAll(selector){const key=selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return this.buttons.filter(button=>key in button.dataset);},querySelector(){return {};}};
  const workspace={isShared:true,getSnapshot:()=>snapshot,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},async updateDownward(mutator){stats.writes++;const gate=nextGate,failure=nextFailure;nextGate=null;nextFailure=null;if(gate)await gate;if(failure)throw Error(failure);const next=structuredClone(snapshot);mutator(next.downward);next.revision++;snapshot=next;listeners.forEach(listener=>listener(snapshot));}};
  const controller=createDownwardWorkspace({workspace,escape:value=>String(value),icon:()=>'',toast:value=>messages.push(value),api,onUpdate(){},renderSchedule:()=>'',navigate(page){stats.navigation.push(page);if(page==='downward')controller.render(container);if(page==='down-receive')controller.renderReceiving(container);},openModal(html){stats.modalHTML=html;const id=html.match(/<form id="([^"]+)"/)?.[1];if(!id)return;if(currentForm)currentForm.isConnected=false;const form=createForm(id,html);forms.set(`#${id}`,form);currentForm=form;},closeModal(){stats.closed++;if(currentForm)currentForm.isConnected=false;}});
  controller.render(container);
  return {controller,container,stats,messages,element,change(name,value){const field=currentForm.querySelector(`[name=${name}]`);assert.ok(field,`missing field ${name}`);field.value=value;return field.onchange?.({target:field});},get state(){return snapshot.downward;},get form(){return currentForm;},click(key,value){const button=container.buttons.find(button=>button.dataset[key]===value);assert.ok(button,`missing control ${key}=${value}`);return button.onclick();},submit(values){currentForm.values=values;return currentForm.onsubmit({target:currentForm,preventDefault(){}});},holdNextWrite(){let resolve;nextGate=new Promise(done=>resolve=done);return resolve;},failNextWrite(message='连接中断'){nextFailure=message;},remoteUpdate(mutator){const next=structuredClone(snapshot);mutator(next.downward);next.revision++;snapshot=next;listeners.forEach(listener=>listener(snapshot));}};
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
  {label:'下转申请',action:['downAction','plan'],values:{hospitalId:PARTNER_DOCTORS[0]?.hospitalId,doctorId:PARTNER_DOCTORS[0]?.id,service:'心脏康复',date:'2026-10-01',goal:'继续康复',handoff:'复核出院小结'},verify:s=>assert.equal(s.plans.length,1)},
  {label:'接收安排',prepare:s=>s.plans.push(structuredClone(arrangedPlan)),role:'lower',action:['downAction','receive'],values:{department:'康复医学科',serviceLocation:'康复住院病区',bed:'02床',arrangement:'每日观察'},verify:s=>assert.equal(s.plans[0].status,'arranged')},
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
  await h.submit({hospitalId:PARTNER_DOCTORS[0].hospitalId,doctorId:PARTNER_DOCTORS[0].id,service:'心脏康复',date:'2026-10-01',goal:newPatient.goal,handoff:newPatient.handoff});
  const plan=h.state.plans.at(-1);assert.equal(plan.patientId,id);assert.equal(plan.status,'pending');assert.match(h.stats.modalHTML,/前往下转接收中心/);
  h.element('#down-go-receiving').onclick();assert.equal(h.stats.navigation.at(-1),'down-receive');assert.match(h.container.innerHTML,/下转接收中心/);assert.match(h.container.innerHTML,/下转流程测试患者/);
  h.click('downReceivePlan',plan.id);await h.submit({department:'康复医学科',serviceLocation:'康复住院病区',bed:'06床',arrangement:'接收后每日监测并对接上级团队。'});
  assert.equal(h.state.plans.at(-1).status,'arranged');assert.match(h.container.innerHTML,/当前没有待接收申请/);assert.doesNotMatch(h.container.innerHTML,/照护患者/);
  h.click('downReceiveFilter','arranged');assert.match(h.container.innerHTML,/康复住院病区 · 06床/);h.click('downTimeline',id);assert.match(h.container.innerHTML,/等待第一条监测记录/);
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
  h.click('downReceivePlan','plan-1');const form=h.form;form.values.serviceLocation='正在填写的地点';
  h.remoteUpdate(s=>s.patients[0].diagnosis='更新后的诊断');assert.equal(h.form,form);assert.equal(form.values.serviceLocation,'正在填写的地点');assert.match(h.container.innerHTML,/更新后的诊断/);assert.match(h.container.innerHTML,/下转接收中心/);
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


test('从真实医生详情发起下转，保存院方目录身份并允许独立填写服务需求',async t=>{
  const d=PARTNER_DOCTORS[0];assert.ok(d,'应提供经来源核实的接收医生');
  const h=workspaceHarness(t);
  h.click('downDoctor',d.id);assert.ok(h.stats.modalHTML.includes(d.name));assert.ok(h.stats.modalHTML.includes(d.photo));
  h.element('#down-use-doctor').onclick();
  assert.ok(h.stats.modalHTML.includes(`value="${d.id}" selected`));
  assert.ok(h.element('#down-selected-doctor').innerHTML.includes(d.hospital));
  for(const service of ['住院延续治疗','心脏康复','术后护理','慢病随访']){
    if(h.state.plans.length)h.click('downAction','plan');
    await h.submit({hospitalId:d.hospitalId,doctorId:d.id,service,date:'2026-10-16',goal:'由院方评估服务条件并衔接治疗',handoff:'携带出院记录'});
    assert.equal(h.state.plans.length,1);
    const plan=h.state.plans[0];
    assert.deepEqual({doctorId:plan.doctorId,doctorName:plan.doctorName,hospital:plan.hospital,department:plan.department},{doctorId:d.id,doctorName:d.name,hospital:d.hospital,department:d.department});
    assert.equal(plan.campus,d.campus||'');assert.equal(plan.service,service);assert.equal(plan.status,'pending');
  }
});

test('新申请不再选择旧虚构团队，历史计划仍可查看并调整',async t=>{
  const h=workspaceHarness(t);h.click('downAction','plan');
  assert.doesNotMatch(h.stats.modalHTML,/<option value="down-(lincheng|zhouzhiyuan|guanning)"/);
  await h.submit({hospitalId:'legacy:down-zhouzhiyuan',doctorId:'down-zhouzhiyuan',service:'心脏康复',date:'2026-10-16',goal:'继续康复',handoff:''});
  assert.equal(h.stats.writes,0);assert.match(h.messages.at(-1),/请选择接收医生/);
  h.remoteUpdate(s=>s.plans.push(structuredClone(arrangedPlan)));h.click('downAction','plan');
  assert.match(h.stats.modalHTML,/既有计划接收团队/);assert.match(h.stats.modalHTML,/<option value="down-zhouzhiyuan" selected/);
  await h.submit({hospitalId:'legacy:down-zhouzhiyuan',doctorId:'down-zhouzhiyuan',service:'心脏康复',date:'2026-10-16',goal:'补充旧计划交接目标',handoff:'保留历史接收团队'});
  assert.equal(h.state.plans.length,1);assert.equal(h.state.plans[0].id,arrangedPlan.id);assert.equal(h.state.plans[0].doctorName,arrangedPlan.doctorName);assert.equal(h.state.plans[0].goal,'补充旧计划交接目标');
});

test('先选择医院再选择医生，医院切换会清空医生且只展示该院名册',t=>{
  const h=workspaceHarness(t);h.click('downAction','plan');
  const hospital=h.form.querySelector('[name="hospitalId"]'),doctor=h.form.querySelector('[name="doctorId"]');
  assert.equal(hospital.value,'');assert.equal(doctor.value,'');assert.equal(doctor.disabled,true);
  assert.deepEqual(hospital.options.filter(o=>o.value).map(o=>o.value),PARTNER_HOSPITALS.map(x=>x.id));
  for(const hospitalInfo of PARTNER_HOSPITALS){
    h.change('hospitalId',hospitalInfo.id);
    assert.equal(doctor.value,'');assert.equal(doctor.disabled,false);
    const choices=PARTNER_DOCTORS.filter(d=>d.hospitalId===hospitalInfo.id);
    assert.deepEqual(doctor.options.filter(o=>o.value).map(o=>o.value),choices.map(d=>d.id));
    h.change('doctorId',choices[0].id);
    assert.ok(h.element('#down-selected-doctor').innerHTML.includes(choices[0].name));
    assert.ok(h.element('#down-selected-doctor').innerHTML.includes(choices[0].hospital));
  }
  h.change('hospitalId','');assert.equal(doctor.value,'');assert.equal(doctor.disabled,true);
  assert.doesNotMatch(h.element('#down-selected-doctor').innerHTML,/<img/);
});

test('不能提交跨院医生组合，重新选定本院医生后才能保存',async t=>{
  const h=workspaceHarness(t);h.click('downAction','plan');
  const first=PARTNER_DOCTORS[0],other=PARTNER_DOCTORS.find(d=>d.hospitalId!==first.hospitalId);
  const request={hospitalId:other.hospitalId,doctorId:first.id,service:'术后护理',date:'2030-10-18',goal:'核对后续照护',handoff:''};
  await h.submit(request);assert.equal(h.stats.writes,0);assert.match(h.messages.at(-1),/所选医院/);
  await h.submit({...request,doctorId:other.id});assert.equal(h.stats.writes,1);assert.equal(h.state.plans[0].doctorId,other.id);assert.equal(h.state.plans[0].hospital,other.hospital);
});

test('新建下转返回患者表单保留申请草稿，修改后沿用同一患者且返回申请',async t=>{
  const h=workspaceHarness(t);h.controller.openNewPatient();await h.submit(newPatient);
  const p=structuredClone(h.state.patients.at(-1)),d=PARTNER_DOCTORS.find(item=>item.hospitalId===PARTNER_HOSPITALS[1].id);
  h.change('hospitalId',d.hospitalId);h.change('doctorId',d.id);
  Object.assign(h.form.values,{date:'2030-10-18',service:'慢病随访',goal:'刚填写的申请目标',handoff:''});
  const oldForm=h.form,closed=h.stats.closed;h.element('#down-plan-cancel').onclick();
  assert.equal(h.stats.closed,closed);assert.equal(oldForm.isConnected,false);assert.equal(h.form.id,'down-patient-form');
  assert.equal(h.form.values.name,p.name);assert.equal(h.form.values.service,'慢病随访');assert.equal(h.form.values.goal,'刚填写的申请目标');assert.equal(h.form.values.handoff,'');
  assert.equal(h.state.patients.length,4);assert.equal(h.state.plans.length,0);
  h.element('#down-patient-cancel').onclick();
  assert.equal(h.form.id,'down-plan-form');assert.equal(h.form.values.hospitalId,d.hospitalId);assert.equal(h.form.values.doctorId,d.id);assert.equal(h.form.values.date,'2030-10-18');assert.equal(h.form.values.goal,'刚填写的申请目标');assert.equal(h.form.values.handoff,'');
  h.element('#down-plan-cancel').onclick();
  h.remoteUpdate(s=>s.patients.find(item=>item.id===p.id).measurements.push({...validateMeasurement(reading),id:'new-remote-measurement',source:'另一协作团队'}));
  await h.submit({...h.form.values,name:'修改后的同一患者',service:'术后护理',goal:'修改后的交接目标',handoff:'补充核对材料'});
  const updated=h.state.patients.find(item=>item.id===p.id);
  assert.equal(h.state.patients.length,4);assert.equal(updated.name,'修改后的同一患者');assert.equal(updated.createdAt,p.createdAt);assert.equal(updated.measurements[0].id,'new-remote-measurement');
  assert.equal(h.form.id,'down-plan-form');assert.equal(h.form.values.doctorId,d.id);assert.equal(h.form.values.hospitalId,d.hospitalId);assert.equal(h.form.values.date,'2030-10-18');assert.equal(h.form.values.service,'术后护理');assert.equal(h.form.values.goal,'修改后的交接目标');assert.equal(h.form.values.handoff,'补充核对材料');
  await h.submit({...h.form.values});
  assert.equal(h.state.plans.length,1);assert.equal(h.state.plans[0].patientId,p.id);assert.equal(h.state.plans[0].doctorId,d.id);assert.equal(h.state.plans[0].date,'2030-10-18');assert.equal(h.state.plans[0].goal,'修改后的交接目标');
});

test('患者列表按新建时间倒序，旧档案保持原顺序且不改写底层记录',t=>{
  const seed=createDownwardSeed(),oldOrder=seed.patients.map(p=>p.id);
  seed.patients.push({...structuredClone(seed.patients[0]),id:'new-a',name:'较早新建',createdAt:'2026-10-15T01:00:00Z',updatedAt:'2026-10-16T10:00:00Z'});
  seed.patients.push({...structuredClone(seed.patients[0]),id:'new-b',name:'最新新建',createdAt:'2026-10-16T01:00:00Z'});
  const original=structuredClone(seed.patients),h=workspaceHarness(t,{state:seed});
  assert.deepEqual(sortCarePatients(seed.patients).map(p=>p.id),['new-b','new-a',...oldOrder]);
  assert.deepEqual(h.container.buttons.filter(b=>b.dataset.downPatient).map(b=>b.dataset.downPatient),['new-b','new-a',...oldOrder]);
  assert.deepEqual(seed.patients,original);assert.deepEqual(h.state.patients,original);
});

test('接收科室、服务地点、床位逐级选择并保存结构化安排',async t=>{
  const seed=createDownwardSeed();seed.plans.push(structuredClone(arrangedPlan));const h=workspaceHarness(t,{state:seed});h.click('downRole','lower');h.click('downAction','receive');
  const department=h.form.querySelector('[name=department]'),location=h.form.querySelector('[name=serviceLocation]'),bed=h.form.querySelector('[name=bed]');
  assert.equal(department.tagName,'SELECT');assert.equal(location.tagName,'SELECT');assert.equal(bed.tagName,'SELECT');
  assert.equal(department.value,'康复医学科');assert.equal(location.value,'');assert.equal(bed.disabled,true);
  h.change('serviceLocation','康复住院病区');assert.equal(bed.disabled,false);assert.equal(bed.value,'待院方分配');h.change('bed','03床');
  h.change('department','心血管内科');assert.equal(location.value,'');assert.equal(bed.value,'');assert.equal(bed.disabled,true);assert.deepEqual(location.options.filter(o=>o.value).map(o=>o.value),['心血管内科病区','心血管门诊随访区']);
  h.change('serviceLocation','心血管门诊随访区');assert.equal(bed.value,'无需床位');
  h.change('serviceLocation','心血管内科病区');assert.equal(bed.value,'待院方分配');h.change('bed','05床');
  await h.submit({...h.form.values,arrangement:'按交接计划登记监测。'});
  const saved=h.state.plans[0];assert.equal(saved.acceptedDepartment,'心血管内科');assert.equal(saved.serviceLocation,'心血管内科病区');assert.equal(saved.bed,'05床');assert.equal(saved.location,'心血管内科病区 · 05床');assert.equal(saved.status,'arranged');
  h.click('downAction','receive');assert.equal(h.form.values.department,'心血管内科');assert.equal(h.form.values.serviceLocation,'心血管内科病区');assert.equal(h.form.values.bed,'05床');
});

test('接收安排拒绝科室、地点或床位不对应的组合',async t=>{
  const seed=createDownwardSeed();seed.plans.push(structuredClone(arrangedPlan));const h=workspaceHarness(t,{state:seed});h.click('downRole','lower');h.click('downAction','receive');
  const valid={department:'康复医学科',serviceLocation:'康复住院病区',bed:'03床',arrangement:'每日监测'};
  for(const invalid of [{department:'不存在的科室'},{serviceLocation:'心血管内科病区'},{bed:'99床'},{bed:''},{serviceLocation:''}]){
    await h.submit({...valid,...invalid});assert.equal(h.stats.writes,0);assert.equal(h.form.isConnected,true);assert.equal(h.state.plans[0].status,'pending');
  }
  await h.submit(valid);assert.equal(h.stats.writes,1);assert.equal(h.state.plans[0].location,'康复住院病区 · 03床');
});

test('既有自由填写的科室和地点能回显，原样保存不覆盖历史地点',async t=>{
  const seed=createDownwardSeed();seed.plans.push({...structuredClone(arrangedPlan),status:'arranged',acceptedDepartment:'历史心脏照护组',location:'原三病区 18 床 / 接待处',arrangement:'原有监测安排'});
  const h=workspaceHarness(t,{state:seed});h.click('downRole','lower');h.click('downAction','receive');
  assert.equal(h.form.values.department,'历史心脏照护组');assert.equal(h.form.values.serviceLocation,'原三病区 18 床 / 接待处');assert.equal(h.form.values.bed,'');assert.match(h.stats.modalHTML,/原记录/);
  await h.submit({...h.form.values,arrangement:'更新监测安排'});
  const saved=h.state.plans[0];assert.equal(saved.acceptedDepartment,'历史心脏照护组');assert.equal(saved.location,'原三病区 18 床 / 接待处');assert.equal(saved.arrangement,'更新监测安排');assert.equal(saved.serviceLocation,undefined);assert.equal(saved.bed,undefined);
});
