import test from 'node:test';
import assert from 'node:assert/strict';
import {INTAKE_EXAMPLES,normalizeIntakePayload,parseIntakeJson,createDataIntake} from './data-intake.mjs';

test('接入两种来源示例为单患者规范记录，年龄归一且丢弃额外敏感字段',()=>{
  for(const value of INTAKE_EXAMPLES)assert.doesNotThrow(()=>normalizeIntakePayload(value));
  const value=normalizeIntakePayload({...INTAKE_EXAMPLES[0],name:' 陈女士 ',age:'58',phone:'not imported',password:'not imported',attachments:[{}]});
  assert.equal(value.name,'陈女士');assert.equal(value.age,58);assert.equal(value.phone,undefined);assert.equal(value.password,undefined);assert.equal(value.attachments,undefined);
});

test('无效格式、关键字段、年龄、来源或过长摘要不能进入病例草稿',()=>{
  for(const value of [null,[],{}, {...INTAKE_EXAMPLES[0],age:''},{...INTAKE_EXAMPLES[0],age:121},{...INTAKE_EXAMPLES[0],age:1.5},{...INTAKE_EXAMPLES[0],sourceSystem:'系统已连接'},{...INTAKE_EXAMPLES[0],sex:'x'},{...INTAKE_EXAMPLES[0],sourceHospital:''},{...INTAKE_EXAMPLES[0],caseSummary:'短'},{...INTAKE_EXAMPLES[0],caseSummary:'字'.repeat(5001)}])assert.throws(()=>normalizeIntakePayload(value));
  assert.throws(()=>parseIntakeJson('{invalid}'),/JSON 格式/);assert.throws(()=>parseIntakeJson('x'.repeat(20001)),/20,000/);
});

class Node {
  innerHTML='';value='';events=new Map();nodes=new Map();isConnected=true;
  querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Node());return this.nodes.get(selector);}
  querySelectorAll(){return [];}
  addEventListener(name,fn){this.events.set(name,fn);}
  removeEventListener(name){this.events.delete(name);}
  contains(){return true;}
}
function target(attribute,value='') {return {dataset:{[attribute.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:value},closest(){return this;},hasAttribute:key=>attribute===key,matches:selector=>selector===`[${attribute}]`,value};}
function setup(importer) {
  const root=new Node(),calls=[],messages=[];
  const controller=createDataIntake({icon:()=>'',onImport:async(...args)=>{calls.push(args);await importer?.(...args);},toast:message=>messages.push(message)});controller.render(root);
  return {root,controller,calls,messages,click:(key,value)=>root.events.get('click')({target:target(key,value)}),input:value=>root.events.get('input')({target:target('data-intake-json',value)}),change:obj=>root.events.get('change')({target:obj})};
}

test('接入入口明确待接入，只有核对确认才转入草稿，并保留来源',async()=>{
  const h=setup();assert.match(h.root.innerHTML,/接口待接入/);assert.equal(h.calls.length,0);
  await h.click('data-intake-example');assert.equal(h.calls.length,0);assert.match(h.root.querySelector('[data-intake-preview-content]').innerHTML,/陈女士/);
  await h.click('data-intake-confirm');assert.equal(h.calls.length,1);assert.equal(h.calls[0][1],'upward');assert.equal(h.calls[0][0].sourceSystem,'东华');
  await h.click('data-intake-vendor','嘉和');await h.click('data-intake-example');await h.click('data-intake-confirm');assert.equal(h.calls[1][1],'downward');assert.equal(h.calls[1][0].sourceSystem,'嘉和');
});

test('改动 JSON 会清除旧预览，未经重新核对不允许误导入旧病例',async()=>{
  const h=setup();await h.click('data-intake-example');h.input('{invalid}');await h.click('data-intake-confirm');assert.equal(h.calls.length,0);
  await h.click('data-intake-preview');assert.match(h.root.querySelector('[data-intake-error]').innerHTML,/JSON 格式/);
  h.input(JSON.stringify({...INTAKE_EXAMPLES[0],name:'新患者'}));await h.click('data-intake-preview');await h.click('data-intake-confirm');assert.equal(h.calls[0][0].name,'新患者');
});

test('切换来源系统清空旧患者核对区，重新载入后才可导入新患者',async()=>{
  const h=setup();await h.click('data-intake-example');assert.match(h.root.querySelector('[data-intake-preview-content]').innerHTML,/陈女士/);
  await h.click('data-intake-vendor','嘉和');assert.match(h.root.querySelector('[data-intake-current]').innerHTML,/王先生/);assert.doesNotMatch(h.root.querySelector('[data-intake-preview-content]').innerHTML,/陈女士|data-intake-confirm/);await h.click('data-intake-confirm');assert.equal(h.calls.length,0);
  await h.click('data-intake-example');await h.click('data-intake-confirm');assert.equal(h.calls[0][0].name,'王先生');assert.equal(h.calls[0][0].sourceSystem,'嘉和');assert.equal(h.calls[0][1],'downward');
  await h.click('data-intake-vendor','东华');await h.click('data-intake-confirm');assert.equal(h.calls.length,1);await h.click('data-intake-example');await h.click('data-intake-confirm');assert.equal(h.calls[1][0].name,'陈女士');assert.equal(h.calls[1][1],'upward');
});

test('异步导入时防重入，失败保留核对信息并允许重试',async()=>{
  let reject;const h=setup(()=>new Promise((_,fail)=>reject=fail));await h.click('data-intake-example');
  const task=h.click('data-intake-confirm');await h.click('data-intake-confirm');assert.equal(h.calls.length,1);
  reject(Error('failure'));await task;assert.match(h.root.querySelector('[data-intake-preview-content]').innerHTML,/陈女士/);assert.match(h.root.querySelector('[data-intake-error]').innerHTML,/资料已保留/);
});

test('文件迟到内容不能覆盖随后手工修改或导航离开的页面',async()=>{
  let read;const h=setup();const file={name:'patient.json',size:500,text:()=>new Promise(resolve=>read=resolve)};
  const upload=target('data-intake-file');upload.files=[file];const task=h.change(upload);
  h.input('新的手工输入');read(JSON.stringify(INTAKE_EXAMPLES[0]));await task;
  await h.click('data-intake-preview');assert.match(h.root.querySelector('[data-intake-error]').innerHTML,/JSON 格式/);
  const leaving=h.change(upload);h.controller.onLeave();read(JSON.stringify(INTAKE_EXAMPLES[0]));await leaving;assert.equal(h.calls.length,0);
});

test('患者内容只作为文本显示，附加 HTML 不形成可执行元素',async()=>{
  const h=setup();h.input(JSON.stringify({...INTAKE_EXAMPLES[0],name:'<script>坏数据</script>'}));await h.click('data-intake-preview');const html=h.root.querySelector('[data-intake-preview-content]').innerHTML;assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
