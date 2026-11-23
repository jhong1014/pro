/* =========================================================
   초기화 : 로그인 후 getInitialData() 1회 호출로 오늘 화면까지 완성
   (기존: getToday → getSchools → getRecords → getTodos 4회 왕복)
========================================================= */
/* 로그인 성공 후 1회 실행 */
async function startApp(){
showLoading('초기 데이터를 불러오는 중...');
// 설정(학년도 · D-day · 테마)을 먼저 읽어야 학년도별 학교 목록을 만들 수 있음
state.today = seoulToday();
try { await loadSettings(); } catch (e) { toast('설정을 불러오지 못했습니다: ' + e.message, 'err'); }
if (!settings.year) settings.year = schoolYearOf(state.today);
if (!settings.semester) settings.semester = semesterOf(state.today);
applyTheme(settings.theme);
applyYearLabels();

google.script.run.withSuccessHandler(function(init){
const today = init.today;
state.today = today; state.date = termDefaultDate();
state.schools = init.schools || [];

document.getElementById('todayBadge').textContent = '오늘: ' + prettyLong(today);
updateDday(today);
document.getElementById('inDate').value = today;
const wr = weekRangeMonFri(today);
document.getElementById('ttStart').value = wr.start;
document.getElementById('ttEnd').value = fmt(new Date(new Date(wr.end).getTime() + 7*24*3600*1000));
setStatRange();
document.getElementById('holStart').value = today;
document.getElementById('holEnd').value = today;

applySchools();

// 오늘 일(day) 화면 즉시 렌더 (추가 서버 호출 없음)
viewCache['day|' + today] = init.day;
if (state.date === today){
state.currentRecords = init.day.records || [];
document.getElementById('centerTitle').textContent = prettyDay(today);
renderDayGrid(init.day);
} else {
loadDay(); // 다른 학년도를 보고 있으면 그 학년도 첫날
}

// 오늘 할 일도 함께 받은 걸로 렌더
renderTodos(init.todos || []);
}).withFailureHandler(function(err){
document.getElementById('viewerBody').innerHTML =
'<div class="empty"><div class="big">불러오기 실패</div><div>'+esc(err.message)+'</div></div>';
}).getInitialData();

document.querySelectorAll('.tab').forEach(function(t){
t.addEventListener('click', function(){
document.querySelectorAll('.tab').forEach(function(x){ x.classList.remove('active'); });
t.classList.add('active');
state.view = t.dataset.view;
state.modeView[t.parentElement.dataset.mode] = state.view;
updateVisibility();
reload();
});
});
// 진도 관리 / 수행평가 전환 : 각 모드에서 마지막으로 보던 탭으로 이동
document.querySelectorAll('.mode').forEach(function(m){
m.addEventListener('click', function(){
const mode = m.dataset.mode;
document.querySelectorAll('.mode').forEach(function(x){ x.classList.toggle('active', x === m); });
// 대시보드 · 설정은 탭이 하나뿐이라 탭 줄을 숨김
document.querySelectorAll('.tabs').forEach(function(x){ x.style.display = (x.dataset.mode === mode && mode !== 'set' && mode !== 'dash' && mode !== 'seat' && mode !== 'pick') ? '' : 'none'; });
document.querySelector('.tabs[data-mode="'+mode+'"] .tab[data-view="'+state.modeView[mode]+'"]').click();
});
});
addTtItem();
// 첫 화면 : 대시보드
goMode('dash');
}

function goMode(mode){
const m = document.querySelector('.mode[data-mode="'+mode+'"]');
if (m) m.click();
}

function updateVisibility(){
const v = state.view;
document.getElementById('dashCard').style.display = (v==='dash') ? '' : 'none';
document.getElementById('viewerCard').style.display = (['day','week','cal'].indexOf(v)>=0) ? '' : 'none';
document.getElementById('ttCard').style.display = (v==='tt') ? '' : 'none';
document.getElementById('statCard').style.display = (v==='stat')? '' : 'none';
document.getElementById('addCard').style.display = (v==='add') ? '' : 'none';
document.getElementById('holCard').style.display = (v==='hol') ? '' : 'none';
document.getElementById('evalBar').style.display = (['etask','escore','esum','esign','estu'].indexOf(v)>=0) ? '' : 'none';
document.getElementById('etaskCard').style.display = (v==='etask') ? '' : 'none';
document.getElementById('escoreCard').style.display = (v==='escore') ? '' : 'none';
document.getElementById('esumCard').style.display = (v==='esum') ? '' : 'none';
document.getElementById('esignCard').style.display = (v==='esign') ? '' : 'none';
document.getElementById('estuCard').style.display = (v==='estu') ? '' : 'none';
document.getElementById('setCard').style.display = (v==='settings') ? '' : 'none';
document.getElementById('seatCard').style.display = (v==='seat') ? '' : 'none';
document.getElementById('pickCard').style.display = (v==='pick') ? '' : 'none';
document.getElementById('libCard').style.display = (v==='lib') ? '' : 'none';
// Todo는 일 뷰에서만
document.getElementById('todoCard').style.display = (v==='day') ? '' : 'none';
}

/* 학교 목록만 다시 필요할 때 (거의 안 씀 - getInitialData/조회 응답에 포함됨) */
function loadSchools(cb){
google.script.run.withSuccessHandler(function(list){
state.schools = list || [];
applySchools();
if (cb) cb();
}).getSchools();
}

/* 조회 응답에 담겨온 schools로 state 갱신 (서버 재호출 없이) */
function syncSchoolsFrom(res){
if (res && res.schools) {
state.schools = res.schools;
applySchools();
}
}

