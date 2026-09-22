import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {AppError} from './llm.mjs';

export const ATTACHMENT_FILE_LIMIT=5*1024*1024;
export const ATTACHMENT_BODY_LIMIT=8*1024*1024;
export const attachmentId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf','.dcm':'application/dicom'};
const invalid=()=>new AppError(400,'INVALID_ATTACHMENT','附件格式无效。请上传 PNG、JPEG、WebP、PDF 或带 DICOM 文件头的 DCM 文件，每份不超过 5 MB。');
const missing=()=>new AppError(404,'ATTACHMENT_NOT_FOUND','附件不存在或暂时无法读取。');
const fail=()=>new AppError(503,'ATTACHMENT_UNAVAILABLE','附件暂时无法保存，请稍后重试。');
const signature=(bytes,type)=>type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':type==='application/pdf'?bytes.toString('ascii',0,5)==='%PDF-':bytes.length>132&&bytes.toString('ascii',128,132)==='DICM';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const publicMetadata=({id,name,type,size,uploadedAt})=>({id,name,type,size,uploadedAt,url:`/api/attachments/${id}`});

export async function createAttachmentStore({dataDir,fsImpl=fs}={}){
  const directory=path.join(dataDir,'attachments');
  await fsImpl.mkdir(directory,{recursive:true,mode:0o700});
  async function atomic(file,bytes){const temporary=`${file}.${randomUUID()}.tmp`;let handle;try{handle=await fsImpl.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await fsImpl.rename(temporary,file);}finally{await handle?.close().catch(()=>{});await fsImpl.unlink(temporary).catch(()=>{});}}
  async function metadata(id){
    if(!attachmentId(id))throw missing();
    try{const value=JSON.parse(await fsImpl.readFile(path.join(directory,`${id}.json`),'utf8'));if(value.id!==id||!types[path.extname(value.name).toLowerCase()]||types[path.extname(value.name).toLowerCase()]!==value.type||!Number.isSafeInteger(value.size)||value.size<=0||value.size>ATTACHMENT_FILE_LIMIT||!/^\w{64}$/.test(value.sha256))throw Error();return value;}catch{throw missing();}
  }
  async function upload(body){
    if(!body||typeof body.name!=='string'||!body.name.trim()||body.name.length>180||/[\x00-\x1f\x7f/\\]/.test(body.name)||typeof body.type!=='string'||typeof body.data!=='string'||body.data.length>Math.ceil(ATTACHMENT_FILE_LIMIT/3)*4||body.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))throw invalid();
    const name=body.name.normalize('NFC').trim(),type=types[path.extname(name).toLowerCase()];
    if(!type||!(body.type===type||(type==='application/dicom'&&['','application/octet-stream'].includes(body.type))))throw invalid();
    const bytes=Buffer.from(body.data,'base64');
    if(bytes.length===0||bytes.length>ATTACHMENT_FILE_LIMIT||bytes.toString('base64')!==body.data||!signature(bytes,type))throw invalid();
    const id=randomUUID(),value={id,name,type,size:bytes.length,uploadedAt:new Date().toISOString(),sha256:digest(bytes)};
    try{await atomic(path.join(directory,`${id}.bin`),bytes);await atomic(path.join(directory,`${id}.json`),JSON.stringify(value));}catch{await fsImpl.unlink(path.join(directory,`${id}.bin`)).catch(()=>{});throw fail();}
    return publicMetadata(value);
  }
  async function download(id){const value=await metadata(id);try{const bytes=await fsImpl.readFile(path.join(directory,`${id}.bin`));if(bytes.length!==value.size||digest(bytes)!==value.sha256)throw Error();return {metadata:publicMetadata(value),bytes};}catch{throw missing();}}
  async function verify(reference){try{const value=await metadata(reference.id);const actual=publicMetadata(value);if(Object.keys(actual).some(key=>actual[key]!==reference[key]))throw Error();const stat=await fsImpl.stat(path.join(directory,`${reference.id}.bin`));if(!stat.isFile()||stat.size!==value.size)throw Error();}catch{throw new AppError(400,'INVALID_ATTACHMENT_REFERENCE','附件未完成上传或信息不一致，请重新上传。');}}
  return {upload,download,verify};
}
