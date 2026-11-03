/* =========================================================
   나이스(NEIS) 교육정보 개방 포털 중계 함수
   - 인증키는 이 함수의 비밀값 NEIS_API_KEY 에만 둡니다 (브라우저로 보내지 않음).
   - 로그인한 선생님(is_allowed_user)만 쓸 수 있습니다.
   - 요청 (POST JSON)
       { type: 'school',   name }                       → 학교 검색 (학교기본정보)
       { type: 'meal',     atpt, code, from, to }       → 급식식단정보 (YYYYMMDD)
       { type: 'schedule', atpt, code, from, to }       → 학사일정
   - 응답 : { rows: [...] } 또는 { error: '...' }
========================================================= */
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

type Row = Record<string, string>;

async function neis(service: string, params: Record<string, string>): Promise<Row[]> {
  const url = new URL('https://open.neis.go.kr/hub/' + service);
  url.search = new URLSearchParams({
    KEY: Deno.env.get('NEIS_API_KEY') ?? '',
    Type: 'json',
    pIndex: '1',
    pSize: '1000',
    ...params,
  }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error('나이스 응답 오류 (' + res.status + ')');
  const data = await res.json();
  const section = data[service];
  if (!section) {
    const code = data?.RESULT?.CODE;
    if (code === 'INFO-200') return []; // 해당하는 자료 없음
    throw new Error(data?.RESULT?.MESSAGE || '나이스 응답을 읽지 못했습니다.');
  }
  const result = section[0]?.head?.[1]?.RESULT;
  if (result && result.CODE !== 'INFO-000') throw new Error(result.MESSAGE || '나이스 오류');
  return section[1]?.row ?? [];
}

// "미역국 (5.6.)<br/>닭갈비5.6.13.15.<br/>잡곡밥" → [{ name, allergy }]
function parseDishes(s: string) {
  return String(s || '')
    .split(/<br\s*\/?>/i)
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const m = d.match(/^(.*?)\s*(?:\(([\d.]+)\)|((?:\d{1,2}\.)+))\s*$/);
      if (!m || !m[1]) return { name: d, allergy: '' };
      return { name: m[1].trim(), allergy: (m[2] || m[3] || '').replace(/\.+$/, '') };
    });
}

const YMD = /^\d{8}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST만 지원합니다.' }, 405);
  try {
    // 로그인한 사람의 권한으로 허용 목록 확인
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: allowed } = await sb.rpc('is_allowed_user');
    if (allowed !== true) return json({ error: '권한이 없습니다.' }, 403);
    if (!Deno.env.get('NEIS_API_KEY')) {
      return json({ error: '나이스 인증키(NEIS_API_KEY)가 설정되지 않았습니다.' }, 500);
    }

    const b = await req.json().catch(() => ({}));

    if (b.type === 'school') {
      const name = String(b.name ?? '').trim();
      if (name.length < 2 || name.length > 40) return json({ error: '학교 이름을 2글자 이상 입력하세요.' }, 400);
      const rows = await neis('schoolInfo', { SCHUL_NM: name });
      return json({
        rows: rows.slice(0, 50).map((r) => ({
          atpt: r.ATPT_OFCDC_SC_CODE,
          office: r.ATPT_OFCDC_SC_NM,
          code: r.SD_SCHUL_CODE,
          name: r.SCHUL_NM,
          kind: r.SCHUL_KND_SC_NM,
          addr: r.ORG_RDNMA,
        })),
      });
    }

    const atpt = String(b.atpt ?? ''), code = String(b.code ?? '');
    const from = String(b.from ?? ''), to = String(b.to ?? '');
    if (!/^[A-Z]\d{2}$/.test(atpt) || !/^\d{7}$/.test(code) || !YMD.test(from) || !YMD.test(to) || from > to) {
      return json({ error: '요청 값이 올바르지 않습니다.' }, 400);
    }
    const school = { ATPT_OFCDC_SC_CODE: atpt, SD_SCHUL_CODE: code };

    if (b.type === 'meal') {
      const rows = await neis('mealServiceDietInfo', { ...school, MLSV_FROM_YMD: from, MLSV_TO_YMD: to });
      return json({
        rows: rows.map((r) => ({
          date: r.MLSV_YMD,
          kind: r.MMEAL_SC_NM,
          dishes: parseDishes(r.DDISH_NM),
          cal: r.CAL_INFO || '',
        })),
      });
    }

    if (b.type === 'schedule') {
      const rows = await neis('SchoolSchedule', { ...school, AA_FROM_YMD: from, AA_TO_YMD: to });
      return json({
        rows: rows.map((r) => ({
          date: r.AA_YMD,
          name: r.EVENT_NM,
          off: r.SBTR_DD_SC_NM === '휴업일',
        })),
      });
    }

    return json({ error: '알 수 없는 요청입니다.' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
