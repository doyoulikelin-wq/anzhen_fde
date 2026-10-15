import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PARTNER_DOCTORS,PARTNER_HOSPITALS,filterPartnerDoctors,findDownwardDoctor} from './partner-roster.mjs';
import {createDownwardSeed} from './downward.mjs';
import {createWorkspaceValidator,createWorkspaceStore} from './workspace-store.mjs';

function planFor(d,index=0){return {id:`PARTNER-PLAN-${index}`,patientId:'patient-wang',doctorId:d.id,doctorName:d.name,hospital:d.hospital,department:d.department,campus:d.campus||'',service:'心脏康复',date:'2026-10-16',goal:'院方评估后衔接治疗及随访',handoff:'出院小结与后续计划',status:'pending',createdAt:'2026-10-15T09:00:00Z',updatedAt:'2026-10-15T09:00:00Z'};}

test('接收目录每位医生均关联医院、公开来源及可读取的真实照片资产',async()=>{
  assert.ok(PARTNER_DOCTORS.length>0);assert.equal(new Set(PARTNER_DOCTORS.map(d=>d.id)).size,PARTNER_DOCTORS.length);
  const hospitals=new Map(PARTNER_HOSPITALS.map(h=>[h.id,h]));
  for(const d of PARTNER_DOCTORS){
    assert.match(d.id,/^[a-zA-Z0-9][a-zA-Z0-9._:~-]*$/);assert.equal(hospitals.get(d.hospitalId)?.name,d.hospital,`${d.name} 医院归属`);
    for(const key of ['name','title','department','bio'])assert.ok(typeof d[key]==='string'&&d[key].trim(),`${d.id} ${key}`);
    // Public profiles may omit specialty details; keep this evidence gap instead of inventing expertise.
    assert.ok(Array.isArray(d.expertise)&&d.expertise.every(item=>typeof item==='string'&&item.trim().length>0));assert.ok(Array.isArray(d.sourceUrls)&&d.sourceUrls.length>0);
    for(const url of d.sourceUrls)assert.equal(new URL(url).protocol,'https:');
    assert.match(d.photo,/^assets\/partners\/[a-z0-9-]+\/[a-zA-Z0-9._-]+\.(?:png|jpe?g|webp)$/);
    const image=await fs.readFile(new URL(d.photo,import.meta.url));
    assert.ok(image.length>1000,`${d.name} 照片应为图片内容`);
    const isPng=image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const isJpeg=image[0]===255&&image[1]===216&&image[2]===255;
    const isWebp=image.toString('ascii',0,4)==='RIFF'&&image.toString('ascii',8,12)==='WEBP';
    assert.ok(isPng||isJpeg||isWebp,`${d.name} 照片不能是错误页面`);
  }
});

test('按医院和姓名查找接收医生，组合条件不串院且不显示历史虚构团队',()=>{
  const d=PARTNER_DOCTORS[0],other=PARTNER_DOCTORS.find(item=>item.hospitalId!==d.hospitalId);assert.ok(other);
  const hospitalMatches=filterPartnerDoctors({hospitalId:d.hospitalId});assert.ok(hospitalMatches.length>0);assert.ok(hospitalMatches.every(item=>item.hospitalId===d.hospitalId));
  assert.ok(filterPartnerDoctors({query:`  ${d.name}  `}).some(item=>item.id===d.id));
  assert.ok(filterPartnerDoctors({query:d.hospital}).some(item=>item.id===d.id));
  assert.ok(filterPartnerDoctors({hospitalId:d.hospitalId,query:d.name}).some(item=>item.id===d.id));
  assert.ok(!filterPartnerDoctors({hospitalId:other.hospitalId,query:d.name}).some(item=>item.id===d.id));
  assert.deepEqual(filterPartnerDoctors({query:'不存在的心血管医生ABC987'}),[]);
  for(const id of ['down-lincheng','down-zhouzhiyuan','down-guanning'])assert.ok(!filterPartnerDoctors().some(item=>item.id===id));
});

test('共享记录接受真实目录身份，拒绝篡改姓名、医院、科室、院区或未知医生ID',()=>{
  const validate=createWorkspaceValidator([]),d=PARTNER_DOCTORS[0],care=createDownwardSeed();care.plans.push(planFor(d));
  assert.doesNotThrow(()=>validate.downward(care));
  const withoutCampus=structuredClone(care);delete withoutCampus.plans[0].campus;assert.doesNotThrow(()=>validate.downward(withoutCampus));
  const other=PARTNER_DOCTORS.find(item=>item.hospitalId!==d.hospitalId);assert.ok(other);
  for(const patch of [{doctorName:'与目录不符的姓名'},{hospital:other.hospital},{department:'与目录不符的科室'},{campus:'与目录不符的院区'},{doctorId:'unknown-receiving-doctor'}]){
    const changed=structuredClone(care);Object.assign(changed.plans[0],patch);
    assert.throws(()=>validate.downward(changed),error=>error.code==='INVALID_WORKSPACE');
  }
});

test('三个历史团队的原有计划仍可保存、重启读取及登记接收',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'anzhen-partner-legacy-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  const legacyIds=['down-lincheng','down-zhouzhiyuan','down-guanning'];
  const store=await createWorkspaceStore({dataDir,doctors:[]});const initial=await store.read();
  initial.downward.plans=legacyIds.map((id,index)=>{const d=findDownwardDoctor(id);assert.ok(d);return planFor(d,index);});
  const saved=await store.commit({revision:initial.revision,downward:initial.downward});
  const reopened=await createWorkspaceStore({dataDir,doctors:[]});const reloaded=await reopened.read();assert.deepEqual(reloaded,saved);
  for(const plan of reloaded.downward.plans)Object.assign(plan,{status:'arranged',acceptedDepartment:plan.department,location:'历史计划接收地点',arrangement:'保留既有交接并继续随访',updatedAt:'2026-10-15T10:00:00Z'});
  const arranged=await reopened.commit({revision:reloaded.revision,downward:reloaded.downward});
  assert.equal(arranged.downward.plans.length,3);assert.ok(arranged.downward.plans.every(plan=>plan.status==='arranged'));
  assert.deepEqual(arranged.downward.plans.map(plan=>plan.doctorId).sort(),legacyIds.sort());
});
