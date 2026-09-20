// Only confirmed server snapshots are published. Revision checks protect concurrent users.
export function createSharedWorkspace({request,onStatus=()=>{},timeoutMs=15000,maxAttempts=4}={}) {
  let snapshot=null,queue=Promise.resolve(),poll=null,refreshing=null,status='loading';
  const listeners=new Set();
  const copy=value=>structuredClone(value);
  function report(next){if(status!==next){status=next;onStatus(next);}}
  function publish(value){
    if(!value||!Number.isSafeInteger(value.revision)||!Array.isArray(value.records)||!Array.isArray(value.downward?.patients))throw Error('共享记录格式不完整，请联系管理员。');
    report('synced');
    if(snapshot&&value.revision<=snapshot.revision)return copy(snapshot);
    snapshot=copy(value);
    for(const listener of listeners){try{listener(copy(snapshot));}catch(error){console.error('共享记录显示更新失败',error);}}
    return copy(snapshot);
  }
  async function call(path,body){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await request(path,body,controller.signal);}
    catch(error){if(error?.status!==409)report('error');throw error;}
    finally{clearTimeout(timer);}
  }
  function serial(operation){const pending=queue.then(operation,operation);queue=pending.catch(()=>{});return pending;}
  async function refresh(){
    if(!refreshing)refreshing=call('/api/workspace').then(publish).finally(()=>{refreshing=null;});
    return refreshing;
  }
  function change(slice,mutator){return serial(async()=>{
    for(let attempt=0;attempt<maxAttempts;attempt++){
      const latest=publish(await call('/api/workspace'));
      const draft=copy(latest[slice]);
      const result=mutator(draft);
      const updated=slice==='records'?result.records:draft;
      try{
        const saved=publish(await call('/api/workspace/commit',{revision:latest.revision,[slice]:updated}));
        return slice==='records'?{...result,records:saved.records}:saved.downward;
      }catch(error){if(error?.code!=='WORKSPACE_CONFLICT'||attempt===maxAttempts-1)throw error;}
    }
  });}
  return {
    isShared:true,
    getSnapshot(){if(!snapshot)throw Error('共享记录尚未加载完成。');return copy(snapshot);},
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    refresh,
    importLegacy(payload){return serial(async()=>publish(await call('/api/workspace/import',payload)));},
    updateRecords(mutator){return change('records',mutator);},
    updateDownward(mutator){return change('downward',mutator);},
    startPolling(interval=5000){if(!poll)poll=setInterval(()=>{void refresh().catch(()=>{});},interval);},
    stop(){clearInterval(poll);poll=null;},
  };
}

export async function migrateLegacyWorkspace({workspace,storage,parseRecords,recordKey,markerKey='anzhen-shared-migration-v1'}) {
  let rawRecords,rawDownward;
  try {
    if(storage.getItem(markerKey)==='complete')return false;
    rawRecords=storage.getItem(recordKey);
    rawDownward=storage.getItem('anzhen-downward-workspace-v1');
  }catch{ return false; }
  const payload={};
  if(rawRecords){
    const original=JSON.parse(rawRecords),records=parseRecords(rawRecords);
    if(!Array.isArray(original)||original.length!==records.length)throw Error('原有转诊记录中存在无法读取的内容，请联系管理员迁移。');
    if(records.length)payload.records=records;
  }
  if(rawDownward){const downward=JSON.parse(rawDownward);if(downward?.version===1&&Array.isArray(downward.patients))payload.downward=downward;else throw Error('原有照护记录无法读取，请联系管理员迁移。');}
  if(Object.keys(payload).length)await workspace.importLegacy(payload);
  // Keep the original data untouched; a failed import never gets a completed marker.
  try{storage.setItem(markerKey,'complete');}catch{/* Import is idempotent if storage is unavailable. */}
  return Object.keys(payload).length>0;
}
