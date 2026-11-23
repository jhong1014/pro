/* =========================================================
   Supabase 연결 설정
   - 공개용(publishable) 키는 웹페이지에 넣어도 되는 키입니다.
   - 데이터 보호는 Supabase의 RLS(허용된 이메일만 접근)로 이뤄집니다.
   - service_role 키는 절대 여기에 넣지 마세요.
========================================================= */
const SUPABASE_URL = 'https://pfasdccrftfedsvwwalb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_XuCCXqn_RAYYbEG9Ua33XA_-opIYotq';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- 공통 도우미 ---------- */
function must(res){
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
// 한국 시간 기준 오늘 (yyyy-MM-dd)
function seoulToday(){
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul' }).format(new Date());
}
// 한국 시간 기준 'yyyy-MM-dd HH:mm'
function seoulDateTime(iso){
  if (!iso) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit'
  }).format(new Date(iso));
}
// DB 행 → 화면에서 쓰던 형태 (row 자리에 DB id 사용)
function toRec(r){
  return {
    row: r.id,
    date: r.date,
    school: r.school || '',
    period: r.period || '',
    cls: r.class_name || '',
    progress: r.progress || ''
  };
}
function byPeriod(a, b){
  const pa = parseInt(a.period, 10), pb = parseInt(b.period, 10);
  if (!isNaN(pa) && !isNaN(pb) && pa !== pb) return pa - pb;
  return String(a.period).localeCompare(String(b.period));
}
// 1000행 제한을 넘는 조회를 위해 나눠서 모두 가져오기
async function fetchAll(makeQuery){
  const out = [], size = 1000;
  for (let from = 0; ; from += size){
    const data = must(await makeQuery().range(from, from + size - 1));
    out.push.apply(out, data);
    if (data.length < size) break;
  }
  return out;
}

/* ---------- 학교 목록 (메모리 캐시, 쓰기 시 무효화) ---------- */
let _schools = null;
async function loadSchoolList(){
  if (_schools) return _schools;
  const rows = await fetchAll(function(){ return sb.from('records').select('school').eq('school_year', settings.year).eq('semester', settings.semester).order('id'); });
  const set = {};
  rows.forEach(function(r){ if (r.school) set[r.school] = true; });
  _schools = Object.keys(set).sort();
  return _schools;
}
function invalidateSchools(){ _schools = null; }

/* ---------- 휴일 ---------- */
async function loadHolidayList(){
  const data = must(await sb.from('holidays').select('*').order('start_date'));
  return data.map(function(h){
    return { row: h.id, start: h.start_date, end: h.end_date || h.start_date, reason: h.reason || '' };
  });
}
function findHoliday(dateStr, list){
  for (let i = 0; i < list.length; i++){
    if (dateStr >= list[i].start && dateStr <= list[i].end) return list[i];
  }
  return null;
}

