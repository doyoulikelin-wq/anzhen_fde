import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_ATTACHMENT_BYTES,validateAttachmentFile,normalizeAttachment,renderAttachmentList,createAttachmentController} from './attachments.mjs';

const metadata={id:'att-test-1',name:'出院小结.png',type:'image/png',size:12,uploadedAt:'2026-09-22T08:00:00.000Z',url:'/api/attachments/att-test-1'};
const file=(overrides={})=>({name:'出院小结.png',type:'image/png',size:12,arrayBuffer:async()=>new Uint8Array(12).buffer,...overrides});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('附件严格校验类型、扩展名与单文件大小，DICOM 支持通用浏览器 MIME',()=>{
  assert.equal(validateAttachmentFile(file()).type,'image/png');
  assert.equal(validateAttachmentFile(file({name:'检查.DCM',type:'application/octet-stream'})).type,'application/dicom');
  assert.equal(validateAttachmentFile(file({name:'检查.pdf',type:''})).type,'application/pdf');
  for(const value of [file({size:0}),file({size:MAX_ATTACHMENT_BYTES+1}),file({name:'bad.svg',type:'image/svg+xml'}),file({name:'bad.html',type:'text/html'}),file({name:'bad.pdf',type:'image/png'}),file({name:'bad\nname.png'})])assert.throws(()=>validateAttachmentFile(value));
});

test('服务器附件元数据仅保留固定字段并拒绝外部或可执行链接',()=>{
  assert.deepEqual(normalizeAttachment({...metadata,secret:'unexpected'}),metadata);
  for(const url of ['https://example.com/x','//example.com/x','javascript:alert(1)','/api/attachments/../config','/api/attachments/id?redirect=1','/api/config'])assert.throws(()=>normalizeAttachment({...metadata,url}));
  assert.throws(()=>normalizeAttachment({...metadata,id:'<script>'}));
  assert.throws(()=>normalizeAttachment({...metadata,uploadedAt:'invalid'}));
});

test('附件预览转义名称，PDF 与 DICOM 只提供下载，不生成诊断或嵌入脚本',()=>{
  const html=renderAttachmentList([{...metadata,name:'<script>.png'},{...metadata,id:'pdf',name:'报告.pdf',type:'application/pdf',url:'/api/attachments/pdf'},{...metadata,id:'dcm',name:'影像.dcm',type:'application/dicom',url:'/api/attachments/dcm'}]);
  assert.match(html,/&lt;script&gt;\.png/);assert.doesNotMatch(html,/<script>/);assert.match(html,/下载附件/);assert.match(html,/DICOM 影像/);assert.doesNotMatch(html,/<iframe|<embed|<object/);
  assert.equal((html.match(/<img /g)||[]).length,1);
});

class Node {
  innerHTML='';events=new Map();isConnected=true;
  addEventListener(name,fn){this.events.set(name,fn);}
  removeEventListener(name){this.events.delete(name);}
  contains(){return true;}
  setAttribute(){}
}
function harness({api}={}) {
  const node=new Node(),changes=[],messages=[],calls=[];
  const controller=createAttachmentController({api:async(...args)=>{calls.push(args);return api?api(...args):metadata;},onChange:list=>changes.push({list,pending:controller.isPending()}),toast:message=>messages.push(message)});
  const container={querySelector:()=>node};controller.bind(container);
  return {controller,node,changes,messages,calls,choose:files=>node.events.get('change')({target:{files,value:'file',matches:selector=>selector==='[data-attachment-input]'}}),remove:id=>node.events.get('click')({target:{closest:()=>({dataset:{attachmentRemove:id}})}})};
}

test('上传只在选择后发生，待服务器返回再关联到草稿，重复绑定不叠加监听',async()=>{
  let acknowledge;const h=harness({api:()=>new Promise(resolve=>acknowledge=resolve)});
  assert.equal(h.calls.length,0);const task=h.choose([file()]);assert.equal(h.controller.isPending(),true);
  await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'/api/attachments');assert.deepEqual(Object.keys(h.calls[0][1]).sort(),['data','name','type']);assert.equal(h.controller.getAttachments().length,0);
  await h.choose([file()]);assert.equal(h.calls.length,1);
  acknowledge(metadata);await task;assert.equal(h.controller.isPending(),false);assert.equal(h.controller.getAttachments().length,1);
  h.remove(metadata.id);assert.equal(h.controller.getAttachments().length,0);assert.equal(h.calls.length,1);
});

test('上传失败保留已存在附件并可重试，不暴露服务错误细节',async()=>{
  const h=harness({api:()=>{throw Error('API_KEY secret vendor error');}});h.controller.setAttachments([metadata]);await h.choose([file({name:'新增.png'})]);
  assert.deepEqual(h.controller.getAttachments(),[metadata]);assert.equal(h.controller.isPending(),false);assert.match(h.node.innerHTML,/上传未完成/);assert.doesNotMatch(h.node.innerHTML,/API_KEY|secret/);
  await h.choose([file({name:'新增.png'})]);assert.equal(h.calls.length,2);
});

test('附件草稿清空后，旧上传响应不能附加到另一个患者',async()=>{
  let acknowledge;const h=harness({api:()=>new Promise(resolve=>acknowledge=resolve)});
  const task=h.choose([file()]);await flush();h.controller.clear();acknowledge(metadata);await task;
  assert.deepEqual(h.controller.getAttachments(),[]);assert.equal(h.controller.isPending(),false);
});

test('超出 10 个、错误文件或离线状态不发送请求',async()=>{
  const h=harness();await h.choose(Array.from({length:11},()=>file()));assert.equal(h.calls.length,0);
  await h.choose([file({size:MAX_ATTACHMENT_BYTES+1})]);assert.equal(h.calls.length,0);
  const offline=createAttachmentController({offline:true,api:()=>assert.fail('offline upload')});const node=new Node();offline.bind({querySelector:()=>node});await node.events.get('change')({target:{matches:()=>true,files:[file()]}});assert.equal(offline.isPending(),false);
});
