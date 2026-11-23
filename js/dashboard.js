/* =========================================================
   대시보드
   - 오늘 근무학교 · 시계(현재 교시) · 미니 달력 · 주간 시간표
   - 나이스 학사일정 · 급식, 할 일, 수행평가 현황
========================================================= */
const dash = { week: '', month: '', todayRes: null, slots: [], timer: null, sched: [], schedTabs: [], schedFilter: '', schedMore: false, calEvents: {}, records: [], evalTasks: [], evalMore: false };
const DASH_SCHED_SHOW = 5, DASH_EVAL_SHOW = 3;
// 더보기 버튼 : 남은 개수 / 접기
function moreBtn(open, rest, fn){
return '<button type="button" class="more-btn" onclick="' + fn + '()">' + (open ? '접기 ▲' : '더보기 (' + rest + '개) ▼') + '</button>';
}
function dashThisWeek(){
// 주말에는 다음 주를 보여줌
const d = parseD(state.today), dow = d.getDay();
if (dow === 6) d.setDate(d.getDate() + 2);
else if (dow === 0) d.setDate(d.getDate() + 1);
return weekRangeMonFri(fmt(d)).start;
}
function dashMsg(html){ return '<div class="dash-msg">' + html + '</div>'; }
function dashErr(e){ return dashMsg('불러오지 못했습니다: ' + esc(e && e.message || e)); }
function schoolDot(name){ return 'hsl(' + hashHue(name) + ',60%,45%)'; }
function seoulNow(){
const g = {};
new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
.formatToParts(new Date()).forEach(function(p){ g[p.type] = p.value; });
return { h: Number(g.hour), m: Number(g.minute), s: Number(g.second) };
}
function cachedCall(key, fn){
if (viewCache[key]) return Promise.resolve(viewCache[key]);
return fn().then(function(res){ viewCache[key] = res; syncSchoolsFrom(res); return res; });
}

