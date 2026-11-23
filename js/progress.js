/* ============== 일 뷰 (그리드) ============== */
function loadDay(){
document.getElementById('centerTitle').textContent = prettyDay(state.date);
const key = 'day|' + state.date;
if (viewCache[key]) { // 캐시 히트 → 즉시 렌더
state.currentRecords = viewCache[key].records || [];
renderDayGrid(viewCache[key]);
return;
}
showLoading();
google.script.run.withSuccessHandler(function(res){
viewCache[key] = res;
state.currentRecords = res.records || [];
syncSchoolsFrom(res);
renderDayGrid(res);
}).withFailureHandler(function(err){ toast(err.message,'err'); }).getRecords(state.date, '');
}

function renderDayGrid(res){
const box = document.getElementById('viewerBody');
const records = res.records || [];
const hol = res.holiday;

const map = {}; // period -> [records]
const outOfGrid = [];
records.forEach(function(r){
const p = parseInt(r.period, 10);
if (!p || p < 1 || p > 7) { outOfGrid.push(r); return; }
(map[p] = map[p] || []).push(r);
});

const periods = [1,2,3,4,5,6,7];
const d = parseD(state.date);
const isToday = (state.date === state.today);
const headCls = hol ? 'holiday' : (isToday ? 'today' : '');

let html = '<div class="week-grid day">';
html += '<div class="wg-corner">교시</div>';
html += '<div class="wg-head '+headCls+'">' +
'<div class="wg-dow">'+dowLabel(d)+'요일</div>' +
'<div class="wg-date">('+d.getDate()+'일)</div>' +
'</div>';

periods.forEach(function(p){
html += '<div class="wg-period">'+p+'교시</div>';
if (hol){
html += '<div class="wg-cell hol">'+esc(hol.reason || '휴일')+'</div>';
return;
}
const items = map[p] || [];
let cell = '<div class="wg-cell">';
items.forEach(function(r){
cell += '<div class="wg-item" style="'+schoolStyle(r.school)+'" onclick="openProgModal('+r.row+')">' +
'<div class="wg-cls">'+esc(r.cls || '(반없음)')+'</div>' +
'<div class="wg-school">'+esc(r.school || '')+'</div>' +
'</div>';
});
cell += '</div>';
html += cell;
});
html += '</div>';

if (outOfGrid.length){
html += '<h3 style="margin-top:12px">교시 지정 없음 · 그 외 (' + outOfGrid.length + '건)</h3>' +
buildTable(outOfGrid, false);
}
box.innerHTML = html;
}

/* ============== 주 뷰 ============== */
function loadWeek(){
const range = weekRangeMonFri(state.date);
const s = parseD(range.start), e = parseD(range.end);
document.getElementById('centerTitle').textContent =
('0'+(s.getMonth()+1)).slice(-2) + '/' + ('0'+s.getDate()).slice(-2) + ' ~ ' +
('0'+(e.getMonth()+1)).slice(-2) + '/' + ('0'+e.getDate()).slice(-2);

const key = 'week|' + range.start;
if (viewCache[key]) {
state.currentRecords = viewCache[key].records || [];
renderWeek(viewCache[key], range);
return;
}
showLoading();
google.script.run.withSuccessHandler(function(res){
viewCache[key] = res;
state.currentRecords = res.records || [];
syncSchoolsFrom(res);
renderWeek(res, range);
}).withFailureHandler(function(err){ toast(err.message,'err'); }).getRecordsRange(range.start, range.end, '');
}

