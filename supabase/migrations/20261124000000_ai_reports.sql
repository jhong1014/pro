/* =========================================================
   AI 사례 보고서 이어쓰기 (네이버폼 수행평가 이어서 작성)
   - 선생님 : 네이버폼 응답 엑셀을 올려 학생별 초안을 만듦 (report_admin.html)
   - 학생   : 학번 + 이름으로 들어와 초안을 이어 쓰고 임시 저장 / 최종 제출 (report.html)
   - 선생님 : 제출 현황 확인, 제출 취소(다시 쓰기 허용), 엑셀로 내려받기, 작성 받기 열기 · 닫기
========================================================= */

create table if not exists public.ai_reports (
  id           bigint generated always as identity primary key,
  hakbun       text not null,
  name         text not null,
  cases        jsonb not null default '[]'::jsonb,  -- [{title, what, opinion, source}] × 3
  pledge       text not null default '',             -- AI를 사용할 때 나의 다짐
  naver        jsonb,                                -- 네이버폼에서 가져온 원래 응답 (비교용)
  imported_at  timestamptz,
  edited_at    timestamptz,                          -- 학생이 마지막으로 저장한 때
  submitted_at timestamptz,                          -- 최종 제출 (null = 작성 중)
  unique (hakbun, name)
);
alter table public.ai_reports enable row level security;
drop policy if exists "allowed users full access" on public.ai_reports;
create policy "allowed users full access" on public.ai_reports for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));

-- 작성 받기 열기 · 닫기 (한 줄만 씀)
create table if not exists public.ai_report_settings (
  id    int primary key default 1 check (id = 1),
  open  boolean not null default true,
  note  text not null default ''                     -- 학생 화면 맨 위 안내 문구
);
insert into public.ai_report_settings (id) values (1) on conflict do nothing;
alter table public.ai_report_settings enable row level security;
drop policy if exists "allowed users full access" on public.ai_report_settings;
create policy "allowed users full access" on public.ai_report_settings for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));

/* ---------- 이름 · 학번 정리 (공백 제거) ---------- */
create or replace function public.ai_report_norm(p text)
returns text
language sql
immutable
set search_path = ''
as $$ select regexp_replace(coalesce(p, ''), '\s+', '', 'g'); $$;

/* ---------- 학생에게 돌려줄 모양 ---------- */
create or replace function public.ai_report_json(r public.ai_reports, p_open boolean, p_note text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'hakbun', r.hakbun, 'name', r.name,
    'cases', r.cases, 'pledge', r.pledge,
    'imported', r.imported_at is not null,
    'edited_at', r.edited_at, 'submitted_at', r.submitted_at,
    'open', p_open, 'note', p_note);
$$;

