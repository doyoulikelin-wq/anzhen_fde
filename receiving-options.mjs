// Temporary coordination choices, not hospital inventory or live bed availability.
// Keep the returned labels independent from persistence so a future hospital feed
// can replace these lists without rewriting historical reception records.
const departments=['心血管内科','康复医学科','全科医学科'];
const locations={
  '心血管内科':['心血管内科病区','心血管门诊随访区'],
  '康复医学科':['康复住院病区','心脏康复治疗区','康复门诊随访区'],
  '全科医学科':['全科医学科病区','全科门诊随访区','社区护理服务区'],
};
const label=value=>typeof value==='string'?value.trim():'';

export function getReceivingDepartments(plan={}){
  return [...new Set([plan?.acceptedDepartment,plan?.department,...departments].map(label).filter(Boolean))];
}

export function getReceivingLocations(department){
  return [...(locations[label(department)]||['住院病区','门诊随访区','护理服务区'])];
}

export function getReceivingBeds(location){
  const place=label(location);
  if(/病区|病房|住院/.test(place))return ['待院方分配',...Array.from({length:6},(_,index)=>`${String(index+1).padStart(2,'0')}床`)];
  if(/门诊|随访|治疗区|服务区/.test(place))return ['无需床位'];
  return ['待院方分配'];
}

export function formatReceivingLocation(serviceLocation,bed){
  const place=label(serviceLocation),selectedBed=label(bed);
  if(!selectedBed||selectedBed==='无需床位')return place;
  if(!place)return selectedBed;
  if(place===selectedBed||place.split(/\s*[·，,、/|]\s*/).includes(selectedBed))return place;
  return `${place} · ${selectedBed}`;
}