function renderWeek(res, range){
const box = document.getElementById('viewerBody');
const monday = parseD(range.start);
const days = [];
for (let i=0;i<5;i++){
const d = new Date(monday); d.setDate(monday.getDate()+i);
days.push({ date: fmt(d), label: dowLabel(d), dayNum: d.getDate() });
}
const holidays = res.holidays || [];
function findHol(ds){
for (let i=0;i<holidays.length;i++){
const h = holidays[i];
if (ds >= String(h.start) && ds <= String(h.end || h.start)) return h;
}
return null;
}
const map = {};
(res.records || []).forEach(function(r){
const p = parseInt(r.period, 10);
if (!p || p < 1 || p > 7) return;
(map[r.date + '|' + p] = map[r.date + '|' + p] || []).push(r);
});
const periods = [1,2,3,4,5,6,7];
let html = '<div class="week-grid week">';
html += '<div class="wg-corner">교시</div>';
days.forEach(function(day){
const hol = findHol(day.date);
const cls = (day.date === state.today) ? 'today' : (hol ? 'holiday' : '');
html += '<div class="wg-head '+cls+'">' +
'<div class="wg-dow">'+day.label+'</div>' +
'<div class="wg-date">('+day.dayNum+'일)</div>' +
'</div>';
});
periods.forEach(function(p){
html += '<div class="wg-period">'+p+'교시</div>';
days.forEach(function(day){
const hol = findHol(day.date);
if (hol){
html += '<div class="wg-cell hol">'+esc(hol.reason || '휴일')+'</div>';
return;
}
const items = map[day.date + '|' + p] || [];
let cell = '<div class="wg-cell">';
items.forEach(function(r){
cell += '<div class="wg-item" style="'+schoolStyle(r.school)+'" onclick="openProgModal('+r.row+')">' +
'<div class="wg-cls">'+esc(r.cls || '(반없음)')+'</div>' +
'<div class="wg-school">'+esc(r.school || '')+'</div>' +
'</div>';
});
cell += '</div>';
html += cell;
});
});
html += '</div>';

const outOfGrid = (res.records || []).filter(function(r){
const p = parseInt(r.period, 10);
return !p || p < 1 || p > 7;
});
if (outOfGrid.length){
html += '<h3 style="margin-top:12px">교시 지정 없음 · 그 외 (' + outOfGrid.length + '건)</h3>' +
buildTable(outOfGrid, true);
}
box.innerHTML = html;
}

/* ============== 캘린더 뷰 ============== */
function loadCalendar(){
const d = parseD(state.date);
const y = d.getFullYear(), m = d.getMonth()+1;
document.getElementById('centerTitle').textContent = y + '.' + ('0'+m).slice(-2);

const key = 'cal|' + y + '-' + m;
if (viewCache[key]) { renderCalendar(viewCache[key]); return; }
showLoading();
google.script.run.withSuccessHandler(function(res){
viewCache[key] = res;
syncSchoolsFrom(res);
renderCalendar(res);
}).withFailureHandler(function(err){ toast(err.message,'err'); }).getMonthSummary(y, m, '');
}

function renderCalendar(res){
const box = document.getElementById('viewerBody');
const y = res.year, m = res.month;
const first = new Date(y, m-1, 1);
const startDow = first.getDay();
const startDate = new Date(y, m-1, 1 - startDow);
const holidays = res.holidays || [];
function findHol(ds){
for (let i=0;i<holidays.length;i++){
const h = holidays[i];
if (ds >= String(h.start) && ds <= String(h.end || h.start)) return h;
}
return null;
}
const cells = [];
for (let i=0;i<42;i++){
const dt = new Date(startDate); dt.setDate(startDate.getDate()+i);
const ds = fmt(dt);
const inMonth = (dt.getMonth() === m-1);
const info = res.summary[ds];
const dow = dt.getDay();
const hol = findHol(ds);
let chips = '';
if (info) {
const shown = info.schools.slice(0,3);
chips = shown.map(function(s){ return chip(s); }).join('');
if (info.schools.length > 3) chips += '<div class="more">+'+(info.schools.length-3)+'</div>';
}
const clsList = [ 'cell' ];
if (!inMonth) clsList.push('out');
if (ds === state.today) clsList.push('today');
if (hol) clsList.push('holiday');
cells.push(
'<div class="'+clsList.join(' ')+'" onclick="drillDown(\''+ds+'\')">' +
'<div class="d '+(dow===0?'sun':dow===6?'sat':'')+'">'+dt.getDate()+'</div>' +
(hol ? '<div class="hol-tag">'+esc(hol.reason||'휴일')+'</div>'
: (info ? '<div class="cnt">'+info.count+'</div>' : '')) +
'<div class="chips">'+chips+'</div>' +
'</div>'
);
}
const dowH = ['일','월','화','수','목','금','토'].map(function(n,i){
return '<div class="dow '+(i===0?'sun':i===6?'sat':'')+'">'+n+'</div>';
}).join('');
box.innerHTML =
'<div class="cal">' + dowH + cells.join('') + '</div>' +
'<div id="drillBox" style="margin-top:14px"></div>';
}

