/* =========================================================
   자리표 (seat_charts 테이블, [자리표] 탭)
   - 학교 · 반마다 자리표를 여러 장 저장하고, 저장한 순서대로 이력을 봅니다.
   - 줄 · 열 수와 사용할 수 없는 자리(고장 난 컴퓨터 등)는 자리표마다 저장합니다.
   - 학생 명단은 수행평가 › 학생 명단(eval_students)을 그대로 씁니다.
========================================================= */
const SEAT_MAX = 12;
const seat = {
school: '', cls: '',
students: [], charts: [], // 현재 학교 데이터
selId: null,   // 보고 있는 자리표
flip: false,   // 학생 쪽에서 본 방향으로 뒤집어 보기
edit: null     // 만들거나 고치는 중인 자리표
};
function seatKey(r, c){ return r + '-' + c; }
function seatMd(ds){ const d = parseD(ds); return (d.getMonth() + 1) + '/' + d.getDate(); }
function normSeatChart(r){
const blocked = {};
(r.blocked || []).forEach(function(b){ blocked[seatKey(b[0], b[1])] = true; });
return {
id: r.id, cls: r.class_name, title: r.title || '', start: r.start_date,
rows: r.row_count, cols: r.col_count, blocked: blocked, seats: r.seats || []
};
}
function seatClasses(){
const set = {};
seat.students.forEach(function(s){ set[s.class_name] = true; });
seat.charts.forEach(function(c){ set[c.cls] = true; });
return Object.keys(set).sort(byClassName);
}
// 최근 것부터
function seatBySTART(a, b){ return a.start < b.start ? 1 : (a.start > b.start ? -1 : b.id - a.id); }
function seatChartsOf(cls){
return seat.charts.filter(function(c){ return c.cls === cls; }).sort(seatBySTART);
}
function seatStudentsOf(cls){
return seat.students.filter(function(s){ return s.class_name === cls; });
}
// 이력에 보이는 기간 : 다음 자리표를 시작하기 전날까지
function seatPeriod(list, i){
const c = list[i];
if (i === 0) return seatMd(c.start) + ' ~ 사용 중';
const d = parseD(list[i - 1].start); d.setDate(d.getDate() - 1);
const end = fmt(d) < c.start ? c.start : fmt(d);
return seatMd(c.start) + ' ~ ' + seatMd(end);
}
function seatCurrent(){
const list = seatChartsOf(seat.cls);
for (let i = 0; i < list.length; i++) if (list[i].id === seat.selId) return list[i];
return list[0] || null;
}

async function loadSeat(){
if (seat.edit){ renderSeat(); return; } // 다른 탭에 다녀와도 고치던 내용 유지
const box = document.getElementById('seatBody');
box.innerHTML = '<div class="skeleton"><span class="spinner"></span>불러오는 중...</div>';
try {
if (!ev.schools.length) await loadEvalSchools();
if (!seat.school || ev.schools.indexOf(seat.school) < 0) seat.school = ev.school || ev.schools[0] || '';
await loadSeatData();
} catch (e) {
const noTable = /seat_charts/.test(e.message);
box.innerHTML = '<div class="empty"><div class="big">불러오기 실패</div><div>' +
(noTable ? '자리표 저장 공간(seat_charts 테이블)이 아직 DB에 없습니다. 마이그레이션이 적용된 뒤 다시 열어 주세요.' : esc(e.message)) + '</div></div>';
return;
}
if (state.view !== 'seat') return;
renderSeat();
}
async function loadSeatData(){
if (!seat.school){ seat.students = []; seat.charts = []; return; }
const s = seat.school;
const res = await Promise.all([
fetchAll(function(){
return sb.from('eval_students').select('id,class_name,number,name').eq('school_year', settings.year).eq('school', s).order('id');
}),
fetchAll(function(){
return sb.from('seat_charts').select('*').eq('school_year', settings.year).eq('school', s).order('id');
})
]);
seat.students = res[0].sort(function(a, b){ return byClassName(a.class_name, b.class_name) || (a.number - b.number); });
seat.charts = res[1].map(normSeatChart);
}
function seatPickSchool(){
seat.school = document.getElementById('seatSchool').value;
seat.cls = ''; seat.selId = null;
loadSeat();
}
function seatPickClass(){
seat.cls = document.getElementById('seatClass').value;
seat.selId = null;
renderSeat();
}

