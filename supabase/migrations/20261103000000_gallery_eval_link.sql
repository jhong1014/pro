/* =========================================================
   바이브코딩 갤러리 평가 점수 → 수행평가 채점 요소(영역) 자동 입력
   - 선생님이 채점 요소 하나를 갤러리 학교와 연결하면
     갤러리 작품의 학교 · 학번(학년 반 번호 2자리)으로 학생을 찾아
     그 학생의 갤러리 평가 점수(30 · 22 · 14 · 6)를 채점 기준으로 바꿔 넣습니다.
   - 연결한 뒤에는 갤러리에서 점수를 주거나 바꾸거나 지우면 바로 반영됩니다.
   - 학생이 작품을 여러 개 올렸으면 가장 높은 점수를 씁니다.
   - 점수 → 채점 기준
       채점 기준에 30 · 22 · 14 · 6점이 모두 있으면 같은 점수의 기준,
       아니면 등급 순서대로(가장 높은 기준 ~ 가장 낮은 기준) 맞춰 고릅니다.
========================================================= */

create table if not exists public.eval_gallery_links (
  item_id        bigint primary key references public.eval_items (id) on delete cascade,
  gallery_school text   not null,        -- 갤러리 쪽 학교명 (예: 장성중학교)
  created_at     timestamptz not null default now()
);

alter table public.eval_gallery_links enable row level security;
drop policy if exists "allowed users full access" on public.eval_gallery_links;
create policy "allowed users full access" on public.eval_gallery_links for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));

