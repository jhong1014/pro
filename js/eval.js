/* =========================================================
   수행평가 : 평가 기준 / 점수 입력 / 학생 명단 (학교별)
   - 테이블: eval_students, eval_tasks, eval_items, eval_item_levels, eval_scores
   - SQL: supabase/evaluation.sql
========================================================= */
const ev = {
school: '', schools: [],
students: [], tasks: [], scoreRows: [], // 현재 학교 데이터
galleryLinks: {}, gallerySchools: null, // 바이브코딩 갤러리 연동 (채점 요소 id → 갤러리 학교)
editing: null // 수정 중인 평가 기준 (새 기준이면 {})
};

function evNum(v){ const n = Number(v); return isFinite(n) ? n : 0; }
function evFmt(v){ return String(Math.round(evNum(v) * 100) / 100); }
function opt(v, label){ return '<option value="'+esc(v)+'">'+esc(label == null ? v : label)+'</option>'; }
function byClassName(a, b){ return String(a).localeCompare(String(b), 'ko', { numeric: true }); }
function evClasses(){
const set = {};
ev.students.forEach(function(s){ set[s.class_name] = true; });
return Object.keys(set).sort(byClassName);
}
function evStudentsOf(cls){
return ev.students.filter(function(s){ return s.class_name === cls; });
}
function evTask(id){
for (let i = 0; i < ev.tasks.length; i++) if (ev.tasks[i].id === id) return ev.tasks[i];
return null;
}
function evLevel(id){
for (let i = 0; i < ev.tasks.length; i++)
for (let j = 0; j < ev.tasks[i].items.length; j++)
for (let k = 0; k < ev.tasks[i].items[j].levels.length; k++)
if (ev.tasks[i].items[j].levels[k].id === id) return ev.tasks[i].items[j].levels[k];
return null;
}
function bySort(a, b){ return (a.sort - b.sort) || (a.id - b.id); }
function normTask(t){
const items = (t.eval_items || []).slice().sort(bySort).map(function(i){
return { id: i.id, name: i.name, max_score: evNum(i.max_score),
levels: (i.eval_item_levels || []).slice().sort(bySort).map(function(l){
return { id: l.id, description: l.description, score: evNum(l.score) };
}) };
});
return {
id: t.id, school: t.school, title: t.title, target: t.target || '',
weight_pct: t.weight_pct, published: !!t.published, items: items
};
}
function taskMax(t){
return t.items.reduce(function(s, i){ return s + evNum(i.max_score); }, 0);
}

/* ---------- 데이터 불러오기 ---------- */
async function loadEvalSchools(){
const res = await Promise.all([
fetchAll(function(){ return sb.from('eval_students').select('school').eq('school_year', settings.year).order('id'); }),
fetchAll(function(){ return sb.from('eval_tasks').select('school').eq('school_year', settings.year).eq('semester', settings.semester).order('id'); }),
loadSchoolList()
]);
const set = {};
res[0].concat(res[1]).forEach(function(r){ if (r.school) set[r.school] = true; });
res[2].forEach(function(s){ set[s] = true; });
if (ev.school) set[ev.school] = true;
ev.schools = Object.keys(set).sort();
if (!ev.school){
let saved = '';
try { saved = localStorage.getItem('evSchool') || ''; } catch (e) {}
ev.school = ev.schools.indexOf(saved) >= 0 ? saved : (ev.schools[0] || '');
}
applyEvalSchools();
}
function applyEvalSchools(){
if (ev.school && ev.schools.indexOf(ev.school) < 0){ ev.schools.push(ev.school); ev.schools.sort(); }
const sel = document.getElementById('evSchool');
sel.innerHTML = (ev.schools.length ? '' : '<option value="">(학교 없음)</option>') +
ev.schools.map(function(s){ return opt(s); }).join('') +
'<option value="__new">＋ 다른 학교 입력…</option>';
sel.value = ev.school;
}
function changeEvalSchool(){
const sel = document.getElementById('evSchool');
if (sel.value === '__new'){
const name = (prompt('학교명을 입력하세요') || '').trim();
if (!name){ sel.value = ev.school; return; }
ev.school = name;
applyEvalSchools();
} else {
ev.school = sel.value;
}
try { localStorage.setItem('evSchool', ev.school); } catch (e) {}
closeTaskEditor();
reload();
}
async function loadEvalData(){
const s = ev.school;
if (!s){ ev.students = []; ev.tasks = []; ev.scoreRows = []; return; }
const res = await Promise.all([
fetchAll(function(){
return sb.from('eval_students').select('id,class_name,number,name,access_code').eq('school_year', settings.year).eq('school', s).order('id');
}),
sb.from('eval_tasks').select('*, eval_items(*, eval_item_levels(*))').eq('school_year', settings.year).eq('semester', settings.semester).eq('school', s).order('id').then(must)
]);
ev.students = res[0].sort(function(a, b){ return byClassName(a.class_name, b.class_name) || (a.number - b.number); });
ev.tasks = res[1].map(normTask);
const itemIds = [];
ev.tasks.forEach(function(t){ t.items.forEach(function(i){ itemIds.push(i.id); }); });
ev.scoreRows = itemIds.length ? await fetchAll(function(){
return sb.from('eval_scores').select('id,student_id,item_id,level_id').in('item_id', itemIds).order('id');
}) : [];
await loadGalleryLinks(itemIds);
}
/* 바이브코딩 갤러리 연동 정보 (DB에 연동 기능이 아직 없으면 조용히 건너뜀) */
async function loadGalleryLinks(itemIds){
ev.galleryLinks = {};
try {
if (ev.gallerySchools === null)
ev.gallerySchools = must(await sb.rpc('eval_gallery_school_list')) || [];
if (itemIds.length){
const rows = must(await sb.from('eval_gallery_links').select('item_id,gallery_school').in('item_id', itemIds));
rows.forEach(function(r){ ev.galleryLinks[r.item_id] = r.gallery_school; });
}
} catch (e) {
ev.gallerySchools = ev.gallerySchools || [];
console.warn('갤러리 연동 정보를 불러오지 못했습니다', e);
}
}
async function loadEval(){
const v = state.view;
const box = { etask: 'etList', escore: 'scBody', esum: 'smBody', esign: 'sgBody', estu: 'esList' }[v];
if (!(v === 'etask' && ev.editing))
document.getElementById(box).innerHTML = '<div class="skeleton"><span class="spinner"></span>불러오는 중...</div>';
try {
if (!ev.schools.length) await loadEvalSchools();
await loadEvalData();
if (v === 'esign') await loadSignatures();
} catch (e) {
toast(e.message, 'err');
document.getElementById(box).innerHTML = '<div class="empty"><div class="big">불러오기 실패</div><div>'+esc(e.message)+'</div></div>';
return;
}
if (state.view !== v) return;
if (v === 'etask') renderTaskView();
else if (v === 'escore') renderScoreView();
else if (v === 'esum') renderSummaryView();
else if (v === 'esign') renderSignView();
else renderStudentView();
}

