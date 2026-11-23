/* =========================================================
   학교별 시정표 (app_settings 'bell')
   - 학교마다 1교시 시작 · 수업 · 쉬는 시간 · 점심 · 중간놀이로 교시 시간을 계산
========================================================= */
const BELL_DEFAULT = { start: '09:00', len: 40, brk: 10, lunchAfter: 4, lunch: 50, midAfter: 0, mid: 0 };
const BELL_MAX_PERIOD = 8;
function bellOf(school){
return Object.assign({}, BELL_DEFAULT, (settings.bell || {})[school] || {});
}
function hmToMin(t){
const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
return m ? Number(m[1]) * 60 + Number(m[2]) : 540;
}
function minToHm(m){ return ('0' + Math.floor(m / 60) % 24).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
// 교시별 [시작, 끝] (분) : 1 ~ BELL_MAX_PERIOD
function bellSlots(b){
const out = {};
let t = hmToMin(b.start);
const len = Math.max(1, Number(b.len) || 40);
for (let p = 1; p <= BELL_MAX_PERIOD; p++){
out[p] = { s: t, e: t + len };
let gap = Number(b.brk) || 0;
if (Number(b.lunchAfter) === p) gap = Number(b.lunch) || 0;
else if (Number(b.midAfter) === p) gap = Number(b.mid) || 0;
t = t + len + gap;
}
return out;
}
const _slotCache = {};
function slotOf(school, period){
const p = parseInt(period, 10);
if (!p || p < 1 || p > BELL_MAX_PERIOD) return null;
const key = school + '|' + JSON.stringify(bellOf(school));
if (!_slotCache[key]) _slotCache[key] = bellSlots(bellOf(school));
return _slotCache[key][p];
}
function bellSchoolNames(){
const set = {};
state.schools.forEach(function(s){ set[s] = true; });
Object.keys(settings.bell || {}).forEach(function(s){ set[s] = true; });
return Object.keys(set).sort();
}
function bellFormValue(){
function n(id){ const v = Number(document.getElementById(id).value); return isFinite(v) && v >= 0 ? Math.round(v) : 0; }
return {
start: document.getElementById('bellStart').value || BELL_DEFAULT.start,
len: Math.max(1, n('bellLen')), brk: n('bellBrk'),
lunchAfter: n('bellLunchAfter'), lunch: n('bellLunch'),
midAfter: n('bellMidAfter'), mid: n('bellMid')
};
}
function renderBellForm(){
const sel = document.getElementById('bellSchool');
const names = bellSchoolNames();
const prev = sel.value;
sel.innerHTML = names.length ? names.map(function(s){ return opt(s); }).join('') : '<option value="">(진도 자료에 학교가 없습니다)</option>';
if (names.indexOf(prev) >= 0) sel.value = prev;
const b = bellOf(sel.value);
document.getElementById('bellStart').value = b.start;
document.getElementById('bellLen').value = b.len;
document.getElementById('bellBrk').value = b.brk;
document.getElementById('bellLunchAfter').value = b.lunchAfter;
document.getElementById('bellLunch').value = b.lunch;
document.getElementById('bellMidAfter').value = b.midAfter;
document.getElementById('bellMid').value = b.mid;
renderBellPreview();
}
function renderBellPreview(){
const slots = bellSlots(bellFormValue());
let html = '';
for (let p = 1; p <= BELL_MAX_PERIOD; p++){
html += '<span class="badge" style="font-size:12px; padding:4px 10px">' + p + '교시 ' + minToHm(slots[p].s) + '~' + minToHm(slots[p].e) + '</span>';
}
document.getElementById('bellPreview').innerHTML = html;
}
async function saveBell(){
const school = document.getElementById('bellSchool').value;
if (!school){ toast('학교를 선택하세요.', 'err'); return; }
const next = Object.assign({}, settings.bell || {});
next[school] = bellFormValue();
try { await saveSetting('bell', next); }
catch (e) { toast(e.message, 'err'); return; }
settings.bell = next;
toast(school + ' 시정을 저장했습니다.', 'ok');
}

