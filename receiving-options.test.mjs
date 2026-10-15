import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getReceivingDepartments,getReceivingLocations,getReceivingBeds,formatReceivingLocation} from './receiving-options.mjs';
import {createWorkspaceStore,createWorkspaceValidator} from './workspace-store.mjs';
import {createDownwardSeed} from './downward.mjs';

const doctors=JSON.parse(await fs.readFile(new URL('./data/doctors.json',import.meta.url),'utf8'));
function arrangedPlan(patientId){
  return {id:'DOWN-RECEIVING-TEST',patientId,doctorId:'down-zhouzhiyuan',doctorName:'周知远',hospital:'青禾康复医院',department:'康复医学科',service:'心脏康复',date:'2026-10-16',goal:'延续康复服务',handoff:'核对交接记录',status:'arranged',createdAt:'2026-10-16T01:00:00Z',updatedAt:'2026-10-16T02:00:00Z',acceptedDepartment:'历史接收科室',location:'原有院区二层接待台',arrangement:'按交接计划记录监测结果'};
}

test('department choices retain historical and intended departments without duplicate defaults',()=>{
  const options=getReceivingDepartments({acceptedDepartment:'历史接收科室',department:'心血管内科'});
  assert.equal(options[0],'历史接收科室');
  assert.equal(options.filter(value=>value==='心血管内科').length,1);
  assert.ok(options.includes('康复医学科'));
  assert.ok(options.includes('全科医学科'));
  assert.ok(getReceivingDepartments().length>0);
});

test('changing from an inpatient ward to outpatient follow-up removes numbered bed choices',()=>{
  const choices=getReceivingLocations('心血管内科');
  const ward=choices.find(value=>value.includes('病区'));
  const outpatient=choices.find(value=>value.includes('随访'));
  assert.ok(ward&&outpatient);
  assert.equal(getReceivingBeds(ward)[0],'待院方分配');
  assert.ok(getReceivingBeds(ward).includes('01床'));
  assert.ok(getReceivingBeds(ward).includes('06床'));
  assert.deepEqual(getReceivingBeds(outpatient),['无需床位']);
  assert.deepEqual(getReceivingBeds('历史接待台'),['待院方分配']);
  // Callers can add a preserved historical option without changing future lists.
  choices.push('历史地点');
  assert.equal(getReceivingLocations('心血管内科').includes('历史地点'),false);
});

test('location display keeps legacy text and avoids redundant no-bed or duplicated labels',()=>{
  assert.equal(formatReceivingLocation('原有院区二层接待台',''),'原有院区二层接待台');
  assert.equal(formatReceivingLocation('门诊随访区','无需床位'),'门诊随访区');
  assert.equal(formatReceivingLocation('康复住院病区','待院方分配'),'康复住院病区 · 待院方分配');
  assert.equal(formatReceivingLocation('康复住院病区 · 01床','01床'),'康复住院病区 · 01床');
  assert.equal(formatReceivingLocation('01床','01床'),'01床');
});

test('legacy and structured receiving arrangements survive saves and reloads unchanged',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'anzhen-receiving-test-'));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  let store=await createWorkspaceStore({dataDir,doctors});
  const initial=await store.read(),downward=structuredClone(initial.downward);
  const legacy=arrangedPlan(downward.patients[0].id);
  const serviceLocation='地'.repeat(200),bed='床'.repeat(40);
  const structured={...arrangedPlan(downward.patients[1].id),id:'DOWN-STRUCTURED-TEST',acceptedDepartment:'康复医学科',serviceLocation,bed,location:formatReceivingLocation(serviceLocation,bed)};
  downward.plans.push(legacy,structured);
  const saved=await store.commit({revision:initial.revision,downward});
  assert.deepEqual(saved.downward.plans.find(plan=>plan.id===legacy.id),legacy);
  assert.deepEqual(saved.downward.plans.find(plan=>plan.id===structured.id),structured);
  store=await createWorkspaceStore({dataDir,doctors});
  assert.deepEqual(await store.read(),saved);
  const legacyReloaded=(await store.read()).downward.plans.find(plan=>plan.id===legacy.id);
  assert.equal(Object.hasOwn(legacyReloaded,'serviceLocation'),false);
  assert.equal(Object.hasOwn(legacyReloaded,'bed'),false);
});

test('invalid optional selection values fail validation without rewriting historical arrangements',()=>{
  const seed=createDownwardSeed(),validator=createWorkspaceValidator(doctors,seed);
  const original=structuredClone(seed);original.plans.push(arrangedPlan(original.patients[0].id));
  for(const fields of [{serviceLocation:123},{serviceLocation:null},{serviceLocation:''},{serviceLocation:'地'.repeat(201)},{bed:1},{bed:null},{bed:''},{bed:'床'.repeat(41)},{location:'地'.repeat(251)}]){
    const attempted=structuredClone(original);Object.assign(attempted.plans[0],fields);
    assert.throws(()=>validator.downward(attempted),error=>error.code==='INVALID_WORKSPACE');
  }
  const before=structuredClone(original);
  assert.equal(validator.downward(original),original);
  assert.deepEqual(original,before);
});
