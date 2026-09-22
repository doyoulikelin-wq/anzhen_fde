import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAttachmentStore,ATTACHMENT_FILE_LIMIT} from './attachment-store.mjs';
import {createAppServer} from './server.mjs';

const pdf=Buffer.from('%PDF-1.7\n% Synthetic attachment for automated testing only\n%%EOF\n');
const uploadBody=(bytes=pdf,name='心电检查报告.pdf',type='application/pdf')=>({name,type,data:bytes.toString('base64')});
async function setup(t,options={}){const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'anzhen-attachment-test-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));return {dataDir,store:await createAttachmentStore({dataDir,...options})};}
const failure=code=>error=>error.code===code;

test('attachments persist private bytes and metadata across independent store instances',async t=>{
  const {store,dataDir}=await setup(t),metadata=await store.upload(uploadBody());
  assert.equal(metadata.name,'心电检查报告.pdf');assert.equal(metadata.type,'application/pdf');assert.equal(metadata.size,pdf.length);assert.equal(metadata.url,`/api/attachments/${metadata.id}`);assert.equal(metadata.sha256,undefined);
  const reopened=await createAttachmentStore({dataDir});const read=await reopened.download(metadata.id);assert.deepEqual(read.metadata,metadata);assert.deepEqual(read.bytes,pdf);await reopened.verify(metadata);
  assert.equal((await fs.stat(path.join(dataDir,'attachments'))).mode&0o777,0o700);
  for(const extension of ['bin','json'])assert.equal((await fs.stat(path.join(dataDir,'attachments',`${metadata.id}.${extension}`))).mode&0o777,0o600);
});

test('upload accepts documented clinical image formats and refuses spoofed or active files',async t=>{
  const {store}=await setup(t);
  const dicom=Buffer.alloc(160);dicom.write('DICM',128);const webp=Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ','binary');
  const samples=[[Buffer.from([137,80,78,71,13,10,26,10]),'截图.png','image/png'],[Buffer.from([255,216,255,217]),'影像.jpeg','image/jpeg'],[webp,'记录.webp','image/webp'],[dicom,'CT.dcm','application/octet-stream']];
  for(const [bytes,name,type]of samples){const uploaded=await store.upload(uploadBody(bytes,name,type));assert.deepEqual((await store.download(uploaded.id)).bytes,bytes);if(name.endsWith('.dcm'))assert.equal(uploaded.type,'application/dicom');}
  for(const body of [uploadBody(Buffer.from('<script>alert(1)</script>'),'报告.pdf'),uploadBody(pdf,'页面.html','text/html'),uploadBody(pdf,'伪造.png','image/png'),uploadBody(pdf,'../报告.pdf'),uploadBody(pdf,'报告\r\n.pdf'),uploadBody(pdf,'报告.pdf','image/png'),{...uploadBody(),data:'data:application/pdf;base64,'+pdf.toString('base64')},{...uploadBody(),data:'????'},uploadBody(Buffer.alloc(140),'无文件头.dcm','application/dicom')])await assert.rejects(store.upload(body),failure('INVALID_ATTACHMENT'));
});

test('five-MiB limit is enforced without crashing on large base64 input',async t=>{
  const {store}=await setup(t);const bytes=Buffer.alloc(ATTACHMENT_FILE_LIMIT,32);bytes.write('%PDF-1.7');
  const uploaded=await store.upload(uploadBody(bytes));assert.equal(uploaded.size,ATTACHMENT_FILE_LIMIT);
  await assert.rejects(store.upload(uploadBody(Buffer.concat([bytes,Buffer.from('x')]))),failure('INVALID_ATTACHMENT'));
});

test('references must match real stored metadata and corrupted bytes are not downloaded',async t=>{
  const {store,dataDir}=await setup(t),metadata=await store.upload(uploadBody());
  for(const reference of [{...metadata,name:'替换.pdf'},{...metadata,size:42},{...metadata,url:'https://other.invalid/file'},{...metadata,id:'01234567-1234-4321-8234-123456789012'}])await assert.rejects(store.verify(reference),failure('INVALID_ATTACHMENT_REFERENCE'));
  for(const id of ['../../.env','%2e%2e','unknown','01234567-1234-4321-8234-123456789012'])await assert.rejects(store.download(id),failure('ATTACHMENT_NOT_FOUND'));
  await fs.writeFile(path.join(dataDir,'attachments',`${metadata.id}.bin`),Buffer.alloc(pdf.length));await assert.rejects(store.download(metadata.id),failure('ATTACHMENT_NOT_FOUND'));
});

test('disk failures never acknowledge a successful upload',async t=>{
  const fsImpl={...fs,open:async()=>{throw Object.assign(Error('injected failure'),{code:'ENOSPC'});}};
  const {store,dataDir}=await setup(t,{fsImpl});await assert.rejects(store.upload(uploadBody()),failure('ATTACHMENT_UNAVAILABLE'));assert.deepEqual(await fs.readdir(path.join(dataDir,'attachments')),[]);
});

test('HTTP attachment endpoints and workspace references enforce source, metadata and download boundaries',async t=>{
  const {dataDir}=await setup(t);const config={apiKey:'test-only-key',baseURL:'https://api.moonshot.cn/v1',model:'kimi-k3',effort:'low',port:4173,timeoutMs:1000};
  const server=await createAppServer({config,dataDir,fetchImpl:()=>{throw Error('No model calls in storage tests');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const base=`http://127.0.0.1:${server.address().port}`,post=(endpoint,body,headers={})=>fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const uploaded=await post('/api/attachments',uploadBody());assert.equal(uploaded.status,201);const metadata=await uploaded.json();
  const download=await fetch(base+metadata.url);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/pdf');assert.equal(download.headers.get('x-content-type-options'),'nosniff');assert.match(download.headers.get('content-disposition'),/^attachment;/);assert.match(download.headers.get('content-disposition'),/filename\*=UTF-8''/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
  assert.equal((await post('/api/attachments',uploadBody(),{Origin:'https://evil.invalid'})).status,403);
  for(const url of ['/attachments/'+metadata.id+'.bin','/var/attachments/'+metadata.id+'.json','/attachment-store.mjs','/api/attachments/not-a-uuid'])assert.equal((await fetch(base+url)).status,404);
  const doctors=JSON.parse(await fs.readFile(new URL('./data/doctors.json',import.meta.url),'utf8')),d=doctors.find(d=>d.photo);
  const row={id:'AZ-ATTACHMENT-HTTP',doctor:{id:d.id,name:d.name,department:d.department},snapshot:{text:'虚构测试病例：需要进一步专科检查。',patient:{name:'测试患者',sex:'男',age:60},sourceHospital:'测试医院',sourceDoctor:'测试医生'},date:'2026-09-22',slotId:'2026-09-22-am',session:'上午',time:'09:00–11:00',createdAt:'2026-09-22T00:00:00Z',status:'review',approval:{status:'pending',reviewer:'',note:''},events:[{label:'提交院内审核',at:'2026-09-22T00:00:00Z'}],attachments:[metadata]};
  assert.equal((await post('/api/workspace/commit',{revision:0,records:[row]})).status,200);
  const corrupted=structuredClone(row);corrupted.attachments[0].name='篡改.pdf';const refused=await post('/api/workspace/commit',{revision:1,records:[corrupted]});assert.equal(refused.status,400);assert.equal((await refused.json()).error.code,'INVALID_ATTACHMENT_REFERENCE');
  const shared=await (await fetch(base+'/api/workspace')).json();assert.equal(shared.records[0].attachments[0].name,metadata.name);
});