/* ============== 평가 기준 목록 ============== */
function renderTaskView(){
if (ev.editing){
// 다른 탭에 다녀와도 입력 중이던 내용 유지
if (!document.getElementById('etEditor').innerHTML) showTaskEditor();
return;
}
document.getElementById('etEditor').style.display = 'none';
const box = document.getElementById('etList');
box.style.display = '';
if (!ev.school){
box.innerHTML = '<div class="empty"><div class="big">학교를 먼저 선택하세요</div></div>';
return;
}
// 과제별 점수가 입력된 학생 수
const taskOfItem = {}, scored = {};
ev.tasks.forEach(function(t){ t.items.forEach(function(i){ taskOfItem[i.id] = t.id; }); });
ev.scoreRows.forEach(function(r){
const tid = taskOfItem[r.item_id];
(scored[tid] = scored[tid] || {})[r.student_id] = true;
});
let html = '<div class="flex" style="justify-content:space-between; align-items:center; margin-bottom:10px">' +
'<h2 style="margin:0">'+esc(ev.school)+' 평가 기준 <span class="badge">'+ev.tasks.length+'개</span></h2>' +
'<button class="btn" onclick="openTaskEditor(null)">＋ 새 평가 기준</button></div>';
if (!ev.tasks.length){
html += '<div class="empty"><div class="big">등록된 평가 기준이 없습니다</div>' +
'<div>[＋ 새 평가 기준]으로 입력하거나, 다른 학교의 기준을 복사해 오세요.</div></div>';
}
ev.tasks.forEach(function(t){
const n = Object.keys(scored[t.id] || {}).length;
html += '<div class="ev-task">' +
'<div class="ev-task-head"><b>'+esc(t.title)+'</b>' +
(t.published ? '<span class="badge ok">학생 공개</span>' : '<span class="badge warn">비공개</span>') +
(t.target ? '<span class="muted" style="font-size:13px">'+esc(t.target)+'</span>' : '') + '</div>' +
'<div class="ev-task-items">' + (t.items.length ? t.items.map(function(i){
return esc(i.name) + ' <b>' + evFmt(i.max_score) + '</b>';
}).join(' · ') : '<span class="muted">채점 요소 없음</span>') + '</div>' +
'<div class="ev-task-meta">총점 ' + evFmt(taskMax(t)) + '점' +
(t.weight_pct != null && t.weight_pct !== '' ? ' · 반영 ' + evFmt(t.weight_pct) + '%' : '') +
' · 점수 입력 ' + n + '명</div>' +
'<div class="flex">' +
'<button class="btn warn sm" onclick="openTaskEditor('+t.id+')">수정</button>' +
'<button class="btn ghost sm" onclick="openCopyModal('+t.id+')">복사</button>' +
'<button class="btn ghost sm" onclick="togglePublish('+t.id+')">'+(t.published ? '비공개로 전환' : '학생에게 공개')+'</button>' +
'<button class="btn ghost sm" onclick="goScore('+t.id+')">점수 입력 →</button>' +
'<button class="btn danger sm" onclick="deleteTask('+t.id+','+n+')">삭제</button>' +
'</div></div>';
});
box.innerHTML = html;
}
async function togglePublish(id){
const t = evTask(id);
try {
must(await sb.from('eval_tasks').update({ published: !t.published, updated_at: new Date().toISOString() }).eq('id', id));
t.published = !t.published;
toast(t.published ? '학생에게 공개했습니다.' : '비공개로 바꿨습니다.', 'ok');
if (state.view === 'escore') renderScoreView(); else renderTaskView();
} catch (e) { toast(e.message, 'err'); }
}
async function deleteTask(id, scoredCount){
const t = evTask(id);
let msg = '"' + t.title + '" 평가 기준을 삭제하시겠습니까?';
if (scoredCount) msg += '\n입력된 학생 ' + scoredCount + '명의 점수도 함께 삭제됩니다.';
if (!confirm(msg)) return;
try {
must(await sb.from('eval_tasks').delete().eq('id', id));
toast('삭제되었습니다.', 'ok');
loadEval();
} catch (e) { toast(e.message, 'err'); }
}
function goScore(id){
state.scoreTask = id;
document.querySelector('.tab[data-view="escore"]').click();
}

/* ---------- 복사 ---------- */
function openCopyModal(id){
const t = evTask(id);
state.copyTask = id;
document.getElementById('cpMeta').textContent = ev.school + ' · ' + t.title;
const sel = document.getElementById('cpSchool');
sel.innerHTML = ev.schools.map(function(s){ return opt(s, s === ev.school ? s + ' (현재 학교)' : s); }).join('');
sel.value = ev.school;
const ySel = document.getElementById('cpYear');
ySel.innerHTML = [settings.year + 1, settings.year, settings.year - 1].map(function(y){
return opt(y, y + '학년도' + (y === settings.year ? ' (현재)' : ''));
}).join('');
ySel.value = settings.year;
document.getElementById('cpSemester').value = settings.semester;
document.getElementById('copyModal').classList.add('show');
}
function closeCopyModal(){
document.getElementById('copyModal').classList.remove('show');
}
async function doCopyTask(){
const target = document.getElementById('cpSchool').value;
const year = Number(document.getElementById('cpYear').value);
const sem = Number(document.getElementById('cpSemester').value);
const here = target === ev.school && year === settings.year && sem === settings.semester;
try {
must(await sb.rpc('copy_eval_task', { p_task_id: state.copyTask, p_school: target, p_year: year, p_semester: sem }));
closeCopyModal();
toast((here ? '복사본을 만들었습니다.' : year + '학년도 ' + sem + '학기 ' + target + '(으)로 복사했습니다.') + ' 복사본은 학생 비공개 상태입니다.', 'ok');
if (here) loadEval();
} catch (e) { toast(e.message, 'err'); }
}

