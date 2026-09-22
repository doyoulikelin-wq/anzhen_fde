import {escapeHtml} from './shared-ui.mjs';

export const MAX_ATTACHMENT_BYTES=5*1024*1024;
export const MAX_ATTACHMENTS=10;
const types=new Set(['image/jpeg','image/png','image/webp','application/pdf','application/dicom']);
const extensionTypes={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',dcm:'application/dicom'};
let sequence=0;

export function validateAttachmentFile(file) {
  if(!file||typeof file.name!=='string'||!file.name.trim()||file.name.length>180||/[\u0000-\u001f\u007f/\\]/.test(file.name))throw Error('附件名称无效，请重新选择文件。');
  if(!Number.isInteger(file.size)||file.size<=0)throw Error('不能上传空文件。');
  if(file.size>MAX_ATTACHMENT_BYTES)throw Error('每个附件不超过 5 MB，请压缩或分开上传。');
  const extension=file.name.split('.').pop().toLowerCase();
  const inferred=extensionTypes[extension];
  const type=(!file.type||file.type==='application/octet-stream')?inferred:file.type;
  if(!types.has(type)||inferred!==type)throw Error('支持 JPG、PNG、WebP、PDF 和 DICOM（.dcm）文件。');
  return {name:file.name.trim(),type,size:file.size};
}

export function normalizeAttachment(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('附件信息无效。');
  const file=validateAttachmentFile(value);
  if(typeof value.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value.id))throw Error('附件编号无效。');
  if(typeof value.url!=='string'||!/^\/api\/attachments\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)?$/.test(value.url)||value.url.split('/').some(part=>part==='.'||part==='..'))throw Error('附件访问地址无效。');
  if(typeof value.uploadedAt!=='string'||!Number.isFinite(Date.parse(value.uploadedAt)))throw Error('附件上传时间无效。');
  return {...file,id:value.id,uploadedAt:value.uploadedAt,url:value.url};
}

