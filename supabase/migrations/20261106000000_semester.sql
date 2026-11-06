/* =========================================================
   학기 (school_year_settings · signatures 다음에 실행)
   - app_settings.semester : 지금 보고 있는 학기 (1 또는 2)
   - 진도(records)        : 학년도 · 학기 열 추가
   - 수행평가(eval_tasks) : 학기 열 추가 (학생 명단은 학년도 단위 그대로, 두 학기 공통)
   - 성적 확인 서명       : 학생 1명 · 학기마다 1건
   - 학기 구분 : 1학기 = 3월 1일 ~ 8월 15일, 2학기 = 8월 16일 ~ 다음 해 2월 말일
     (기존 자료는 날짜 · 만든 날짜로 학기를 정함)
========================================================= */

/* ---------- 설정 : 현재 학기 ---------- */
insert into public.app_settings (key, value)
values ('semester', to_jsonb(case when extract(month from (now() at time zone 'Asia/Seoul')) between 3 and 7
                                    or (extract(month from (now() at time zone 'Asia/Seoul')) = 8
                                        and extract(day from (now() at time zone 'Asia/Seoul')) <= 15)
                                  then 1 else 2 end))
on conflict (key) do nothing;

/* ---------- 날짜 → 학년도 · 학기 ---------- */
create or replace function public.school_year_of(d date)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when extract(month from d) >= 3 then extract(year from d)::int
              else extract(year from d)::int - 1 end;
$$;

create or replace function public.semester_of(d date)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case when extract(month from d) between 3 and 7
                or (extract(month from d) = 8 and extract(day from d) <= 15)
              then 1 else 2 end::smallint;
$$;

/* ---------- 진도 : 학년도 · 학기 ---------- */
alter table public.records add column if not exists school_year int;
alter table public.records add column if not exists semester smallint;
update public.records set school_year = public.school_year_of(date) where school_year is null;
update public.records set semester = public.semester_of(date) where semester is null;

-- 학년도 · 학기를 보내지 않고 저장하면(다른 앱 등) 날짜로 채움
create or replace function public.records_fill_term_trg()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.school_year is null then new.school_year := public.school_year_of(new.date); end if;
  if new.semester is null then new.semester := public.semester_of(new.date); end if;
  return new;
end;
$$;
drop trigger if exists records_fill_term on public.records;
create trigger records_fill_term before insert or update on public.records
for each row execute function public.records_fill_term_trg();

alter table public.records alter column school_year set not null;
alter table public.records alter column semester set not null;
alter table public.records drop constraint if exists records_semester_check;
alter table public.records add constraint records_semester_check check (semester in (1, 2));
create index if not exists records_term_date_idx on public.records (school_year, semester, date);

/* ---------- 수행평가 : 학기 ---------- */
alter table public.eval_tasks add column if not exists semester smallint;
update public.eval_tasks set semester = public.semester_of((created_at at time zone 'Asia/Seoul')::date)
where semester is null;
alter table public.eval_tasks alter column semester set not null;
alter table public.eval_tasks drop constraint if exists eval_tasks_semester_check;
alter table public.eval_tasks add constraint eval_tasks_semester_check check (semester in (1, 2));
drop index if exists public.eval_tasks_year_school_idx;
create index if not exists eval_tasks_term_school_idx on public.eval_tasks (school_year, semester, school);

/* ---------- 성적 확인 서명 : 학기마다 ---------- */
alter table public.eval_signatures add column if not exists semester smallint;
update public.eval_signatures sg set semester = coalesce(
  (select max(tk.semester) from public.eval_students st
   join public.eval_tasks tk on tk.school = st.school and tk.school_year = st.school_year
   where st.id = sg.student_id), 2)
