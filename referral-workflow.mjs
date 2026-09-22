export const referralStatusLabel=status=>({review:'待医务审核',returned:'退回补充',pending:'待上级接收',accepted:'已登记待核实'}[status]||'待处理');

export function referralNotifications(record,stage,at=new Date().toISOString()) {
  const source=stage==='review',recipient=source?`${record.snapshot.sourceHospital} · 医务处 / 审核负责人`:`${record.doctor.name} · 接诊医生`;
  const title=source?'有转诊申请待医务审核':'有已通过医务审核的转诊申请待接收';
  return ['in_app','sms','wechat'].map(channel=>({id:`${record.id}-${stage}-${Date.parse(at)}-${channel}`,channel,status:channel==='in_app'?'unread':'not_configured',createdAt:at,title,recipient}));
}

export function reviewReferral(record,{decision,reviewer,note,at=new Date().toISOString()}) {
  if(record.status!=='review')throw Error('这份申请的审核状态已变化，请重新打开。');
  if(!['approve','return'].includes(decision))throw Error('请选择审核结果。');
  reviewer=String(reviewer||'').trim();note=String(note||'').trim();
  if(!reviewer||!note)throw Error('请填写审核人和审核意见。');
  if(reviewer.length>100||note.length>2000)throw Error('审核信息过长。');
  const approved=decision==='approve';
  return {...record,status:approved?'pending':'returned',
    approval:{status:approved?'approved':'returned',reviewer,note,at},
    events:[...record.events,{label:approved?`医务审核通过 · ${reviewer}；待上级接收`:`医务审核退回 · ${reviewer}：${note}`,at}],
    notifications:[...(record.notifications||[]).map(n=>n.channel==='in_app'&&n.status==='unread'?{...n,status:'read',readAt:at}:n),...(approved?referralNotifications(record,'receive',at):[{id:`${record.id}-returned-${Date.parse(at)}`,channel:'in_app',status:'unread',createdAt:at,title:'转诊申请已退回，请补充材料后重新提交',recipient:record.snapshot.sourceDoctor}])]};
}

export function resubmitReferral(record,{text,attachments=record.attachments||[],at=new Date().toISOString()}) {
  if(record.status!=='returned')throw Error('仅退回的申请可以补充后重新提交。');
  text=String(text||'').trim();if(!text||text.length>5000)throw Error('请填写不超过 5000 字的病例补充信息。');
  return {...record,status:'review',snapshot:{...record.snapshot,text},attachments,approval:{status:'pending',reviewer:'',note:''},events:[...record.events,{label:'已补充资料，重新提交医务审核',at}],notifications:[...(record.notifications||[]).map(n=>n.channel==='in_app'&&n.status==='unread'?{...n,status:'read',readAt:at}:n),...referralNotifications(record,'review',at)]};
}

export function listReferralNotifications(records){return records.flatMap(record=>(record.notifications||[]).map(item=>({...item,recordId:record.id,patient:record.snapshot.patient.name,urgent:record.snapshot.urgent}))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
