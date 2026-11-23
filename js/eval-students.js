/* ============== 학생 명단 ============== */
function renderStudentView(){
const sel = document.getElementById('esClass');
const prev = sel.value;
const classes = evClasses();
sel.innerHTML = classes.length ? classes.map(function(c){ return opt(c); }).join('') : '<option value="">(등록된 반 없음)</option>';
if (classes.indexOf(prev) >= 0) sel.value = prev;
renderStudents();
}
function renderStudents(){
const cls = document.getElementById('esClass').value;
const box = document.getElementById('esList');
if (cls) document.getElementById('esNewClass').value = cls;
if (!ev.school){ box.innerHTML = '<div class="empty"><div class="big">학교를 먼저 선택하세요</div></div>'; return; }
const list = evStudentsOf(cls);
if (!list.length){
box.innerHTML = '<div class="empty"><div class="big">등록된 학생이 없습니다</div><div>아래에서 반과 번호 · 이름을 붙여넣어 등록하세요.</div></div>';
return;
}
let html = '<div class="flex" style="margin-bottom:8px">' +
'<button class="btn ghost sm" onclick="printCodes()">확인코드표 인쇄</button>' +
'<button class="btn danger sm" onclick="deleteClass()">이 반 전체 삭제</button></div>' +
'<table><thead><tr><th class="num" style="width:60px">번호</th><th>이름</th><th>확인코드</th><th style="width:170px">동작</th></tr></thead><tbody>';
list.forEach(function(s){
html += '<tr><td class="num">'+s.number+'</td><td>'+esc(s.name)+'</td><td class="code">'+esc(s.access_code)+'</td>' +
'<td><button class="btn ghost sm" onclick="reissueCode('+s.id+')">코드 재발급</button> ' +
'<button class="btn danger sm" onclick="deleteStudent('+s.id+')">삭제</button></td></tr>';
});
box.innerHTML = html + '</tbody></table>';
}
async function submitStudents(){
const cls = document.getElementById('esNewClass').value.trim();
if (!ev.school){ toast('학교를 먼저 선택하세요', 'err'); return; }
if (!cls){ toast('반을 입력하세요', 'err'); return; }
const byNumber = {}, bad = [];
document.getElementById('esPaste').value.split(/\r?\n/).forEach(function(line){
line = line.trim();
if (!line) return;
const m = line.match(/^(\d+)[\s,]+(.+)$/);
if (!m){ bad.push(line); return; }
// 같은 번호가 두 번 나오면 마지막 줄 기준
byNumber[m[1]] = { school_year: settings.year, school: ev.school, class_name: cls, number: Number(m[1]), name: m[2].replace(/[\t,]+/g, ' ').trim() };
});
const rows = Object.keys(byNumber).map(function(k){ return byNumber[k]; });
if (bad.length){ toast('형식이 맞지 않는 줄: ' + bad[0], 'err'); return; }
if (!rows.length){ toast('번호와 이름을 입력하세요', 'err'); return; }
try {
must(await sb.from('eval_students').upsert(rows, { onConflict: 'school_year,school,class_name,number' }));
toast(rows.length + '명 등록했습니다.', 'ok');
document.getElementById('esPaste').value = '';
await loadEvalData();
renderStudentView();
document.getElementById('esClass').value = cls;
renderStudents();
} catch (e) { toast(e.message, 'err'); }
}
function newCode(){
const a = new Uint32Array(1);
crypto.getRandomValues(a);
return ('00000' + (a[0] % 1000000)).slice(-6);
}
async function reissueCode(id){
if (!confirm('확인코드를 새로 만들까요? 이전 코드는 더 이상 쓸 수 없습니다.')) return;
try {
must(await sb.from('eval_students').update({ access_code: newCode(), fail_count: 0, locked_until: null }).eq('id', id));
toast('재발급했습니다.', 'ok');
await loadEvalData();
renderStudents();
} catch (e) { toast(e.message, 'err'); }
}
async function deleteStudent(id){
if (!confirm('이 학생을 삭제하시겠습니까? 입력된 점수도 함께 삭제됩니다.')) return;
try {
must(await sb.from('eval_students').delete().eq('id', id));
toast('삭제되었습니다.', 'ok');
await loadEvalData();
renderStudentView();
} catch (e) { toast(e.message, 'err'); }
}
async function deleteClass(){
const cls = document.getElementById('esClass').value;
if (!confirm(ev.school + ' ' + cls + ' 학생 ' + evStudentsOf(cls).length + '명을 모두 삭제하시겠습니까?\n입력된 점수도 함께 삭제됩니다.')) return;
try {
must(await sb.from('eval_students').delete().eq('school_year', settings.year).eq('school', ev.school).eq('class_name', cls));
toast('삭제되었습니다.', 'ok');
await loadEvalData();
renderStudentView();
} catch (e) { toast(e.message, 'err'); }
}
/* 학생 조회 주소 (학교 · 반 · 번호를 미리 채움, 확인코드는 넣지 않음) */
function studentUrl(st){
const u = new URL('student.html', location.href);
u.search = new URLSearchParams({ s: ev.school, c: st.class_name, n: String(st.number) }).toString();
return u.href;
}
function qrSvg(text){
if (typeof qrcode === 'undefined') return '';  // QR 라이브러리를 못 불러오면 주소 글자만 인쇄
const qr = qrcode(0, 'M');
qr.addData(text);
qr.make();
return qr.createSvgTag({ cellSize: 2, margin: 8, scalable: true });  // 테두리 4칸: 카메라 인식용 여백
}
function printCodes(){
const cls = document.getElementById('esClass').value;
const w = window.open('', '_blank');
if (!w){ toast('팝업이 차단되었습니다.', 'err'); return; }
w.document.write('<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>확인코드 ' + esc(cls) + '</title>' +
'<style>body{font-family:sans-serif;margin:16px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}' +
'.s{border:1px dashed #94a3b8;border-radius:8px;padding:10px;font-size:13px;break-inside:avoid;display:flex;gap:10px;align-items:center}' +
'.q{width:104px;height:104px;flex-shrink:0}.q svg{width:100%;height:100%;display:block}' +
'.c{font-size:20px;font-weight:700;letter-spacing:2px;font-family:monospace}.u{font-size:9px;color:#64748b;word-break:break-all;margin-top:4px}' +
'@media print{body{margin:0}}</style></head><body>' +
'<div class="g">' + evStudentsOf(cls).map(function(s){
const url = studentUrl(s), qr = qrSvg(url);
return '<div class="s">' + (qr ? '<div class="q">' + qr + '</div>' : '') + '<div>' +
esc(ev.school) + ' ' + esc(s.class_name) + ' ' + s.number + '번 <b>' + esc(s.name) + '</b>' +
'<div>확인코드 <span class="c">' + esc(s.access_code) + '</span></div>' +
'<div class="u">' + (qr ? 'QR을 찍고 확인코드를 입력하세요' : esc(url)) + '</div></div></div>';
}).join('') + '</div><script>window.print()<\/script></body></html>');
w.document.close();
}
