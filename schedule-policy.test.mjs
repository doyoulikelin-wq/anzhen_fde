import test from 'node:test';import assert from 'node:assert/strict';
import {currentSchedule,nextAppointment,sortCandidateDoctors} from './schedule-policy.mjs';
import {renderWorkingSchedule} from './shared-ui.mjs';
test('current-day scheduling disables elapsed sessions and crosses year boundaries',()=>{
 const now=new Date(2026,11,31,17,0),days=currentSchedule('doctor-a',now);
 assert.equal(days[0].date,'2026-12-31');assert.equal(days.at(-1).date,'2027-01-06');assert.ok(days[0].slots.every(s=>s.elapsed&&s.remaining===0));
 const next=nextAppointment('doctor-a',now);assert.ok(next.startsAt>now.getTime());
});
test('time sorting reorders only the supplied relevant candidates without changing AI scores',()=>{
 const candidates=Array.from({length:10},(_,i)=>({id:`doctor-${i}`,name:`医生${i}`,score:90-i})),now=new Date(2026,8,22,8);
 const sorted=sortCandidateDoctors(candidates,{order:'time',now});assert.equal(sorted.length,candidates.length);
 const times=sorted.map(d=>nextAppointment(d.id,now).startsAt);assert.deepEqual(times,[...times].sort((a,b)=>a-b));assert.deepEqual(candidates.map(d=>d.score),Array.from({length:10},(_,i)=>90-i));
});
test('intent count reflects workspace referrals without pretending to consume hospital slots',()=>{
 const now=new Date(2026,8,22,8),day=currentSchedule('doc',now)[0],slot=day.slots[0];
 const records=[{doctor:{id:'doc'},date:day.date,slotId:slot.id,status:'review'},{doctor:{id:'doc'},date:day.date,slotId:slot.id,status:'returned'}];
 const updated=currentSchedule('doc',now,records)[0].slots[0];assert.equal(updated.intents,1);assert.equal(updated.remaining,slot.remaining);
});
test('selectable schedule links buttons to exact slot IDs and marks selection',()=>{
 const now=new Date(2026,8,22,8),next=nextAppointment('doctor-a',now);const html=renderWorkingSchedule('doctor-a',{selectable:true,selectedSlotId:next.id,now});
 assert.ok(html.includes(`data-work-slot="${next.id}"`));assert.ok(html.includes('aria-pressed="true"'));assert.ok(html.includes('尚未连接院方挂号系统'));
 assert.ok(!renderWorkingSchedule('doctor-a',{now}).includes('data-work-slot'));
});
