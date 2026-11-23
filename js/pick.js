/* =========================================================
   발표자 뽑기 ([발표자] 탭)
   - 학교 · 반을 고르면 수행평가 › 학생 명단(eval_students)의 번호 · 이름이 돌림판에 들어갑니다.
   - 뽑힌 순서는 이 브라우저에 반별로 기억합니다 (localStorage, DB에는 저장하지 않음).
========================================================= */
const PICK_COLORS = ['#e0e7ff', '#fef3c7', '#d1fae5', '#fee2e2', '#e0f2fe', '#f3e8ff', '#ffedd5', '#dcfce7'];
const pick = {
school: '', cls: '', students: [],
order: [],      // 뽑힌 학생 id (뽑힌 순서)
exclude: true,  // 한 번 뽑힌 학생은 제외
wheel: [],      // 지금 돌림판에 그려진 학생
last: null, spinning: false
};
function pickStudentsOf(){ return pick.students.filter(function(s){ return s.class_name === pick.cls; }); }
function pickStoreKey(){ return 'pick|' + settings.year + '|' + pick.school + '|' + pick.cls; }
function pickLoadOrder(){
const ok = {};
pickStudentsOf().forEach(function(s){ ok[s.id] = true; });
let a = [];
try { a = JSON.parse(localStorage.getItem(pickStoreKey()) || '[]'); } catch (e) {}
pick.order = Array.isArray(a) ? a.filter(function(id){ return ok[id]; }) : [];
pick.last = null;
}
function pickSaveOrder(){
try { localStorage.setItem(pickStoreKey(), JSON.stringify(pick.order)); } catch (e) {}
}
function pickPool(){
const list = pickStudentsOf();
if (!pick.exclude) return list;
return list.filter(function(s){ return pick.order.indexOf(s.id) < 0; });
}
async function loadPick(){
if (pick.spinning) return;
const box = document.getElementById('pickBody');
box.innerHTML = '<div class="skeleton"><span class="spinner"></span>불러오는 중...</div>';
try {
if (!ev.schools.length) await loadEvalSchools();
if (!pick.school || ev.schools.indexOf(pick.school) < 0) pick.school = ev.school || ev.schools[0] || '';
const s = pick.school;
pick.students = !s ? [] : (await fetchAll(function(){
return sb.from('eval_students').select('id,class_name,number,name').eq('school_year', settings.year).eq('school', s).order('id');
})).sort(function(a, b){ return byClassName(a.class_name, b.class_name) || (a.number - b.number); });
} catch (e) {
box.innerHTML = '<div class="empty"><div class="big">불러오기 실패</div><div>' + esc(e.message) + '</div></div>';
return;
}
if (state.view !== 'pick') return;
renderPick(true);
}
function pickPickSchool(){
pick.school = document.getElementById('pickSchool').value;
pick.cls = '';
loadPick();
}
function pickPickClass(){
pick.cls = document.getElementById('pickClass').value;
renderPick(true);
}
function renderPick(reloadOrder){
const sSel = document.getElementById('pickSchool'), cSel = document.getElementById('pickClass');
sSel.innerHTML = ev.schools.length ? ev.schools.map(function(s){ return opt(s); }).join('') : '<option value="">(학교 없음)</option>';
sSel.value = pick.school;
const set = {};
pick.students.forEach(function(s){ set[s.class_name] = true; });
const classes = Object.keys(set).sort(byClassName);
if (classes.indexOf(pick.cls) < 0){ pick.cls = classes[0] || ''; reloadOrder = true; }
cSel.innerHTML = classes.length ? classes.map(function(c){ return opt(c, c + ' (' + pick.students.filter(function(s){ return s.class_name === c; }).length + '명)'); }).join('') : '<option value="">(등록된 반 없음)</option>';
cSel.value = pick.cls;
const box = document.getElementById('pickBody');
if (!pick.cls){
box.innerHTML = '<div class="empty"><div class="big">등록된 학생이 없습니다</div><div>수행평가 › 학생 명단에서 학생을 먼저 등록하세요.</div></div>';
return;
}
if (reloadOrder) pickLoadOrder();
pick.wheel = pickPool();
box.innerHTML = '<div class="pick-wrap">' +
'<div class="pick-wheel-box"><div class="pick-pointer" aria-hidden="true"></div><div id="pickWheel" class="pick-wheel">' + pickWheelSvg(pick.wheel) + '</div></div>' +
'<div class="pick-side" id="pickSide"></div></div>';
renderPickSide();
}
function renderPickSide(){
const all = pickStudentsOf(), pool = pickPool(), byId = {};
all.forEach(function(s){ byId[s.id] = s; });
const last = pick.last != null ? byId[pick.last] : null;
document.getElementById('pickSide').innerHTML =
'<div class="pick-result" aria-live="polite"><div class="muted">이번 발표자</div>' +
'<div class="pick-no">' + (last ? esc(last.number) + '번' : esc(pick.school) + ' ' + esc(pick.cls)) + '</div>' +
'<div class="pick-name">' + (pick.spinning ? '돌리는 중…' : (last ? esc(last.name) : '돌림판을 돌려 주세요')) + '</div></div>' +
'<button class="btn pick-go" id="pickGo" onclick="pickSpin()"' + (pick.spinning ? ' disabled' : '') + '>돌리기</button>' +
'<label class="pick-opt"><input type="checkbox"' + (pick.exclude ? ' checked' : '') + (pick.spinning ? ' disabled' : '') + ' onchange="pickToggleExclude(this.checked)"/> 한 번 뽑힌 학생은 제외</label>' +
'<div class="hint">남은 학생 <b>' + pool.length + '</b>명 · 전체 <b>' + all.length + '</b>명</div>' +
'<div class="pick-order-head"><h3>뽑힌 순서 (' + pick.order.length + ')</h3>' +
'<button class="btn ghost sm" onclick="pickReset()"' + (pick.spinning ? ' disabled' : '') + '>처음부터 다시</button></div>' +
(pick.order.length ? '<div class="pick-chips">' + pick.order.map(function(id, i){
const s = byId[id];
return s ? '<span>' + (i + 1) + '. ' + esc(s.number) + '번 ' + esc(s.name) + '</span>' : '';
}).join('') + '</div>' : '<div class="hint">아직 뽑힌 학생이 없습니다.</div>') +
'<div class="hint" style="margin-top:10px">뽑힌 순서는 이 컴퓨터(브라우저)에 반별로 남아, 다음 시간에 이어서 뽑을 수 있습니다.</div>';
}
/* 돌림판 그림 : 12시 방향에서 시계 방향으로 한 칸씩 */
function pickWheelSvg(list){
const n = list.length;
if (!n) return '<div class="empty" style="padding:60px 10px"><div class="big">모두 뽑았습니다</div><div>[처음부터 다시]를 누르면 돌림판이 다시 채워집니다.</div></div>';
const step = 360 / n;
const pt = function(deg, r){ const a = deg * Math.PI / 180; return (r * Math.sin(a)).toFixed(3) + ' ' + (-r * Math.cos(a)).toFixed(3); };
let out = '';
list.forEach(function(s, i){
let ci = i % PICK_COLORS.length;
if (i === n - 1 && ci === 0 && n > 1) ci = 4; // 마지막 칸이 첫 칸과 같은 색이 되지 않게
const label = s.number + ' ' + s.name;
const fs = Math.max(2.6, Math.min(9, 2 * Math.PI * 60 / n * 0.62, 66 / (label.length * 0.95)));
const mid = (i + 0.5) * step;
out += '<g data-i="' + i + '">' +
(n === 1 ? '<circle r="100" fill="' + PICK_COLORS[0] + '"/>'
: '<path d="M0 0 L' + pt(i * step, 100) + ' A100 100 0 ' + (step > 180 ? 1 : 0) + ' 1 ' + pt((i + 1) * step, 100) + ' Z" fill="' + PICK_COLORS[ci] + '"/>') +
'<text transform="rotate(' + (mid - 90).toFixed(3) + ') translate(60 0)" text-anchor="middle" dominant-baseline="central" font-size="' + fs.toFixed(2) + '">' + esc(label) + '</text></g>';
});
return '<svg viewBox="-104 -104 208 208" role="img" aria-label="발표자 돌림판, 학생 ' + n + '명">' +
'<circle r="103" fill="#0f172a"/>' + out + '<circle r="7" fill="#0f172a"/></svg>';
}
function pickSpin(){
if (pick.spinning) return;
const pool = pickPool();
if (!pool.length){ toast('모두 뽑았습니다. [처음부터 다시]를 눌러 주세요.', 'err'); return; }
// 지난번에 뽑힌 학생을 뺀 돌림판으로 다시 그림
pick.wheel = pool;
const wheel = document.getElementById('pickWheel');
wheel.innerHTML = pickWheelSvg(pool);
const svg = wheel.querySelector('svg');
const idx = Math.floor(Math.random() * pool.length), step = 360 / pool.length;
const deg = 360 * 6 - (idx + 0.5) * step + (Math.random() - 0.5) * step * 0.7;
const quick = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ms = quick ? 300 : 4200;
pick.spinning = true;
renderPickSide();
svg.getBoundingClientRect(); // 처음 위치를 한 번 그린 뒤에 돌리기 시작
svg.style.transition = 'transform ' + ms + 'ms cubic-bezier(.12,.75,.1,1)';
svg.style.transform = 'rotate(' + deg.toFixed(2) + 'deg)';
const winner = pool[idx], key = pickStoreKey();
setTimeout(function(){
pick.spinning = false;
if (key !== pickStoreKey()) return; // 도는 동안 학년도가 바뀐 경우
pick.last = winner.id;
pick.order.push(winner.id);
pickSaveOrder();
if (state.view !== 'pick' || !document.getElementById('pickSide')) return;
const g = document.querySelector('#pickWheel g[data-i="' + idx + '"]');
if (g) g.setAttribute('class', 'win');
renderPickSide();
}, ms + 80);
}
function pickToggleExclude(on){
pick.exclude = !!on;
renderPick(false);
}
function pickReset(){
if (pick.order.length && !confirm(pick.school + ' ' + pick.cls + '의 뽑힌 순서를 지우고 처음부터 다시 뽑을까요?')) return;
pick.order = []; pick.last = null;
pickSaveOrder();
renderPick(false);
}

