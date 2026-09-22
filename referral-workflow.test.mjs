import test from 'node:test';import assert from 'node:assert/strict';
import {reviewReferral,resubmitReferral,referralNotifications,listReferralNotifications} from './referral-workflow.mjs';
const record=()=>({id:'AZ-TEST',status:'review',doctor:{name:'医生甲'},snapshot:{patient:{name:'示例患者'},sourceHospital:'协作医院',sourceDoctor:'医生乙',text:'原病例'},approval:{status:'pending',reviewer:'',note:''},events:[],notifications:[]});
test('source approval gates receiving and creates honest channel states',()=>{
 const r=record();r.notifications=referralNotifications(r,'review','2026-09-22T01:00:00Z');
 const result=reviewReferral(r,{decision:'approve',reviewer:'医务科',note:'已复核病例和交接材料',at:'2026-09-22T02:00:00Z'});
 assert.equal(Object.hasOwn(result,'insurance'),false);assert.equal(result.status,'pending');assert.equal(result.approval.status,'approved');assert.equal(result.notifications.filter(n=>n.channel==='in_app'&&n.status==='unread').length,1);
 assert.ok(result.notifications.filter(n=>n.channel!=='in_app').every(n=>n.status==='not_configured'));
});
test('return and resubmit retain history and supplemental attachments',()=>{
 const returned=reviewReferral(record(),{decision:'return',reviewer:'审核人',note:'请补充出院小结'});assert.equal(returned.status,'returned');
 const next=resubmitReferral(returned,{text:'原病例；已补充出院小结',attachments:[{id:'document'}]});assert.equal(next.status,'review');assert.equal(next.approval.status,'pending');assert.equal(next.events.length,2);assert.equal(next.attachments.length,1);
});
test('review refuses stale state, missing reviewer, missing note or invalid decision',()=>{
 for(const change of [{decision:'approve',reviewer:'',note:'核对'},{decision:'approve',reviewer:'甲',note:''}, {decision:'invalid',reviewer:'甲',note:'核对'}])assert.throws(()=>reviewReferral(record(),change));
 assert.throws(()=>reviewReferral({...record(),status:'pending'},{decision:'approve',reviewer:'甲',note:'核对'}));
});
test('notifications carry record links and pending external delivery never means sent',()=>{const r=record();r.notifications=referralNotifications(r,'review');const items=listReferralNotifications([r]);assert.equal(items.length,3);assert.ok(items.every(n=>n.recordId===r.id));assert.equal(items.filter(n=>n.status==='not_configured').length,2);});

test('legacy fields survive review, supplement and final approval without being requested',()=>{
 const original={...record(),insurance:{type:'legacy-type',settlement:'legacy-status',materialStatus:'legacy-materials',note:'historical note'}};
 const historical=structuredClone(original.insurance);
 const returned=reviewReferral(original,{decision:'return',reviewer:'审核人',note:'请补充出院小结'});
 const resubmitted=resubmitReferral(returned,{text:'已补充出院小结与交接资料。'});
 const approved=reviewReferral(resubmitted,{decision:'approve',reviewer:'审核人',note:'资料齐全'});
 for(const item of [original,returned,resubmitted,approved])assert.deepEqual(item.insurance,historical);
 assert.equal(approved.status,'pending');assert.equal(approved.events.length,3);
});