function renderSeat(){
document.getElementById('seatYear').textContent = settings.year + '학년도';
const sSel = document.getElementById('seatSchool'), cSel = document.getElementById('seatClass');
sSel.innerHTML = ev.schools.length ? ev.schools.map(function(s){ return opt(s); }).join('') : '<option value="">(학교 없음)</option>';
sSel.value = seat.school;
const classes = seatClasses();
if (classes.indexOf(seat.cls) < 0) seat.cls = classes[0] || '';
cSel.innerHTML = classes.length ? classes.map(function(c){ return opt(c); }).join('') : '<option value="">(등록된 반 없음)</option>';
cSel.value = seat.cls;
// 고치는 중에는 학교 · 반을 바꾸지 못하게
sSel.disabled = cSel.disabled = !!seat.edit;
if (seat.edit) renderSeatEdit(); else renderSeatView();
}

/* 자리 칸 그리기 (보기 · 고치기 · 인쇄 공용)
   g = { rows, cols, blocked: {key:true}, who: {key: {number, name}} } */
function seatGridHtml(g, o){
o = o || {};
const desk = '<div class="seat-desk">교탁 (칠판 쪽)</div>';
let cells = '';
for (let i = 0; i < g.rows; i++){
for (let j = 0; j < g.cols; j++){
const r = o.flip ? g.rows - 1 - i : i, c = o.flip ? g.cols - 1 - j : j;
const key = seatKey(r, c), p = g.who[key];
const cls = 'seat' + (g.blocked[key] ? ' x' : (p ? ' on' : '')) + (o.pick === key ? ' pick' : '');
const inner = '<small>' + (r * g.cols + c + 1) + '</small>' +
(g.blocked[key] ? '<b>사용 불가</b>' : (p ? '<b>' + esc(p.name) + '</b><i>' + esc(p.number) + '번</i>' : ''));
cells += o.edit
? '<button type="button" class="' + cls + '" onclick="seatClick(\'' + key + '\')">' + inner + '</button>'
: '<div class="' + cls + '">' + inner + '</div>';
}
}
return '<div class="seat-scroll"><div style="min-width:' + (g.cols * 62) + 'px">' + (o.flip ? '' : desk) +
'<div class="seat-grid" style="grid-template-columns:repeat(' + g.cols + ',minmax(0,1fr))">' + cells + '</div>' +
(o.flip ? desk : '') + '</div></div>';
}
function seatChartGrid(c){
const who = {};
c.seats.forEach(function(s){ who[seatKey(s.r, s.c)] = s; });
return { rows: c.rows, cols: c.cols, blocked: c.blocked, who: who };
}

