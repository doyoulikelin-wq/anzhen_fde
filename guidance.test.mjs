import test from 'node:test';
import assert from 'node:assert/strict';
import {createGuidanceWorkspace} from './guidance.mjs';

// Minimal DOM seam for request lifetime tests; browser QA covers visual layout.
class Node {
  innerHTML='';textContent='';disabled=false;isConnected=true;scrollHeight=0;
  constructor(){this.nodes=new Map();this.events=new Map();}
  querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Node());return this.nodes.get(selector);}
  querySelectorAll(){return [];}
  addEventListener(name,callback){this.events.set(name,callback);}
  removeEventListener(name){this.events.delete(name);}
  contains(){return true;}
  setAttribute(){}
  scrollIntoView(){}
}
function button(attribute,value='') {
  return {dataset:{[attribute.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:value},closest(){return this;},hasAttribute(name){return name===attribute;}};
}
function input(attribute,value){return {value,matches(selector){return selector===`[${attribute}]`;}};}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const doctor={id:'real-doctor',name:'名单医生',photo:'photo.png',title:'主任医师',department:'心血管内科',bio:'公开专业资料',expertise:['心律失常']};
const response=(urgent=false)=>({analysis:{valid:true,urgent,categoryLabel:'心律失常',summary:'病例分析',missing:[]},ranked:[{id:doctor.id,score:85,reasons:['相关公开资料']} ]});
function setup() {
  const root=new Node(),requests=[];
  const workspace=createGuidanceWorkspace({getDoctors:()=>[doctor,{...doctor,id:'no-photo',photo:''}],escape:value=>String(value??'').replaceAll('<','&lt;'),icon:()=>'<svg></svg>',photo:d=>`<img alt="${d.name}">`,api:(path,body,signal)=>{const pending=deferred();requests.push({path,body,signal,...pending});return pending.promise;},renderSchedule:()=>'<table>七日排班</table>',openModal(){},closeModal(){},toast(){}});
  workspace.render(root);
  return {root,requests,workspace,click:attribute=>root.events.get('click')({target:button(attribute)}),editCase:value=>root.events.get('input')({target:input('data-guide-case',value)})};
}
function imageBrowser(t) {
  const originals=new Map(['FileReader','Image','document'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  t.after(()=>{for(const [name,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
  globalThis.FileReader=class {readAsDataURL(){this.result='data:image/png;base64,AA==';queueMicrotask(()=>this.onload());}};
  globalThis.Image=class {width=800;height=600;set src(_){queueMicrotask(()=>this.onload());}};
  globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,AA=='})};
}
function chooseImage(ui,name='病历.png') {
  const target=input('data-guide-image');target.files=[{name,type:'image/png',size:100}];
  ui.root.events.get('change')({target});
}
function reviewImage(ui) {
  const target=input('data-guide-reviewed');target.checked=true;ui.root.events.get('change')({target});
}

test('导诊仅在明确点击后请求，忽略未知及无照片医生并保留可信名单资料',async()=>{
  const ui=setup();assert.equal(ui.requests.length,0);
  ui.click('data-guide-match');assert.equal(ui.requests.length,1);assert.equal(ui.requests[0].path,'/api/match');
  const data=response();data.ranked.push({id:'invented',score:99,reasons:['无来源']},{id:'no-photo',score:90,reasons:[]});data.ranked[0].name='伪造姓名';
  ui.requests[0].resolve(data);await flush();
  const rendered=ui.root.querySelector('[data-guide-results]').innerHTML;
  assert.match(rendered,/名单医生/);assert.doesNotMatch(rendered,/伪造姓名|invented|no-photo/);
});

test('病例修改中止旧推荐，迟到响应不能覆盖当前病例界面',async()=>{
  const ui=setup();ui.click('data-guide-match');
  ui.editCase('男，56岁。高血压5年，目前平稳，拟门诊复诊。');
  assert.equal(ui.requests[0].signal.aborted,true);
  ui.requests[0].resolve(response());await flush();
  assert.match(ui.root.querySelector('[data-guide-results]').innerHTML,/先说说您的就诊需要/);
  assert.doesNotMatch(ui.root.querySelector('[data-guide-results]').innerHTML,/名单医生/);
  ui.click('data-guide-match');assert.match(ui.requests[1].body.caseText,/高血压5年/);
});

test('急症结果不提供普通医生排班入口，并可查看急诊人工引导',async()=>{
  const ui=setup();ui.click('data-guide-match');ui.requests[0].resolve(response(true));await flush();
  assert.match(ui.root.querySelector('[data-guide-results]').innerHTML,/优先寻求急诊评估/);
  assert.doesNotMatch(ui.root.querySelector('[data-guide-results]').innerHTML,/data-guide-detail/);
  ui.click('data-guide-emergency');assert.match(ui.root.querySelector('[data-guide-route]').innerHTML,/急诊分诊台/);
  assert.match(ui.root.querySelector('[data-guide-route]').innerHTML,/路线为院区示意/);
});

test('离开导诊会中止请求，失败响应不污染下次进入',async()=>{
  const ui=setup();ui.click('data-guide-match');ui.workspace.onLeave();
  assert.equal(ui.requests[0].signal.aborted,true);ui.requests[0].reject(Error('late error'));await flush();
  ui.workspace.render(ui.root);assert.doesNotMatch(ui.root.querySelector('[data-guide-results]').innerHTML,/late error|暂未完成推荐/);
});

test('超过5000字病例不能发起匹配请求',()=>{
  const ui=setup();ui.editCase('病'.repeat(5001));ui.click('data-guide-match');
  assert.equal(ui.requests.length,0);assert.equal(ui.root.querySelector('[data-guide-match]').disabled,true);
});

test('选择新图片立即阻止旧文字推荐，识别失败仍受阻，移除后恢复文字推荐',async t=>{
  imageBrowser(t);const ui=setup();chooseImage(ui);
  assert.equal(ui.root.querySelector('[data-guide-match]').disabled,true);
  ui.click('data-guide-match');assert.equal(ui.requests.length,0);
  await flush();assert.match(ui.root.querySelector('[data-guide-image-state]').innerHTML,/尚未识别/);
  ui.click('data-guide-match');assert.equal(ui.requests.length,0);
  ui.click('data-guide-extract');assert.equal(ui.requests[0].path,'/api/record-extract');
  ui.requests[0].reject(Error('识别失败'));await flush();
  ui.click('data-guide-match');assert.equal(ui.requests.length,1);
  ui.click('data-guide-remove-image');assert.equal(ui.root.querySelector('[data-guide-match]').disabled,false);
  ui.click('data-guide-match');assert.equal(ui.requests[1].path,'/api/match');
});

test('识别成功后显示已识别但仍需核对，重新选图使既有核对和推荐失效',async t=>{
  imageBrowser(t);const ui=setup();chooseImage(ui);await flush();ui.click('data-guide-extract');
  const recognized='男，58岁，高血压病史多年，近一个月血压偏高，无胸痛，需门诊复诊。';
  ui.requests[0].resolve({text:recognized,uncertain:[],source:'ai'});await flush();
  assert.match(ui.root.querySelector('[data-guide-image-state]').innerHTML,/已识别 · 请核对下方文字/);
  assert.equal(ui.root.querySelector('[data-guide-match]').disabled,true);
  ui.click('data-guide-match');assert.equal(ui.requests.length,1);
  reviewImage(ui);assert.equal(ui.root.querySelector('[data-guide-match]').disabled,false);
  assert.match(ui.root.querySelector('[data-guide-image-state]').innerHTML,/文字已核对/);
  ui.click('data-guide-match');assert.equal(ui.requests[1].body.caseText,recognized);
  chooseImage(ui,'另一份病历.png');assert.equal(ui.requests[1].signal.aborted,true);await flush();
  assert.equal(ui.root.querySelector('[data-guide-match]').disabled,true);
  assert.doesNotMatch(ui.root.querySelector('[data-guide-image-state]').innerHTML,/文字已核对/);
  ui.requests[1].resolve(response());await flush();
  assert.doesNotMatch(ui.root.querySelector('[data-guide-results]').innerHTML,/名单医生/);
  ui.click('data-guide-match');assert.equal(ui.requests.length,2);
});
