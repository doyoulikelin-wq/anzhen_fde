import test from 'node:test';
import assert from 'node:assert/strict';
import {createApprovalWorkspace} from './approval-ui.mjs';
import {referralNotifications} from './referral-workflow.mjs';
import {escapeHtml} from './shared-ui.mjs';

const attachment={id:'791ab191-8b3a-44f4-87b0-a9795177c5bc',name:'检查报告.pdf',type:'application/pdf',size:25,uploadedAt:'2026-09-22T08:00:00.000Z',url:'/api/attachments/791ab191-8b3a-44f4-87b0-a9795177c5bc'};
const record=()=>{const r={id:'AZ-APPROVAL-1',status:'review',doctor:{id:'doctor-a',name:'接诊医生',department:'心血管内科'},snapshot:{patient:{name:'王先生',sex:'男',age:66},sourceHospital:'协作医院',sourceDoctor:'发起医生',text:'冠心病治疗后需进一步进行诊疗评估。',urgent:false},date:'2026-10-01',session:'上午',time:'08:00–12:00',approval:{status:'pending',reviewer:'',note:''},attachments:[{...attachment}],inputSource:{sourceSystem:'东华',sourcePatientId:'SOURCE-001'},createdAt:'2026-09-22T08:00:00.000Z',events:[{label:'申请已提交',at:'2026-09-22T08:00:00.000Z'}]};r.notifications=referralNotifications(r,'review',r.createdAt);return r;};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

