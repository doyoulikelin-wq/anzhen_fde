import {buildSchedule} from './matching.mjs';
export function currentSchedule(doctorId,now=new Date(),records=[]){
 return buildSchedule(doctorId,now,{includeToday:true}).map(day=>({...day,slots:day.slots.map(slot=>({...slot,intents:records.filter(r=>r.doctor.id===doctorId&&r.date===day.date&&r.slotId===slot.id&&r.status!=='returned').length}))}));
}
export function nextAppointment(doctorId,now=new Date(),records=[]){
 for(const day of currentSchedule(doctorId,now,records))for(const slot of day.slots)if(slot.remaining>0&&!slot.elapsed)return {...slot,date:day.date,startsAt:new Date(`${day.date}T${slot.session==='上午'?'09:00':'14:00'}`).getTime()};
 return null;
}
export function sortCandidateDoctors(doctors,{order='score',onlyAvailable=false,now=new Date(),records=[]}={}) {
 const rows=doctors.map(d=>({doctor:d,next:nextAppointment(d.id,now,records),intents:records.filter(r=>r.doctor.id===d.id&&r.date>=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`&&r.status!=='returned').length}));
 return rows.filter(x=>!onlyAvailable||x.next).sort((a,b)=>{
   if(order==='time'){const delta=(a.next?.startsAt??Infinity)-(b.next?.startsAt??Infinity);if(delta&&!Number.isNaN(delta))return delta;}
   if(order==='intents'&&a.intents!==b.intents)return a.intents-b.intents;
   return b.doctor.score-a.doctor.score||a.doctor.name.localeCompare(b.doctor.name,'zh-CN');
 }).map(x=>x.doctor);
}
