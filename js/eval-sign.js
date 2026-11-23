/* ============== 성적 확인 서명 ==============
   eval_signature_list(학년도, 학교) : 학생마다 현재 성적(current), 서명할 때 성적(snapshot),
   서명 그림 · 일시, 서명 뒤 점수가 바뀌었는지(matches) */
async function loadSignatures(){
ev.signs = ev.school ? must(await sb.rpc('eval_signature_list', { p_year: settings.year, p_school: ev.school, p_semester: settings.semester })) : [];
}
function renderSignView(){
const sel = document.getElementById('sgClass');
const prev = sel.value;
const classes = evClasses();
sel.innerHTML = classes.length ? '<option value="">전체 반</option>' + classes.map(function(c){ return opt(c); }).join('')
: '<option value="">(학생 명단 없음)</option>';
if (classes.indexOf(prev) >= 0) sel.value = prev;
renderSignTable();
}
function seoulTime(iso){ return iso ? seoulDateTime(iso) : ''; }
// 학생 공개 과제만 (학생이 확인 · 서명하는 대상)
function signTasks(){ return ev.tasks.filter(function(t){ return t.published; }); }
function signRows(){
const cls = document.getElementById('sgClass').value;
return (ev.signs || []).filter(function(r){ return !cls || r.class_name === cls; })
.sort(function(a, b){ return byClassName(a.class_name, b.class_name) || (a.number - b.number); })
.map(function(r){
const status = !r.signed_at ? 'none' : (r.matches ? 'ok' : 'stale');
// 서명이 유효하면 학생이 확인한 성적(snapshot), 아니면 현재 성적
const src = status === 'ok' ? r.snapshot : r.current;
const byTask = {};
(src || []).forEach(function(t){ byTask[t.id] = t; });
return { r: r, status: status, cells: signTasks().map(function(t){ return byTask[t.id] ? evFmt(byTask[t.id].total) : ''; }) };
});
}
const SIGN_STATUS = { ok: '<span class="sg-ok">서명 완료</span>', stale: '<span class="sg-stale">재확인 필요</span>', none: '<span class="muted">미서명</span>' };
function renderSignTable(){
const box = document.getElementById('sgBody');
const all = !document.getElementById('sgClass').value;
if (!ev.school){ box.innerHTML = '<div class="empty"><div class="big">학교를 먼저 선택하세요</div></div>'; return; }
if (!ev.students.length){ box.innerHTML = '<div class="empty"><div class="big">학생 명단이 없습니다</div></div>'; return; }
const tasks = signTasks();
const rows = signRows();
const cnt = { ok: 0, stale: 0, none: 0 };
rows.forEach(function(x){ cnt[x.status]++; });
let html = '<div class="flex" style="margin-bottom:10px; align-items:center; justify-content:space-between">' +
'<div style="font-size:13px">서명 완료 <b>' + cnt.ok + '</b> · 재확인 필요 <b>' + cnt.stale + '</b> · 미서명 <b>' + cnt.none + '</b> / ' + rows.length + '명</div>' +
'<div class="flex" style="align-items:center; gap:8px">' +
'<label style="font-size:13px; display:flex; align-items:center; gap:4px"><input type="checkbox" id="slipUnsigned"/>미서명 · 재확인만</label>' +
'<button class="btn ghost sm" onclick="printGradeSlips()">학생용 성적 확인표 인쇄</button>' +
'<button class="btn sm" onclick="printSignatures()">서명 자료 인쇄</button></div></div>';
if (!tasks.length) html += '<div class="ev-notice"><span>학생에게 공개된 평가가 없어 학생이 서명할 수 없습니다. [평가 기준]에서 공개해 주세요.</span></div>';
html += '<div class="ev-scroll"><table class="ev-score"><thead><tr>' + (all ? '<th>반</th>' : '') + '<th class="num">번호</th><th>이름</th>' +
tasks.map(function(t){ return '<th class="num" style="white-space:normal; min-width:80px">' + esc(t.title) + '<small>' + evFmt(taskMax(t)) + '점</small></th>'; }).join('') +
'<th>상태</th><th>서명일시</th><th>서명</th><th></th></tr></thead><tbody>';
rows.forEach(function(x){
const r = x.r;
html += '<tr>' + (all ? '<td>' + esc(r.class_name) + '</td>' : '') + '<td class="num">' + r.number + '</td><td><span class="sg-name" onclick="openSignViewer(' + r.student_id + ')">' + esc(r.name) + '</span></td>' +
x.cells.map(function(c){ return '<td class="num">' + (c || '<span class="muted">-</span>') + '</td>'; }).join('') +
'<td>' + SIGN_STATUS[x.status] + '</td><td style="font-size:12px">' + esc(seoulTime(r.signed_at)) + '</td>' +
'<td>' + (r.signature ? '<img class="sg-img" src="' + esc(r.signature) + '" alt="서명"/>' : '') + '</td>' +
'<td>' + (r.signed_at ? '<button class="btn ghost sm" onclick="deleteSignature(' + r.student_id + ')">서명 지우기</button>' : '') + '</td></tr>';
});
html += '</tbody></table></div>' +
'<div class="hint">서명 뒤 점수가 바뀌면 "재확인 필요"로 표시되고, 학생 화면에서 다시 서명하도록 안내됩니다. ' +
'위의 [한 명씩 확인 · 서명]이나 학생 이름을 누르면 선생님 화면에서 학생별 성적을 보여 주고 바로 서명받을 수 있습니다.</div>';
box.innerHTML = html;
}
async function deleteSignature(studentId){
if (!confirm('이 학생의 서명을 지우시겠습니까? 학생이 다시 서명해야 합니다.')) return;
try {
must(await sb.from('eval_signatures').delete().eq('student_id', studentId).eq('semester', settings.semester));
toast('서명을 지웠습니다.', 'ok');
await loadSignatures();
renderSignTable();
} catch (e) { toast(e.message, 'err'); }
}
/* 반마다 한 쪽씩 : 번호 · 이름 · 영역(과제)별 성적 · 서명일시 · 서명 */
function printSignatures(){
const tasks = signTasks();
const rows = signRows();
const w = window.open('', '_blank');
if (!w){ toast('팝업이 차단되었습니다.', 'err'); return; }
const groups = {};
rows.forEach(function(x){ (groups[x.r.class_name] = groups[x.r.class_name] || []).push(x); });
const printed = seoulDateTime(new Date().toISOString());
const pages = Object.keys(groups).sort(byClassName).map(function(cls){
return '<section><h1>' + termLabel() + ' ' + esc(ev.school) + ' ' + esc(cls) + ' 수행평가 성적 확인서</h1>' +
'<div class="meta">출력 ' + esc(printed) + '</div>' +
'<table><thead><tr><th>번호</th><th>이름</th>' +
tasks.map(function(t){ return '<th style="min-width:80px">' + esc(t.title) + '<br><small>(' + evFmt(taskMax(t)) + '점)</small></th>'; }).join('') +
'<th>서명일시</th><th>서명</th><th>비고</th></tr></thead><tbody>' +
groups[cls].map(function(x){
return '<tr><td>' + x.r.number + '</td><td>' + esc(x.r.name) + '</td>' +
x.cells.map(function(c){ return '<td>' + (c || '') + '</td>'; }).join('') +
'<td class="t">' + (x.status === 'ok' ? esc(seoulTime(x.r.signed_at)) : '') + '</td>' +
'<td class="s">' + (x.status === 'ok' ? '<img src="' + esc(x.r.signature) + '" alt="서명"/>' : '') + '</td>' +
'<td>' + (x.status === 'stale' ? '점수 변경 후 미확인' : x.status === 'none' ? '미서명' : '') + '</td></tr>';
}).join('') + '</tbody></table></section>';
}).join('');
w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>성적 확인서 ' + esc(ev.school) + '</title>' +
'<style>@page{size:A4 landscape;margin:12mm}body{font-family:sans-serif;margin:0;color:#000}' +
'section{page-break-after:always}section:last-child{page-break-after:auto}' +
'h1{font-size:18px;margin:0 0 4px}.meta{font-size:11px;color:#555;margin-bottom:8px}' +
'table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #333;padding:4px 6px;text-align:center}' +
'th{background:#f1f5f9}th small{font-weight:400}td.t{font-size:11px;white-space:nowrap}td.s{width:120px;height:38px;padding:2px}' +
'td.s img{max-height:34px;max-width:116px}tr{page-break-inside:avoid}' +
'td:nth-child(-n+2),td:last-child,th:nth-child(-n+2),th:last-child{white-space:nowrap}</style></head><body>' +
(pages || '<p>학생이 없습니다.</p>') + '<script>window.onload=function(){window.print()}<\/script></body></html>');
w.document.close();
}