function moveDate(size, dir){
const d = parseD(state.date);
const v = state.view;
if (v==='day'){
d.setDate(d.getDate() + (size==='big' ? 7*dir : 1*dir));
} else if (v==='week'){
d.setDate(d.getDate() + (size==='big' ? 28*dir : 7*dir));
} else if (v==='cal'){
if (size==='big') d.setFullYear(d.getFullYear()+dir);
else d.setMonth(d.getMonth()+dir);
}
state.date = fmt(d);
reload();
}

function reload(){
const v = state.view;
if (v==='dash') loadDashboard();
else if (v==='day') { loadDay(); loadTodos(); }
else if (v==='week') loadWeek();
else if (v==='cal') loadCalendar();
else if (v==='hol') loadHolidays();
else if (['etask','escore','esum','esign','estu'].indexOf(v)>=0) loadEval();
else if (v==='seat') loadSeat();
else if (v==='pick') loadPick();
else if (v==='lib') loadLib();
else if (v==='settings') renderSettings();
}

/* ============== 설정 ============== */
// 수업시수 기본 기간 : 지금 학기면 이번 달, 다른 학기면 학기 전체
function setStatRange(){
const r = isCurrentTerm() ? monthRange(state.today) : semesterRange(settings.year, settings.semester);
document.getElementById('statStart').value = r.start;
document.getElementById('statEnd').value = r.end;
}
// 고를 수 있는 학년도 : 자료가 있는 학년도 ~ 올해 다음 학년도
async function settingYears(){
const cur = schoolYearOf(state.today);
const years = [cur - 1, cur, cur + 1, settings.year];
try {
// 표 전체를 읽지 않고, 가장 이른 · 가장 늦은 학년도 한 줄씩만 읽음
const edge = function(table, col, asc){ return sb.from(table).select(col).order(col, { ascending: asc }).limit(1).then(must); };
const res = await Promise.all([
edge('eval_tasks', 'school_year', true), edge('eval_tasks', 'school_year', false),
edge('eval_students', 'school_year', true), edge('eval_students', 'school_year', false),
edge('records', 'date', true), edge('records', 'date', false)
]);
const found = [];
res.slice(0, 4).forEach(function(rows){ rows.forEach(function(r){ found.push(Number(r.school_year)); }); });
res.slice(4).forEach(function(rows){ rows.forEach(function(r){ found.push(schoolYearOf(r.date)); }); });
const ok = found.filter(function(y){ return isFinite(y) && y > 0; });
// 그 사이 학년도를 모두 고를 수 있게
if (ok.length) for (let y = Math.min.apply(null, ok); y <= Math.max.apply(null, ok); y++) years.push(y);
} catch (e) {}
const lo = Math.min.apply(null, years), hi = Math.max.apply(null, years), out = [];
for (let y = hi; y >= lo; y--) out.push(y);
return out;
}
async function renderSettings(){
const ySel = document.getElementById('setYear');
ySel.innerHTML = opt(settings.year, settings.year + '학년도');
settingYears().then(function(list){
ySel.innerHTML = list.map(function(y){ return opt(y, y + '학년도'); }).join('');
ySel.value = settings.year;
});
document.getElementById('setSemester').value = settings.semester;
document.getElementById('setDdayLabel').value = (settings.dday || {}).label || '';
document.getElementById('setDdayDate').value = (settings.dday || {}).date || '';
document.getElementById('setThemes').innerHTML = THEMES.map(function(t){
return '<button type="button" class="theme-opt' + (t.id === (settings.theme || 'violet') ? ' active' : '') + '" onclick="pickTheme(\'' + t.id + '\')">' +
'<div class="sw" style="background:' + (t.swatch || 'linear-gradient(135deg,' + t.colors.join(',') + ')') + '"></div>' +
'<div class="nm">' + esc(t.name) + '</div></button>';
}).join('');
renderBellForm();
renderNeisSettings();
renderMealDays();
}
async function changeYear(){
const sel = document.getElementById('setYear');
const y = Number(sel.value);
try { await saveSetting('school_year', y); }
catch (e) { toast(e.message, 'err'); sel.value = settings.year; return; }
settings.year = y;
afterTermChange();
}
async function changeSemester(){
const sel = document.getElementById('setSemester');
const sem = Number(sel.value) === 1 ? 1 : 2;
try { await saveSetting('semester', sem); }
catch (e) { toast(e.message, 'err'); sel.value = settings.semester; return; }
settings.semester = sem;
afterTermChange();
}
// 학년도 · 학기가 바뀌면 학교 목록 · 화면 캐시 · 수행평가 자료를 모두 새로
function afterTermChange(){
applyYearLabels();
invalidateSchools();
clearViewCache();
closeTaskEditor();
ev.schools = []; ev.school = '';
seat.school = ''; seat.cls = ''; seat.selId = null; seat.edit = null;
pick.school = ''; pick.cls = '';
state.date = termDefaultDate();
setStatRange();
loadSchools();
toast(termLabel() + ' 자료로 바꿨습니다.', 'ok');
}
async function saveDday(){
const d = {
label: document.getElementById('setDdayLabel').value.trim(),
date: document.getElementById('setDdayDate').value
};
try { await saveSetting('dday', d); }
catch (e) { toast(e.message, 'err'); return; }
settings.dday = d;
updateDday(state.today);
toast('D-day를 저장했습니다.', 'ok');
}
async function pickTheme(id){
const before = settings.theme;
settings.theme = id;
applyTheme(id);
renderSettings();
try { await saveSetting('theme', id); }
catch (e) { toast(e.message, 'err'); settings.theme = before; applyTheme(before); renderSettings(); }
}