/* ============== 평가 기준 입력 · 수정 ============== */
function openTaskEditor(id){
if (id){
ev.editing = JSON.parse(JSON.stringify(evTask(id)));
} else {
ev.editing = {
title: '', target: '', weight_pct: '', published: false,
items: [{ name: '', max_score: '', levels: [{ description: '', score: '' }] }]
};
}
showTaskEditor();
}
function showTaskEditor(){
const t = ev.editing;
// 이미 점수가 입력된 채점 요소/기준 (지울 때 경고용)
ev.useLevel = {}; ev.useItem = {};
ev.scoreRows.forEach(function(r){
ev.useLevel[r.level_id] = (ev.useLevel[r.level_id] || 0) + 1;
ev.useItem[r.item_id] = (ev.useItem[r.item_id] || 0) + 1;
});
document.getElementById('etList').style.display = 'none';
const box = document.getElementById('etEditor');
box.style.display = '';
box.innerHTML =
'<h2>' + (t.id ? '평가 기준 수정' : '새 평가 기준') + ' <span class="muted" style="font-size:13px; font-weight:500">' + esc(ev.school) + '</span></h2>' +
'<div class="row">' +
'<label class="field" style="grid-column:1/-1">수행 과제<input type="text" id="etTitle" placeholder="예: 가. 생활 속 인공지능 찾아 사례 조사 및 발표" value="'+esc(t.title)+'"/></label>' +
'<label class="field">대상 (선택)<input type="text" id="etTarget" placeholder="예: 1학년" value="'+esc(t.target)+'"/></label>' +
'<label class="field">반영 비율 % (선생님만 보임)<input type="number" step="any" id="etWeight" placeholder="예: 30" value="'+esc(t.weight_pct == null ? '' : t.weight_pct)+'"/></label>' +
'</div>' +
'<h3>채점 요소 · 채점 기준 · 배점</h3>' +
'<div id="etItems">' + t.items.map(etItemBlock).join('') + '</div>' +
'<button class="btn ghost sm" onclick="etAddItem()">＋ 채점 요소 추가</button>' +
'<div class="et-total" id="etTotal"></div>' +
'<label class="flex" style="margin-top:10px; align-items:center; gap:6px; font-size:14px; cursor:pointer">' +
'<input type="checkbox" id="etPublished" '+(t.published ? 'checked' : '')+'/> 학생에게 공개 (점수가 입력된 학생만 조회됩니다)</label>' +
'<div class="flex" style="margin-top:14px">' +
'<button class="btn" onclick="saveTask()">저장</button>' +
'<button class="btn ghost" onclick="cancelTaskEditor()">취소</button>' +
'</div>';
etValidate();
}
function etLevelRow(l){
return '<div class="et-level" data-id="'+(l.id || '')+'">' +
'<input type="text" class="et-l-desc" value="'+esc(l.description)+'" placeholder="채점 기준 (예: 사례 3가지를 조사하고 …)"/>' +
'<input type="number" step="any" class="et-l-score" value="'+esc(l.score)+'" placeholder="점수"/>' +
'<button class="icon-btn" title="삭제" onclick="etRemoveLevel(this)">✕</button></div>';
}
function etItemBlock(it){
return '<div class="et-item" data-id="'+(it.id || '')+'">' +
'<div class="et-item-head">' +
'<input type="text" class="et-i-name" value="'+esc(it.name)+'" placeholder="채점 요소 (예: 내용의 적절성)"/>' +
'<input type="number" step="any" class="et-i-max" value="'+esc(it.max_score)+'" placeholder="배점"/>' +
'<button class="icon-btn" title="위로" onclick="etMoveItem(this,-1)">↑</button>' +
'<button class="icon-btn" title="아래로" onclick="etMoveItem(this,1)">↓</button>' +
'<button class="icon-btn" title="채점 요소 삭제" onclick="etRemoveItem(this)">✕</button>' +
'</div>' +
'<div class="et-levels">' + it.levels.map(etLevelRow).join('') + '</div>' +
'<button class="btn ghost sm" onclick="etAddLevel(this)">＋ 채점 기준 추가</button>' +
'<div class="et-warn"></div></div>';
}
function etAddItem(){
document.getElementById('etItems').insertAdjacentHTML('beforeend',
etItemBlock({ name: '', max_score: '', levels: [{ description: '', score: '' }] }));
etValidate();
}
function etAddLevel(btn){
const levels = btn.parentElement.querySelector('.et-levels');
levels.insertAdjacentHTML('beforeend', etLevelRow({ description: '', score: '' }));
levels.lastElementChild.querySelector('.et-l-desc').focus();
etValidate();
}
function etRemoveLevel(btn){
const row = btn.parentElement;
const used = ev.useLevel[row.dataset.id];
if (used && !confirm('이 채점 기준으로 입력된 점수 ' + used + '건이 저장할 때 함께 삭제됩니다. 지울까요?')) return;
row.remove();
etValidate();
}
function etRemoveItem(btn){
const block = btn.closest('.et-item');
const used = ev.useItem[block.dataset.id];
const name = block.querySelector('.et-i-name').value || '이 채점 요소';
let msg = '"' + name + '"를 지울까요?';
if (used) msg += '\n입력된 점수 ' + used + '건이 저장할 때 함께 삭제됩니다.';
if (!confirm(msg)) return;
block.remove();
etValidate();
}
function etMoveItem(btn, dir){
const block = btn.closest('.et-item');
const other = dir < 0 ? block.previousElementSibling : block.nextElementSibling;
if (!other) return;
if (dir < 0) other.before(block); else other.after(block);
}
/* 배점과 채점 기준 점수가 맞는지 확인 (저장은 막지 않음) */
function etValidate(){
let total = 0;
document.querySelectorAll('#etItems .et-item').forEach(function(block){
const maxStr = block.querySelector('.et-i-max').value;
const max = evNum(maxStr);
total += max;
const scores = [];
block.querySelectorAll('.et-l-score').forEach(function(i){ if (i.value !== '') scores.push(evNum(i.value)); });
const warns = [];
if (!block.querySelectorAll('.et-level').length) warns.push('채점 기준을 1개 이상 입력하세요.');
if (maxStr === '') warns.push('배점을 입력하세요.');
else if (scores.length && Math.max.apply(null, scores) !== max)
warns.push('가장 높은 점수(' + evFmt(Math.max.apply(null, scores)) + ')가 배점(' + evFmt(max) + ')과 다릅니다.');
if (scores.some(function(v, i){ return scores.indexOf(v) !== i; }))
warns.push('같은 점수가 두 번 있습니다. 점수 입력에서는 위쪽 기준으로 저장됩니다.');
block.querySelector('.et-warn').textContent = warns.join(' ');
});
const el = document.getElementById('etTotal');
if (el) el.textContent = '총점 ' + evFmt(total) + '점';
}
function etCollect(){
return {
id: ev.editing.id || null,
school_year: settings.year,
semester: settings.semester,
school: ev.school,
title: document.getElementById('etTitle').value.trim(),
target: document.getElementById('etTarget').value.trim(),
weight_pct: document.getElementById('etWeight').value,
published: document.getElementById('etPublished').checked,
items: Array.prototype.map.call(document.querySelectorAll('#etItems .et-item'), function(b){
return {
id: b.dataset.id || null,
name: b.querySelector('.et-i-name').value.trim(),
max_score: b.querySelector('.et-i-max').value,
levels: Array.prototype.map.call(b.querySelectorAll('.et-level'), function(r){
return { id: r.dataset.id || null, description: r.querySelector('.et-l-desc').value.trim(), score: r.querySelector('.et-l-score').value };
}).filter(function(l){ return l.description || l.score !== ''; })
};
})
};
}
async function saveTask(){
const p = etCollect();
if (!p.title){ toast('수행 과제명을 입력하세요', 'err'); return; }
if (!p.items.length){ toast('채점 요소를 1개 이상 입력하세요', 'err'); return; }
try {
must(await sb.rpc('save_eval_task', { p: p }));
// 채점 기준이 바뀌었을 수 있으므로 갤러리와 연결된 채점 요소는 점수를 다시 가져옴
const linked = (p.items || []).map(function(i){ return Number(i.id); }).filter(function(id){ return id && ev.galleryLinks[id]; });
for (let k = 0; k < linked.length; k++){
try { must(await sb.rpc('eval_gallery_sync_item', { p_item_id: linked[k] })); } catch (e2) { console.warn(e2); }
}
toast('저장되었습니다.', 'ok');
closeTaskEditor();
loadEval();
} catch (e) { toast(e.message, 'err'); }
}
function cancelTaskEditor(){
if (!confirm('입력한 내용을 저장하지 않고 닫을까요?')) return;
closeTaskEditor();
renderTaskView();
}
function closeTaskEditor(){
ev.editing = null;
document.getElementById('etEditor').innerHTML = '';
}

