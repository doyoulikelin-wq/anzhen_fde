import test from 'node:test';
import assert from 'node:assert/strict';
import {createDownwardSeed,validateMeasurement} from './downward.mjs';
const reading={date:'2026-09-20T14:30',sbp:'126',dbp:'78',heartRate:'74',spo2:'98',weight:'68.1',symptoms:' 暂无新发不适 '};
test('监测输入转为有限数值并保留录入日期',()=>{
  const value=validateMeasurement(reading);
  assert.equal(value.sbp,126);assert.equal(value.weight,68.1);assert.equal(value.date,reading.date);assert.equal(value.symptoms,'暂无新发不适');
});
test('空数值和非有限数值不能成为监测记录',()=>{
  for(const key of ['sbp','dbp','heartRate','spo2','weight'])for(const value of ['',null,'NaN','Infinity'])assert.throws(()=>validateMeasurement({...reading,[key]:value}));
});
test('明显无效的体征输入和颠倒血压被拦截',()=>{
  for(const change of [{sbp:301},{dbp:250},{heartRate:0},{spo2:101},{weight:-1},{sbp:80,dbp:100}])assert.throws(()=>validateMeasurement({...reading,...change}));
});
test('缺失或不可读日期被拦截',()=>{
  for(const date of ['','today','2026-13-01T09:00','2026-09-20'])assert.throws(()=>validateMeasurement({...reading,date}));
});
test('三位患者监测记录隔离，连续七日按日期保存',()=>{
  const state=createDownwardSeed();assert.equal(state.patients.length,3);assert.equal(new Set(state.patients.map(p=>p.id)).size,3);
  const measurementIds=state.patients.flatMap(p=>p.measurements.map(m=>m.id));assert.equal(new Set(measurementIds).size,21);
  for(const p of state.patients){assert.equal(p.measurements.length,7);for(let i=1;i<p.measurements.length;i++)assert.ok(p.measurements[i].date>p.measurements[i-1].date);for(const m of p.measurements)assert.doesNotThrow(()=>validateMeasurement(m));}
});