class Node {
  isConnected=true;dataset={};values={};disabled=false;events=new Map();nodes=new Map();buttons=[];html='';
  set innerHTML(value){this.html=value;this.buttons=[...value.matchAll(/<button\b([^>]*)>/g)].map(([,attributes])=>{const button=new Node();for(const [,key,text] of attributes.matchAll(/data-([a-z-]+)="([^"]*)"/g))button.dataset[key.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=text;return button;});}
  get innerHTML(){return this.html;}
  querySelector(selector){if(!this.nodes.has(selector))this.nodes.set(selector,new Node());return this.nodes.get(selector);}
  querySelectorAll(selector){const match=selector.match(/^\[data-([a-z-]+)\]$/);if(match){const key=match[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return this.buttons.filter(button=>key in button.dataset);}return [];}
  addEventListener(name,fn){this.events.set(name,fn);}
  removeEventListener(name){this.events.delete(name);}
  setAttribute(){}
  contains(){return true;}
}

function harness(t,{rows=[record()],api=()=>assert.fail('No upload initiated')}={}) {
  const previousDocument=globalThis.document,previousFormData=globalThis.FormData;
  t.after(()=>{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousFormData===undefined)delete globalThis.FormData;else globalThis.FormData=previousFormData;});
  const root=new Node(),nodes=new Map(),messages=[],delegated=[],stats={writes:0,closed:0,updates:0};let records=structuredClone(rows),form=null,gate=null,failure=null,modalHTML='';
  globalThis.document={querySelector(selector){if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);}};
  globalThis.FormData=class{constructor(value){this.values=value.values;}get(key){return this.values[key]??null;}};
  const workspace=createApprovalWorkspace({escape:escapeHtml,icon:()=>'',toast:message=>messages.push(message),getRecords:()=>records,openRecord:id=>delegated.push(id),api,openModal(html){if(form)form.isConnected=false;modalHTML=html;const formId=html.match(/<form id="([^"]+)"/)?.[1];form=new Node();nodes.set(`#${formId}`,form);},closeModal(){stats.closed++;if(form)form.isConnected=false;},onUpdate(){stats.updates++;},async saveRecordChange(mutator){stats.writes++;const pending=gate,error=failure;gate=null;failure=null;if(pending)await pending;if(error)throw Error(error);const result=mutator(structuredClone(records));records=result.records;return {...result,records};}});
  workspace.render(root);
  return {workspace,root,messages,delegated,stats,get rows(){return records;},get form(){return form;},get modalHTML(){return modalHTML;},open(){workspace.openRecord(records[0].id);},submit(values){form.values=values;return form.onsubmit({preventDefault(){},target:form});},attachmentNode(){return [...nodes.get('#supplement-attachments').nodes.values()].find(node=>node.events.has('change'));},hold(){let resolve;gate=new Promise(done=>resolve=done);return resolve;},fail(message='服务器暂时不可用'){failure=message;},remote(mutator){mutator(records);},messageButton(id){return root.querySelectorAll('[data-message-id]').find(button=>button.dataset.messageId===id);}};
}

const reviewValues={checked:'on',reviewer:'医务处审核人',decision:'return','review-note':'请补充出院小结并核对交接材料'};

test('医务审核退回→补充→重提保持申请编号、原附件和审核历史',async t=>{
  const h=harness(t);h.open();assert.match(h.modalHTML,/SOURCE-001/);assert.match(h.modalHTML,/检查报告\.pdf/);assert.doesNotMatch(h.modalHTML,/医保|insurance-/);
  await h.submit(reviewValues);assert.equal(h.rows[0].status,'returned');assert.equal(h.rows[0].events.length,2);assert.equal(h.stats.closed,1);
  h.open();assert.match(h.modalHTML,/补充转诊资料/);assert.doesNotMatch(h.modalHTML,/医保|insurance-/);await h.submit({text:'冠心病治疗后需诊疗评估；已补充出院小结。'});
  assert.equal(h.rows[0].id,'AZ-APPROVAL-1');assert.equal(h.rows[0].status,'review');assert.equal(h.rows[0].approval.status,'pending');assert.equal(h.rows[0].events.length,3);assert.equal(h.rows[0].attachments[0].id,attachment.id);assert.match(h.rows[0].snapshot.text,/已补充/);assert.equal(h.rows[0].notifications.filter(n=>n.channel==='in_app'&&n.status==='unread').length,1);
});

test('审核提交期间防重复，确认失败保留表单和附件再重试',async t=>{
  const h=harness(t);h.open();const resolve=h.hold();h.fail();const task=h.submit(reviewValues);const form=h.form;
  assert.equal(form.querySelector('[type=submit]').disabled,true);await h.submit(reviewValues);assert.equal(h.stats.writes,1);
  resolve();await task;assert.equal(h.stats.closed,0);assert.equal(h.form,form);assert.equal(form.isConnected,true);assert.deepEqual(form.values,reviewValues);assert.equal(h.rows[0].status,'review');assert.equal(h.rows[0].attachments.length,1);assert.equal(form.querySelector('[type=submit]').disabled,false);assert.match(h.messages.at(-1),/服务器/);
  await h.submit(reviewValues);assert.equal(h.rows[0].status,'returned');assert.equal(h.stats.closed,1);
});

test('未确认核对不写入，另一协作页面先审核后阻止旧表单覆盖',async t=>{
  const h=harness(t);h.open();await h.submit({...reviewValues,checked:null});assert.equal(h.stats.writes,0);
  h.remote(records=>{records[0].status='pending';records[0].approval={status:'approved',reviewer:'另一审核人',note:'已审核',at:new Date().toISOString()};});
  await h.submit(reviewValues);assert.equal(h.rows[0].status,'pending');assert.equal(h.rows[0].approval.reviewer,'另一审核人');assert.equal(h.stats.closed,0);assert.match(h.messages.at(-1),/状态已变化/);
});

test('通过审核生成接诊站内消息，短信微信仅保留待接入状态',async t=>{
  const h=harness(t);h.open();await h.submit({...reviewValues,decision:'approve','review-note':'转诊资料已复核，接收安排待院方确认'});
  assert.equal(h.rows[0].status,'pending');assert.equal(Object.hasOwn(h.rows[0],'insurance'),false);assert.equal(h.workspace.count(),0);assert.equal(h.workspace.unreadCount(),1);
  h.workspace.renderNotifications(h.root);assert.match(h.root.innerHTML,/通道待接入 · 未发送/);assert.match(h.root.innerHTML,/接诊医生/);
  const notice=h.rows[0].notifications.find(item=>item.channel==='in_app'&&item.status==='unread');await h.messageButton(notice.id).onclick();
  assert.equal(h.workspace.unreadCount(),0);assert.deepEqual(h.delegated,['AZ-APPROVAL-1']);assert.ok(h.rows[0].notifications.filter(n=>n.channel!=='in_app').every(n=>n.status==='not_configured'));
});

test('全部已读只更新站内消息；保存失败不伪造已读状态',async t=>{
  const second=record();second.id='AZ-APPROVAL-2';second.notifications=referralNotifications(second,'review',second.createdAt);const h=harness(t,{rows:[record(),second]});h.workspace.renderNotifications(h.root);
  assert.equal(h.workspace.unreadCount(),2);h.fail();h.root.querySelector('#messages-read-all').onclick();await flush();assert.equal(h.workspace.unreadCount(),2);assert.match(h.messages.at(-1),/服务器/);
  h.root.querySelector('#messages-read-all').onclick();await flush();assert.equal(h.workspace.unreadCount(),0);assert.ok(h.rows.flatMap(row=>row.notifications).filter(n=>n.channel==='in_app').every(n=>n.readAt));assert.ok(h.rows.flatMap(row=>row.notifications).filter(n=>n.channel!=='in_app').every(n=>n.status==='not_configured'));
});

test('补充保存等待中打开另一患者，不串入对方附件或关闭新表单',async t=>{
  const first=record(),second=record();
  first.status=second.status='returned';first.approval.status=second.approval.status='returned';second.id='AZ-APPROVAL-2';second.snapshot.patient.name='陈女士';second.attachments=[{...attachment,id:'95ac47d0-0152-4793-afc2-0bbe6ef7b894',url:'/api/attachments/95ac47d0-0152-4793-afc2-0bbe6ef7b894',name:'另一患者.pdf'}];
  const h=harness(t,{rows:[first,second]});h.open();const resolve=h.hold(),task=h.submit({text:'首位患者的诊疗资料已补充完成。'});
  h.workspace.openRecord(second.id);const secondForm=h.form;secondForm.values.text='另一患者仍在编辑的内容';resolve();await task;
  assert.equal(h.rows[0].attachments[0].id,first.attachments[0].id);assert.equal(h.rows[1].status,'returned');assert.equal(secondForm.isConnected,true);assert.equal(secondForm.values.text,'另一患者仍在编辑的内容');
});

test('审核保存的迟到响应不关闭后来打开的患者表单',async t=>{
  const second=record();second.id='AZ-APPROVAL-2';const h=harness(t,{rows:[record(),second]});h.open();const resolve=h.hold(),task=h.submit(reviewValues);
  h.workspace.openRecord(second.id);const secondForm=h.form;resolve();await task;assert.equal(h.rows[0].status,'returned');assert.equal(secondForm.isConnected,true);
});

test('关闭补充窗口清理上传监听，迟到上传结果不进入重开的患者草稿',async t=>{
  const row=record();row.status='returned';row.approval.status='returned';let resolveUpload;
  const h=harness(t,{rows:[row],api:()=>new Promise(resolve=>resolveUpload=resolve)});h.open();const uploadRoot=h.attachmentNode();
  const task=uploadRoot.events.get('change')({target:{matches:selector=>selector==='[data-attachment-input]',value:'file',files:[{name:'补充.pdf',type:'application/pdf',size:5,arrayBuffer:async()=>new TextEncoder().encode('%PDF-').buffer}]}});await flush();
  h.workspace.onModalClose();h.form.isConnected=false;assert.equal(uploadRoot.events.has('change'),false);h.open();
  resolveUpload({...attachment,id:'ee861fcc-3d87-4a62-b8d3-8fcda7af7805',url:'/api/attachments/ee861fcc-3d87-4a62-b8d3-8fcda7af7805',name:'补充.pdf',size:5});await task;
  await h.submit({text:'病例已核对，准备重新提交审核。'});assert.equal(h.rows[0].attachments.length,1);assert.equal(h.rows[0].attachments[0].id,attachment.id);
});

test('历史附加字段不展示也不阻碍审核，保存时原样保留',async t=>{
 const row=record();row.insurance={type:'legacy-type',settlement:'legacy-status',materialStatus:'legacy-materials',note:'historical note'};
 const h=harness(t,{rows:[row]});h.open();assert.doesNotMatch(h.modalHTML,/legacy-|historical note|insurance-/);
 await h.submit({...reviewValues,decision:'approve','review-note':'转诊信息与交接资料已复核'});
 assert.equal(h.rows[0].status,'pending');assert.deepEqual(h.rows[0].insurance,row.insurance);
});