/* ============== 나이스 수행평가 통계표에 서명 넣기 ==============
   - 나이스에서 내려받은 엑셀(.xlsx / .xls)을 올리면 시트마다 "번호" · "비고" 머리글을 찾고
     학생 행의 비고 칸에 서명 그림(서명 완료 상태만)을 칸 크기에 맞춰 넣은 뒤 _서명.xlsx 로 내려받음
   - 반 : 시트 안의 "1학년 3반" 같은 글자 → 반 열 → 위에서 고른 반 순서로 찾음
   - 이름 열이 있으면 이름이 같은지도 확인 (다르면 넣지 않고 알려 줌)
   - .xls 는 SheetJS로 .xlsx 로 바꾼 뒤 넣음 (글꼴 · 테두리 같은 서식은 일부 빠질 수 있음) */
const NEIS_LIBS = {
exceljs: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
};
function loadScriptOnce(src){
loadScriptOnce.p = loadScriptOnce.p || {};
if (!loadScriptOnce.p[src]) loadScriptOnce.p[src] = new Promise(function(ok, fail){
const s = document.createElement('script');
s.src = src; s.onload = ok;
s.onerror = function(){ delete loadScriptOnce.p[src]; fail(new Error('엑셀 처리 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
document.head.appendChild(s);
});
return loadScriptOnce.p[src];
}
const neisNorm = function(v){ return String(v == null ? '' : v).replace(/\s+/g, ''); };
function neisCellText(cell){
const v = cell.value;
if (v == null) return '';
if (typeof v === 'object'){
if (v.richText) return v.richText.map(function(t){ return t.text; }).join('');
if (v.result != null) return String(v.result);
if (v.text != null) return String(v.text);
}
return String(v);
}
// 서명 그림의 빈 여백을 잘라 내고 흰 배경 위에 그린 PNG (base64, 가로 · 세로 크기)
function neisTrimSignature(dataUrl){
return new Promise(function(ok){
const img = new Image();
img.onload = function(){
const c = document.createElement('canvas');
c.width = img.width; c.height = img.height;
const g = c.getContext('2d');
g.drawImage(img, 0, 0);
const d = g.getImageData(0, 0, c.width, c.height).data;
let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++){
const i = (y * c.width + x) * 4;
// 투명하지 않고 흰색에 가깝지 않은 점 = 서명 획
if (d[i + 3] > 20 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)){
if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
}
}
if (x1 < 0){ x0 = 0; y0 = 0; x1 = c.width - 1; y1 = c.height - 1; }
const pad = 6;
x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
const out = document.createElement('canvas');
out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
ok({ base64: out.toDataURL('image/png').split(',')[1], w: out.width, h: out.height });
};
img.onerror = function(){ ok(null); };
img.src = dataUrl;
});
}
// 엑셀 열 너비(글자 수) · 행 높이(pt) → 화면 픽셀
const neisColPx = function(ws, c){ const w = ws.getColumn(c).width; return w ? Math.floor(w * 7) : 64; }; // 저장된 너비에 여백이 이미 들어 있음
const neisRowPx = function(ws, r){ const h = ws.getRow(r).height; return Math.round((h || 15) * 96 / 72); };
// 병합된 칸이면 병합 범위, 아니면 그 칸 하나
function neisCellRange(ws, r, c){
const merges = (ws.model && ws.model.merges) || [];
for (let k = 0; k < merges.length; k++){
const m = merges[k].match(/^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/);
if (!m) continue;
const col = function(s){ let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64; return n; };
const t = +m[2], b = +m[4], l = col(m[1]), rt = col(m[3]);
if (r >= t && r <= b && c >= l && c <= rt) return { t: t, b: b, l: l, r: rt };
}
return { t: r, b: r, l: c, r: c };
}
// 범위 안 픽셀 위치 → ExcelJS 앵커 (0부터 세는 소수 열 · 행 번호)
function neisAnchor(sizes, start, px){
for (let i = 0; i < sizes.length; i++){
if (px <= sizes[i] || i === sizes.length - 1) return start - 1 + i + Math.min(1, px / sizes[i]);
px -= sizes[i];
}
return start - 1;
}
// 시트에서 "번호" · "비고" 가 함께 있는 머리글 행 찾기
function neisFindHeader(ws){
const last = Math.min(ws.rowCount, 40);
for (let r = 1; r <= last; r++){
const cols = {};
ws.getRow(r).eachCell({ includeEmpty: false }, function(cell, c){
const t = neisNorm(neisCellText(cell));
if (!cols.num && /^(번호|출석번호)$/.test(t)) cols.num = c;
else if (!cols.clsnum && /^(학년\/?)?반\/?번호$/.test(t)) cols.clsnum = c; // 나이스 일람표 "반/번호" (값 예: 2/1)
else if (!cols.name && /^(성명|이름|학생명|학생이름)$/.test(t)) cols.name = c;
else if (!cols.note && /^비고$/.test(t)) cols.note = c;
else if (!cols.cls && /^(반|학년반|학반)$/.test(t)) cols.cls = c;
});
if ((cols.num || cols.clsnum) && cols.note) { cols.row = r; return cols; }
}
return null;
}
// "1학년 3반" · "1-3" 같은 글자 → 학생 명단의 반 이름
function neisMatchClass(text){
const t = String(text || '');
const classes = evClasses();
const m = t.match(/(\d+)\s*학년\s*(\d+)\s*반/) || t.match(/(?:^|[^\d])([1-6])\s*[-–]\s*(\d{1,2})(?:[^\d]|$)/);
if (!m) return null;
const g = +m[1], k = +m[2];
return classes.find(function(c){
const n = String(c).match(/(\d+)\D+(\d+)/);
return n && +n[1] === g && +n[2] === k;
}) || null;
}
// 학년 · 반 번호 → 학생 명단의 반 이름 (학년을 모르면 그 반 번호인 반이 하나뿐일 때만)
function neisClassBy(g, k){
const hit = evClasses().filter(function(c){
const n = String(c).match(/(\d+)\D+(\d+)/);
return n && +n[2] === k && (g == null || +n[1] === g);
});
return hit.length === 1 ? hit[0] : null;
}
// "2026학년도 2학기 주간 2학년 2 강의실" → 2 ("학년도"는 건너뜀)
function neisGrade(text){
const m = String(text || '').match(/(?:^|[^\d])(\d)\s*학년(?!도)/);
return m ? +m[1] : null;
}
async function neisSignFile(input){
const file = input.files && input.files[0];
input.value = '';
if (!file) return;
const box = document.getElementById('neisResult');
if (!ev.school){ toast('학교를 먼저 선택하세요.', 'err'); return; }
box.innerHTML = '<div class="ev-notice"><span>엑셀 파일을 처리하는 중입니다…</span></div>';
try {
await loadSignatures();
await loadScriptOnce(NEIS_LIBS.exceljs);
let buf = await file.arrayBuffer();
const wb = new ExcelJS.Workbook();
try {
if (/\.xls$/i.test(file.name)) throw new Error('xls');
await wb.xlsx.load(buf);
} catch (e) {
// .xls (또는 ExcelJS가 못 읽는 파일) → SheetJS로 .xlsx 로 바꿔서 다시 읽기
await loadScriptOnce(NEIS_LIBS.xlsx);
const sj = XLSX.read(buf, { type: 'array', cellStyles: true });
buf = XLSX.write(sj, { type: 'array', bookType: 'xlsx', cellStyles: true });
await wb.xlsx.load(buf);
// 바꾼 파일은 기본 행 높이가 빠져 있어 그림 위치가 어긋나 보일 수 있음 → 15pt로 채움
wb.worksheets.forEach(function(w){ w.properties.defaultRowHeight = 15; });
}
const pickedClass = document.getElementById('sgClass').value;
const signs = ev.signs || [];
const trimmed = {};
const res = { put: [], stale: [], none: [], mismatch: [], unknown: [], sheets: [] };
for (const ws of wb.worksheets){
const h = neisFindHeader(ws);
if (!h) continue;
// 머리글 위쪽 글자 + 시트 이름에서 반 찾기
let above = ws.name + ' ';
for (let r = 1; r < h.row; r++) ws.getRow(r).eachCell(function(cell){ above += neisCellText(cell) + ' '; });
const sheetClass = neisMatchClass(above) || pickedClass || null;
const sheetGrade = neisGrade(above);
let count = 0;
for (let r = h.row + 1; r <= ws.rowCount; r++){
const row = ws.getRow(r);
let number, cls = null;
if (h.num){
const numText = neisNorm(neisCellText(row.getCell(h.num)));
if (!/^\d+$/.test(numText)) continue;
number = +numText;
cls = (h.cls && neisMatchClass(neisCellText(row.getCell(h.cls)))) || sheetClass;
} else {
// "반/번호" 칸 : 2/1 (반/번호) 또는 2/3/1 (학년/반/번호)
const m = neisNorm(neisCellText(row.getCell(h.clsnum))).match(/^(?:(\d+)\D)?(\d+)\D(\d+)$/);
if (!m) continue;
number = +m[3];
cls = neisClassBy(m[1] ? +m[1] : sheetGrade, +m[2]);
}
const name = h.name ? neisNorm(neisCellText(row.getCell(h.name))) : '';
let cand = signs.filter(function(s){ return s.number === number && (!cls || s.class_name === cls); });
if (!cls && name) cand = cand.filter(function(s){ return neisNorm(s.name) === name; });
const label = (cls ? cls + ' ' : '') + number + '번' + (name ? ' ' + name : '');
if (cand.length !== 1){ res.unknown.push(label); continue; }
const s = cand[0];
if (name && neisNorm(s.name) !== name){ res.mismatch.push(label + ' (명단: ' + s.name + ')'); continue; }
if (!s.signed_at){ res.none.push(label); continue; }
if (!s.matches){ res.stale.push(label); continue; }
if (!(s.student_id in trimmed)) trimmed[s.student_id] = await neisTrimSignature(s.signature);
const pic = trimmed[s.student_id];
if (!pic){ res.unknown.push(label); continue; }
// 비고 칸(병합 포함) 크기 계산, 너무 낮으면 행 높이를 조금 늘림
const rg = neisCellRange(ws, r, h.note);
if (rg.t === rg.b && neisRowPx(ws, r) < 26) ws.getRow(r).height = 20;
const ws_ = []; for (let c = rg.l; c <= rg.r; c++) ws_.push(neisColPx(ws, c));
const hs_ = []; for (let rr = rg.t; rr <= rg.b; rr++) hs_.push(neisRowPx(ws, rr));
const cw = ws_.reduce(function(a, b){ return a + b; }, 0), ch = hs_.reduce(function(a, b){ return a + b; }, 0);
const scale = Math.min((cw - 4) / pic.w, (ch - 4) / pic.h);
const iw = Math.max(1, Math.floor(pic.w * scale)), ih = Math.max(1, Math.floor(pic.h * scale));
const imgId = wb.addImage({ base64: pic.base64, extension: 'png' });
ws.addImage(imgId, {
tl: { col: neisAnchor(ws_, rg.l, (cw - iw) / 2), row: neisAnchor(hs_, rg.t, (ch - ih) / 2) },
ext: { width: iw, height: ih },
editAs: 'oneCell'
});
res.put.push(label);
count++;
}
res.sheets.push(ws.name + (sheetClass ? ' (' + sheetClass + ')' : '') + ' ' + count + '명');
}
if (!res.sheets.length){
box.innerHTML = '<div class="ev-notice"><span>"번호"와 "비고" 머리글이 있는 표를 찾지 못했습니다. 나이스에서 내려받은 수행평가 통계표인지 확인해 주세요.</span></div>';
return;
}
if (res.put.length){
const out = await wb.xlsx.writeBuffer();
const a = document.createElement('a');
a.href = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
a.download = file.name.replace(/\.xlsx?$/i, '') + '_서명.xlsx';
document.body.appendChild(a); a.click(); a.remove();
setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
}
const list = function(title, arr){
return arr.length ? '<div style="margin-top:4px"><b>' + title + ' ' + arr.length + '명</b> : ' + arr.map(esc).join(', ') + '</div>' : '';
};
box.innerHTML = '<div class="ev-notice" style="display:block; font-size:13px">' +
'<div><b>' + (res.put.length ? '✔ 서명 ' + res.put.length + '명을 넣어 내려받았습니다.' : '넣을 수 있는 서명이 없어 파일을 만들지 않았습니다.') + '</b>' +
' <span class="muted">(' + res.sheets.map(esc).join(' · ') + ')</span></div>' +
list('미서명', res.none) + list('재확인 필요(서명 뒤 점수 변경)', res.stale) +
list('이름이 명단과 다름', res.mismatch) + list('명단에서 찾지 못함', res.unknown) +
'<div class="hint" style="margin-top:6px">서명은 비고 칸 위에 그림으로 들어갑니다. 인쇄 · 제출용이며, 이 파일을 나이스에 다시 올려도 서명은 반영되지 않습니다.' +
(/\.xls$/i.test(file.name) ? ' .xls 파일은 .xlsx 로 바꾸면서 글꼴 · 테두리 서식이 일부 빠질 수 있습니다.' : '') + '</div></div>';
} catch (e) {
box.innerHTML = '';
toast(e.message, 'err');
}
}

/* 학생용 성적 확인표 : 조회 화면을 못 쓸 때 나눠주는 종이 확인표
   - 학생에게 공개된 과제만, 과제별 평가 영역 점수 · 과제 합계 · 300점 만점 환산 총점
   - 학생 한 명이 가로 띠 한 줄, A4 한 장에 최대한 많이 (자르는 선 포함) */
function printGradeSlips(){
const tasks = signTasks();
if (!tasks.length){ toast('학생에게 공개된 평가가 없습니다.', 'err'); return; }
let rows = signRows();
const onlyUnsigned = document.getElementById('slipUnsigned');
if (onlyUnsigned && onlyUnsigned.checked) rows = rows.filter(function(x){ return x.status !== 'ok'; });
if (!rows.length){ toast('인쇄할 학생이 없습니다.', 'err'); return; }
const w = window.open('', '_blank');
if (!w){ toast('팝업이 차단되었습니다.', 'err'); return; }
const scoreOf = {};
ev.scoreRows.forEach(function(r){
const lv = evLevel(r.level_id);
if (lv) scoreOf[r.student_id + ':' + r.item_id] = lv.score;
});
const maxAll = tasks.reduce(function(s, t){ return s + taskMax(t); }, 0);
const head = esc(settings.year + '-' + settings.semester + '학기 ' + ev.school);
// 한 학생 = 가로 띠 한 줄 : 이름 | 과제마다 (평가 영역별 점수 + 합계) | 300점 만점 총점
const slip = function(x){
const r = x.r;
let sumAll = 0, missing = false;
const blocks = tasks.map(function(t){
const vals = t.items.map(function(it){ return scoreOf[r.student_id + ':' + it.id]; });
const sub = vals.reduce(function(s, v){ return s + (v == null ? 0 : evNum(v)); }, 0);
if (vals.some(function(v){ return v == null; })) missing = true;
sumAll += sub;
return '<table class="tk"><tr><th class="tt" colspan="' + (t.items.length + 1) + '">' + esc(t.title) + '</th></tr>' +
'<tr>' + t.items.map(function(it){ return '<td class="nm">' + esc(it.name) + '<small>' + evFmt(it.max_score) + '</small></td>'; }).join('') +
'<td class="nm sb">합계<small>' + evFmt(taskMax(t)) + '</small></td></tr>' +
'<tr>' + vals.map(function(v){ return '<td class="sc">' + (v == null ? '<span class="miss">미채점</span>' : evFmt(v)) + '</td>'; }).join('') +
'<td class="sc sb">' + evFmt(sub) + '</td></tr></table>';
}).join('');
const total = maxAll ? evFmt1(sumAll / maxAll * 300) : '-';
return '<div class="slip"><div class="who"><span class="cap">' + head + '</span><b>' + esc(r.class_name) + ' ' + r.number + '번 ' + esc(r.name) + '</b>' +
'<div class="tot">총점 <b>' + total + '</b> / 300</div>' + (missing ? '<small>미채점 0점 계산</small>' : '') + '</div>' +
blocks + '</div>';
};
w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>성적 확인표 ' + esc(ev.school) + '</title>' +
'<style>@page{size:A4 portrait;margin:7mm}body{font-family:sans-serif;margin:0;color:#000}' +
'.slip{display:flex;flex-wrap:wrap;align-items:stretch;gap:3px;padding:3px 0 4px;border-bottom:1px dashed #888;break-inside:avoid;page-break-inside:avoid}' +
'.cap{font-size:6.5px;color:#555;white-space:normal}' +
'.who{display:flex;flex-direction:column;justify-content:center;border:1.5px solid #000;padding:2px 4px;font-size:10px;width:24mm;box-sizing:border-box;word-break:keep-all}' +
'table.tk{border-collapse:collapse;font-size:8.5px}table.tk td,table.tk th{border:1px solid #333;padding:1px 2px;text-align:center}' +
'th.tt{background:#e5e9ef;font-size:9px;white-space:nowrap}' +
'td.nm{min-width:30px;max-width:62px;line-height:1.15;color:#222}td.nm small{display:block;color:#666;font-size:7.5px}' +
'td.sc{font-size:10.5px;font-weight:700}td.sb{background:#f3f4f6}.miss{color:#b00;font-size:7.5px;font-weight:400}' +
'.tot{font-size:8.5px;margin-top:2px;border-top:1px solid #999;padding-top:2px}.tot b{font-size:14px}.who small{font-size:7px;color:#b00}</style></head><body>' +
rows.map(slip).join('') + '<script>window.onload=function(){window.print()}<\/script></body></html>');
w.document.close();
}