function drillDown(ds){
const key = 'day|' + ds; // 일 뷰 캐시와 공유
function paint(res){
state.currentRecords = res.records || [];
const el = document.getElementById('drillBox');
let banner = '';
if (res.holiday){
banner = '<div style="margin:8px 0"><span class="badge danger">휴일</span> ' + esc(res.holiday.reason||'') + '</div>';
}
if (!res.records.length){
el.innerHTML = '<h3>'+prettyLong(ds)+'</h3>' + banner + '<div class="empty"><div class="big">자료가 없습니다</div></div>';
} else {
el.innerHTML = '<h3>'+prettyLong(ds)+' <span class="badge">'+res.records.length+'건</span></h3>' +
banner + buildTable(res.records, false);
}
}
if (viewCache[key]) { paint(viewCache[key]); return; }
google.script.run.withSuccessHandler(function(res){
viewCache[key] = res;
syncSchoolsFrom(res);
paint(res);
}).withFailureHandler(function(err){ toast(err.message,'err'); }).getRecords(ds, '');
}

/* ============== 테이블 빌더 (그리드 외 항목/캘린더 드릴다운용) ============== */
function buildTable(records, includeDate){
let head = '<table><thead><tr>';
if (includeDate) head += '<th>날짜</th>';
head += '<th>학교명</th><th class="num">교시</th><th>반</th><th>진도</th>' +
'<th style="width:130px">동작</th></tr></thead><tbody>';
const body = records.map(function(r){
return '<tr>' +
(includeDate ? '<td>'+esc(r.date)+'</td>' : '') +
'<td>' + chip(r.school) + '</td>' +
'<td class="num">' + esc(r.period) + '</td>' +
'<td>' + esc(r.cls) + '</td>' +
'<td>' + esc(r.progress) + '</td>' +
'<td>' +
'<button class="btn warn sm" onclick="openEditModal('+r.row+')">수정</button> ' +
'<button class="btn danger sm" onclick="removeRow('+r.row+')">삭제</button>' +
'</td>' +
'</tr>';
}).join('');
return head + body + '</tbody></table>';
}

function removeRow(row){
if (!confirm('이 행을 삭제하시겠습니까?')) return;
google.script.run.withSuccessHandler(function(){
toast('삭제되었습니다.', 'ok');
closeProgModal();
clearViewCache(); // 데이터 바뀜 → 뷰 캐시 무효화
reload();
}).withFailureHandler(function(err){ toast(err.message,'err'); }).deleteRecord(row);
}

/* ============== 진도 상세 모달 ============== */
function findRecordByRow(row){
// 대시보드 주간 시간표의 자료도 함께 찾음
const lists = [state.currentRecords, (state.view === 'dash' && dash.records) || []];
for (let j=0;j<lists.length;j++){
for (let i=0;i<lists[j].length;i++){
if (lists[j][i].row === row) return lists[j][i];
}
}
return null;
}
function openProgModal(row){
const r = findRecordByRow(row);
if (!r){ toast('자료를 찾지 못했습니다.','err'); return; }
document.getElementById('pmTitle').innerHTML =
esc(r.school) + ' · ' + esc(r.cls || '') + ' · ' + esc(r.period || '') + '교시';
document.getElementById('pmMeta').textContent = prettyLong(r.date);
document.getElementById('pmProg').textContent = r.progress || '(진도 내용 없음)';
document.getElementById('pmEditBtn').onclick = function(){
closeProgModal();
openEditModal(row);
};
document.getElementById('pmDelBtn').onclick = function(){
removeRow(row);
};
document.getElementById('progModal').classList.add('show');
pmLoadMaterials(row);
}
function closeProgModal(){
lib.pm = null;
document.getElementById('progModal').classList.remove('show');
}

