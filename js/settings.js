/* =========================================================
설정 (app_settings 테이블, [설정] 탭에서 수정)
· year  : 학년도 (3월 ~ 다음 해 2월)
· semester : 학기 (1 또는 2) — 진도 · 수행평가 자료를 학기마다 구분
· dday  : 상단 D-day 날짜와 문구
· theme : 화면 테마
· bell  : 학교별 시정표 { 학교: {start, len, brk, lunchAfter, lunch, midAfter, mid} }
· neis_schools : 나이스 학교 연결 { 학교: {atpt, code, name, office} }
· meal_days : 요일별 급식 { '1'~'5': {mode: auto|off|school, school: {atpt, code, name, office}} }
========================================================= */
const THEMES = [
{ id: 'violet', name: '기본 (보라)', colors: ['#4f46e5', '#7c3aed', '#db2777'] },
{ id: 'ocean', name: '바다', colors: ['#0284c7', '#0891b2', '#14b8a6'] },
{ id: 'forest', name: '숲', colors: ['#059669', '#16a34a', '#84cc16'] },
{ id: 'sunset', name: '노을', colors: ['#ea580c', '#e11d48', '#f59e0b'] },
{ id: 'mono', name: '모노', colors: ['#334155', '#0f172a', '#64748b'] },
{ id: 'flat', name: '단색 (깔끔)', colors: ['#2457d6'], swatch: 'linear-gradient(90deg,#f4f6f9 0 34%,#2457d6 34% 67%,#1f2a44 67%)' }
];
let settings = { year: 0, semester: 0, dday: { date: '2027-01-08', label: '겨울방학까지' }, theme: 'violet', bell: {}, neis: {}, mealDays: {} };

let state = {
view: 'dash',
date: '',
today: '',
schools: [],
currentRecords: [],
editingRow: null,
modeView: { dash: 'dash', prog: 'day', eval: 'etask', seat: 'seat', pick: 'pick', set: 'settings' }
};

/* [성능] 뷰별 응답 캐시 (같은 날짜를 다시 볼 때 서버 왕복 생략)
   - key: 'day|2026-01-01', 'week|2026-01-01', 'cal|2026-1', 'hol'
   - 저장/수정/삭제 시 clearViewCache()로 통째로 비움 */
let viewCache = {};
function clearViewCache(){ viewCache = {}; lib.loaded = false; } // 진도 기록이 바뀌면 자료 사용 내역도 다시 읽음

/* 공통 유틸 */
function toast(msg, type){
const el = document.getElementById('toast');
el.className = 'toast show ' + (type||'');
el.textContent = msg;
setTimeout(function(){ el.className='toast '+(type||''); }, 1800);
}
function fmt(d){ return d.getFullYear() + '-' + ('0'+(d.getMonth()+1)).slice(-2) + '-' + ('0'+d.getDate()).slice(-2); }
function parseD(s){ return new Date(s + 'T00:00:00'); }
function dowLabel(d){ return ['일','월','화','수','목','금','토'][d.getDay()]; }
function prettyDay(s){
const d = parseD(s);
return ('0'+(d.getMonth()+1)).slice(-2) + '월 ' + ('0'+d.getDate()).slice(-2) + '일 (' + dowLabel(d) + ')';
}
function prettyLong(s){
const d = parseD(s);
return d.getFullYear() + '년 ' + ('0'+(d.getMonth()+1)).slice(-2) + '월 ' + ('0'+d.getDate()).slice(-2) + '일 (' + dowLabel(d) + ')';
}
function weekRangeMonFri(s){
const d = parseD(s); const dow = d.getDay();
const diffToMon = (dow === 0) ? -6 : (1 - dow);
const mon = new Date(d); mon.setDate(d.getDate() + diffToMon);
const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
return { start: fmt(mon), end: fmt(fri) };
}
function monthRange(s){
const d = parseD(s);
const start = new Date(d.getFullYear(), d.getMonth(), 1);
const end = new Date(d.getFullYear(), d.getMonth()+1, 0);
return { start: fmt(start), end: fmt(end) };
}
function daysBetween(a, b){
return Math.round((parseD(a).getTime() - parseD(b).getTime()) / (24*3600*1000));
}
function hashHue(s){
s = String(s||''); let h = 0;
for (let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i)) >>> 0;
return h % 360;
}
function schoolStyle(name){
const h = hashHue(name);
return 'background:hsl('+h+',75%,92%);color:hsl('+h+',55%,28%);border-color:hsl('+h+',60%,80%);';
}
function chip(name){
if(!name) return '';
return '<span class="school-chip" style="'+schoolStyle(name)+'">'+esc(name)+'</span>';
}
function esc(s){
return String(s==null?'':s).replace(/[&<>"']/g, function(c){
return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
});
}
/* [신규] 로딩 표시 */
function showLoading(msg){
document.getElementById('viewerBody').innerHTML =
'<div class="skeleton"><span class="spinner"></span>'+esc(msg||'불러오는 중...')+'</div>';
}