export function formatAttachmentSize(bytes) {
  return bytes<1024*1024?`${Math.max(1,Math.ceil(bytes/1024))} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
}

export function renderAttachmentList(values,{escape=escapeHtml,removable=false,disabled=false}={}) {
  const list=Array.isArray(values)?values:[];
  return `<div class="attachment-list">${list.map(item=>{
    let file;try{file=normalizeAttachment(item);}catch{return '';}
    const image=file.type.startsWith('image/');
    return `<article class="attachment-item">${image?`<a class="attachment-preview" href="${escape(file.url)}" target="_blank" rel="noopener noreferrer" aria-label="查看${escape(file.name)}"><img src="${escape(file.url)}" alt="${escape(file.name)}" loading="lazy"></a>`:`<div class="attachment-file-icon" aria-hidden="true">${file.type==='application/pdf'?'PDF':'DCM'}</div>`}<div class="attachment-detail"><strong>${escape(file.name)}</strong><small>${formatAttachmentSize(file.size)} · ${image?'病历图片':file.type==='application/pdf'?'PDF 文档':'DICOM 影像'} · 已上传</small><a href="${escape(file.url)}" target="_blank" rel="noopener noreferrer" ${image?'':'download'}>${image?'查看原图':'下载附件'}</a></div>${removable?`<button type="button" class="attachment-remove" data-attachment-remove="${escape(file.id)}" aria-label="移除附件${escape(file.name)}" ${disabled?'disabled':''}>移除</button>`:''}</article>`;
  }).join('')}</div>`;
}

async function fileBase64(file) {
  const bytes=new Uint8Array(await file.arrayBuffer());
  let binary='';
  for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
}

export function createAttachmentController({api,onChange=()=>{},toast=()=>{},escape=escapeHtml,offline=false}={}) {
  const id=`attachment-editor-${++sequence}`;
  let attachments=[],pending=false,uploadName='',error='',root=null,generation=0;
  const snapshot=()=>attachments.map(item=>({...item}));
  const notify=()=>onChange(snapshot());
  function content() {
    return `<div class="attachment-heading"><strong>病历与影像附件</strong><span>${attachments.length} / ${MAX_ATTACHMENTS}</span></div>${renderAttachmentList(attachments,{escape,removable:true,disabled:pending})}<label class="attachment-upload ${pending||offline?'is-disabled':''}"><input type="file" data-attachment-input accept="image/jpeg,image/png,image/webp,application/pdf,application/dicom,.dcm" multiple ${pending||offline||attachments.length>=MAX_ATTACHMENTS?'disabled':''} aria-label="添加病历图片或影像附件"><span aria-hidden="true">＋</span><span>${pending?`正在上传 ${escape(uploadName)}…`:'添加病历图片 / 影像附件'}</span></label><p class="attachment-help">JPG、PNG、WebP、PDF、DICOM · 每个不超过 5 MB，最多 10 个。${offline?'离线页面暂不支持上传。':'附件随转诊资料供接收方查看；影像附件不自动生成诊断。'}</p>${error?`<p class="attachment-error" role="alert">${escape(error)}</p>`:''}<span class="sr-only" role="status">${pending?'正在上传附件，请稍候。':''}</span>`;
  }
  function refresh() {if(root){root.innerHTML=content();root.setAttribute('aria-busy',String(pending));}}
  function render() {return `<section class="attachment-editor" data-attachment-controller="${id}" aria-label="病历与影像附件" aria-busy="${pending}">${content()}</section>`;}
  function detach() {root?.removeEventListener('change',onFiles);root?.removeEventListener('click',onClick);root=null;}
  function bind(container) {
    detach();root=container?.matches?.(`[data-attachment-controller="${id}"]`)?container:container?.querySelector(`[data-attachment-controller="${id}"]`);
    root?.addEventListener('change',onFiles);root?.addEventListener('click',onClick);
  }
  function onClick(event) {
    const button=event.target.closest?.('[data-attachment-remove]');if(!button||!root?.contains(button)||pending)return;
    attachments=attachments.filter(file=>file.id!==button.dataset.attachmentRemove);error='';refresh();notify();
  }
  async function onFiles(event) {
    if(!event.target.matches?.('[data-attachment-input]')||pending||offline)return;
    const files=Array.from(event.target.files||[]);event.target.value='';
    if(!files.length)return;
    if(attachments.length+files.length>MAX_ATTACHMENTS){error='最多添加 10 个附件，请减少本次选择的文件。';refresh();toast(error);return;}
    try{files.forEach(validateAttachmentFile);}catch(failure){error=failure.message;refresh();toast(error);return;}
    const current=++generation;pending=true;error='';notify();refresh();
    const failures=[];
    try{
      for(const file of files){
        if(current!==generation)return;
        uploadName=file.name;refresh();
        try{
          const metadata=validateAttachmentFile(file),data=await fileBase64(file);
          if(current!==generation)return;
          const result=normalizeAttachment(await api('/api/attachments',{name:metadata.name,type:metadata.type,data}));
          if(current!==generation)return;
          if(!attachments.some(item=>item.id===result.id))attachments.push(result);
          notify();refresh();
        }catch{if(current!==generation)return;failures.push(file.name);}
      }
    }finally{
      if(current===generation){pending=false;uploadName='';error=failures.length?`${failures.join('、')} 上传未完成，已上传的附件已保留，请重新选择失败文件重试。`:'';refresh();notify();if(error)toast(error);}
    }
  }
  return {render,bind,getAttachments:snapshot,isPending:()=>pending,
    setAttachments(list) {const next=(list||[]).map(normalizeAttachment);if(next.length>MAX_ATTACHMENTS)throw Error('附件数量超过限制。');if(new Set(next.map(item=>item.id)).size!==next.length)throw Error('附件编号重复。');generation++;pending=false;uploadName='';error='';attachments=next;refresh();notify();},
    clear(){generation++;pending=false;uploadName='';error='';attachments=[];refresh();notify();},
    destroy(){generation++;pending=false;detach();}
  };
}