/* 수정 모달 */
function openEditModal(row){
const r = findRecordByRow(row);
if (!r){ toast('자료를 찾지 못했습니다.','err'); return; }
state.editingRow = row;
document.getElementById('edDate').value = r.date;
document.getElementById('edSchool').value = r.school || '';
document.getElementById('edPeriod').value = r.period || '';
document.getElementById('edClass').value = r.cls || '';
document.getElementById('edProgress').value= r.progress || '';
document.getElementById('editModal').classList.add('show');
}
function closeEditModal(){
state.editingRow = null;
document.getElementById('editModal').classList.remove('show');
}
function saveEdit(){
const row = state.editingRow;
if (!row){ closeEditModal(); return; }
const rec = {
date: document.getElementById('edDate').value,
school: document.getElementById('edSchool').value.trim(),
period: document.getElementById('edPeriod').value.trim(),
cls: document.getElementById('edClass').value.trim(),
progress:document.getElementById('edProgress').value.trim()
};
if (!rec.date) { toast('날짜를 입력하세요','err'); return; }
if (!rec.school) { toast('학교명을 입력하세요','err'); return; }
google.script.run
.withSuccessHandler(function(){
toast('수정되었습니다.', 'ok');
closeEditModal();
clearViewCache();
reload();
})
.withFailureHandler(function(err){ toast(err.message,'err'); })
.updateRecord(row, rec);
}

/* ============== Todo List ============== */
function loadTodos(){
google.script.run.withSuccessHandler(renderTodos).getTodos();
}
function renderTodos(list){
list = list || [];
['todoCount', 'dashTodoCount'].forEach(function(id){ document.getElementById(id).textContent = list.length; });
const html = !list.length ? '<div class="empty" style="padding:14px"><div>진행 중인 할 일이 없습니다.</div></div>' :
list.map(function(t){
return '<div class="todo-item">' +
'<input type="checkbox" onchange="completeTodo('+t.row+')" title="완료"/>' +
'<div class="todo-text">'+esc(t.text)+'</div>' +
'<div class="todo-time">'+esc(t.createdAt)+'</div>' +
'<button class="todo-del" onclick="deleteTodo('+t.row+')" title="삭제">✕</button>' +
'</div>';
}).join('');
['todoList', 'dashTodoList'].forEach(function(id){ document.getElementById(id).innerHTML = html; });
}
function submitTodo(inputId){
const el = document.getElementById(inputId || 'todoText');
const t = el.value.trim();
if (!t){ toast('내용을 입력하세요','err'); return; }
google.script.run
.withSuccessHandler(function(list){
el.value = '';
toast('추가되었습니다.', 'ok');
renderTodos(list);
})
.withFailureHandler(function(err){ toast(err.message,'err'); })
.addTodo(t);
}
function completeTodo(row){
google.script.run
.withSuccessHandler(function(list){
toast('완료 처리', 'ok');
renderTodos(list);
})
.withFailureHandler(function(err){ toast(err.message,'err'); })
.completeTodo(row);
}
function deleteTodo(row){
if (!confirm('이 할 일을 삭제하시겠습니까?')) return;
google.script.run
.withSuccessHandler(function(list){
toast('삭제되었습니다.', 'ok');
renderTodos(list);
})
.withFailureHandler(function(err){ toast(err.message,'err'); })
.deleteTodo(row);
}