where semester is null;
alter table public.eval_signatures alter column semester set not null;
alter table public.eval_signatures drop constraint if exists eval_signatures_semester_check;
alter table public.eval_signatures add constraint eval_signatures_semester_check check (semester in (1, 2));
alter table public.eval_signatures drop constraint if exists eval_signatures_student_id_key;
alter table public.eval_signatures drop constraint if exists eval_signatures_student_semester_key;
alter table public.eval_signatures add constraint eval_signatures_student_semester_key unique (student_id, semester);

/* ---------- 평가 기준 저장 : 새로 만들 때 학년도 · 학기 필요 ---------- */
create or replace function public.save_eval_task(p jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task_id bigint := nullif(p ->> 'id', '')::bigint;
  v_item    jsonb;
  v_level   jsonb;
  v_item_id bigint;
  v_level_id bigint;
  v_item_ids bigint[] := '{}';
  v_level_ids bigint[];
  i int := 0;
  j int;
begin
  if not public.is_allowed_user() then
    raise exception '권한이 없습니다.';
  end if;
  if coalesce(trim(p ->> 'school'), '') = '' then raise exception '학교를 선택하세요.'; end if;
  if coalesce(trim(p ->> 'title'), '') = '' then raise exception '수행 과제명을 입력하세요.'; end if;

  if v_task_id is null then
    if nullif(p ->> 'school_year', '') is null then raise exception '학년도를 선택하세요.'; end if;
    if coalesce(p ->> 'semester', '') not in ('1', '2') then raise exception '학기를 선택하세요.'; end if;
    insert into public.eval_tasks (school_year, semester, school, title, target, weight_pct, standards,
                                   achievement_levels, eval_types, notes, published)
    values ((p ->> 'school_year')::int, (p ->> 'semester')::smallint, trim(p ->> 'school'), trim(p ->> 'title'),
            nullif(trim(p ->> 'target'), ''),
            nullif(p ->> 'weight_pct', '')::numeric, p ->> 'standards',
            coalesce(p -> 'achievement_levels', '[]'::jsonb),
            coalesce(array(select jsonb_array_elements_text(p -> 'eval_types')), '{}'),
            p ->> 'notes', coalesce((p ->> 'published')::boolean, false))
    returning id into v_task_id;
  else
    update public.eval_tasks set
      school = trim(p ->> 'school'),
      title = trim(p ->> 'title'),
      target = nullif(trim(p ->> 'target'), ''),
      weight_pct = nullif(p ->> 'weight_pct', '')::numeric,
      standards = p ->> 'standards',
      achievement_levels = coalesce(p -> 'achievement_levels', '[]'::jsonb),
      eval_types = coalesce(array(select jsonb_array_elements_text(p -> 'eval_types')), '{}'),
      notes = p ->> 'notes',
      published = coalesce((p ->> 'published')::boolean, false),
      updated_at = now()
    where id = v_task_id;
    if not found then raise exception '평가 기준을 찾지 못했습니다.'; end if;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    i := i + 1;
    if coalesce(trim(v_item ->> 'name'), '') = '' then
      raise exception '%번째 채점 요소의 이름을 입력하세요.', i;
    end if;
    v_item_id := nullif(v_item ->> 'id', '')::bigint;
    if v_item_id is not null then
      update public.eval_items set sort = i, name = trim(v_item ->> 'name'),
             max_score = coalesce(nullif(v_item ->> 'max_score', '')::numeric, 0)
      where id = v_item_id and task_id = v_task_id;
      if not found then v_item_id := null; end if;
    end if;
    if v_item_id is null then
      insert into public.eval_items (task_id, sort, name, max_score)
      values (v_task_id, i, trim(v_item ->> 'name'),
              coalesce(nullif(v_item ->> 'max_score', '')::numeric, 0))
      returning id into v_item_id;
    end if;
    v_item_ids := v_item_ids || v_item_id;

    v_level_ids := '{}';
    j := 0;
    for v_level in select * from jsonb_array_elements(coalesce(v_item -> 'levels', '[]'::jsonb)) loop
      j := j + 1;
      if coalesce(v_level ->> 'score', '') = '' then
        raise exception '"%"의 %번째 채점 기준에 점수를 입력하세요.', trim(v_item ->> 'name'), j;
      end if;
      v_level_id := nullif(v_level ->> 'id', '')::bigint;
      if v_level_id is not null then
        update public.eval_item_levels set sort = j,
               description = coalesce(trim(v_level ->> 'description'), ''),
               score = (v_level ->> 'score')::numeric
        where id = v_level_id and item_id = v_item_id;
        if not found then v_level_id := null; end if;
      end if;
      if v_level_id is null then
        insert into public.eval_item_levels (item_id, sort, description, score)
        values (v_item_id, j, coalesce(trim(v_level ->> 'description'), ''),
                (v_level ->> 'score')::numeric)
        returning id into v_level_id;
      end if;
      v_level_ids := v_level_ids || v_level_id;
    end loop;
    delete from public.eval_item_levels where item_id = v_item_id and id <> all (v_level_ids);
  end loop;

  delete from public.eval_items where task_id = v_task_id and id <> all (v_item_ids);
  return v_task_id;
end;
$$;

/* ---------- 평가 기준 복사 : 다른 학교 · 학년도 · 학기로도 ---------- */
drop function if exists public.copy_eval_task(bigint, text, int);
create or replace function public.copy_eval_task(p_task_id bigint, p_school text, p_year int, p_semester int)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src public.eval_tasks;
  v_new_task bigint;
  v_item public.eval_items;
  v_new_item bigint;
begin
  if not public.is_allowed_user() then
    raise exception '권한이 없습니다.';
  end if;
  if coalesce(trim(p_school), '') = '' then raise exception '복사할 학교를 선택하세요.'; end if;
  if p_year is null then raise exception '복사할 학년도를 선택하세요.'; end if;
  if p_semester is null or p_semester not in (1, 2) then raise exception '복사할 학기를 선택하세요.'; end if;
  select * into v_src from public.eval_tasks where id = p_task_id;
  if not found then raise exception '평가 기준을 찾지 못했습니다.'; end if;

  insert into public.eval_tasks (school_year, semester, school, title, target, weight_pct, standards,
                                 achievement_levels, eval_types, notes, published)
  values (p_year, p_semester, trim(p_school),
          case when v_src.school = trim(p_school) and v_src.school_year = p_year and v_src.semester = p_semester
               then v_src.title || ' (복사)' else v_src.title end,
          v_src.target, v_src.weight_pct, v_src.standards,
          v_src.achievement_levels, v_src.eval_types, v_src.notes, false)
  returning id into v_new_task;

  for v_item in select * from public.eval_items where task_id = p_task_id order by sort, id loop
    insert into public.eval_items (task_id, sort, name, max_score)
    values (v_new_task, v_item.sort, v_item.name, v_item.max_score)
    returning id into v_new_item;
    insert into public.eval_item_levels (item_id, sort, description, score)
    select v_new_item, l.sort, l.description, l.score
    from public.eval_item_levels l where l.item_id = v_item.id order by l.sort, l.id;
  end loop;
  return v_new_task;
end;
$$;

/* ---------- 학생 1명 · 1학기의 공개 과제 결과 (내부용) ---------- */
drop function if exists public.eval_student_tasks(bigint);
create or replace function public.eval_student_tasks(p_student_id bigint, p_semester int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(t order by t_id), '[]'::jsonb)
  from (
    select tk.id as t_id,
      jsonb_build_object(
        'id', tk.id,
        'title', tk.title,
        'target', tk.target,
        'total', (select coalesce(sum(l.score), 0)
                  from public.eval_scores s
                  join public.eval_items i on i.id = s.item_id
                  join public.eval_item_levels l on l.id = s.level_id
                  where s.student_id = st.id and i.task_id = tk.id),
        'max_total', (select coalesce(sum(i.max_score), 0) from public.eval_items i where i.task_id = tk.id),
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'name', i.name,
            'max_score', i.max_score,
            'my_score', (select l.score from public.eval_scores s
                         join public.eval_item_levels l on l.id = s.level_id
                         where s.student_id = st.id and s.item_id = i.id),
            'levels', (select coalesce(jsonb_agg(jsonb_build_object(
                          'description', l.description,
                          'score', l.score,
                          'selected', exists (select 1 from public.eval_scores s
                                              where s.student_id = st.id and s.level_id = l.id)
                        ) order by l.sort, l.id), '[]'::jsonb)
                       from public.eval_item_levels l where l.item_id = i.id)
          ) order by i.sort, i.id), '[]'::jsonb)
          from public.eval_items i where i.task_id = tk.id)
      ) as t
    from public.eval_students st
    join public.eval_tasks tk on tk.school = st.school and tk.school_year = st.school_year
    where st.id = p_student_id
      and tk.semester = p_semester
      and tk.published
      and exists (select 1 from public.eval_scores s
                  join public.eval_items i on i.id = s.item_id
                  where s.student_id = st.id and i.task_id = tk.id)
  ) x;