/* ============== 점수 입력 ============== */
function renderScoreView(){
const tSel = document.getElementById('scTask'), cSel = document.getElementById('scClass');
const prevT = state.scoreTask || Number(tSel.value), prevC = cSel.value;
state.scoreTask = null;
tSel.innerHTML = ev.tasks.length ? ev.tasks.map(function(t){ return opt(t.id, t.title + (t.published ? '' : ' (비공개)')); }).join('')
: '<option value="">(평가 기준 없음)</option>';
if (evTask(prevT)) tSel.value = prevT;
const classes = evClasses();
cSel.innerHTML = classes.length ? classes.map(function(c){ return opt(c); }).join('')
: '<option value="">(학생 명단 없음)</option>';
if (classes.indexOf(prevC) >= 0) cSel.value = prevC;
renderScoreTable();
}
function scoreKey(sid, iid){ return sid + '|' + iid; }
function scoreMap(){
const m = {};
ev.scoreRows.forEach(function(r){ m[scoreKey(r.student_id, r.item_id)] = r; });
return m;
}
/* 입력한 점수 → 채점 기준 (같은 점수가 둘이면 첫 번째 기준) */
function levelOfScore(item, value){
const v = String(value).trim();
if (v === '' || !isFinite(Number(v))) return null;
for (let i = 0; i < item.levels.length; i++) if (item.levels[i].score === Number(v)) return item.levels[i];
return null;
}
function allowedScores(item){
const seen = {};
return item.levels.map(function(l){ return evFmt(l.score); }).filter(function(v){ return seen[v] ? false : (seen[v] = true); });
}
/* ============== 바이브코딩 갤러리 점수 자동 입력 ==============
   채점 요소(영역)를 갤러리 학교와 연결하면, 갤러리에서 선생님이 준 평가 점수(30 · 22 · 14 · 6)가
   학번(학년 · 반 · 번호)이 같은 학생의 그 채점 요소 점수로 자동 입력됩니다. (DB 트리거)
   - 채점 기준에 30 · 22 · 14 · 6점이 모두 있으면 같은 점수, 아니면 등급 순서대로 맞춰 넣음
   - 작품이 여러 개면 가장 높은 점수 */