/* ============== 기초 시간표 ============== */
function addTtItem(){
const wrap = document.getElementById('ttItems');
const div = document.createElement('div');
div.className = 'tt-item';
div.innerHTML =
'<label class="field">요일<select class="tt-dow">' +
['일','월','화','수','목','금','토'].map(function(n,i){
return '<option value="'+i+'" '+(i===1?'selected':'')+'>'+n+'</option>';
}).join('') +
'</select></label>' +
'<label class="field">교시<input type="text" class="tt-period" placeholder="예: 3"/></label>' +
'<label class="field">반<input type="text" class="tt-cls" placeholder="예: 3-2"/></label>' +
'<label class="field">진도(선택)<input type="text" class="tt-prog"/></label>' +
'<button class="icon-btn" onclick="this.parentElement.remove()">✕</button>';
wrap.appendChild(div);
}
function generateTt(){
const school = document.getElementById('ttSchool').value.trim();
const start = document.getElementById('ttStart').value;
const end = document.getElementById('ttEnd').value;
const overwrite = document.getElementById('ttOverwrite').value === 'force';
const skipHolidays = document.getElementById('ttSkipHol').value === 'yes';
if (!school){ toast('학교명을 입력하세요','err'); return; }
if (!start || !end){ toast('기간을 입력하세요','err'); return; }
const items = [];
document.querySelectorAll('#ttItems .tt-item').forEach(function(el){
const dow = parseInt(el.querySelector('.tt-dow').value,10);
const period = el.querySelector('.tt-period').value.trim();
const cls = el.querySelector('.tt-cls').value.trim();
const prog = el.querySelector('.tt-prog').value.trim();
if (period || cls || prog) items.push({dow:dow, period:period, cls:cls, progress:prog});
});
if (!items.length){ toast('요일별 시간표를 추가하세요','err'); return; }
const spec = { school:school, start:start, end:end, items:items, overwrite:overwrite, skipHolidays:skipHolidays };
google.script.run
.withSuccessHandler(function(res){
toast(res.message, res.inserted>0 ? 'ok' : '');
clearViewCache(); // 대량 추가됨 → 뷰 캐시 무효화
loadSchools();
})
.withFailureHandler(function(err){ toast(err.message,'err'); })
.generateTimetable(spec);
}

/* ============== 자료 입력 ============== */
function submitRecord(){
const rec = {
date: document.getElementById('inDate').value,
school: document.getElementById('inSchool').value.trim(),
period: document.getElementById('inPeriod').value.trim(),
cls: document.getElementById('inClass').value.trim(),
progress:document.getElementById('inProgress').value.trim()
};
if (!rec.date) { toast('날짜를 입력하세요','err'); return; }
if (!rec.school) { toast('학교명을 입력하세요','err'); return; }
google.script.run
.withSuccessHandler(function(res){
toast('저장되었습니다.', 'ok');
clearForm();
clearViewCache(); // 데이터 추가됨 → 뷰 캐시 무효화
syncSchoolsFrom(res); // 새 학교면 응답에 이미 반영되어 옴
})
.withFailureHandler(function(err){ toast(err.message,'err'); })
.addRecord(rec);
}
function clearForm(){
document.getElementById('inPeriod').value='';
document.getElementById('inClass').value='';
document.getElementById('inProgress').value='';
}