$$;

/* 학생에게 보여줄 결과가 있는 학기 목록 (내부용) */
create or replace function public.eval_student_semesters(p_student_id bigint)
returns int[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct tk.semester::int order by tk.semester::int), '{}')
  from public.eval_students st
  join public.eval_tasks tk on tk.school = st.school and tk.school_year = st.school_year
  where st.id = p_student_id
    and tk.published
    and exists (select 1 from public.eval_scores s
                join public.eval_items i on i.id = s.item_id
                where s.student_id = st.id and i.task_id = tk.id);
$$;

/* ---------- 학생 조회 : 학기별 결과 + 서명 상태 ----------
   p_semester 를 비우면 결과가 있는 가장 최근 학기 */
drop function if exists public.student_eval_view(text, text, int, text);
create or replace function public.student_eval_view(p_school text, p_class text, p_number int, p_code text,
                                                    p_semester int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_st public.eval_students;
  v_tasks jsonb;
  v_sig public.eval_signatures;
  v_sems int[];
  v_sem int;
begin
  if not exists (select 1 from public.eval_students
                 where school = p_school and class_name = p_class and number = p_number) then
    return jsonb_build_object('error', '학교·반·번호 또는 확인코드가 올바르지 않습니다.');
  end if;
  if exists (select 1 from public.eval_students
             where school = p_school and class_name = p_class and number = p_number
               and locked_until > now()) then
    return jsonb_build_object('error', '확인코드를 여러 번 틀렸습니다. 10분 뒤에 다시 시도하세요.');
  end if;
  update public.eval_students set fail_count = 0, locked_until = null
  where school = p_school and class_name = p_class and number = p_number
    and locked_until is not null and locked_until <= now();

  select * into v_st from public.eval_students
  where school = p_school and class_name = p_class and number = p_number
    and access_code = trim(coalesce(p_code, ''))
  order by school_year desc
  limit 1;
  if not found then
    update public.eval_students set
      fail_count = fail_count + 1,
      locked_until = case when fail_count + 1 >= 10 then now() + interval '10 minutes' else null end
    where school = p_school and class_name = p_class and number = p_number;
    return jsonb_build_object('error', '학교·반·번호 또는 확인코드가 올바르지 않습니다.');
  end if;
  update public.eval_students set fail_count = 0
  where school = p_school and class_name = p_class and number = p_number and fail_count <> 0;

  v_sems := public.eval_student_semesters(v_st.id);
  v_sem := case when p_semester in (1, 2) then p_semester
                else coalesce(v_sems[array_length(v_sems, 1)], 1) end;
  v_tasks := public.eval_student_tasks(v_st.id, v_sem);
  select * into v_sig from public.eval_signatures where student_id = v_st.id and semester = v_sem;

  return jsonb_build_object(
    'student', jsonb_build_object('school', v_st.school, 'class_name', v_st.class_name,
                                  'number', v_st.number, 'name', v_st.name,
                                  'school_year', v_st.school_year),
    'semester', v_sem,
    'semesters', to_jsonb(v_sems),
    'tasks', v_tasks,
    'signature', case when v_sig.id is null then null else jsonb_build_object(
      'signed_at', v_sig.signed_at,
      'signature', v_sig.signature,
      'matches', v_sig.snapshot = public.eval_snapshot(v_tasks)) end);
end;
$$;

/* ---------- 학생 서명 : 확인코드를 다시 확인한 뒤 그 학기 서명 저장 ---------- */
drop function if exists public.student_eval_sign(text, text, int, text, text);
create or replace function public.student_eval_sign(p_school text, p_class text, p_number int, p_code text,
                                                    p_signature text, p_semester int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_id bigint;
  v_sem int;
begin
  v := public.student_eval_view(p_school, p_class, p_number, p_code, p_semester);
  if v ? 'error' then return v; end if;
  if jsonb_array_length(v -> 'tasks') = 0 then
    return jsonb_build_object('error', '확인할 성적이 없습니다.');
  end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(p_signature) > 300000 then
    return jsonb_build_object('error', '서명을 다시 해 주세요.');
  end if;
  v_sem := (v ->> 'semester')::int;

  select id into v_id from public.eval_students
  where school = p_school and class_name = p_class and number = p_number
    and access_code = trim(coalesce(p_code, ''))
  order by school_year desc
  limit 1;

  insert into public.eval_signatures (student_id, semester, snapshot, signature, signed_at)
  values (v_id, v_sem, public.eval_snapshot(v -> 'tasks'), p_signature, now())
  on conflict (student_id, semester) do update
    set snapshot = excluded.snapshot, signature = excluded.signature, signed_at = excluded.signed_at;

  return public.student_eval_view(p_school, p_class, p_number, p_code, v_sem);
end;
$$;

/* ---------- 선생님 : 학교 · 학년도 · 학기 서명 자료 ---------- */
drop function if exists public.eval_signature_list(int, text);
create or replace function public.eval_signature_list(p_year int, p_school text, p_semester int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed_user() then
    raise exception '권한이 없습니다.';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'student_id', st.id,
      'class_name', st.class_name,
      'number', st.number,
      'name', st.name,
      'current', c.cur,
      'signed_at', sg.signed_at,
      'signature', sg.signature,
      'snapshot', sg.snapshot,
      'matches', sg.snapshot = c.cur
    ) order by st.class_name, st.number), '[]'::jsonb)
    from public.eval_students st
    cross join lateral (select public.eval_snapshot(public.eval_student_tasks(st.id, p_semester)) as cur) c
    left join public.eval_signatures sg on sg.student_id = st.id and sg.semester = p_semester
    where st.school_year = p_year and st.school = p_school
  );
end;
$$;

revoke all on function public.records_fill_term_trg() from public, anon, authenticated;
revoke all on function public.eval_student_tasks(bigint, int) from public, anon, authenticated;
revoke all on function public.eval_student_semesters(bigint) from public, anon, authenticated;
revoke all on function public.copy_eval_task(bigint, text, int, int) from public, anon;
revoke all on function public.eval_signature_list(int, text, int) from public, anon;
grant execute on function public.save_eval_task(jsonb) to authenticated;
grant execute on function public.copy_eval_task(bigint, text, int, int) to authenticated;
grant execute on function public.eval_signature_list(int, text, int) to authenticated;
grant execute on function public.student_eval_view(text, text, int, text, int) to anon, authenticated;
grant execute on function public.student_eval_sign(text, text, int, text, text, int) to anon, authenticated;