/* D-day */
function updateDday(todayStr){
const el = document.getElementById('ddayBadge');
const d = settings.dday || {};
el.style.display = d.date ? '' : 'none';
if (!d.date) return;
const diff = daysBetween(d.date, todayStr);
const label = esc(d.label || '');
if (diff > 0) el.innerHTML = label + ' <b>D-' + diff + '</b>';
else if (diff === 0) el.innerHTML = label + ' <b>D-DAY</b>';
else el.innerHTML = label + ' <b>D+' + (-diff) + '</b>';
}

/* ---------- 학년도 : Y학년도 = Y-03-01 ~ (Y+1)-02 말일 ---------- */
function schoolYearOf(dateStr){
const d = parseD(dateStr);
return d.getMonth() >= 2 ? d.getFullYear() : d.getFullYear() - 1;
}
function yearRange(y){
return { start: y + '-03-01', end: fmt(new Date(y + 1, 2, 0)) };
}
/* ---------- 학기 : 1학기 = 3월 1일 ~ 8월 15일, 2학기 = 8월 16일 ~ 다음 해 2월 말일 ---------- */
function semesterOf(dateStr){
const d = parseD(dateStr), m = d.getMonth() + 1;
return (m >= 3 && m <= 7) || (m === 8 && d.getDate() <= 15) ? 1 : 2;
}
function semesterRange(y, sem){
return sem === 1 ? { start: y + '-03-01', end: y + '-08-15' }
: { start: y + '-08-16', end: fmt(new Date(y + 1, 2, 0)) };
}
function isCurrentTerm(){
return schoolYearOf(state.today) === settings.year && semesterOf(state.today) === settings.semester;
}
function termLabel(){ return settings.year + '학년도 ' + settings.semester + '학기'; }
function termKey(){ return settings.year + '-' + settings.semester; }
// 학년도 · 학기를 바꿨을 때 처음 보여줄 날짜 : 오늘이 그 학기면 오늘, 아니면 1학기 3월 2일 · 2학기 8월 16일
function termDefaultDate(){
if (isCurrentTerm()) return state.today;
return settings.semester === 1 ? settings.year + '-03-02' : settings.year + '-08-16';
}

/* ---------- 설정 불러오기 · 저장 ---------- */
async function loadSettings(){
const rows = must(await sb.from('app_settings').select('key,value'));
rows.forEach(function(r){
if (r.key === 'school_year') settings.year = Number(r.value) || 0;
else if (r.key === 'semester') settings.semester = Number(r.value) === 1 ? 1 : (Number(r.value) === 2 ? 2 : 0);
else if (r.key === 'dday') settings.dday = r.value || {};
else if (r.key === 'theme') settings.theme = r.value || 'violet';
else if (r.key === 'bell') settings.bell = r.value || {};
else if (r.key === 'neis_schools') settings.neis = r.value || {};
else if (r.key === 'meal_days') settings.mealDays = r.value || {};
});
}
async function saveSetting(key, value){
must(await sb.from('app_settings').upsert({ key: key, value: value, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
}
function applyTheme(id){
const t = (id && id !== 'violet') ? id : '';
document.documentElement.dataset.theme = t;
try { localStorage.setItem('theme', t); } catch (e) {}
}
function applyYearLabels(){
document.getElementById('yearSub').textContent = termLabel();
document.getElementById('evYearLabel').textContent = termLabel() + ' ·';
}

/* 학교 목록 UI 갱신 (state.schools 기준) */
function applySchools(){
document.getElementById('schoolList').innerHTML =
state.schools.map(function(s){ return '<option value="'+esc(s)+'">'; }).join('');
const ss = document.getElementById('statSchool');
if (ss) ss.innerHTML = '<option value="">전체</option>' +
state.schools.map(function(s){ return '<option value="'+esc(s)+'">'+esc(s)+'</option>'; }).join('');
}

