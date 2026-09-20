import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedWorkspace,migrateLegacyWorkspace} from './shared-client.mjs';

const copy=value=>structuredClone(value);
const initial=()=>({revision:0,records:[],downward:{version:1,patients:[],plans:[],alerts:[]}});
function service(){
  let state=initial(),fail=false,conflicts=0,imports=0;
  const request=async(path,body)=>{
    await new Promise(resolve=>setImmediate(resolve));
    if(fail)throw Error('connection lost');
    if(path==='/api/workspace')return copy(state);
    if(path.endsWith('/import')){imports++;state={...state,...body,revision:state.revision+1};return copy(state);}
    if(body.revision!==state.revision){conflicts++;throw Object.assign(Error('stale'),{status:409,code:'WORKSPACE_CONFLICT'});}
    state={...state,...body,revision:state.revision+1};return copy(state);
  };
  return {request,get state(){return state;},get conflicts(){return conflicts;},get imports(){return imports;},set fail(v){fail=v;}};
}

test('independent clients concurrently add records without overwriting each other',async()=>{
  const api=service(),a=createSharedWorkspace({request:api.request}),b=createSharedWorkspace({request:api.request});
  await Promise.all([a.refresh(),b.refresh()]);
  const values=await Promise.all([a.updateRecords(records=>({records:[...records,{id:'a'}],recordId:'a'})),b.updateRecords(records=>({records:[...records,{id:'b'}],recordId:'b'}))]);
  assert.deepEqual(api.state.records.map(r=>r.id).sort(),['a','b']);assert.equal(api.conflicts,1);
  assert.equal(values[1].recordId,'b');await a.refresh();assert.deepEqual(a.getSnapshot(),b.getSnapshot());
});
test('concurrent upward and downward writes retain both slices and notify another reader',async()=>{
  const api=service(),a=createSharedWorkspace({request:api.request}),b=createSharedWorkspace({request:api.request});
  await Promise.all([a.refresh(),b.refresh()]);let notified;
  b.subscribe(snapshot=>{notified=snapshot;});
  await Promise.all([a.updateRecords(records=>({records:[...records,{id:'a'}]})),b.updateDownward(state=>{state.plans.push({id:'p'});})]);
  assert.equal(api.state.records.length,1);assert.equal(api.state.downward.plans.length,1);
  await b.refresh();assert.equal(notified.records.length,1);
});
test('failed save preserves the last confirmed snapshot and can be retried',async()=>{
  const api=service(),states=[],client=createSharedWorkspace({request:api.request,onStatus:s=>states.push(s)});
  await client.refresh();api.fail=true;
  await assert.rejects(client.updateRecords(records=>({records:[...records,{id:'a'}]})),/connection lost/);
  assert.equal(client.getSnapshot().records.length,0);assert.equal(states.at(-1),'error');
  api.fail=false;await client.updateRecords(records=>({records:[...records,{id:'a'}]}));assert.equal(states.at(-1),'synced');
});
test('an older poll response cannot undo a newer committed revision',async()=>{
  const api=service();let finishPoll,hold=false;
  const client=createSharedWorkspace({request:async(path,body)=>{
    if(hold&&path==='/api/workspace'){hold=false;const old=copy(api.state);return new Promise(resolve=>{finishPoll=()=>resolve(old);});}
    return api.request(path,body);
  }});
  await client.refresh();hold=true;const polling=client.refresh();
  await client.updateRecords(records=>({records:[...records,{id:'new'}]}));finishPoll();await polling;
  assert.equal(client.getSnapshot().revision,1);assert.equal(client.getSnapshot().records[0].id,'new');
});
test('caller edits cannot mutate cached confirmed data',async()=>{
  const api=service(),client=createSharedWorkspace({request:api.request});await client.refresh();
  client.getSnapshot().records.push({id:'phantom'});assert.equal(client.getSnapshot().records.length,0);
});
test('legacy import marks completion only after server acknowledgement and retains backup',async()=>{
  const api=service(),client=createSharedWorkspace({request:api.request});await client.refresh();
  const saved=new Map([['old',JSON.stringify([{id:'legacy'}])],['anzhen-downward-workspace-v1',JSON.stringify(initial().downward)]]);
  const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
  const options={workspace:client,storage,parseRecords:JSON.parse,recordKey:'old'};
  api.fail=true;await assert.rejects(migrateLegacyWorkspace(options));assert.equal(saved.has('anzhen-shared-migration-v1'),false);
  api.fail=false;assert.equal(await migrateLegacyWorkspace(options),true);assert.equal(client.getSnapshot().records[0].id,'legacy');
  assert.equal(saved.get('old'),JSON.stringify([{id:'legacy'}]));assert.equal(await migrateLegacyWorkspace(options),false);assert.equal(api.imports,1);
});
test('empty browser reads server records without creating private local seed data',async()=>{
  const api=service(),a=createSharedWorkspace({request:api.request});await a.refresh();
  await a.updateRecords(records=>({records:[...records,{id:'server'}]}));
  const visitor=createSharedWorkspace({request:api.request});await visitor.refresh();
  await migrateLegacyWorkspace({workspace:visitor,storage:{getItem:()=>null,setItem:()=>{}},parseRecords:JSON.parse,recordKey:'old'});
  assert.equal(visitor.getSnapshot().records[0].id,'server');assert.equal(api.imports,0);
});
test('partially invalid legacy records never get silently skipped and marked imported',async()=>{
  const api=service(),client=createSharedWorkspace({request:api.request});await client.refresh();let marked=false;
  await assert.rejects(migrateLegacyWorkspace({workspace:client,recordKey:'old',parseRecords:()=>[{id:'valid'}],storage:{getItem:key=>key==='old'?'[{"id":"valid"},{"broken":true}]':null,setItem:()=>{marked=true;}}}),/无法读取/);
  assert.equal(marked,false);assert.equal(api.imports,0);
});
