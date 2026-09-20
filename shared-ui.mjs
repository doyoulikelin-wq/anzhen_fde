import {buildSchedule} from './matching.mjs';

export function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function renderWorkingSchedule(doctorId) {
  const days=buildSchedule(doctorId);
  return `<section class="working-schedule" aria-label="医生工作时间"><div class="working-schedule-heading"><h3>工作时间</h3><span>近 7 日</span></div><div class="working-schedule-scroll"><table><caption>医生近七日工作时间与接诊意向</caption><thead><tr><th scope="col">日期</th><th scope="col">上午</th><th scope="col">下午</th></tr></thead><tbody>${days.map(day=>`<tr><th scope="row"><strong>${escapeHtml(day.monthDay)}</strong><small>${escapeHtml(day.weekday)}</small></th>${day.slots.map(slot=>`<td><span>${escapeHtml(slot.time)}</span><small class="${slot.remaining>0?'shift-open':'shift-check'}">${slot.remaining>0?'可登记意向':'需联系确认'}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="working-schedule-note">工作时间为预设安排，实际出诊与接诊请以院方确认为准。</p></section>`;
}