function guessGallerySchool(){
const list = ev.gallerySchools || [], s = ev.school;
for (let i = 0; i < list.length; i++) if (list[i] === s || list[i] === s + '학교') return list[i];
for (let i = 0; i < list.length; i++) if (s && list[i].indexOf(s) >= 0) return list[i];
return '';
}
function galleryPanel(task){
if (!ev.gallerySchools || !ev.gallerySchools.length) return '';
const linkedCnt = task.items.filter(function(it){ return ev.galleryLinks[it.id]; }).length;
const guess = guessGallerySchool();
let html = '<details class="ev-legend"' + (ev.galOpen ? ' open' : '') + ' ontoggle="ev.galOpen=this.open"><summary>바이브코딩 갤러리 점수 자동 입력' +
(linkedCnt ? ' <span class="badge ok">' + linkedCnt + '개 영역 연결됨</span>' : '') + '</summary>' +
'<div class="hint" style="margin:6px 0">영역(채점 요소)을 갤러리 학교와 연결하면 갤러리에서 준 평가 점수(30 · 22 · 14 · 6)가 학번이 같은 학생의 점수로 자동 입력되고, ' +
'갤러리에서 점수를 바꾸거나 지우면 여기에도 바로 반영됩니다. 채점 기준에 30 · 22 · 14 · 6점이 모두 있으면 같은 점수로, 아니면 등급 순서대로(가장 높은 기준부터) 넣습니다. ' +
'작품이 여러 개면 가장 높은 점수를 씁니다. 반은 "2-1"처럼 입력되어 있어야 학번(2101)과 맞춰집니다.</div>';
task.items.forEach(function(it){
const cur = ev.galleryLinks[it.id] || '';
let opts = '<option value="">연결 안 함</option>';
ev.gallerySchools.forEach(function(g){ opts += '<option value="'+esc(g)+'"'+(g === cur ? ' selected' : '')+'>'+esc(g)+(g === guess && !cur ? ' (추천)' : '')+'</option>'; });
html += '<div class="ev-gal"><span class="ev-gal-name">' + esc(it.name) + ' <span class="muted">(' + allowedScores(it).join(' · ') + ')</span></span>' +
'<select onchange="setGalleryLink('+it.id+', this)">' + opts + '</select>' +
(cur ? '<button class="btn ghost sm" onclick="syncGalleryItem('+it.id+')">다시 가져오기</button>' : '') + '</div>';
});
html += '<div id="scGalleryResult"></div></details>';
return html;
}
function showGalleryResult(res, itemName){
const box = document.getElementById('scGalleryResult');
const um = (res && res.unmatched) || [];
let msg = '"' + itemName + '" : 갤러리 점수 ' + ((res && res.applied) || 0) + '명 입력';
toast(msg, 'ok');
if (!box) return;
box.innerHTML = um.length ? '<div class="ev-notice" style="margin-top:8px"><span><b>학생 명단에서 찾지 못한 작품 ' + um.length + '개</b> (학번 · 이름이 맞는지 확인하세요): ' +
um.map(function(w){ return esc((w.hakbun || '학번 없음') + ' ' + (w.name || '') + ' ' + w.score + '점'); }).join(', ') + '</span></div>' : '';
}
async function setGalleryLink(iid, sel){
const task = evTask(Number(document.getElementById('scTask').value));
const item = task && task.items.find(function(i){ return i.id === iid; });
const school = sel.value, prev = ev.galleryLinks[iid] || '';
if (school && !confirm('"' + item.name + '" 영역에 ' + school + ' 갤러리 평가 점수를 자동으로 입력할까요?\n갤러리 점수가 있는 학생은 지금 입력된 점수가 갤러리 점수로 바뀝니다.')){ sel.value = prev; return; }
if (!school && !confirm('"' + item.name + '" 영역의 갤러리 연결을 끊을까요?\n이미 입력된 점수는 그대로 남습니다.')){ sel.value = prev; return; }
try {
const res = must(await sb.rpc('eval_gallery_set_link', { p_item_id: iid, p_gallery_school: school }));
await loadEvalData();
renderScoreTable();
if (school) showGalleryResult(res, item.name); else toast('연결을 끊었습니다.', 'ok');
} catch (e) { toast(e.message, 'err'); sel.value = prev; }
}
async function syncGalleryItem(iid){
const task = evTask(Number(document.getElementById('scTask').value));
const item = task && task.items.find(function(i){ return i.id === iid; });
try {
const res = must(await sb.rpc('eval_gallery_sync_item', { p_item_id: iid }));
await loadEvalData();
renderScoreTable();
showGalleryResult(res, item.name);
} catch (e) { toast(e.message, 'err'); }
}
function renderScoreTable(){
const box = document.getElementById('scBody');
const task = evTask(Number(document.getElementById('scTask').value));
const cls = document.getElementById('scClass').value;
if (!ev.school){ box.innerHTML = '<div class="empty"><div class="big">학교를 먼저 선택하세요</div></div>'; return; }
if (!task){ box.innerHTML = '<div class="empty"><div class="big">평가 기준이 없습니다</div><div>[평가 기준] 탭에서 먼저 입력하세요.</div></div>'; return; }
if (!cls){ box.innerHTML = '<div class="empty"><div class="big">학생 명단이 없습니다</div><div>[학생 명단] 탭에서 먼저 등록하세요.</div></div>'; return; }
const students = evStudentsOf(cls);
const map = scoreMap();
// 비공개 과제는 학생 조회 화면에 나오지 않으므로 눈에 띄게 알림
const notice = task.published ? '' : '<div class="ev-notice"><span>이 과제는 <b>학생 비공개</b> 상태라 학생 조회 화면에 나오지 않습니다.</span>' +
'<button class="btn sm" onclick="togglePublish('+task.id+')">학생에게 공개</button></div>';

let legend = notice + '<details class="ev-legend"><summary>채점 기준 보기</summary>';
task.items.forEach(function(it){
legend += '<table><thead><tr><th>'+esc(it.name)+' ('+evFmt(it.max_score)+'점)</th><th class="num" style="width:70px">점수</th></tr></thead><tbody>' +
it.levels.map(function(l){ return '<tr><td>'+esc(l.description)+'</td><td class="num">'+evFmt(l.score)+'</td></tr>'; }).join('') +
'</tbody></table>';
});
legend += '</details>' + galleryPanel(task);

let html = legend + '<div class="ev-scroll"><table class="ev-score"><thead><tr><th class="sc-name">학생</th>';
task.items.forEach(function(it){
html += '<th>' + esc(it.name) + '<small>' + evFmt(it.max_score) + '점</small>' +
(ev.galleryLinks[it.id] ? '<span class="badge ok" title="'+esc(ev.galleryLinks[it.id])+' 갤러리 평가 점수가 자동으로 입력됩니다">갤러리 자동</span>' : '') +
'<small class="sc-allowed">' + allowedScores(it).join(' · ') + '</small>' +
'<input type="text" inputmode="decimal" class="sc-in" placeholder="일괄" title="빈칸만 이 점수로 채웁니다" onchange="fillScoreColumn(this,'+it.id+')"/></th>';
});
html += '<th class="num">합계<small>' + evFmt(taskMax(task)) + '점</small></th></tr></thead><tbody>';
students.forEach(function(s){
html += '<tr id="scRow'+s.id+'"><td class="sc-name"><b>'+s.number+'</b> '+esc(s.name)+'</td>';
task.items.forEach(function(it){
const r = map[scoreKey(s.id, it.id)];
const cur = r ? evLevel(r.level_id) : null;
html += '<td><input type="text" inputmode="decimal" autocomplete="off" class="sc-in sc-cell" data-sid="'+s.id+'" data-iid="'+it.id+'"' +
' value="'+(cur ? evFmt(cur.score) : '')+'"'+(cur ? ' title="'+esc(cur.description)+'"' : '') +
' oninput="checkScoreInput(this)" onchange="saveScore(this)" onkeydown="scoreInputKey(event,this)"/></td>';
});
html += '<td class="num"><b class="sc-total"></b></td></tr>';
});
html += '</tbody></table></div>' +
'<div class="flex" style="margin-top:10px; align-items:center; justify-content:space-between">' +
'<div class="muted" id="scSummary" style="font-size:13px"></div>' +
'<button class="btn ghost sm" onclick="downloadScoresCsv()">CSV 내려받기</button></div>';
box.innerHTML = html;
students.forEach(function(s){ updateScoreRow(s.id, task); });
updateScoreSummary(task, students);
}
function scoreItem(inp){
const task = evTask(Number(document.getElementById('scTask').value));
const iid = Number(inp.dataset.iid);
return task.items.find(function(i){ return i.id === iid; });
}
/* 등록된 점수가 아니면 빨간 굵은 글씨로 표시 */
function checkScoreInput(inp){
const item = scoreItem(inp);
const v = inp.value.trim();
const bad = v !== '' && !levelOfScore(item, v);
inp.classList.toggle('bad', bad);
if (bad) inp.title = '틀린 점수입니다. 입력 가능: ' + allowedScores(item).join(', ');
return !bad;
}
/* Enter : 같은 채점 요소의 다음 학생으로 이동 */
function scoreInputKey(e, inp){
if (e.key !== 'Enter') return;
e.preventDefault();
const cells = Array.prototype.slice.call(document.querySelectorAll('.sc-cell[data-iid="'+inp.dataset.iid+'"]'));
const next = cells[cells.indexOf(inp) + 1];
if (next){ next.focus(); next.select(); } else inp.blur();
}
function studentTotal(sid, task, map){
let total = 0, filled = 0;
task.items.forEach(function(it){
const r = map[scoreKey(sid, it.id)];
if (r){ filled++; total += evNum((evLevel(r.level_id) || {}).score); }
});
return { total: total, filled: filled };
}
function updateScoreRow(sid, task){
const t = studentTotal(sid, task, scoreMap());
const row = document.getElementById('scRow' + sid);
row.querySelector('.sc-total').textContent = t.filled ? evFmt(t.total) : '-';
row.classList.toggle('partial', t.filled > 0 && t.filled < task.items.length);
}
function updateScoreSummary(task, students){
const map = scoreMap();
let done = 0, sum = 0;
students.forEach(function(s){
const t = studentTotal(s.id, task, map);
if (t.filled === task.items.length && task.items.length){ done++; sum += t.total; }
});
const bad = document.querySelectorAll('.sc-cell.bad').length;
document.getElementById('scSummary').innerHTML =
'입력 완료 ' + done + ' / ' + students.length + '명' + (done ? ' · 평균 ' + evFmt(sum / done) + '점' : '') +
(bad ? ' · <b style="color:var(--danger)">틀린 점수 ' + bad + '칸 (저장되지 않음)</b>' : '');
}
async function saveScore(inp){
const sid = Number(inp.dataset.sid), iid = Number(inp.dataset.iid);
const task = evTask(Number(document.getElementById('scTask').value));
const students = evStudentsOf(document.getElementById('scClass').value);
const idx = ev.scoreRows.findIndex(function(r){ return r.student_id === sid && r.item_id === iid; });
const before = idx >= 0 ? evLevel(ev.scoreRows[idx].level_id) : null;
if (!checkScoreInput(inp)){ updateScoreSummary(task, students); return; }
const level = levelOfScore(scoreItem(inp), inp.value);
if ((level && before && level.id === before.id) || (!level && !before)){ updateScoreSummary(task, students); return; }
try {
if (level){
const row = must(await sb.from('eval_scores')
.upsert({ student_id: sid, item_id: iid, level_id: level.id, updated_at: new Date().toISOString() }, { onConflict: 'student_id,item_id' })
.select('id,student_id,item_id,level_id').single());
if (idx >= 0) ev.scoreRows[idx] = row; else ev.scoreRows.push(row);
} else {
must(await sb.from('eval_scores').delete().eq('student_id', sid).eq('item_id', iid));
if (idx >= 0) ev.scoreRows.splice(idx, 1);
}
} catch (e) {
toast(e.message, 'err');
inp.value = before ? evFmt(before.score) : '';
return;
}
inp.value = level ? evFmt(level.score) : '';
inp.title = level ? level.description : '';
inp.classList.add('saved');
setTimeout(function(){ inp.classList.remove('saved'); }, 700);
updateScoreRow(sid, task);
updateScoreSummary(task, students);
}
async function fillScoreColumn(inp, iid){
const task = evTask(Number(document.getElementById('scTask').value));
const item = task.items.find(function(i){ return i.id === iid; });
const value = inp.value.trim();
inp.value = '';
if (!value) return;
const level = levelOfScore(item, value);
if (!level){ toast('틀린 점수입니다. 입력 가능: ' + allowedScores(item).join(', '), 'err'); return; }
const map = scoreMap();
const targets = evStudentsOf(document.getElementById('scClass').value).filter(function(s){ return !map[scoreKey(s.id, iid)]; });
if (!targets.length){ toast('빈칸이 없습니다.'); return; }
if (!confirm('빈칸인 ' + targets.length + '명의 "' + item.name + '"을(를) ' + evFmt(level.score) + '점으로 채울까요?')) return;
try {
const rows = must(await sb.from('eval_scores').insert(targets.map(function(s){
return { student_id: s.id, item_id: iid, level_id: level.id };
})).select('id,student_id,item_id,level_id'));
ev.scoreRows = ev.scoreRows.concat(rows);
toast(rows.length + '명 입력했습니다.', 'ok');
renderScoreTable();
} catch (e) { toast(e.message, 'err'); }
}
function downloadScoresCsv(){
const task = evTask(Number(document.getElementById('scTask').value));
const cls = document.getElementById('scClass').value;
const map = scoreMap();
const cell = csvCell;
const lines = [['반','번호','이름'].concat(task.items.map(function(i){ return i.name + '(' + evFmt(i.max_score) + ')'; }), ['합계']).map(cell).join(',')];
evStudentsOf(cls).forEach(function(s){
const t = studentTotal(s.id, task, map);
lines.push([s.class_name, s.number, s.name].concat(task.items.map(function(it){
const r = map[scoreKey(s.id, it.id)];
return r ? evFmt(evLevel(r.level_id).score) : '';
}), [t.filled ? evFmt(t.total) : '']).map(cell).join(','));
});
saveCsv(lines, ev.school + '_' + cls + '_' + task.title + '.csv');
}
function csvCell(v){ v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
/* 엑셀에서 한글이 깨지지 않도록 BOM을 붙여 저장 */
function saveCsv(lines, filename){
const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = filename.replace(/[\\/:*?"<>|]/g, '_');
document.body.appendChild(a);
a.click();
a.remove();
setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
}

/* ============== 과제별 합계 · 성적 산출 ==============
   - 과제마다 (합계 ÷ 만점 × 반영 비율)을 더해 100점 만점 성적을 냅니다.
   - 반영 비율 합이 100%가 아니면 100점 만점이 되도록 비율대로 환산합니다.
   - 반영 비율이 없는(또는 0%) 과제는 성적 산출에서 빠집니다.
   - 성적은 소수점 첫째 자리까지 (둘째 자리에서 반올림)
   - 평정 : 90점 이상 A · 80점 이상 B · 70점 이상 C · 60점 이상 D · 그 외 E
========================================================= */
const EV_GRADES = ['A', 'B', 'C', 'D', 'E'];
const evSum = { all: null, loading: false, year: null }; // 전체 학교 비교 (학년도마다 한 번 불러옴)
function evRound1(v){ return Math.round((v + 1e-9) * 10) / 10; }
function evFmt1(v){ return evRound1(v).toFixed(1); }
function evGradeOf(score){
return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'E';
}
function evPct(n, total){ return total ? evFmt1(n / total * 100) : '0.0'; }
function evWeight(t){ const w = Number(t.weight_pct); return (t.weight_pct != null && t.weight_pct !== '' && isFinite(w) && w > 0) ? w : 0; }
// 성적 산출에 들어가는 과제와 반영 비율 합
function evWeightInfo(tasks){
const used = tasks.filter(function(t){ return evWeight(t) > 0 && taskMax(t) > 0; });
return { used: used, sum: used.reduce(function(s, t){ return s + evWeight(t); }, 0) };
}
// 학생별 · 과제별 합계 : { 학생id: { 과제id: { total, filled } } }
function taskTotals(tasks, scoreRows){
tasks = tasks || ev.tasks; scoreRows = scoreRows || ev.scoreRows;
const taskOfItem = {}, scoreOfLevel = {}, out = {};
tasks.forEach(function(t){ t.items.forEach(function(i){
taskOfItem[i.id] = t.id;
i.levels.forEach(function(l){ scoreOfLevel[l.id] = l.score; });
}); });
scoreRows.forEach(function(r){
const tid = taskOfItem[r.item_id];
if (tid == null) return;
const st = out[r.student_id] = out[r.student_id] || {};
const t = st[tid] = st[tid] || { total: 0, filled: 0 };
t.total += evNum(scoreOfLevel[r.level_id]);
t.filled++;
});
return out;
}
// 학생 한 명의 성적 : 과제마다 반영 점수, 100점 만점 성적, 평정
function evStudentGrade(tasks, info, st){
let sum = 0, any = false, partial = false;
const cells = tasks.map(function(t){
const v = st[t.id], max = taskMax(t), w = evWeight(t);
const used = w > 0 && max > 0;
const conv = (v && used) ? v.total / max * w : null;
if (v && used){ sum += conv; any = true; }
if (used && (!v || v.filled < t.items.length)) partial = true;
return { total: v ? v.total : null, partial: !!v && v.filled < t.items.length, conv: conv };
});
const score = (any && info.sum > 0) ? evRound1(sum / info.sum * 100) : null;
return { cells: cells, score: score, grade: score == null ? '' : evGradeOf(score), partial: any && partial };
}
// 학생 목록의 성적 + 평정 분포
function evGradeRows(tasks, students, scoreRows){
const totals = taskTotals(tasks, scoreRows), info = evWeightInfo(tasks);
return students.map(function(s){ return { student: s, g: evStudentGrade(tasks, info, totals[s.id] || {}) }; });
}
function evDist(rows){
const d = { A: 0, B: 0, C: 0, D: 0, E: 0, graded: 0, none: 0, total: rows.length, sum: 0 };
rows.forEach(function(r){
if (r.g.grade){ d[r.g.grade]++; d.graded++; d.sum += r.g.score; } else d.none++;
});
d.avg = d.graded ? evFmt1(d.sum / d.graded) : '-';
return d;
}

function renderSummaryView(){
const sel = document.getElementById('smClass');
const prev = sel.value;
const classes = evClasses();
sel.innerHTML = classes.length ? '<option value="">전체 반</option>' + classes.map(function(c){ return opt(c); }).join('')
: '<option value="">(학생 명단 없음)</option>';
if (classes.indexOf(prev) >= 0) sel.value = prev;
renderSummaryTable();
loadAllSchoolGrades(true);
}
function summaryRows(){
const cls = document.getElementById('smClass').value;
return evGradeRows(ev.tasks, cls ? evStudentsOf(cls) : ev.students);
}
// 반영 비율 안내
function evWeightHtml(tasks){
const info = evWeightInfo(tasks);
let html = '<div class="ev-weights">' + tasks.map(function(t){
const w = evWeight(t), max = taskMax(t);
const on = w > 0 && max > 0;
return '<span class="ev-wchip' + (on ? '' : ' off') + '">' + esc(t.title) + ' <b>' + (w > 0 ? evFmt(w) + '%' : '비율 없음') + '</b>' +
(on ? ' <small>(' + evFmt(max) + '점 → ' + evFmt1(info.sum ? w / info.sum * 100 : 0) + '점)</small>' : '') + '</span>';
}).join('') + '<span class="ev-wchip total">반영 비율 합 <b>' + evFmt(info.sum) + '%</b></span></div>';
if (!info.used.length)
html += '<div class="hint" style="color:#b45309">반영 비율이 입력된 과제가 없어 성적을 산출할 수 없습니다. [평가 기준]에서 과제마다 반영 비율(%)을 입력하세요.</div>';
else if (Math.abs(info.sum - 100) > 1e-9)
html += '<div class="hint" style="color:#b45309">반영 비율 합이 100%가 아닙니다. 100점 만점이 되도록 비율대로 환산했습니다.</div>';
if (info.used.length && info.used.length < tasks.length)
html += '<div class="hint">반영 비율이 없거나 만점이 0점인 과제는 성적 산출에서 빠집니다.</div>';
return html;
}
// 평정 분포 표 : rows = [{ label, d }]
function evDistTable(rows, firstHead){
return '<div class="ev-scroll"><table class="ev-score ev-dist"><thead><tr><th>' + esc(firstHead) + '</th><th class="num">인원</th>' +
EV_GRADES.map(function(g){ return '<th class="num">' + g + '</th>'; }).join('') +
'<th class="num">미산출</th><th class="num">평균</th></tr></thead><tbody>' +
rows.map(function(r){
const d = r.d;
return '<tr' + (r.strong ? ' style="font-weight:700"' : '') + '><td>' + esc(r.label) + '</td><td class="num">' + d.total + '</td>' +
EV_GRADES.map(function(g){
return '<td class="num">' + d[g] + '명<small>' + evPct(d[g], d.graded) + '%</small>' +
'<span class="ev-bar-mini"><i class="g' + g + '" style="width:' + (d.graded ? d[g] / d.graded * 100 : 0) + '%"></i></span></td>';
}).join('') +
'<td class="num">' + (d.none ? d.none + '명' : '<span class="muted">-</span>') + '</td><td class="num">' + d.avg + '</td></tr>';
}).join('') + '</tbody></table></div>';
}
function renderSummaryTable(){
const box = document.getElementById('smBody');
const cls = document.getElementById('smClass').value, all = !cls;
if (!ev.school){ box.innerHTML = '<div class="empty"><div class="big">학교를 먼저 선택하세요</div></div>'; return; }
if (!ev.tasks.length){ box.innerHTML = '<div class="empty"><div class="big">평가 기준이 없습니다</div><div>[평가 기준] 탭에서 먼저 입력하세요.</div></div>'; return; }
if (!ev.students.length){ box.innerHTML = '<div class="empty"><div class="big">학생 명단이 없습니다</div><div>[학생 명단] 탭에서 먼저 등록하세요.</div></div>'; return; }
const rows = summaryRows();
let html = '<h3>반영 비율</h3>' + evWeightHtml(ev.tasks);

// 평정 분포 (학교 전체 · 반별)
const distRows = [{ label: ev.school + ' 전체', d: evDist(evGradeRows(ev.tasks, ev.students)), strong: true }];
evClasses().forEach(function(c){
if (!all && c !== cls) return;
distRows.push({ label: c, d: evDist(evGradeRows(ev.tasks, evStudentsOf(c))) });
});
html += '<h3>평정 비율 <span class="muted" style="font-weight:400">(90↑ A · 80↑ B · 70↑ C · 60↑ D · 그 외 E, 비율은 성적이 산출된 학생 기준)</span></h3>' +
evDistTable(distRows, '구분');

// 학생별 성적
html += '<h3>학생별 성적</h3><div class="ev-scroll"><table class="ev-score"><thead><tr>' +
(all ? '<th>반</th>' : '') + '<th class="num">번호</th><th>이름</th>' +
ev.tasks.map(function(t){
const w = evWeight(t);
return '<th class="num" style="white-space:normal; min-width:90px">' + esc(t.title) +
'<small>' + evFmt(taskMax(t)) + '점' + (w > 0 ? ' · ' + evFmt(w) + '%' : ' · 미반영') + '</small></th>';
}).join('') +
'<th class="num">성적<small>100점 만점</small></th><th class="num">평정</th></tr></thead><tbody>';
rows.forEach(function(r){
const g = r.g;
html += '<tr>' + (all ? '<td>' + esc(r.student.class_name) + '</td>' : '') +
'<td class="num">' + r.student.number + '</td><td>' + esc(r.student.name) + '</td>' +
g.cells.map(function(c){
return '<td class="num"' + (c.partial ? ' style="background:#fffbeb" title="일부 채점 요소만 입력됨"' : '') + '>' +
(c.total == null ? '<span class="muted">-</span>' : evFmt(c.total) +
(c.conv != null ? '<small>반영 ' + evFmt1(c.conv) + '</small>' : '')) + '</td>';
}).join('') +
'<td class="num"' + (g.partial ? ' style="background:#fffbeb" title="입력되지 않은 점수가 있음 (0점으로 계산)"' : '') + '><b>' +
(g.score == null ? '<span class="muted">-</span>' : evFmt1(g.score)) + '</b></td>' +
'<td class="num">' + (g.grade ? '<span class="ev-grade g' + g.grade + '">' + g.grade + '</span>' : '<span class="muted">-</span>') + '</td></tr>';
});
html += '</tbody></table></div>' +
'<div class="flex" style="margin-top:10px; align-items:center; justify-content:space-between">' +
'<div class="muted" style="font-size:12px">성적 = Σ(과제 합계 ÷ 만점 × 반영 비율), 소수점 첫째 자리까지 · 노란 칸: 아직 입력되지 않은 점수가 있음 (0점으로 계산)</div>' +
'<button class="btn ghost sm" onclick="downloadSummaryCsv()">CSV 내려받기</button></div>';

html += '<h3>학교별 평정 비율 <span class="muted" style="font-weight:400">(' + esc(termLabel()) + ' 전체 학교)</span></h3><div id="smAllSchools"></div>';
box.innerHTML = html;
renderAllSchoolGrades();
}

/* ---------- 학교별 비교 : 학년도의 모든 학교를 불러와 반영 비율 · 평정 비율을 나란히 보여줌 ---------- */
async function loadAllSchoolGrades(force){
if (evSum.loading) return;
if (!force && evSum.all && evSum.year === termKey()) return;
evSum.loading = true;
renderAllSchoolGrades();
try {
const res = await Promise.all([
sb.from('eval_tasks').select('*, eval_items(*, eval_item_levels(*))').eq('school_year', settings.year).eq('semester', settings.semester).order('id').then(must),
fetchAll(function(){ return sb.from('eval_students').select('id,school,class_name,number,name').eq('school_year', settings.year).order('id'); })
]);
const tasks = res[0].map(normTask), itemIds = [];
tasks.forEach(function(t){ t.items.forEach(function(i){ itemIds.push(i.id); }); });
const scores = itemIds.length ? await fetchAll(function(){
return sb.from('eval_scores').select('student_id,item_id,level_id').in('item_id', itemIds).order('id');
}) : [];
evSum.all = { tasks: tasks, students: res[1], scores: scores };
evSum.year = termKey();
} catch (e) {
evSum.all = { error: e.message };
}
evSum.loading = false;
renderAllSchoolGrades();
}
function renderAllSchoolGrades(){
const box = document.getElementById('smAllSchools');
if (!box) return;
if (evSum.loading || !evSum.all){ box.innerHTML = '<div class="skeleton"><span class="spinner"></span>불러오는 중...</div>'; return; }
if (evSum.all.error){ box.innerHTML = '<div class="empty"><div>불러오기 실패: ' + esc(evSum.all.error) + '</div></div>'; return; }
const a = evSum.all, schools = {};
a.tasks.forEach(function(t){ (schools[t.school] = schools[t.school] || { tasks: [], students: [] }).tasks.push(t); });
a.students.forEach(function(s){ (schools[s.school] = schools[s.school] || { tasks: [], students: [] }).students.push(s); });
const names = Object.keys(schools).sort();
if (!names.length){ box.innerHTML = '<div class="empty"><div>등록된 학교가 없습니다</div></div>'; return; }
const distRows = [];
let wHtml = '';
names.forEach(function(n){
const sc = schools[n];
distRows.push({ label: n, d: evDist(evGradeRows(sc.tasks, sc.students, a.scores)), strong: n === ev.school });
wHtml += '<div class="ev-wschool"><b>' + esc(n) + '</b>' + (sc.tasks.length ? evWeightHtml(sc.tasks) : '<div class="hint">평가 기준 없음</div>') + '</div>';
});
box.innerHTML = evDistTable(distRows, '학교') +
'<h3>학교별 반영 비율</h3>' + wHtml +
'<div class="flex" style="margin-top:8px; justify-content:flex-end">' +
'<button class="btn ghost sm" onclick="loadAllSchoolGrades(true)">새로고침</button>' +
'<button class="btn ghost sm" onclick="downloadSchoolGradesCsv()">학교별 CSV</button></div>';
}
function downloadSchoolGradesCsv(){
const a = evSum.all;
if (!a || a.error) return;
const lines = [['학교','반','번호','이름'].concat(['성적(100점)','평정']).map(csvCell).join(',')];
const bySchool = {};
a.tasks.forEach(function(t){ (bySchool[t.school] = bySchool[t.school] || []).push(t); });
a.students.slice().sort(function(x, y){ return String(x.school).localeCompare(String(y.school), 'ko') || byClassName(x.class_name, y.class_name) || (x.number - y.number); })
.forEach(function(s){
const tasks = bySchool[s.school] || [];
const r = evGradeRows(tasks, [s], a.scores)[0];
lines.push([s.school, s.class_name, s.number, s.name].concat([r.g.score == null ? '' : evFmt1(r.g.score), r.g.grade]).map(csvCell).join(','));
});
saveCsv(lines, settings.year + '_' + settings.semester + '학기_학교별_성적.csv');
}
function downloadSummaryCsv(){
const cls = document.getElementById('smClass').value;
const head = (cls ? [] : ['반']).concat(['번호', '이름']);
ev.tasks.forEach(function(t){
const w = evWeight(t);
head.push(t.title + '(' + evFmt(taskMax(t)) + '점)');
if (w > 0) head.push(t.title + ' 반영(' + evFmt(w) + '%)');
});
head.push('성적(100점)', '평정');
const lines = [head.map(csvCell).join(',')];
summaryRows().forEach(function(r){
const row = (cls ? [] : [r.student.class_name]).concat([r.student.number, r.student.name]);
ev.tasks.forEach(function(t, k){
const c = r.g.cells[k];
row.push(c.total == null ? '' : evFmt(c.total));
if (evWeight(t) > 0) row.push(c.conv == null ? '' : evFmt1(c.conv));
});
row.push(r.g.score == null ? '' : evFmt1(r.g.score), r.g.grade);
lines.push(row.map(csvCell).join(','));
});
saveCsv(lines, ev.school + '_' + (cls || '전체') + '_성적산출.csv');
}