function loadDashboard(){
if (!dash.week) dash.week = dashThisWeek();
if (!dash.month) dash.month = state.today.slice(0, 7);
loadTodos();
dashStartClock();
dashLoadToday();
dashLoadWeek();
dashLoadCalendar();
dashLoadSchedule();
dashLoadEval();
dashLoadMemos();
}
function dashMoveWeek(dir){
dash.week = dir === 0 ? dashThisWeek() : addDays(dash.week, 7 * dir);
dashLoadWeek();
}
function dashMoveMonth(dir){
const d = parseD(dash.month + '-01');
d.setMonth(d.getMonth() + dir);
dash.month = fmt(d).slice(0, 7);
dashLoadCalendar();
}
function dashPickDate(ds){
dash.week = weekRangeMonFri(ds).start;
dashLoadWeek();
document.getElementById('dashWeekBody').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ----- 오늘 근무학교 ----- */
async function dashLoadToday(){
const box = document.getElementById('dashToday');
let res;
try { res = await cachedCall('day|' + state.today, function(){ return API.getRecords(state.today, ''); }); }
catch (e) { box.innerHTML = '<div class="dash-label">오늘 근무학교</div>' + dashErr(e); return; }
dash.todayRes = res;
const recs = res.records || [];
dash.slots = recs.map(function(r){
const t = slotOf(r.school, r.period);
return t ? { p: parseInt(r.period, 10), school: r.school, cls: r.cls, s: t.s, e: t.e } : null;
}).filter(Boolean).sort(function(a, b){ return a.s - b.s; });
let html = '<div class="dash-label">오늘 근무학교</div>';
if (res.holiday){
html += '<div class="dash-school"><i style="background:#dc2626"></i>' + esc(res.holiday.reason || '휴일') + '</div>' +
'<div class="dash-next"><span class="muted">오늘은 휴일입니다.</span></div>';
} else if (!recs.length){
html += '<div class="dash-school" style="font-size:20px">오늘은 수업이 없습니다</div>' +
'<div class="dash-next"><span class="muted">진도 관리 › 자료 입력이나 기초 시간표에서 수업을 넣을 수 있어요.</span></div>';
} else {
const cnt = {};
recs.forEach(function(r){ cnt[r.school] = (cnt[r.school] || 0) + 1; });
const schools = Object.keys(cnt).sort(function(a, b){ return cnt[b] - cnt[a]; });
const classes = [];
recs.forEach(function(r){ if (r.cls && classes.indexOf(r.cls) < 0) classes.push(r.cls); });
const ps = dash.slots.map(function(x){ return x.p; });
html += schools.map(function(s){ return '<div class="dash-school"><i style="background:' + schoolDot(s) + '"></i>' + esc(s) + '</div>'; }).join('') +
'<div class="dash-kpis">' +
'<div class="dash-kpi"><div class="l">오늘 수업</div><div class="v">' + recs.length + '시간' +
(ps.length ? ' <span class="muted" style="font-size:12px; font-weight:500">' + Math.min.apply(null, ps) + '~' + Math.max.apply(null, ps) + '교시</span>' : '') + '</div></div>' +
'<div class="dash-kpi"><div class="l">담당 반</div><div class="v" style="font-size:15px">' + (classes.length ? esc(classes.join(' · ')) : '-') + '</div></div>' +
'</div>' +
'<div class="dash-next"><div class="l">다음 수업</div><b id="dashNext">-</b></div>';
}
box.innerHTML = html;
dashTick();
if (!memo.school || memo.todaySchools.indexOf(memo.school) >= 0 || !memo.todaySchools.length) memo.school = memoTodaySchools()[0] || memo.school;
renderMemos();
}

/* ----- 시계 : 1초마다 ----- */
function dashStartClock(){
if (dash.timer) return;
dash.timer = setInterval(function(){ if (state.view === 'dash') dashTick(); }, 1000);
dashTick();
}
function dashTick(){
const t = seoulNow();
const pad = function(n){ return ('0' + n).slice(-2); };
document.getElementById('dashClock').textContent = pad(t.h) + ':' + pad(t.m);
document.getElementById('dashSec').textContent = pad(t.s);
document.getElementById('dashDate').textContent = prettyLong(state.today);
const now = t.h * 60 + t.m;
const slots = dash.slots;
let cur = null, next = null;
slots.forEach(function(x){
if (!cur && now >= x.s && now < x.e) cur = x;
if (!next && now < x.s) next = x;
});
let status, sub = '', pct = 0;
const res = dash.todayRes;
if (!res){ status = '불러오는 중...'; }
else if (res.holiday){ status = '오늘은 휴일입니다'; sub = res.holiday.reason || ''; }
else if (!slots.length){ status = (res.records || []).length ? '교시가 지정된 수업이 없습니다' : '오늘은 수업이 없습니다'; }
else if (cur){
status = cur.p + '교시 진행 중 · ' + cur.school + ' ' + (cur.cls || '');
sub = '종료까지 ' + (cur.e - now) + '분 (' + minToHm(cur.s) + ' ~ ' + minToHm(cur.e) + ')';
pct = Math.round((now - cur.s) / (cur.e - cur.s) * 100);
} else if (next){
status = (now < slots[0].s ? '수업 전 · 첫 수업 ' : '쉬는 시간 · 다음 ') + next.p + '교시';
sub = next.p + '교시 시작까지 ' + (next.s - now) + '분 · ' + next.school + ' ' + (next.cls || '');
} else {
status = '오늘 수업이 모두 끝났습니다'; sub = '수고하셨어요'; pct = 100;
}
document.getElementById('dashStatus').textContent = status;
document.getElementById('dashSub').textContent = sub;
document.getElementById('dashBar').style.width = pct + '%';
const nx = document.getElementById('dashNext');
if (nx) nx.textContent = next ? next.p + '교시 · ' + next.school + ' ' + (next.cls || '') + ' · ' + minToHm(next.s) + ' 시작' : '오늘 남은 수업 없음';
// 주간 시간표에서 지금 교시 강조
const nowKey = cur ? state.today + '|' + cur.p : '';
document.querySelectorAll('#dashWeekBody .wg-item').forEach(function(el){
el.classList.toggle('now', !!nowKey && el.dataset.slot === nowKey);
});
}

/* ----- 주간 시간표 ----- */
async function dashLoadWeek(){
const start = dash.week, end = addDays(start, 4);
const s = parseD(start), e = parseD(end);
document.getElementById('dashWeekTitle').textContent =
(s.getMonth() + 1) + '/' + s.getDate() + '(월) ~ ' + (e.getMonth() + 1) + '/' + e.getDate() + '(금)';
const box = document.getElementById('dashWeekBody');
box.innerHTML = '<div class="skeleton"><span class="spinner"></span>불러오는 중...</div>';
document.getElementById('dashMeal').innerHTML = '<div class="skeleton"><span class="spinner"></span>불러오는 중...</div>';
let res;
try { res = await cachedCall('week|' + start, function(){ return API.getRecordsRange(start, end, ''); }); }
catch (err) { box.innerHTML = dashErr(err); document.getElementById('dashMeal').innerHTML = ''; return; }
if (dash.week !== start) return;
dash.records = res.records || [];
state.currentRecords = dash.records;
renderDashWeek(res, start);
dashTick();
dashLoadMeals(res, start);
}
function renderDashWeek(res, start){
const days = [];
for (let i = 0; i < 5; i++){
const ds = addDays(start, i), d = parseD(ds);
days.push({ date: ds, label: dowLabel(d), dayNum: d.getDate(), hol: findHoliday(ds, res.holidays || []) });
}
const map = {};
let maxP = 6;
(res.records || []).forEach(function(r){
const p = parseInt(r.period, 10);
if (!p || p < 1 || p > BELL_MAX_PERIOD) return;
if (p > maxP) maxP = p;
(map[r.date + '|' + p] = map[r.date + '|' + p] || []).push(r);
});
let html = '<div class="week-grid week"><div class="wg-corner">교시</div>';
days.forEach(function(day){
const cls = (day.date === state.today) ? 'today' : (day.hol ? 'holiday' : '');
html += '<div class="wg-head ' + cls + '"><div class="wg-dow">' + day.label + (day.date === state.today ? ' · 오늘' : '') + '</div>' +
'<div class="wg-date">(' + day.dayNum + '일)</div></div>';
});
for (let p = 1; p <= maxP; p++){
html += '<div class="wg-period">' + p + '교시</div>';
days.forEach(function(day){
if (day.hol){ html += '<div class="wg-cell hol">' + esc(day.hol.reason || '휴일') + '</div>'; return; }
let cell = '<div class="wg-cell">';
(map[day.date + '|' + p] || []).forEach(function(r){
const t = slotOf(r.school, p);
cell += '<div class="wg-item" data-slot="' + day.date + '|' + p + '" style="' + schoolStyle(r.school) + '" onclick="openProgModal(' + r.row + ')">' +
'<div class="wg-top"><span class="wg-cls">' + esc(r.cls || '(반없음)') + '</span><span class="now-tag">진행 중</span></div>' +
'<div class="wg-school">' + esc(r.school || '') + (t ? ' <span class="wg-time">' + minToHm(t.s) + '~' + minToHm(t.e) + '</span>' : '') + '</div>' +
(r.progress ? '<div class="wg-prog">' + esc(r.progress) + '</div>' : '') +
'</div>';
});
html += cell + '</div>';
});
}
html += '</div>';
const extra = (res.records || []).filter(function(r){ const p = parseInt(r.period, 10); return !p || p < 1 || p > BELL_MAX_PERIOD; });
if (extra.length) html += '<div class="hint">교시가 지정되지 않은 자료 ' + extra.length + '건은 진도 관리 › 주 화면에서 볼 수 있어요.</div>';
document.getElementById('dashWeekBody').innerHTML = html;
}

/* ----- 미니 달력 ----- */
async function dashLoadCalendar(){
const month = dash.month;
const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
document.getElementById('dashCalTitle').textContent = y + '년 ' + m + '월';
let res;
try { res = await cachedCall('cal|' + y + '-' + m, function(){ return API.getMonthSummary(y, m, ''); }); }
catch (e) { document.getElementById('dashCalBody').innerHTML = dashErr(e); return; }
if (dash.month !== month) return;
renderDashCalendar(res);
// 나이스 학사일정 표시 (연결된 학교만)
const linked = neisLinkedSchools();
if (!linked.length) return;
const from = month + '-01', to = fmt(new Date(y, m, 0));
const evs = {};
await Promise.all(linked.map(function(sc){
const l = neisLink(sc);
return neisCall({ type: 'schedule', atpt: l.atpt, code: l.code, from: ymd(from), to: ymd(to) }).then(function(rows){
rows.forEach(function(r){
if (!neisEventShown(r)) return;
const ds = ymdToDs(r.date);
(evs[ds] = evs[ds] || []).push({ school: sc, name: r.name, off: r.off });
});
}).catch(function(){});
}));
if (dash.month !== month) return;
dash.calEvents = evs;
renderDashCalendar(res);
}
function renderDashCalendar(res){
const y = res.year, m = res.month;
const first = new Date(y, m - 1, 1);
const start = new Date(y, m - 1, 1 - first.getDay());
const weeks = Math.ceil((first.getDay() + new Date(y, m, 0).getDate()) / 7);
const wkStart = dash.week, wkEnd = addDays(dash.week, 4);
const evs = dash.calEvents || {};
let html = '<div class="mcal">' + ['일','월','화','수','목','금','토'].map(function(n, i){
return '<div class="dw' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + n + '</div>';
}).join('');
for (let i = 0; i < weeks * 7; i++){
const dt = new Date(start); dt.setDate(start.getDate() + i);
const ds = fmt(dt), dow = dt.getDay();
const info = res.summary[ds];
const hol = findHoliday(ds, res.holidays || []);
const ev = evs[ds] || [];
const neisOff = ev.some(function(x){ return x.off; });
const cls = [];
if (dt.getMonth() !== m - 1) cls.push('out');
if (dow === 0) cls.push('sun'); else if (dow === 6) cls.push('sat');
if (hol || neisOff) cls.push('hol');
if (ev.length) cls.push('ev');
if (ds === state.today) cls.push('today');
if (ds >= wkStart && ds <= wkEnd) cls.push('wk');
const tip = [];
if (hol) tip.push(hol.reason || '휴일');
ev.forEach(function(x){ tip.push(x.school + ' ' + x.name); });
if (info) tip.push('수업 ' + info.count + '건 (' + info.schools.join(', ') + ')');
const dots = info ? info.schools.slice(0, 3).map(function(s){ return '<i style="background:' + schoolDot(s) + '"></i>'; }).join('') : '';
html += '<button type="button" class="' + cls.join(' ') + '" title="' + esc(tip.join(' · ')) + '" onclick="dashPickDate(\'' + ds + '\')">' +
'<span class="n">' + dt.getDate() + '</span><span class="dots">' + dots + '</span></button>';
}
document.getElementById('dashCalBody').innerHTML = html + '</div>';
}

/* ----- 나이스 학사일정 ----- */
// 토요휴업일 같은 매주 반복 항목은 숨김
function neisEventShown(r){ return r.name && !/토요휴업일/.test(r.name); }
function needNeisHtml(what){
return dashMsg(what + '을 보려면 설정에서 학교를 나이스와 연결하세요.<br><button class="btn sm" onclick="goMode(\'set\')">설정으로</button>');
}
async function dashLoadSchedule(){
const box = document.getElementById('dashSched');
const tabs = document.getElementById('dashSchedTabs');
const linked = neisLinkedSchools();
if (!linked.length){ tabs.innerHTML = ''; box.innerHTML = needNeisHtml('학사일정'); return; }
box.innerHTML = '<div class="skeleton"><span class="spinner"></span>나이스에서 불러오는 중...</div>';
const from = state.today, to = addDays(state.today, 70);
const list = [], errors = [];
await Promise.all(linked.map(function(sc){
const l = neisLink(sc);
return neisCall({ type: 'schedule', atpt: l.atpt, code: l.code, from: ymd(from), to: ymd(to) }).then(function(rows){
// 같은 행사가 며칠 이어지면 (주말 사이 포함) 한 줄로 합침
const sorted = rows.filter(neisEventShown).map(function(r){ return { ds: ymdToDs(r.date), name: r.name, off: !!r.off }; })
.sort(function(a, b){ return a.ds < b.ds ? -1 : a.ds > b.ds ? 1 : 0; });
const open = {};
sorted.forEach(function(r){
const k = r.name + '|' + r.off, o = open[k];
if (o && daysBetween(r.ds, o.end) <= 3){ o.end = r.ds; return; }
open[k] = { school: sc, name: r.name, off: r.off, start: r.ds, end: r.ds };
list.push(open[k]);
});
}).catch(function(e){ errors.push(sc + ': ' + e.message); });
}));
list.sort(function(a, b){ return a.start < b.start ? -1 : a.start > b.start ? 1 : a.school.localeCompare(b.school); });
dash.sched = list;
dash.schedErrors = errors;
if (dash.schedFilter && linked.indexOf(dash.schedFilter) < 0) dash.schedFilter = '';
dash.schedTabs = [''].concat(linked);
tabs.innerHTML = linked.length > 1 ? dash.schedTabs.map(function(sc, i){
return '<button type="button" class="' + (dash.schedFilter === sc ? 'active' : '') + '" onclick="dashSchedPick(' + i + ')">' + (sc ? esc(sc) : '전체') + '</button>';
}).join('') : '';
renderDashSchedule();
}
function dashSchedPick(i){
dash.schedFilter = dash.schedTabs[i] || '';
dash.schedMore = false;
document.querySelectorAll('#dashSchedTabs button').forEach(function(b, j){ b.classList.toggle('active', j === i); });
renderDashSchedule();
}
function renderDashSchedule(){
const box = document.getElementById('dashSched');
const items = dash.sched.filter(function(x){ return !dash.schedFilter || x.school === dash.schedFilter; });
let html = '';
(dash.schedErrors || []).forEach(function(m){ html += '<div class="hint" style="color:var(--danger)">' + esc(m) + '</div>'; });
if (!items.length){ box.innerHTML = html + dashMsg('앞으로 10주 동안 학사일정이 없습니다.'); return; }
function row(x){
const d0 = daysBetween(x.start, state.today);
const dd = d0 > 0 ? 'D-' + d0 : (d0 === 0 ? 'D-DAY' : '진행 중');
const sd = parseD(x.start), ed = parseD(x.end);
let when = (sd.getMonth() + 1) + '/' + sd.getDate() + '(' + dowLabel(sd) + ')';
if (x.end !== x.start) when += ' ~ ' + (ed.getMonth() + 1) + '/' + ed.getDate() + '(' + dowLabel(ed) + ')';
return '<div class="sched-item"><span class="sched-dd' + (x.off ? ' off' : '') + '">' + dd + '</span>' +
'<div class="sched-body"><b>' + esc(x.name) + '</b>' + (x.off ? '<span class="sched-off">휴업일</span>' : '') +
'<div class="when">' + when + '</div></div>' + chip(x.school) + '</div>';
}
html += items.slice(0, DASH_SCHED_SHOW).map(row).join('');
const rest = items.slice(DASH_SCHED_SHOW);
if (rest.length){
if (dash.schedMore) html += '<div class="more-list">' + rest.map(row).join('') + '</div>';
html += moreBtn(dash.schedMore, rest.length, 'dashSchedToggle');
}
box.innerHTML = html;
}
function dashSchedToggle(){ dash.schedMore = !dash.schedMore; renderDashSchedule(); }

/* ----- 나이스 급식 : 설정의 요일별 급식 (기본 = 그날 수업이 가장 많은 학교) ----- */
async function dashLoadMeals(res, start){
const box = document.getElementById('dashMeal');
const end = addDays(start, 4);
const days = [];
let anyLink = false;
for (let i = 0; i < 5; i++){
const ds = addDays(start, i), dow = parseD(ds).getDay(), md = mealDayOf(dow);
if (md.mode === 'off') continue; // 급식 안 하는 요일은 빼기
const hol = findHoliday(ds, res.holidays || []);
let label = '', link = null;
if (md.mode === 'school' && md.school && md.school.code){
label = md.school.name; link = md.school;
} else {
const cnt = {};
(res.records || []).forEach(function(r){ if (r.date === ds && r.school) cnt[r.school] = (cnt[r.school] || 0) + 1; });
label = Object.keys(cnt).sort(function(a, b){ return cnt[b] - cnt[a]; })[0] || '';
link = label ? neisLink(label) : null;
}
if (link) anyLink = true;
days.push({ ds: ds, label: label, link: link, hol: hol });
}
if (!days.length){ box.innerHTML = dashMsg('설정에서 모든 요일을 "급식 안 함"으로 두었습니다.'); return; }
if (!anyLink && !neisLinkedSchools().length){ box.innerHTML = needNeisHtml('급식'); return; }
const linkKey = function(l){ return l.atpt + '|' + l.code; };
const need = {};
days.forEach(function(d){ if (d.link && !d.hol) need[linkKey(d.link)] = d.link; });
const meals = {}, errors = {};
await Promise.all(Object.keys(need).map(function(k){
const l = need[k];
return neisCall({ type: 'meal', atpt: l.atpt, code: l.code, from: ymd(start), to: ymd(end) }).then(function(rows){
rows.forEach(function(r){
const mk = k + '|' + ymdToDs(r.date);
// 중식을 먼저, 없으면 처음 나온 끼니
if (!meals[mk] || (r.kind === '중식' && meals[mk].kind !== '중식')) meals[mk] = r;
});
}).catch(function(e){ errors[k] = e.message; });
}));
if (dash.week !== start) return;
box.innerHTML = '<div class="meal-scroll"><div class="meal-grid" style="grid-template-columns:repeat(' + days.length + ', minmax(120px, 1fr)); min-width:' + (days.length * 124) + 'px">' + days.map(function(d){
const dt = parseD(d.ds);
const head = '<div class="md-head"><span>' + dowLabel(dt) + ' ' + (dt.getMonth() + 1) + '/' + dt.getDate() + (d.ds === state.today ? ' · 오늘' : '') + '</span>' + (d.label ? chip(d.label) : '') + '</div>';
let body;
const k = d.link ? linkKey(d.link) : '';
const meal = d.link ? meals[k + '|' + d.ds] : null;
if (d.hol) body = '<div class="none">' + esc(d.hol.reason || '휴일') + '</div>';
else if (!d.label) body = '<div class="none">근무 없음</div>';
else if (!d.link) body = '<div class="none">나이스 연결 안 됨</div>';
else if (errors[k]) body = '<div class="none" style="color:var(--danger)">' + esc(errors[k]) + '</div>';
else if (!meal) body = '<div class="none">급식 정보 없음</div>';
else body = '<ul>' + meal.dishes.map(function(x){
return '<li>' + esc(x.name) + (x.allergy ? '<span class="al">' + esc(x.allergy) + '</span>' : '') + '</li>';
}).join('') + '</ul>' + (meal.cal ? '<div class="kcal">' + esc(meal.cal) + '</div>' : '');
return '<div class="meal-day' + (d.ds === state.today ? ' today' : '') + '">' + head + body + '</div>';
}).join('') + '</div></div>';
}

/* ----- 학교 메모 (school_memos) -----
   기본 : 오늘 근무학교의 메모. 다른 학교는 목록에서 골라 보거나 새로 입력 */
const memo = { list: null, school: '', editing: 0, todaySchools: [] };
async function dashLoadMemos(){
try {
memo.list = must(await sb.from('school_memos').select('*').order('created_at'));
} catch (e) {
memo.list = null;
document.getElementById('memoList').innerHTML = dashErr(e);
return;
}
renderMemos();
}
// 오늘 근무학교 (수업이 많은 순)
function memoTodaySchools(){
const res = dash.todayRes;
if (!res || res.holiday) return [];
const cnt = {};
(res.records || []).forEach(function(r){ if (r.school) cnt[r.school] = (cnt[r.school] || 0) + 1; });
return Object.keys(cnt).sort(function(a, b){ return cnt[b] - cnt[a]; });
}
function memoAllSchools(){
const set = {};
state.schools.forEach(function(s){ set[s] = true; });
(memo.list || []).forEach(function(m){ set[m.school] = true; });
if (memo.school) set[memo.school] = true;
return Object.keys(set).sort();
}
function memoCount(school){
return (memo.list || []).filter(function(m){ return m.school === school; }).length;
}
function renderMemos(){
if (!memo.list) return;
const today = memoTodaySchools();
memo.todaySchools = today;
if (!memo.school){
let saved = '';
try { saved = localStorage.getItem('memoSchool') || ''; } catch (e) {}
memo.school = today[0] || (memoAllSchools().indexOf(saved) >= 0 ? saved : memoAllSchools()[0] || '');
}
// 탭 : 오늘 근무학교 + 지금 보고 있는 학교
const tabs = today.slice();
if (memo.school && tabs.indexOf(memo.school) < 0) tabs.push(memo.school);
document.getElementById('memoTabs').innerHTML = tabs.map(function(sc, i){
return '<button type="button" class="' + (sc === memo.school ? 'active' : '') + '" onclick="memoPickTab(' + i + ')">' + esc(sc) +
(today.indexOf(sc) >= 0 ? '<small>오늘</small>' : '') + (memoCount(sc) ? '<small>' + memoCount(sc) + '</small>' : '') + '</button>';
}).join('');
memo.tabs = tabs;
const others = memoAllSchools();
memo.others = others;
document.getElementById('memoOther').innerHTML = '<option value="">다른 학교 보기…</option>' +
others.map(function(sc, i){ return '<option value="' + i + '">' + esc(sc) + (memoCount(sc) ? ' (' + memoCount(sc) + ')' : '') + '</option>'; }).join('') +
'<option value="__new">＋ 새 학교 입력…</option>';
document.getElementById('memoHint').textContent = today.length ? (today.indexOf(memo.school) >= 0 ? '오늘 근무학교 메모' : '') : '오늘은 근무학교가 없습니다';
const box = document.getElementById('memoList');
if (!memo.school){
box.innerHTML = dashMsg('학교가 없습니다. "다른 학교 보기 › 새 학교 입력"으로 학교를 정하세요.');
return;
}
const items = (memo.list || []).filter(function(m){ return m.school === memo.school; });
document.getElementById('memoText').placeholder = memo.school + ' 메모 (예: 교무실 내선 번호, 와이파이, 수업 교실, 주차 위치)';
if (!items.length){ box.innerHTML = dashMsg(esc(memo.school) + ' 메모가 없습니다. 아래에 적고 추가하세요.'); return; }
box.innerHTML = items.map(function(m){
if (memo.editing === m.id){
return '<div class="memo-item"><textarea id="memoEdit" rows="3">' + esc(m.content) + '</textarea>' +
'<div class="memo-acts" style="flex-direction:column"><button class="btn sm" onclick="saveMemo(' + m.id + ')">저장</button>' +
'<button onclick="editMemo(0)">취소</button></div></div>';
}
return '<div class="memo-item"><div style="flex:1; min-width:0"><div class="memo-text">' + esc(m.content) + '</div>' +
'<div class="memo-time">' + esc(seoulDateTime(m.updated_at || m.created_at)) + '</div></div>' +
'<div class="memo-acts"><button title="수정" onclick="editMemo(' + m.id + ')">수정</button><button title="삭제" onclick="deleteMemo(' + m.id + ')">✕</button></div></div>';
}).join('');
}
function memoSetSchool(sc){
memo.school = sc; memo.editing = 0;
try { localStorage.setItem('memoSchool', sc); } catch (e) {}
renderMemos();
}
function memoPickTab(i){ memoSetSchool(memo.tabs[i]); }
function memoPickOther(v){
const sel = document.getElementById('memoOther');
sel.value = '';
if (v === '') return;
if (v === '__new'){
const name = (prompt('메모를 남길 학교 이름을 입력하세요') || '').trim();
if (name) memoSetSchool(name);
return;
}
memoSetSchool(memo.others[Number(v)]);
}
async function addMemo(){
const el = document.getElementById('memoText');
const text = el.value.trim();
if (!memo.school){ toast('학교를 먼저 고르세요.', 'err'); return; }
if (!text){ toast('메모 내용을 입력하세요.', 'err'); return; }
try { must(await sb.from('school_memos').insert({ school: memo.school, content: text })); }
catch (e) { toast(e.message, 'err'); return; }
el.value = '';
toast(memo.school + ' 메모를 추가했습니다.', 'ok');
dashLoadMemos();
}
function editMemo(id){
memo.editing = id;
renderMemos();
const el = document.getElementById('memoEdit');
if (el) el.focus();
}
async function saveMemo(id){
const text = (document.getElementById('memoEdit').value || '').trim();
if (!text){ toast('메모 내용을 입력하세요.', 'err'); return; }
try { must(await sb.from('school_memos').update({ content: text, updated_at: new Date().toISOString() }).eq('id', id)); }
catch (e) { toast(e.message, 'err'); return; }
memo.editing = 0;
toast('수정했습니다.', 'ok');
dashLoadMemos();
}
async function deleteMemo(id){
if (!confirm('이 메모를 삭제할까요?')) return;
try { must(await sb.from('school_memos').delete().eq('id', id)); }
catch (e) { toast(e.message, 'err'); return; }
toast('삭제했습니다.', 'ok');
dashLoadMemos();
}

/* ----- 수행평가 현황 : 과제별 채점 진행률 · 서명 미확인 ----- */
async function dashLoadEval(){
const box = document.getElementById('dashEval');
box.innerHTML = '<div class="skeleton"><span class="spinner"></span>불러오는 중...</div>';
try {
const res = await Promise.all([
sb.from('eval_tasks').select('id,school,title,published,eval_items(id)').eq('school_year', settings.year).eq('semester', settings.semester).order('school').order('id').then(must),
fetchAll(function(){ return sb.from('eval_students').select('id,school').eq('school_year', settings.year).order('id'); })
]);
const tasks = res[0], students = res[1];
if (!tasks.length){ box.innerHTML = dashMsg(termLabel() + '에 등록된 평가 기준이 없습니다.'); return; }
const itemIds = [], itemTask = {};
tasks.forEach(function(t){ (t.eval_items || []).forEach(function(i){ itemIds.push(i.id); itemTask[i.id] = t.id; }); });
const scores = itemIds.length ? await fetchAll(function(){
return sb.from('eval_scores').select('student_id,item_id').in('item_id', itemIds).order('id');
}) : [];
const cnt = {}; // task|student -> 채점한 요소 수
scores.forEach(function(s){ const k = itemTask[s.item_id] + '|' + s.student_id; cnt[k] = (cnt[k] || 0) + 1; });
const bySchool = {};
students.forEach(function(s){ (bySchool[s.school] = bySchool[s.school] || []).push(s.id); });
// 공개 과제가 있는 학교만 서명 확인
const signSchools = [];
tasks.forEach(function(t){ if (t.published && signSchools.indexOf(t.school) < 0) signSchools.push(t.school); });
const unsigned = {};
await Promise.all(signSchools.map(function(sc){
return sb.rpc('eval_signature_list', { p_year: settings.year, p_school: sc, p_semester: settings.semester }).then(must).then(function(rows){
unsigned[sc] = (rows || []).filter(function(r){ return (r.current || []).length && !(r.signed_at && r.matches); }).length;
}).catch(function(){});
}));
dash.evalTasks = tasks;
dash.evalHtml = tasks.map(function(t, i){
const ids = bySchool[t.school] || [], need = (t.eval_items || []).length;
// 진행률 = 입력한 칸 수 / (채점 요소 수 × 학생 수)
// 예) 5개 요소 · 10명 = 50칸 중 30칸 입력 → 60%
const total = need * ids.length;
let filled = 0, done = 0;
ids.forEach(function(id){
const c = Math.min(cnt[t.id + '|' + id] || 0, need);
filled += c;
if (need && c >= need) done++;
});
const pct = total ? Math.round(filled / total * 100) : 0;
const tags = [];
tags.push('입력 ' + filled + ' / ' + total + '칸');
tags.push('다 채점한 학생 ' + done + ' / ' + ids.length + '명');
if (!t.published) tags.push('학생 미공개');
else if (unsigned[t.school]) tags.push('<b style="color:var(--warn)">' + esc(t.school) + ' 서명 미확인 ' + unsigned[t.school] + '명</b>');
return '<button type="button" class="ev-prog ev-link" onclick="dashGoScore(' + i + ')" title="점수 입력 화면으로">' +
'<div class="t"><span>' + chip(t.school) + ' ' + esc(t.title) + '<span class="go">점수 입력 ›</span></span><b>' + pct + '%</b></div>' +
'<div class="pbar"><i style="width:' + pct + '%"></i></div><div class="s">' + tags.join(' · ') + '</div></button>';
});
renderDashEval();
} catch (e) { box.innerHTML = dashErr(e); }
}
function renderDashEval(){
const list = dash.evalHtml || [];
let html = list.slice(0, DASH_EVAL_SHOW).join('');
const rest = list.slice(DASH_EVAL_SHOW);
if (rest.length){
if (dash.evalMore) html += '<div class="more-list">' + rest.join('') + '</div>';
html += moreBtn(dash.evalMore, rest.length, 'dashEvalToggle');
}
document.getElementById('dashEval').innerHTML = html;
}
function dashEvalToggle(){ dash.evalMore = !dash.evalMore; renderDashEval(); }
// 수행평가 현황 항목 → 그 학교 · 그 과제의 점수 입력 화면
function dashGoScore(i){
const t = dash.evalTasks[i];
if (!t) return;
if (ev.school !== t.school){
ev.school = t.school;
try { localStorage.setItem('evSchool', t.school); } catch (e) {}
closeTaskEditor();
if (ev.schools.length) applyEvalSchools();
}
state.scoreTask = t.id;
state.modeView.eval = 'escore';
goMode('eval');
}

document.addEventListener('DOMContentLoaded', function(){
document.getElementById('evStudentLink').href = new URL('student.html', location.href).href;
});