/* ============== 공휴일 관리 ============== */
function loadHolidays(){
const key = 'hol';
if (viewCache[key]) { renderHolidays(viewCache[key]); return; }
google.script.run.withSuccessHandler(function(list){
viewCache[key] = list || [];
renderHolidays(list || []);
}).getHolidays();
}
function renderHolidays(list){
const box = document.getElementById('holList');
// 선택한 학년도에 걸치는 휴일만 표시 (일 · 주 · 캘린더는 학년도와 상관없이 모든 휴일 반영)
const yr = yearRange(settings.year);
list = list.filter(function(h){ return h.end >= yr.start && h.start <= yr.end; });
if (!list.length){
box.innerHTML = '<div class="empty"><div class="big">' + settings.year + '학년도에 등록된 휴일이 없습니다</div><div>위 폼에서 방학·공휴일을 등록하세요.</div></div>';
return;
}
let html = '<table><thead><tr><th>시작일</th><th>종료일</th><th>사유</th><th style="width:80px">동작</th></tr></thead><tbody>';
list.forEach(function(h){
html += '<tr>' +
'<td>'+esc(h.start)+'</td><td>'+esc(h.end)+'</td><td>'+esc(h.reason||'')+'</td>' +
'<td><button class="btn danger sm" onclick="removeHoliday('+h.row+')">삭제</button></td>' +
'</tr>';
});
html += '</tbody></table>';
box.innerHTML = html;
}
function submitHoliday(){
const h = {
start: document.getElementById('holStart').value,
end: document.getElementById('holEnd').value,
reason: document.getElementById('holReason').value.trim()
};
if (!h.start){ toast('시작일을 입력하세요','err'); return; }
if (!h.end) h.end = h.start;
google.script.run
.withSuccessHandler(function(list){
toast('휴일 등록 완료', 'ok');
document.getElementById('holReason').value = '';
clearViewCache(); // 휴일 바뀌면 일/주/캘린더 표시도 달라짐
viewCache['hol'] = list || [];
renderHolidays(list || []);
})
.withFailureHandler(function(err){ toast(err.message,'err'); })
.addHoliday(h);
}
function removeHoliday(row){
if (!confirm('이 휴일을 삭제하시겠습니까?')) return;
google.script.run
.withSuccessHandler(function(list){
toast('삭제되었습니다.', 'ok');
clearViewCache();
viewCache['hol'] = list || [];
renderHolidays(list || []);
})
.withFailureHandler(function(err){ toast(err.message,'err'); })
.deleteHoliday(row);
}

/* ============== 수업시수 집계 ============== */
function runStats(){
const c = {
start: document.getElementById('statStart').value,
end: document.getElementById('statEnd').value,
school: document.getElementById('statSchool').value,
groupBy:document.getElementById('statGroup').value
};
if (!c.start || !c.end){ toast('기간을 입력하세요','err'); return; }
document.getElementById('statBody').innerHTML =
'<div class="skeleton"><span class="spinner"></span>집계 중...</div>';
google.script.run
.withSuccessHandler(function(res){ renderStats(res, c.groupBy); })
.withFailureHandler(function(err){ toast(err.message,'err'); })
.getClassStats(c);
}
function renderStats(res, groupBy){
const box = document.getElementById('statBody');
if (!res.groups.length){
box.innerHTML = '<div class="empty"><div class="big">집계 결과 없음</div></div>';
return;
}
const uniqSchools = {};
res.groups.forEach(function(g){ uniqSchools[g.school]=true; });
let kpis =
'<div class="kpi-row">' +
'<div class="kpi p"><div class="label">총 수업시수</div><div class="value">'+res.total+' 회</div></div>' +
'<div class="kpi o"><div class="label">학교 수</div><div class="value">'+Object.keys(uniqSchools).length+' 개</div></div>' +
'<div class="kpi w"><div class="label">집계 기간</div><div class="value" style="font-size:15px">'+res.start+' ~ '+res.end+'</div></div>' +
'</div>';
const max = Math.max.apply(null, res.groups.map(function(g){ return g.count; }));
let head = '<table><thead><tr><th>학교</th>';
if (groupBy==='school-class') head += '<th>반</th>';
if (groupBy==='school-day') head += '<th>요일</th>';
head += '<th class="num">수업 횟수</th><th style="width:40%">비중</th></tr></thead><tbody>';
const body = res.groups.map(function(g){
const pct = Math.round(g.count/max*100);
return '<tr>' +
'<td>' + chip(g.school) + '</td>' +
(groupBy==='school-class' ? '<td>' + esc(g.cls||'-') + '</td>' : '') +
(groupBy==='school-day' ? '<td>' + esc(g.day||'-') + '요일</td>' : '') +
'<td class="num"><b>'+g.count+'</b> 회</td>' +
'<td><div style="background:var(--primary-soft); border-radius:6px; overflow:hidden; height:10px"><div style="width:'+pct+'%; height:100%; background:linear-gradient(90deg,var(--primary),var(--primary-2))"></div></div></td>' +
'</tr>';
}).join('');
box.innerHTML = kpis + head + body + '</tbody></table>';
}