/* 교사용 한 명씩 확인 · 서명
   - 선생님이 반 학생을 번호 순으로 이전 · 다음으로 넘기며 과제 · 평가 영역 점수를 보여 주고 그 자리에서 서명을 받음
   - 화면에 보이는 성적(eval_signature_list 의 current)을 그대로 snapshot 으로 저장
     → 학생이 직접 서명한 것과 똑같이 "서명 완료 / 재확인 필요"가 판정됨 */
const sv = { list: [], idx: 0, pad: null, saving: false };
function openSignViewer(studentId){
if (!ev.school){ toast('학교를 먼저 선택하세요.', 'err'); return; }
if (!signTasks().length){ toast('학생에게 공개된 평가가 없습니다.', 'err'); return; }
document.getElementById('svOnly').checked = false;
sv.list = signRows();
if (!sv.list.length){ toast('학생이 없습니다.', 'err'); return; }
const i = studentId ? sv.list.findIndex(function(x){ return x.r.student_id === studentId; }) : 0;
document.getElementById('svModal').classList.add('show');
svGo(Math.max(0, i));
}
function closeSignViewer(){
document.getElementById('svModal').classList.remove('show');
sv.pad = null;
}
// 미서명 · 재확인만 보기 : 지금 학생이 목록에 남아 있으면 그대로, 아니면 첫 학생
function svFilter(){
const cur = sv.list[sv.idx] && sv.list[sv.idx].r.student_id;
const only = document.getElementById('svOnly').checked;
sv.list = signRows().filter(function(x){ return !only || x.status !== 'ok'; });
if (!sv.list.length){
document.getElementById('svOnly').checked = false;
sv.list = signRows();
toast('미서명 · 재확인 필요 학생이 없습니다.', 'ok');
}
const i = sv.list.findIndex(function(x){ return x.r.student_id === cur; });
svGo(Math.max(0, i));
}
function svMove(d){
if (!sv.list.length) return;
const i = sv.idx + d;
if (i < 0){ toast('첫 번째 학생입니다.'); return; }
if (i >= sv.list.length){ toast('마지막 학생입니다.'); return; }
svGo(i);
}
function svGo(i){
sv.idx = i;
const x = sv.list[i];
const r = x.r;
const all = !document.getElementById('sgClass').value;
document.getElementById('svCap').textContent = termLabel() + ' · ' + ev.school;
document.getElementById('svWho').textContent = r.class_name + ' ' + r.number + '번 ' + r.name;
document.getElementById('svPos').textContent = (i + 1) + ' / ' + sv.list.length;
document.getElementById('svPick').innerHTML = sv.list.map(function(y, k){
return '<option value="' + k + '"' + (k === i ? ' selected' : '') + '>' + esc((all ? y.r.class_name + ' ' : '') + y.r.number + '번 ' + y.r.name) +
(y.status === 'ok' ? ' ✔' : y.status === 'stale' ? ' (재확인)' : '') + '</option>';
}).join('');
// 과제별 평가 영역 점수 (서명할 때 저장될 현재 성적)
const tasks = signTasks();
const cur = {};
(r.current || []).forEach(function(t){ cur[t.id] = t; });
const maxAll = tasks.reduce(function(s, t){ return s + taskMax(t); }, 0);
let sumAll = 0, missing = false, html = '';
tasks.forEach(function(t){
const c = cur[t.id];
// 점수가 있으면 서명에 저장될 그 성적(snapshot과 같은 모양)을 그대로, 없으면 평가 기준의 채점 요소만
const items = c ? c.items : t.items.map(function(it){ return { name: it.name, max_score: it.max_score, score: null }; });
let sub = 0;
const cells = items.map(function(it){
const v = it.score;
if (v == null) missing = true; else sub += evNum(v);
return '<div class="sv-item"><div class="nm">' + esc(it.name) + '<small>' + evFmt(it.max_score) + '점</small></div>' +
(v == null ? '<div class="sc miss">미채점</div>' : '<div class="sc">' + evFmt(v) + '</div>') + '</div>';
}).join('');
sumAll += sub;
html += '<div class="sv-task"><div class="sv-task-head"><span>' + esc(t.title) + '</span><b>' + evFmt(sub) + '<small> / ' + evFmt(taskMax(t)) + '</small></b></div>' +
(items.length ? '<div class="sv-items">' + cells + '</div>' : '<div class="sv-item muted">채점 요소 없음</div>') + '</div>';
});
html += '<div class="sv-total"><div><b>총점</b> <span class="muted" style="font-size:12px">(' + evFmt(sumAll) + ' / ' + evFmt(maxAll) + '점 → 300점 만점 환산)</span>' +
(missing ? '<div style="font-size:12px; color:var(--danger)">미채점 항목은 0점으로 계산</div>' : '') + '</div>' +
'<div class="v">' + (maxAll ? evFmt1(sumAll / maxAll * 300) : '-') + '<small> / 300</small></div></div>';
// 서명
const canSign = (r.current || []).length > 0;
html += '<div class="sv-sign"><h4>성적 확인 서명 ' + SIGN_STATUS[x.status] + '</h4>';
if (!canSign){
html += '<div class="ev-notice"><span>이 학생은 공개된 과제에 입력된 점수가 없어 서명할 수 없습니다.</span></div>';
} else if (x.status === 'ok'){
html += '<div class="sv-signed"><img src="' + esc(r.signature) + '" alt="서명"/><div><div class="sg-ok">✔ ' + esc(seoulTime(r.signed_at)) + ' 서명 완료</div>' +
'<button class="btn ghost sm" style="margin-top:6px" onclick="svResign()">다시 서명받기</button></div></div>';
} else {
html += svPadHtml(x.status === 'stale');
}
html += '</div>';
document.getElementById('svBody').innerHTML = html;
document.getElementById('svBody').scrollTop = 0;
svSetupPad();
}
function svPadHtml(stale){
return (stale ? '<div class="ev-notice"><span>서명한 뒤 점수가 바뀌었습니다. 바뀐 성적을 확인하고 다시 서명받으세요.</span></div>' : '') +
'<div class="sv-pad"><canvas id="svCanvas"></canvas><div class="hint2" id="svHint">학생이 여기에 서명하세요</div></div>' +
'<div class="flex" style="margin-top:8px; justify-content:space-between; align-items:center">' +
'<span class="hint" style="margin:0">성적에 이상이 있으면 서명하지 말고 점수를 먼저 고치세요.</span>' +
'<button class="btn ghost sm" onclick="svClear()">서명 지우기</button></div>';
}
function svResign(){
const box = document.querySelector('#svBody .sv-sign');
box.innerHTML = '<h4>성적 확인 서명 ' + SIGN_STATUS.ok + '</h4>' + svPadHtml(false);
svSetupPad();
}
function svSetupPad(){
const cv = document.getElementById('svCanvas');
sv.pad = null;
document.getElementById('svSave').disabled = true;
if (!cv) return;
const ratio = window.devicePixelRatio || 1;
cv.width = cv.clientWidth * ratio;
cv.height = cv.clientHeight * ratio;
const g = cv.getContext('2d');
g.scale(ratio, ratio);
g.lineWidth = 2.5; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0f172a';
const pad = sv.pad = { cv: cv, g: g, drawing: false, strokes: 0 };
function pos(e){ const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; }
cv.addEventListener('pointerdown', function(e){
e.preventDefault();
cv.setPointerCapture(e.pointerId);
pad.drawing = true;
const p = pos(e);
g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + 0.1, p.y + 0.1); g.stroke();
});
cv.addEventListener('pointermove', function(e){
if (!pad.drawing) return;
const p = pos(e);
g.lineTo(p.x, p.y); g.stroke();
});
function end(){
if (!pad.drawing) return;
pad.drawing = false;
pad.strokes++;
document.getElementById('svHint').style.display = 'none';
document.getElementById('svSave').disabled = false;
}
cv.addEventListener('pointerup', end);
cv.addEventListener('pointercancel', end);
cv.addEventListener('pointerleave', end);
}
function svClear(){
if (!sv.pad) return;
sv.pad.g.clearRect(0, 0, sv.pad.cv.width, sv.pad.cv.height);
sv.pad.strokes = 0;
document.getElementById('svHint').style.display = '';
document.getElementById('svSave').disabled = true;
}
async function svSave(){
const x = sv.list[sv.idx];
if (!x || !sv.pad || !sv.pad.strokes || sv.saving) return;
const btn = document.getElementById('svSave');
btn.disabled = true;
sv.saving = true;
// 학생 화면과 같이 가로 400px PNG로 줄여서 저장
const out = document.createElement('canvas');
out.width = 400;
out.height = Math.round(400 * sv.pad.cv.height / sv.pad.cv.width);
out.getContext('2d').drawImage(sv.pad.cv, 0, 0, out.width, out.height);
try {
must(await sb.from('eval_signatures').upsert({
student_id: x.r.student_id, semester: settings.semester, snapshot: x.r.current,
signature: out.toDataURL('image/png'), signed_at: new Date().toISOString()
}, { onConflict: 'student_id,semester' }));
await loadSignatures();
renderSignTable();
toast(x.r.number + '번 ' + x.r.name + ' 서명을 저장했습니다.', 'ok');
// 새로 불러온 서명 상태로 목록을 다시 만들고, 다음 학생으로
const only = document.getElementById('svOnly').checked;
const id = x.r.student_id;
const fresh = signRows();
const pos = fresh.findIndex(function(y){ return y.r.student_id === id; });
sv.list = fresh.filter(function(y){ return !only || y.status !== 'ok' || y.r.student_id === id; });
let i = sv.list.findIndex(function(y){ return y.r.student_id === id; });
if (i < 0) i = Math.max(0, Math.min(pos, sv.list.length - 1));
if (i + 1 < sv.list.length) svGo(i + 1);
else { svGo(i); toast('마지막 학생까지 확인했습니다.', 'ok'); }
} catch (e) {
toast(e.message, 'err');
btn.disabled = false;
} finally { sv.saving = false; }
}
document.addEventListener('keydown', function(e){
if (!document.getElementById('svModal').classList.contains('show')) return;
if (e.key === 'Escape'){ closeSignViewer(); return; }
const tag = (e.target && e.target.tagName) || '';
if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
if (e.key === 'ArrowLeft'){ e.preventDefault(); svMove(-1); }
if (e.key === 'ArrowRight'){ e.preventDefault(); svMove(1); }
});

