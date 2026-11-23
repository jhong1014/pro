/* =========================================================
   나이스(NEIS) 연동 : Supabase Edge Function 'neis'를 거쳐 호출
   - 인증키는 함수의 비밀값(NEIS_API_KEY)에만 있고 브라우저에는 없음
   - type: school(학교 검색) · meal(급식) · schedule(학사일정)
========================================================= */
const neisCache = {};
function neisCall(body){
const key = JSON.stringify(body);
if (neisCache[key]) return neisCache[key];
const p = sb.functions.invoke('neis', { body: body }).then(async function(res){
if (res.error){
let msg = res.error.message || '나이스 연결에 실패했습니다.';
try { const j = await res.error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
throw new Error(msg);
}
return (res.data && res.data.rows) || [];
});
neisCache[key] = p;
p.catch(function(){ delete neisCache[key]; });
return p;
}
function ymd(ds){ return String(ds).replace(/-/g, ''); }
function ymdToDs(s){ s = String(s); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
function addDays(ds, n){ const d = parseD(ds); d.setDate(d.getDate() + n); return fmt(d); }
function neisLink(school){ const l = (settings.neis || {})[school]; return l && l.code ? l : null; }
function neisLinkedSchools(){ return Object.keys(settings.neis || {}).filter(neisLink).sort(); }

/* ----- 설정 화면 : 학교 연결 ----- */
let neisUi = { rows: [], open: -1, results: null, loading: false, error: '' };
function renderNeisSettings(){
const set = {};
state.schools.forEach(function(s){ set[s] = true; });
Object.keys(settings.neis || {}).forEach(function(s){ set[s] = true; });
neisUi.rows = Object.keys(set).sort();
const box = document.getElementById('neisList');
if (!neisUi.rows.length){
box.innerHTML = '<div class="empty" style="padding:14px">진도 자료에 학교가 없습니다. 먼저 진도를 입력하세요.</div>';
return;
}
let html = '<table><thead><tr><th>내 학교 이름</th><th>나이스 학교</th><th style="width:150px">동작</th></tr></thead><tbody>';
neisUi.rows.forEach(function(name, i){
const l = neisLink(name);
html += '<tr><td>' + chip(name) + '</td><td>' +
(l ? esc(l.name) + ' <span class="muted" style="font-size:12px">' + esc(l.office || '') + ' · ' + esc(l.code) + '</span>' : '<span class="muted">연결 안 됨</span>') +
'</td><td><button class="btn sm' + (l ? ' ghost' : '') + '" onclick="neisOpenSearch(' + i + ')">' + (l ? '다시 검색' : '학교 검색') + '</button>' +
(l ? ' <button class="btn ghost sm" onclick="neisUnlink(' + i + ')">해제</button>' : '') + '</td></tr>';
if (neisUi.open === i){
html += '<tr><td colspan="3"><div class="neis-search">' +
'<div class="flex" style="align-items:center"><input type="text" id="neisQuery" value="' + esc(neisUi.query || name) + '" placeholder="나이스에 등록된 학교 이름" onkeydown="if(event.key===\'Enter\')neisSearch()" style="flex:1; min-width:160px"/>' +
'<button class="btn sm" onclick="neisSearch()">검색</button><button class="btn ghost sm" onclick="neisCloseSearch()">닫기</button></div>' +
'<div style="margin-top:8px">' + neisResultsHtml() + '</div></div></td></tr>';
}
});
html += '</tbody></table>';
box.innerHTML = html;
}
function neisResultsHtml(ui, pickFn){
ui = ui || neisUi; pickFn = pickFn || 'neisPick';
if (ui.loading) return '<span class="spinner"></span>검색 중...';
if (ui.error) return '<span style="color:var(--danger); font-size:13px">' + esc(ui.error) + '</span>';
if (!ui.results) return '<span class="hint">예: 정식 이름 "서울OO초등학교"의 일부를 넣고 검색하세요.</span>';
if (!ui.results.length) return '<span class="hint">검색 결과가 없습니다.</span>';
return ui.results.map(function(r, j){
return '<div class="neis-result"><div><b>' + esc(r.name) + '</b> <span class="muted">' + esc(r.office || '') + ' · ' + esc(r.kind || '') + '</span>' +
'<div class="muted" style="font-size:12px">' + esc(r.addr || '') + '</div></div>' +
'<button class="btn sm" onclick="' + pickFn + '(' + j + ')">' + (pickFn === 'neisPick' ? '연결' : '선택') + '</button></div>';
}).join('');
}
function neisOpenSearch(i){
neisUi.open = i; neisUi.results = null; neisUi.error = ''; neisUi.query = '';
renderNeisSettings();
neisSearch();
}
function neisCloseSearch(){ neisUi.open = -1; renderNeisSettings(); }
async function neisSearch(){
const q = (document.getElementById('neisQuery') || {}).value || '';
neisUi.query = q.trim();
if (neisUi.query.length < 2){ neisUi.error = '학교 이름을 2글자 이상 입력하세요.'; renderNeisSettings(); return; }
neisUi.loading = true; neisUi.error = ''; renderNeisSettings();
try { neisUi.results = await neisCall({ type: 'school', name: neisUi.query }); }
catch (e) { neisUi.error = e.message; neisUi.results = null; }
neisUi.loading = false;
renderNeisSettings();
}
async function neisSaveLinks(next, okMsg){
try { await saveSetting('neis_schools', next); }
catch (e) { toast(e.message, 'err'); return false; }
settings.neis = next;
toast(okMsg, 'ok');
return true;
}
async function neisPick(j){
const name = neisUi.rows[neisUi.open], r = neisUi.results[j];
const next = Object.assign({}, settings.neis || {});
next[name] = { atpt: r.atpt, code: r.code, name: r.name, office: r.office };
if (await neisSaveLinks(next, name + ' ↔ ' + r.name + ' 연결했습니다.')){ neisUi.open = -1; renderNeisSettings(); }
}
async function neisUnlink(i){
const name = neisUi.rows[i];
if (!confirm(name + '의 나이스 연결을 해제할까요?')) return;
const next = Object.assign({}, settings.neis || {});
delete next[name];
if (await neisSaveLinks(next, '연결을 해제했습니다.')) renderNeisSettings();
}

/* ----- 설정 화면 : 요일별 급식 ----- */
const MEAL_DOWS = [1, 2, 3, 4, 5];
let mealUi = { open: 0, results: null, loading: false, error: '', query: '' };
function mealDayOf(dow){ return (settings.mealDays || {})[String(dow)] || { mode: 'auto' }; }
function renderMealDays(){
const box = document.getElementById('mealDaysList');
let html = '<table><thead><tr><th style="width:70px">요일</th><th style="width:190px">급식</th><th>학교</th></tr></thead><tbody>';
MEAL_DOWS.forEach(function(dow){
const md = mealDayOf(dow);
const pending = mealUi.open === dow && md.mode !== 'school';
const mode = pending ? 'school' : md.mode;
html += '<tr><td><b>' + ['일','월','화','수','목','금','토'][dow] + '요일</b></td><td>' +
'<select onchange="mealDayMode(' + dow + ', this.value)">' +
[['auto', '그날 근무학교'], ['school', '다른 학교 지정'], ['off', '급식 안 함']].map(function(o){
return '<option value="' + o[0] + '"' + (mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
}).join('') + '</select></td><td>';
if (mode === 'off') html += '<span class="muted">대시보드에 표시하지 않음</span>';
else if (mode === 'auto') html += '<span class="muted">그날 수업이 가장 많은 학교 (나이스 연결된 학교)</span>';
else html += (md.mode === 'school' && md.school ? esc(md.school.name) + ' <span class="muted" style="font-size:12px">' + esc(md.school.office || '') + '</span> ' : '<span class="muted">학교를 검색해 고르세요</span> ') +
'<button class="btn ghost sm" onclick="mealOpenSearch(' + dow + ')">학교 검색</button>';
html += '</td></tr>';
if (mealUi.open === dow){
html += '<tr><td colspan="3"><div class="neis-search">' +
'<div class="flex" style="align-items:center"><input type="text" id="mealQuery" value="' + esc(mealUi.query) + '" placeholder="예: 장성중" onkeydown="if(event.key===\'Enter\')mealSearch()" style="flex:1; min-width:160px"/>' +
'<button class="btn sm" onclick="mealSearch()">검색</button><button class="btn ghost sm" onclick="mealCloseSearch()">닫기</button></div>' +
'<div style="margin-top:8px">' + neisResultsHtml(mealUi, 'mealPick') + '</div></div></td></tr>';
}
});
box.innerHTML = html + '</tbody></table>';
}
async function mealSaveDays(next, okMsg){
try { await saveSetting('meal_days', next); }
catch (e) { toast(e.message, 'err'); return false; }
settings.mealDays = next;
toast(okMsg, 'ok');
return true;
}
async function mealDayMode(dow, mode){
const label = ['일','월','화','수','목','금','토'][dow] + '요일';
if (mode === 'school'){
const md = mealDayOf(dow);
if (md.mode === 'school' && md.school){ renderMealDays(); return; }
mealOpenSearch(dow); // 학교를 고르면 저장
return;
}
const next = Object.assign({}, settings.mealDays || {});
next[String(dow)] = { mode: mode };
if (mealUi.open === dow) mealUi.open = 0;
await mealSaveDays(next, label + ' 급식: ' + (mode === 'off' ? '급식 안 함' : '그날 근무학교'));
renderMealDays();
}
function mealOpenSearch(dow){
mealUi = { open: dow, results: null, loading: false, error: '', query: '' };
renderMealDays();
const el = document.getElementById('mealQuery');
if (el) el.focus();
}
function mealCloseSearch(){ mealUi.open = 0; renderMealDays(); }
async function mealSearch(){
const q = ((document.getElementById('mealQuery') || {}).value || '').trim();
mealUi.query = q;
if (q.length < 2){ mealUi.error = '학교 이름을 2글자 이상 입력하세요.'; renderMealDays(); return; }
mealUi.loading = true; mealUi.error = ''; renderMealDays();
try { mealUi.results = await neisCall({ type: 'school', name: q }); }
catch (e) { mealUi.error = e.message; mealUi.results = null; }
mealUi.loading = false;
renderMealDays();
}
async function mealPick(j){
const dow = mealUi.open, r = mealUi.results[j];
const next = Object.assign({}, settings.mealDays || {});
next[String(dow)] = { mode: 'school', school: { atpt: r.atpt, code: r.code, name: r.name, office: r.office } };
if (await mealSaveDays(next, ['일','월','화','수','목','금','토'][dow] + '요일 급식: ' + r.name)){ mealUi.open = 0; renderMealDays(); }
}