/* ---------- 보기 ---------- */
function renderSeatView(){
const box = document.getElementById('seatBody');
if (!seat.school){ box.innerHTML = '<div class="empty"><div class="big">학교가 없습니다</div><div>수행평가 › 학생 명단에서 학교와 학생을 먼저 등록하세요.</div></div>'; return; }
if (!seat.cls){ box.innerHTML = '<div class="empty"><div class="big">등록된 반이 없습니다</div><div>수행평가 › 학생 명단에서 ' + esc(seat.school) + ' 학생을 먼저 등록하세요.</div></div>'; return; }
const list = seatChartsOf(seat.cls), cur = seatCurrent();
if (!cur){
box.innerHTML = '<div class="empty"><div class="big">저장된 자리표가 없습니다</div><div>' + esc(seat.school) + ' ' + esc(seat.cls) + ' · 학생 ' + seatStudentsOf(seat.cls).length + '명</div>' +
'<div style="margin-top:12px"><button class="btn" onclick="seatNew()">새 자리표 만들기</button></div></div>';
return;
}
seat.selId = cur.id;
const idx = list.indexOf(cur);
const hist = list.map(function(c, i){
return '<button type="button"' + (c.id === cur.id ? ' class="active"' : '') + ' onclick="seatSelect(' + c.id + ')">' +
'<b>' + seatPeriod(list, i) + '</b><span>' + esc(c.title || '메모 없음') + ' · ' + c.seats.length + '명</span></button>';
}).join('');
box.innerHTML = '<div class="seat-wrap"><div>' +
'<div class="seat-head"><div><b>' + seatPeriod(list, idx) + '</b> ' +
(idx === 0 ? '<span class="badge ok">사용 중</span>' : '<span class="badge warn">지난 기록</span>') +
(cur.title ? ' <span class="muted">' + esc(cur.title) + '</span>' : '') + '</div>' +
'<div class="flex">' +
'<button class="btn sm" onclick="seatNew()">새 자리표 만들기</button>' +
'<button class="btn ghost sm" onclick="seatEdit()">수정</button>' +
'<button class="btn ghost sm" onclick="seatFlip()">' + (seat.flip ? '교탁에서 본 방향' : '학생 쪽에서 본 방향') + '</button>' +
'<button class="btn ghost sm" onclick="seatPrint()">인쇄</button>' +
'<button class="btn danger sm" onclick="seatDelete()">삭제</button>' +
'</div></div>' +
seatGridHtml(seatChartGrid(cur), { flip: seat.flip }) +
'<div class="hint">칸 왼쪽 위 숫자는 자리 번호입니다. 줄 · 열 수와 사용 불가 자리는 [수정] 또는 [새 자리표 만들기]에서 바꿉니다.</div>' +
'</div><div class="seat-hist"><h3>저장된 자리표 이력 (' + list.length + ')</h3>' + hist +
'<div class="hint">누르면 그때의 자리를 볼 수 있습니다.</div></div></div>';
}
function seatSelect(id){ seat.selId = id; renderSeatView(); }
function seatFlip(){ seat.flip = !seat.flip; renderSeatView(); }
async function seatDelete(){
const cur = seatCurrent();
if (!cur) return;
const list = seatChartsOf(seat.cls);
if (!confirm(seat.school + ' ' + seat.cls + ' 자리표 (' + seatPeriod(list, list.indexOf(cur)) + ')를 삭제하시겠습니까?')) return;
try {
must(await sb.from('seat_charts').delete().eq('id', cur.id));
toast('삭제되었습니다.', 'ok');
seat.selId = null;
await loadSeatData();
renderSeat();
} catch (e) { toast(e.message, 'err'); }
}
function seatPrint(){
const cur = seatCurrent();
if (!cur) return;
const list = seatChartsOf(seat.cls);
const w = window.open('', '_blank');
if (!w){ toast('팝업이 차단되었습니다.', 'err'); return; }
const title = esc(seat.school) + ' ' + esc(seat.cls) + ' 자리표';
w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>' + title + '</title>' +
'<style>body{font-family:sans-serif;margin:16px;color:#0f172a}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 12px;font-size:13px;color:#475569}' +
'.seat-desk{width:46%;margin:12px auto;text-align:center;font-weight:700;border:1px solid #64748b;border-radius:8px;padding:7px 0}' +
'.seat-grid{display:grid;gap:6px}' +
'.seat{position:relative;min-height:64px;border:1px solid #64748b;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px 2px 6px;break-inside:avoid}' +
'.seat small{position:absolute;top:3px;left:6px;font-size:10px;color:#475569}.seat b{font-size:15px}.seat i{font-style:normal;font-size:11px;color:#475569}' +
'.seat.x{background:#e2e8f0}.seat.x b{font-size:11px}@media print{body{margin:0}}</style></head><body>' +
'<h1>' + title + '</h1><p>' + seatPeriod(list, list.indexOf(cur)) + (cur.title ? ' · ' + esc(cur.title) : '') +
' · ' + (seat.flip ? '학생 쪽에서 본 방향' : '교탁에서 본 방향') + '</p>' +
seatGridHtml(seatChartGrid(cur), { flip: seat.flip }) + '<script>window.print()<\/script></body></html>');
w.document.close();
}