/* ---------- 학생 : 학번 + 이름으로 불러오기 ---------- */
create or replace function public.student_ai_report_load(p_hakbun text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_h text := public.ai_report_norm(p_hakbun);
  v_n text := public.ai_report_norm(p_name);
  v_r public.ai_reports;
  v_s public.ai_report_settings;
begin
  if v_h !~ '^[0-9]{4,6}$' then
    return jsonb_build_object('error', '학번은 숫자 4~6자리로 입력하세요. (예: 2111)');
  end if;
  if length(v_n) < 2 or length(v_n) > 20 then
    return jsonb_build_object('error', '이름을 정확히 입력하세요.');
  end if;
  select * into v_s from public.ai_report_settings where id = 1;

  select * into v_r from public.ai_reports where hakbun = v_h and name = v_n;
  if not found then
    if exists (select 1 from public.ai_reports where hakbun = v_h) then
      return jsonb_build_object('error', '이 학번으로 등록된 이름과 다릅니다. 학번과 이름을 다시 확인하세요.');
    end if;
    if not v_s.open then
      return jsonb_build_object('error', '지금은 보고서 작성 기간이 아닙니다.');
    end if;
    -- 네이버폼에 응답하지 않은 학생 : 빈 보고서로 새로 시작
    insert into public.ai_reports (hakbun, name) values (v_h, v_n)
    on conflict (hakbun, name) do nothing;
    select * into v_r from public.ai_reports where hakbun = v_h and name = v_n;
  end if;
  return public.ai_report_json(v_r, v_s.open, v_s.note);
end;
$$;

/* ---------- 학생 : 임시 저장 / 최종 제출 ---------- */
create or replace function public.student_ai_report_save(p_hakbun text, p_name text, p_cases jsonb, p_pledge text, p_submit boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_h text := public.ai_report_norm(p_hakbun);
  v_n text := public.ai_report_norm(p_name);
  v_r public.ai_reports;
  v_s public.ai_report_settings;
  v_cases jsonb;
begin
  select * into v_s from public.ai_report_settings where id = 1;
  select * into v_r from public.ai_reports where hakbun = v_h and name = v_n;
  if not found then
    return jsonb_build_object('error', '학번과 이름을 다시 확인하세요.');
  end if;
  if not v_s.open then
    return jsonb_build_object('error', '보고서 작성이 마감되었습니다. 저장되지 않았습니다.');
  end if;
  if v_r.submitted_at is not null then
    return jsonb_build_object('error', '이미 최종 제출했습니다. 고칠 것이 있으면 선생님께 말씀하세요.');
  end if;
  if jsonb_typeof(p_cases) is distinct from 'array' or jsonb_array_length(p_cases) <> 3
     or length(p_cases::text) > 30000 or length(coalesce(p_pledge, '')) > 2000 then
    return jsonb_build_object('error', '저장할 내용이 올바르지 않습니다.');
  end if;
  -- 사례마다 네 칸만 문자열로 남김
  select jsonb_agg(jsonb_build_object(
           'title',   left(coalesce(c ->> 'title', ''), 300),
           'what',    left(coalesce(c ->> 'what', ''), 4000),
           'opinion', left(coalesce(c ->> 'opinion', ''), 4000),
           'source',  left(coalesce(c ->> 'source', ''), 500)) order by o)
    into v_cases
  from jsonb_array_elements(p_cases) with ordinality as e(c, o);

  if p_submit and (
       exists (select 1 from jsonb_array_elements(v_cases) c
               where btrim(c ->> 'title') = '' or btrim(c ->> 'what') = ''
                  or btrim(c ->> 'opinion') = '' or btrim(c ->> 'source') = '')
       or btrim(coalesce(p_pledge, '')) = '') then
    return jsonb_build_object('error', '사례 3가지의 모든 칸과 나의 다짐을 채워야 최종 제출할 수 있습니다.');
  end if;

  update public.ai_reports set
    cases = v_cases,
    pledge = coalesce(p_pledge, ''),
    edited_at = now(),
    submitted_at = case when p_submit then now() else null end
  where id = v_r.id
  returning * into v_r;
  return public.ai_report_json(v_r, v_s.open, v_s.note);
end;
$$;

/* ---------- 선생님 : 네이버폼 엑셀 가져오기 ----------
   p_rows : [{hakbun, name, cases, pledge, naver}]
   - 새 학생은 추가
   - 이미 있는 학생은 학생이 아직 한 번도 저장하지 않았을 때만 덮어씀 (이어 쓴 내용 보호) */
create or replace function public.ai_report_import(p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_added int := 0;
  v_updated int := 0;
  v_kept int := 0;
  x jsonb;
  v_h text;
  v_n text;
  v_r public.ai_reports;
begin
  if not public.is_allowed_user() then
    raise exception '권한이 없습니다.';
  end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    v_h := public.ai_report_norm(x ->> 'hakbun');
    v_n := public.ai_report_norm(x ->> 'name');
    continue when v_h = '' or v_n = '';
    select * into v_r from public.ai_reports where hakbun = v_h and name = v_n;
    if not found then
      insert into public.ai_reports (hakbun, name, cases, pledge, naver, imported_at)
      values (v_h, v_n, x -> 'cases', coalesce(x ->> 'pledge', ''), x -> 'naver', now());
      v_added := v_added + 1;
    elsif v_r.edited_at is null then
      update public.ai_reports set cases = x -> 'cases', pledge = coalesce(x ->> 'pledge', ''),
        naver = x -> 'naver', imported_at = now()
      where id = v_r.id;
      v_updated := v_updated + 1;
    else
      v_kept := v_kept + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'kept', v_kept);
end;
$$;

revoke all on function public.ai_report_json(public.ai_reports, boolean, text) from public, anon, authenticated;
revoke all on function public.ai_report_import(jsonb) from public, anon;
grant execute on function public.ai_report_import(jsonb) to authenticated;
grant execute on function public.student_ai_report_load(text, text) to anon, authenticated;
grant execute on function public.student_ai_report_save(text, text, jsonb, text, boolean) to anon, authenticated;