/* ---------- 반(예: 2-1) · 번호 → 갤러리 학번(예: 2101) ---------- */
create or replace function public.eval_hakbun(p_class text, p_number int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_class ~ '^\s*[1-9]\s*-\s*[1-9]\s*$' and p_number between 0 and 99
    then regexp_replace(p_class, '\D', '', 'g') || lpad(p_number::text, 2, '0') end;
$$;

/* ---------- 갤러리 점수 → 채점 기준 id ---------- */
create or replace function public.eval_gallery_level(p_item_id bigint, p_score int)
returns bigint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_n int;
  v_exact int;
  v_rank int;
  v_id bigint;
begin
  if p_score is null then return null; end if;
  -- 점수가 같은 기준이 여럿이면 앞의 것 (점수 입력 화면과 같은 규칙)
  select count(*), count(*) filter (where score in (30, 22, 14, 6))
    into v_n, v_exact
  from (select distinct score from public.eval_item_levels where item_id = p_item_id) d;
  if v_n = 0 then return null; end if;

  if v_exact = 4 then
    select id into v_id from public.eval_item_levels
    where item_id = p_item_id and score = p_score
    order by sort, id limit 1;
    return v_id;
  end if;

  v_rank := case p_score when 30 then 0 when 22 then 1 when 14 then 2 else 3 end;
  select id into v_id from (
    select distinct on (score) id, score
    from public.eval_item_levels where item_id = p_item_id
    order by score, sort, id
  ) l
  order by score desc
  offset round(v_rank * (v_n - 1) / 3.0)::int limit 1;
  return v_id;
end;
$$;

/* ---------- 학생 한 명 · 채점 요소 하나에 갤러리 점수 넣기 ----------
   반환: 'set'(넣음) · 'cleared'(지움) · 'none'(바꾼 것 없음)
   p_clear : 갤러리 점수가 없을 때 기존 점수를 지울지 */
create or replace function public.eval_gallery_apply(p_item_id bigint, p_student_id bigint, p_clear boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.eval_gallery_links;
  v_hakbun text;
  v_best int;
  v_level bigint;
begin
  select * into v_link from public.eval_gallery_links where item_id = p_item_id;
  if not found then return 'none'; end if;

  select public.eval_hakbun(st.class_name, st.number) into v_hakbun
  from public.eval_students st
  join public.eval_items i on i.id = p_item_id
  join public.eval_tasks tk on tk.id = i.task_id
  where st.id = p_student_id and st.school = tk.school and st.school_year = tk.school_year;
  if v_hakbun is null then return 'none'; end if;

  select max(gs.score) into v_best
  from public.gallery_works w
  join public.gallery_scores gs on gs.work_id = w.id
  where w.school = v_link.gallery_school and w.hakbun = v_hakbun;

  if v_best is null then
    if p_clear then
      delete from public.eval_scores where student_id = p_student_id and item_id = p_item_id;
      if found then return 'cleared'; end if;
    end if;
    return 'none';
  end if;

  v_level := public.eval_gallery_level(p_item_id, v_best);
  if v_level is null then return 'none'; end if;

  insert into public.eval_scores (student_id, item_id, level_id, updated_at)
  values (p_student_id, p_item_id, v_level, now())
  on conflict (student_id, item_id) do update
    set level_id = excluded.level_id, updated_at = now()
    where public.eval_scores.level_id is distinct from excluded.level_id;
  return 'set';
end;
$$;

/* ---------- 갤러리 학교 · 학번 하나가 바뀌었을 때 연결된 모든 채점 요소에 반영 ---------- */
create or replace function public.eval_gallery_refresh(p_gallery_school text, p_hakbun text, p_clear boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  if p_gallery_school is null or p_hakbun is null then return; end if;
  for r in
    select l.item_id, st.id as student_id
    from public.eval_gallery_links l
    join public.eval_items i on i.id = l.item_id
    join public.eval_tasks tk on tk.id = i.task_id
    join public.eval_students st on st.school = tk.school and st.school_year = tk.school_year
    where l.gallery_school = p_gallery_school
      and public.eval_hakbun(st.class_name, st.number) = p_hakbun
  loop
    perform public.eval_gallery_apply(r.item_id, r.student_id, p_clear);
  end loop;
end;
$$;

/* ---------- 채점 요소 전체 다시 가져오기 (갤러리 점수가 없는 학생의 점수는 그대로 둠) ---------- */
create or replace function public.eval_gallery_sync_item(p_item_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.eval_gallery_links;
  v_task public.eval_tasks;
  v_applied int := 0;
  v_unmatched jsonb;
  r record;
begin
  if not public.is_allowed_user() then raise exception '권한이 없습니다.'; end if;
  select * into v_link from public.eval_gallery_links where item_id = p_item_id;
  if not found then raise exception '갤러리와 연결되지 않은 채점 요소입니다.'; end if;
  select tk.* into v_task from public.eval_tasks tk join public.eval_items i on i.task_id = tk.id
  where i.id = p_item_id;

  for r in
    select st.id from public.eval_students st
    where st.school = v_task.school and st.school_year = v_task.school_year
  loop
    if public.eval_gallery_apply(p_item_id, r.id, false) = 'set' then v_applied := v_applied + 1; end if;
  end loop;

  -- 점수가 있는데 학생 명단에서 찾지 못한 작품
  select coalesce(jsonb_agg(jsonb_build_object('hakbun', w.hakbun, 'name', w.name, 'title', w.title, 'score', gs.score)
                            order by w.hakbun nulls first, w.id), '[]'::jsonb)
    into v_unmatched
  from public.gallery_works w
  join public.gallery_scores gs on gs.work_id = w.id
  where w.school = v_link.gallery_school
    and not exists (select 1 from public.eval_students st
                    where st.school = v_task.school and st.school_year = v_task.school_year
                      and public.eval_hakbun(st.class_name, st.number) = w.hakbun);

  return jsonb_build_object('applied', v_applied, 'unmatched', v_unmatched);
end;
$$;

/* ---------- 연결 · 해제 (선생님) : p_gallery_school 이 비어 있으면 해제 ----------
   해제해도 이미 들어간 점수는 지우지 않습니다. */
create or replace function public.eval_gallery_set_link(p_item_id bigint, p_gallery_school text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed_user() then raise exception '권한이 없습니다.'; end if;
  if not exists (select 1 from public.eval_items where id = p_item_id) then
    raise exception '채점 요소를 찾지 못했습니다.';
  end if;
  if coalesce(trim(p_gallery_school), '') = '' then
    delete from public.eval_gallery_links where item_id = p_item_id;
    return jsonb_build_object('linked', false);
  end if;
  insert into public.eval_gallery_links (item_id, gallery_school)
  values (p_item_id, trim(p_gallery_school))
  on conflict (item_id) do update set gallery_school = excluded.gallery_school;
  return public.eval_gallery_sync_item(p_item_id) || jsonb_build_object('linked', true);
end;
$$;

/* ---------- 갤러리 학교 목록 (선생님 화면 선택용) ---------- */
create or replace function public.eval_gallery_school_list()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select s from (
    select (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g'))[1] as s
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.gallery_works'::regclass and c.conname = 'gallery_works_school_check'
    union
    select school from public.gallery_works where school is not null
  ) x
  where public.is_allowed_user()
  order by s;
$$;

/* =========================================================
   자동 반영 트리거
========================================================= */
-- 갤러리 점수 입력 · 수정 · 삭제
create or replace function public.eval_gallery_scores_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare w record;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select school, hakbun into w from public.gallery_works where id = old.work_id;
    if found then perform public.eval_gallery_refresh(w.school, w.hakbun, true); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select school, hakbun into w from public.gallery_works where id = new.work_id;
    if found then perform public.eval_gallery_refresh(w.school, w.hakbun, true); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists eval_gallery_scores_sync on public.gallery_scores;
create trigger eval_gallery_scores_sync
after insert or update or delete on public.gallery_scores
for each row execute function public.eval_gallery_scores_trg();

-- 작품의 학교 · 학번이 바뀌거나 작품이 지워짐
create or replace function public.eval_gallery_works_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.eval_gallery_refresh(old.school, old.hakbun, true);
  if tg_op = 'UPDATE' then
    perform public.eval_gallery_refresh(new.school, new.hakbun, true);
  end if;
  return null;
end;
$$;

drop trigger if exists eval_gallery_works_sync on public.gallery_works;
create trigger eval_gallery_works_sync
after update of school, hakbun or delete on public.gallery_works
for each row execute function public.eval_gallery_works_trg();

-- 학생을 새로 등록하거나 반 · 번호를 고치면 그 학생 점수도 가져옴
create or replace function public.eval_gallery_students_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in
    select l.item_id from public.eval_gallery_links l
    join public.eval_items i on i.id = l.item_id
    join public.eval_tasks tk on tk.id = i.task_id
    where tk.school = new.school and tk.school_year = new.school_year
  loop
    perform public.eval_gallery_apply(r.item_id, new.id, false);
  end loop;
  return null;
end;
$$;

drop trigger if exists eval_gallery_students_sync on public.eval_students;
create trigger eval_gallery_students_sync
after insert or update of class_name, number, school, school_year on public.eval_students
for each row execute function public.eval_gallery_students_trg();

/* ---------- 권한 ---------- */
revoke all on function public.eval_gallery_apply(bigint, bigint, boolean) from public, anon, authenticated;
revoke all on function public.eval_gallery_refresh(text, text, boolean) from public, anon, authenticated;
revoke all on function public.eval_gallery_scores_trg() from public, anon, authenticated;
revoke all on function public.eval_gallery_works_trg() from public, anon, authenticated;
revoke all on function public.eval_gallery_students_trg() from public, anon, authenticated;
revoke all on function public.eval_gallery_sync_item(bigint) from public, anon;
revoke all on function public.eval_gallery_set_link(bigint, text) from public, anon;
revoke all on function public.eval_gallery_school_list() from public, anon;
grant execute on function public.eval_gallery_sync_item(bigint) to authenticated;
grant execute on function public.eval_gallery_set_link(bigint, text) to authenticated;
grant execute on function public.eval_gallery_school_list() to authenticated;