/* ---------- 만들기 · 고치기 ---------- */
function seatPeopleOf(cls, chart){
const people = {};
seatStudentsOf(cls).forEach(function(s){ people[s.id] = { id: s.id, number: s.number, name: s.name }; });
// 명단에서 빠진 학생도 자리표에 적힌 이름으로 유지
if (chart) chart.seats.forEach(function(s){ if (!people[s.id]) people[s.id] = { id: s.id, number: s.number, name: s.name }; });
return people;
}
// 새 자리표 : 줄 · 열 · 사용 불가 자리는 보던 자리표 → 이 반의 최근 → 같은 학교의 최근 자리표 순으로 이어받음
function seatNew(){
const n = seatStudentsOf(seat.cls).length;
if (!n){ toast('이 반에 등록된 학생이 없습니다. 수행평가 › 학생 명단에서 먼저 등록하세요.', 'err'); return; }
const src = seatCurrent() || seat.charts.slice().sort(seatBySTART)[0] || null;
seat.edit = {
id: null, start: state.today, title: '',
rows: src ? src.rows : Math.max(1, Math.ceil(n / 6)), cols: src ? src.cols : 6,
blocked: src ? Object.assign({}, src.blocked) : {},
map: {}, people: seatPeopleOf(seat.cls, null), tool: 'move', pick: null
};
renderSeat();
}
function seatEdit(){
const cur = seatCurrent();
if (!cur) return;
const map = {};
cur.seats.forEach(function(s){ map[seatKey(s.r, s.c)] = s.id; });
seat.edit = {
id: cur.id, start: cur.start, title: cur.title, rows: cur.rows, cols: cur.cols,
blocked: Object.assign({}, cur.blocked), map: map, people: seatPeopleOf(seat.cls, cur), tool: 'move', pick: null
};
renderSeat();
}
function seatCancel(){
seat.edit = null;
renderSeat();
}
function seatByNumber(a, b){ return (a.number - b.number) || (a.id - b.id); }
function seatUnplaced(){
const e = seat.edit, used = {};
Object.keys(e.map).forEach(function(k){ used[e.map[k]] = true; });
return Object.keys(e.people).map(function(id){ return e.people[id]; })
.filter(function(p){ return !used[p.id]; }).sort(seatByNumber);
}
function seatFreeKeys(){
const e = seat.edit, out = [];
for (let r = 0; r < e.rows; r++) for (let c = 0; c < e.cols; c++)
if (!e.blocked[seatKey(r, c)]) out.push(seatKey(r, c));
return out;
}
function renderSeatEdit(){
const e = seat.edit, box = document.getElementById('seatBody');
const who = {};
Object.keys(e.map).forEach(function(k){ who[k] = e.people[e.map[k]]; });
const free = seatFreeKeys().length, total = Object.keys(e.people).length, pool = seatUnplaced();
const pickedSeat = e.pick && e.pick.seat;
box.innerHTML =
'<h3 style="margin-top:0">' + (e.id ? '자리표 수정' : '새 자리표') + ' · ' + esc(seat.school) + ' ' + esc(seat.cls) + '</h3>' +
'<div class="row">' +
'<label class="field">줄 (앞뒤)<input type="number" id="seRows" min="1" max="' + SEAT_MAX + '" value="' + e.rows + '" onchange="seatResize()"/></label>' +
'<label class="field">열 (좌우)<input type="number" id="seCols" min="1" max="' + SEAT_MAX + '" value="' + e.cols + '" onchange="seatResize()"/></label>' +
'<label class="field">시작일<input type="date" id="seStart" value="' + esc(e.start) + '" onchange="seat.edit.start=this.value"/></label>' +
'<label class="field">메모<input type="text" id="seTitle" value="' + esc(e.title) + '" placeholder="예: 중간고사 뒤 배치" oninput="seat.edit.title=this.value"/></label>' +
'</div>' +
'<div class="pill-tabs memo" style="margin-top:12px">' +
'<button type="button"' + (e.tool === 'move' ? ' class="active"' : '') + ' onclick="seatTool(\'move\')">자리 배치</button>' +
'<button type="button"' + (e.tool === 'block' ? ' class="active"' : '') + ' onclick="seatTool(\'block\')">사용 불가 자리 지정</button>' +
'</div>' +
'<div class="hint" style="margin-bottom:8px">' + (e.tool === 'block'
? '고장 난 컴퓨터처럼 앉으면 안 되는 자리를 누르세요. 다시 누르면 풀립니다.'
: '자리 두 곳을 차례로 누르면 서로 바뀝니다. 아래 미배치 학생을 누른 뒤 자리를 눌러 앉힐 수도 있습니다.') + '</div>' +
(e.tool === 'move' ? '<div class="flex" style="margin-bottom:4px">' +
'<button class="btn sm" onclick="seatFill(\'random\')">무작위 배치</button>' +
'<button class="btn ghost sm" onclick="seatFill(\'number\')">번호순 배치</button>' +
'<button class="btn ghost sm" onclick="seatFill(\'none\')">모두 비우기</button>' +
(pickedSeat && e.map[pickedSeat] ? '<button class="btn ghost sm" onclick="seatUnseat()">선택한 자리 비우기</button>' : '') +
'</div>' : '') +
seatGridHtml({ rows: e.rows, cols: e.cols, blocked: e.blocked, who: who }, { edit: true, pick: pickedSeat }) +
'<div class="hint">앉을 수 있는 자리 <b>' + free + '</b> · 학생 <b>' + total + '</b>명 · 미배치 <b>' + pool.length + '</b>명' +
(free < total ? ' <span class="badge danger">자리가 ' + (total - free) + '개 모자랍니다</span>' : '') + '</div>' +
(pool.length ? '<h3>미배치 학생</h3><div class="seat-pool">' + pool.map(function(p){
return '<button type="button"' + (e.pick && e.pick.person === p.id ? ' class="pick"' : '') + ' onclick="seatClickPerson(' + p.id + ')">' + esc(p.number) + '번 ' + esc(p.name) + '</button>';
}).join('') + '</div>' : '') +
'<div class="flex" style="margin-top:14px">' +
'<button class="btn" id="seSave" onclick="seatSave()">' + (e.id ? '수정 내용 저장' : '새 자리표로 저장') + '</button>' +
'<button class="btn ghost" onclick="seatCancel()">취소</button></div>';
}
function seatTool(t){ seat.edit.tool = t; seat.edit.pick = null; renderSeatEdit(); }
// 줄 · 열 수를 바꿈 : 밖으로 나간 자리의 학생은 미배치로
function seatResize(){
const e = seat.edit;
const clamp = function(id, cur){
const v = Math.round(Number(document.getElementById(id).value));
return isFinite(v) && v >= 1 ? Math.min(SEAT_MAX, v) : cur;
};
e.rows = clamp('seRows', e.rows); e.cols = clamp('seCols', e.cols);
const inside = function(k){ const p = k.split('-'); return Number(p[0]) < e.rows && Number(p[1]) < e.cols; };
Object.keys(e.map).forEach(function(k){ if (!inside(k)) delete e.map[k]; });
Object.keys(e.blocked).forEach(function(k){ if (!inside(k)) delete e.blocked[k]; });
e.pick = null;
// 다음 칸으로 넘어가던 중이면 다시 그린 뒤에도 그 칸에 머물도록
setTimeout(function(){
if (!seat.edit) return;
const a = document.activeElement, id = a && a.id;
renderSeatEdit();
const el = id && document.getElementById(id);
if (el && /^se[A-Z]/.test(id)){ el.focus(); if (el.type === 'number' || el.type === 'text') el.select(); }
}, 0);
}
function seatClick(key){
const e = seat.edit;
if (e.tool === 'block'){
if (e.blocked[key]) delete e.blocked[key];
else { e.blocked[key] = true; delete e.map[key]; }
renderSeatEdit();
return;
}
if (e.blocked[key]){ toast('사용 불가 자리입니다.', 'err'); return; }
if (e.pick && e.pick.person != null){
e.map[key] = e.pick.person; // 앉아 있던 학생은 미배치로
e.pick = null;
} else if (e.pick && e.pick.seat){
const from = e.pick.seat, a = e.map[from], b = e.map[key];
if (from !== key){
if (b == null) delete e.map[from]; else e.map[from] = b;
if (a == null) delete e.map[key]; else e.map[key] = a;
}
e.pick = null;
} else {
e.pick = { seat: key };
}
renderSeatEdit();
}
function seatClickPerson(id){
const e = seat.edit;
if (e.tool !== 'move') return;
if (e.pick && e.pick.seat){
e.map[e.pick.seat] = id;
e.pick = null;
} else {
e.pick = (e.pick && e.pick.person === id) ? null : { person: id };
}
renderSeatEdit();
}
function seatUnseat(){
const e = seat.edit;
if (e.pick && e.pick.seat) delete e.map[e.pick.seat];
e.pick = null;
renderSeatEdit();
}
function seatFill(mode){
const e = seat.edit;
e.map = {}; e.pick = null;
if (mode !== 'none'){
const ids = Object.keys(e.people).map(function(id){ return e.people[id]; }).sort(seatByNumber).map(function(p){ return p.id; });
if (mode === 'random'){
for (let i = ids.length - 1; i > 0; i--){
const j = Math.floor(Math.random() * (i + 1));
const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
}
}
const free = seatFreeKeys();
ids.forEach(function(id, i){ if (i < free.length) e.map[free[i]] = id; });
if (ids.length > free.length) toast('자리가 모자라 ' + (ids.length - free.length) + '명은 미배치로 남았습니다.', 'err');
}
renderSeatEdit();
}
async function seatSave(){
const e = seat.edit;
if (!e.start){ toast('시작일을 입력하세요', 'err'); return; }
const left = seatUnplaced().length;
if (left && !confirm('미배치 학생이 ' + left + '명 있습니다. 그대로 저장할까요?')) return;
const keyRC = function(k){ const p = k.split('-'); return [Number(p[0]), Number(p[1])]; };
const row = {
school_year: settings.year, school: seat.school, class_name: seat.cls,
title: (e.title || '').trim(), start_date: e.start, row_count: e.rows, col_count: e.cols,
blocked: Object.keys(e.blocked).map(keyRC),
seats: Object.keys(e.map).map(function(k){
const rc = keyRC(k), p = e.people[e.map[k]];
return { r: rc[0], c: rc[1], id: p.id, number: p.number, name: p.name };
}),
updated_at: new Date().toISOString()
};
const btn = document.getElementById('seSave');
btn.disabled = true;
try {
let id = e.id;
if (id) must(await sb.from('seat_charts').update(row).eq('id', id));
else id = must(await sb.from('seat_charts').insert(row).select('id').single()).id;
seat.edit = null; seat.selId = id;
await loadSeatData();
toast('자리표를 저장했습니다.', 'ok');
renderSeat();
} catch (err) {
btn.disabled = false;
toast(err.message, 'err');
}
}
