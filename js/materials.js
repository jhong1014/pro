/* =========================================================
   수업 자료 보관함 (lesson_materials · lesson_material_uses)
   - 진도 관리 › [자료 보관함] 탭 : 학년 · 단원별 자료 목록, 사용한 반, 최근 사용일
   - 진도 상세 창 "수업 자료" : 그 수업에 자료를 붙이고, 같은 진도를 나간 다른 반의 자료를 추천
   - 파일은 올리지 않고 링크 주소만 저장합니다.
========================================================= */
const LIB_KINDS = ['학습지', '슬라이드', '링크', '영상', '평가', '기타'];
const lib = {
loaded: false,
materials: [], uses: [], recs: {}, // recs : 자료가 붙은 이번 학년도 진도 기록 (id → 기록)
grade: null, q: '',                // 목록 필터 (grade null = 전체)
form: null,                        // 자료 추가 · 수정 창 { id, attachTo }
pm: null                           // 진도 상세 창 { row, same: [같은 진도의 다른 기록], picking }
};
function libKindClass(k){ return { '학습지': 'k1', '슬라이드': 'k2', '링크': 'k3' }[k] || 'k4'; }
function libMd(ds){ const d = parseD(ds); return (d.getMonth() + 1) + '/' + d.getDate(); }
function libUrl(u){ return /^https?:\/\//i.test(u || '') ? u : '#'; } // http(s) 주소만 링크로
function libMaterial(id){
for (let i = 0; i < lib.materials.length; i++) if (lib.materials[i].id === id) return lib.materials[i];
return null;
}
async function loadLibData(){
// 자료 목록은 학년도와 상관없이 다시 쓰는 것이라 전부 읽고,
// 사용 내역은 보고 있는 학년도의 진도 기록에 붙은 것만 읽음 (학년도가 쌓여도 느려지지 않게)
const res = await Promise.all([
fetchAll(function(){ return sb.from('lesson_materials').select('id,grade,unit,kind,title,url').order('id'); }),
fetchAll(function(){
return sb.from('lesson_material_uses').select('id,material_id,record_id,records!inner(id,date,school,class_name)')
.eq('records.school_year', settings.year).order('id');
})
]);
const recs = {};
res[1].forEach(function(u){ if (u.records) recs[u.record_id] = u.records; });
lib.materials = res[0];
lib.uses = res[1].map(function(u){ return { id: u.id, material_id: u.material_id, record_id: u.record_id }; });
lib.recs = recs;
lib.loaded = true;
}
function libErrorHtml(e){
return /lesson_material/.test(e.message)
? '자료 보관함 저장 공간(lesson_materials 테이블)이 아직 DB에 없습니다. 마이그레이션이 적용된 뒤 다시 열어 주세요.'
: esc(e.message);
}
async function loadLib(){
const box = document.getElementById('libBody');
box.innerHTML = '<div class="skeleton"><span class="spinner"></span>불러오는 중...</div>';
try { await loadLibData(); }
catch (e) {
box.innerHTML = '<div class="empty"><div class="big">불러오기 실패</div><div>' + libErrorHtml(e) + '</div></div>';
return;
}
if (state.view !== 'lib') return;
renderLib();
}
// 자료별 사용 내역 (이번 학년도) : { text: '한빛중 2-1 · 2-3<br>…', last: 'yyyy-mm-dd' }
function libUsage(id){
const bySchool = {}; let last = '';
lib.uses.forEach(function(u){
const r = u.material_id === id ? lib.recs[u.record_id] : null;
if (!r) return;
(bySchool[r.school] = bySchool[r.school] || {})[r.class_name || ''] = true;
if (r.date > last) last = r.date;
});
const text = Object.keys(bySchool).sort().map(function(s){
return esc(s) + ' ' + Object.keys(bySchool[s]).sort(byClassName).map(esc).join(' · ');
}).join('<br>');
return { text: text, last: last };
}
function renderLib(){
const box = document.getElementById('libBody');
const gset = {};
lib.materials.forEach(function(m){ gset[m.grade || ''] = true; });
const grades = Object.keys(gset).sort(byClassName);
if (lib.grade != null && !gset[lib.grade]) lib.grade = null;
const q = lib.q.trim().toLowerCase();
const list = lib.materials.filter(function(m){
if (lib.grade != null && (m.grade || '') !== lib.grade) return false;
return !q || (m.title + ' ' + m.unit + ' ' + m.kind).toLowerCase().indexOf(q) >= 0;
});
let html = '<div class="lib-filter"><div class="pill-tabs memo" style="margin:0">' +
'<button type="button"' + (lib.grade == null ? ' class="active"' : '') + ' onclick="libPickGrade(null)">전체</button>' +
grades.map(function(g, i){
return '<button type="button"' + (lib.grade === g ? ' class="active"' : '') + ' onclick="libPickGrade(' + i + ')">' + esc(g || '학년 없음') + '</button>';
}).join('') + '</div>' +
'<input type="text" id="libQ" value="' + esc(lib.q) + '" placeholder="자료 이름 · 단원 검색" aria-label="자료 검색" oninput="libSearch(this.value)"/></div>' +
'<div id="libList">' + libListHtml(list) + '</div>';
box.innerHTML = html;
lib._grades = grades;
}
function libListHtml(list){
if (!lib.materials.length) return '<div class="empty"><div class="big">보관한 자료가 없습니다</div><div>[자료 추가]를 누르거나, 일 · 주 화면에서 수업 칸을 눌러 자료를 붙여 보세요.</div></div>';
if (!list.length) return '<div class="empty"><div class="big">찾는 자료가 없습니다</div></div>';
const groups = {}, keys = [];
list.forEach(function(m){
const k = (m.grade || '') + '\u0001' + (m.unit || '');
if (!groups[k]){ groups[k] = []; keys.push(k); }
groups[k].push(m);
});
keys.sort(function(a, b){
const x = a.split('\u0001'), y = b.split('\u0001');
return byClassName(x[0], y[0]) || byClassName(x[1], y[1]);
});
return keys.map(function(k){
const p = k.split('\u0001');
const title = (lib.grade == null && p[0] ? esc(p[0]) + ' · ' : '') + esc(p[1] || '단원 없음');
return '<div class="lib-group"><div class="lib-unit"><b>' + title + '</b> <span class="muted">자료 ' + groups[k].length + '개</span></div>' +
groups[k].map(function(m){
const u = libUsage(m.id);
return '<div class="lib-row"><span class="lib-kind ' + libKindClass(m.kind) + '">' + esc(m.kind) + '</span>' +
'<span class="lib-title">' + esc(m.title) + '</span>' +
'<span class="lib-use">' + (u.text || '아직 사용 안 함') + '</span>' +
'<span class="lib-date">' + (u.last ? libMd(u.last) + ' 사용' : '—') + '</span>' +
'<span class="lib-act"><a class="btn ghost sm" href="' + esc(libUrl(m.url)) + '" target="_blank" rel="noopener noreferrer">열기</a>' +
'<button class="btn ghost sm" onclick="libOpenForm(' + m.id + ')">수정</button>' +
'<button class="btn danger sm" onclick="libDelete(' + m.id + ')">삭제</button></span></div>';
}).join('') + '</div>';
}).join('');
}
function libPickGrade(i){
lib.grade = i == null ? null : lib._grades[i];
renderLib();
}
// 검색어를 치는 동안에는 목록만 다시 그려 입력 칸이 풀리지 않게
function libSearch(v){
lib.q = v;
const q = v.trim().toLowerCase();
document.getElementById('libList').innerHTML = libListHtml(lib.materials.filter(function(m){
if (lib.grade != null && (m.grade || '') !== lib.grade) return false;
return !q || (m.title + ' ' + m.unit + ' ' + m.kind).toLowerCase().indexOf(q) >= 0;
}));
}
/* ---------- 자료 추가 · 수정 창 ---------- */
function libOpenForm(id, attachTo, grade){
const m = id ? libMaterial(id) : null;
lib.form = { id: m ? m.id : null, attachTo: attachTo || null };
const uniq = function(key, onlyGrade){
const set = {};
lib.materials.forEach(function(x){ if (x[key] && (onlyGrade == null || x.grade === onlyGrade)) set[x[key]] = true; });
return Object.keys(set).sort(byClassName).map(function(v){ return opt(v); }).join('');
};
document.getElementById('mtTitleHead').textContent = m ? '자료 수정' : (attachTo ? '새 자료 추가 후 이 수업에 붙이기' : '자료 추가');
document.getElementById('mtGrades').innerHTML = uniq('grade');
document.getElementById('mtUnits').innerHTML = uniq('unit');
document.getElementById('mtKind').innerHTML = LIB_KINDS.map(function(k){ return opt(k); }).join('');
document.getElementById('mtGrade').value = m ? m.grade : (grade || (lib.grade || ''));
document.getElementById('mtUnit').value = m ? m.unit : '';
document.getElementById('mtKind').value = m && LIB_KINDS.indexOf(m.kind) >= 0 ? m.kind : '링크';
document.getElementById('mtTitle').value = m ? m.title : '';
document.getElementById('mtUrl').value = m ? m.url : '';
document.getElementById('matModal').classList.add('show');
document.getElementById('mtTitle').focus();
}
function libCloseForm(){
lib.form = null;
document.getElementById('matModal').classList.remove('show');
}
async function libSaveForm(){
const f = lib.form;
if (!f) return;
let url = document.getElementById('mtUrl').value.trim();
if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url; // 'drive.google.com/…'처럼 앞부분을 빼고 붙여넣은 경우
const row = {
grade: document.getElementById('mtGrade').value.trim(),
unit: document.getElementById('mtUnit').value.trim(),
kind: document.getElementById('mtKind').value,
title: document.getElementById('mtTitle').value.trim(),
url: url,
updated_at: new Date().toISOString()
};
if (!row.title){ toast('자료 이름을 입력하세요', 'err'); return; }
if (!/^https?:\/\/\S+$/i.test(url)){ toast('http:// 또는 https:// 로 시작하는 링크 주소를 입력하세요', 'err'); return; }
const btn = document.getElementById('mtSave');
btn.disabled = true;
try {
let id = f.id;
if (id) must(await sb.from('lesson_materials').update(row).eq('id', id));
else id = must(await sb.from('lesson_materials').insert(row).select('id').single()).id;
if (f.attachTo) must(await sb.from('lesson_material_uses').insert({ material_id: id, record_id: f.attachTo }));
libCloseForm();
toast('저장했습니다.', 'ok');
await libRefresh();
} catch (e) { toast(e.message, 'err'); }
btn.disabled = false;
}
async function libDelete(id){
const m = libMaterial(id);
if (!m || !confirm('"' + m.title + '" 자료를 보관함에서 삭제하시겠습니까?\n수업에 붙여 둔 연결도 함께 사라집니다.')) return;
try {
must(await sb.from('lesson_materials').delete().eq('id', id));
toast('삭제되었습니다.', 'ok');
await libRefresh();
} catch (e) { toast(e.message, 'err'); }
}
// 저장 · 삭제 뒤 : 자료를 다시 읽고 보이는 화면(보관함 목록 · 진도 상세 창)을 다시 그림
async function libRefresh(){
await loadLibData();
if (state.view === 'lib') renderLib();
if (lib.pm && document.getElementById('progModal').classList.contains('show')) renderPmMaterials();
}

/* ---------- 진도 상세 창의 "수업 자료" ---------- */
async function pmLoadMaterials(row){
const box = document.getElementById('pmMat');
lib.pm = { row: row, same: [], picking: false };
box.innerHTML = '<div class="pm-mat"><div class="pm-mat-head">수업 자료</div><div class="hint"><span class="spinner"></span>불러오는 중...</div></div>';
const r = findRecordByRow(row);
try {
if (!lib.loaded) await loadLibData();
const same = r && r.progress ? must(await sb.from('records').select('id,date,school,class_name')
.eq('school_year', settings.year).eq('progress', r.progress).neq('id', row).order('date')) : [];
if (!lib.pm || lib.pm.row !== row) return; // 그 사이 다른 수업을 연 경우
lib.pm.same = same;
} catch (e) {
if (lib.pm && lib.pm.row === row)
box.innerHTML = '<div class="pm-mat"><div class="pm-mat-head">수업 자료</div><div class="hint">' + libErrorHtml(e) + '</div></div>';
return;
}
renderPmMaterials();
}
function pmMatRow(m, btn){
return '<div class="pm-mat-row"><span class="lib-kind ' + libKindClass(m.kind) + '">' + esc(m.kind) + '</span>' +
'<span class="lib-title">' + esc(m.title) + '</span>' +
'<a class="btn ghost sm" href="' + esc(libUrl(m.url)) + '" target="_blank" rel="noopener noreferrer">열기</a>' + btn + '</div>';
}
function renderPmMaterials(){
const pm = lib.pm, box = document.getElementById('pmMat');
if (!pm) return;
const mine = {}, attached = [];
lib.uses.forEach(function(u){
if (u.record_id !== pm.row) return;
const m = libMaterial(u.material_id);
if (m){ mine[m.id] = true; attached.push({ use: u, m: m }); }
});
// 같은 진도를 나간 다른 수업에 붙어 있는 자료 (아직 안 붙인 것만)
const sameById = {}, sug = [], seen = {};
pm.same.forEach(function(r){ sameById[r.id] = r; });
let from = null;
lib.uses.forEach(function(u){
const r = sameById[u.record_id], m = libMaterial(u.material_id);
if (!r || !m || mine[m.id] || seen[m.id]) return;
seen[m.id] = true; sug.push(m);
if (!from || r.date > from.date) from = r;
});
let html = '<div class="pm-mat"><div class="pm-mat-head">수업 자료</div>' +
(attached.length ? attached.map(function(a){
return pmMatRow(a.m, '<button class="btn ghost sm" onclick="pmDetach(' + a.use.id + ')">떼기</button>');
}).join('') : '<div class="hint">이 수업에 붙인 자료가 없습니다.</div>');
if (sug.length){
html += '<div class="pm-sug"><b>같은 진도를 나간 다른 반에서 쓴 자료</b>' +
sug.map(function(m){ return pmMatRow(m, '<button class="btn sm" onclick="pmAttach(' + m.id + ')">붙이기</button>'); }).join('') +
'<div class="hint">' + esc(from.school) + ' ' + esc(from.class_name || '') + '이(가) ' + libMd(from.date) + '에 같은 진도를 나갔습니다.</div></div>';
}
if (pm.picking){
const rest = lib.materials.filter(function(m){ return !mine[m.id]; });
const groups = {}, keys = [];
rest.forEach(function(m){
const k = [m.grade, m.unit].filter(Boolean).join(' · ') || '단원 없음';
if (!groups[k]){ groups[k] = []; keys.push(k); }
groups[k].push(m);
});
keys.sort(byClassName);
html += rest.length ? '<div class="pm-pick"><select id="pmPick" aria-label="보관함 자료 고르기">' + keys.map(function(k){
return '<optgroup label="' + esc(k) + '">' + groups[k].map(function(m){ return opt(m.id, '[' + m.kind + '] ' + m.title); }).join('') + '</optgroup>';
}).join('') + '</select><button class="btn sm" onclick="pmAttach(Number(document.getElementById(\'pmPick\').value))">붙이기</button>' +
'<button class="btn ghost sm" onclick="pmPicking(false)">닫기</button></div>'
: '<div class="hint">보관함에 붙일 수 있는 다른 자료가 없습니다.</div>';
} else {
html += '<div class="pm-mat-btns"><button class="btn ghost sm" onclick="pmPicking(true)">보관함에서 고르기</button>' +
'<button class="btn ghost sm" onclick="pmNewMaterial()">새 링크 붙여넣기</button></div>';
}
box.innerHTML = html + '</div>';
}
function pmPicking(on){ if (lib.pm){ lib.pm.picking = !!on; renderPmMaterials(); } }
function pmNewMaterial(){
const r = lib.pm && findRecordByRow(lib.pm.row);
const g = r && /^(\d+)\s*-/.exec(r.cls || ''); // 반 '2-3' → '2학년'
libOpenForm(null, lib.pm.row, g ? g[1] + '학년' : '');
}
async function pmAttach(id){
if (!lib.pm || !id) return;
try {
must(await sb.from('lesson_material_uses').insert({ material_id: id, record_id: lib.pm.row }));
lib.pm.picking = false;
toast('자료를 붙였습니다.', 'ok');
await libRefresh();
} catch (e) { toast(e.message, 'err'); }
}
async function pmDetach(useId){
try {
must(await sb.from('lesson_material_uses').delete().eq('id', useId));
toast('자료를 뗐습니다. 보관함에는 그대로 남아 있습니다.', 'ok');
await libRefresh();
} catch (e) { toast(e.message, 'err'); }
}
