/* =========================================================
   학년도 · 설정 (evaluation.sql 다음에 실행)
   - app_settings : 학년도, D-day, 화면 테마 (선생님만)
   - 학생 명단 · 평가 기준에 학년도(school_year) 추가
     기존 자료는 모두 2026학년도로 지정
   - 학생 조회는 학교 · 반 · 번호 · 확인코드가 맞는 학년도의 결과를 보여줌
========================================================= */

/* ---------- 설정 ---------- */
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "allowed users full access" on public.app_settings;
create policy "allowed users full access" on public.app_settings for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));

insert into public.app_settings (key, value) values
  ('school_year', '2026'::jsonb),
  ('dday', '{"date": "2027-01-08", "label": "겨울방학까지"}'::jsonb),
  ('theme', '"violet"'::jsonb)
on conflict (key) do nothing;

/* ---------- 학년도 ---------- */
alter table public.eval_students add column if not exists school_year int;
alter table public.eval_tasks    add column if not exists school_year int;
update public.eval_students set school_year = 2026 where school_year is null;
update public.eval_tasks    set school_year = 2026 where school_year is null;
alter table public.eval_students alter column school_year set not null;
alter table public.eval_tasks    alter column school_year set not null;

-- 같은 학교 · 반 · 번호라도 학년도가 다르면 다른 학생
alter table public.eval_students drop constraint if exists eval_students_school_class_name_number_key;
alter table public.eval_students drop constraint if exists eval_students_year_school_class_number_key;
alter table public.eval_students add constraint eval_students_year_school_class_number_key
  unique (school_year, school, class_name, number);
create index if not exists eval_tasks_year_school_idx on public.eval_tasks (school_year, school);

/* ---------- 평가 기준 저장 : 새로 만들 때 학년도 필요 ---------- */
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
    insert into public.eval_tasks (school_year, school, title, target, weight_pct, standards,
                                   achievement_levels, eval_types, notes, published)
    values ((p ->> 'school_year')::int, trim(p ->> 'school'), trim(p ->> 'title'), nullif(trim(p ->> 'target'), ''),
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

/* ---------- 평가 기준 복사 : 다른 학교 · 다른 학년도로도 ---------- */
drop function if exists public.copy_eval_task(bigint, text);
create or replace function public.copy_eval_task(p_task_id bigint, p_school text, p_year int)
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
  select * into v_src from public.eval_tasks where id = p_task_id;
  if not found then raise exception '평가 기준을 찾지 못했습니다.'; end if;

  insert into public.eval_tasks (school_year, school, title, target, weight_pct, standards,
                                 achievement_levels, eval_types, notes, published)
  values (p_year, trim(p_school),
          case when v_src.school = trim(p_school) and v_src.school_year = p_year
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

/* ---------- 학생 조회 : 확인코드가 맞는 학년도의 결과 ----------
   같은 학교 · 반 · 번호가 여러 학년도에 있을 수 있으므로
   확인코드까지 맞는 학생을 찾고, 그 학년도의 공개 과제만 보여줌 */
create or replace function public.student_eval_view(p_school text, p_class text, p_number int, p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_st public.eval_students;
  v_tasks jsonb;
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
  -- 잠금 시간이 지났으면 횟수 초기화
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

  select coalesce(jsonb_agg(t order by t_id), '[]'::jsonb) into v_tasks
  from (
    select tk.id as t_id,
      jsonb_build_object(
        'title', tk.title,
        'target', tk.target,
        'total', (select coalesce(sum(l.score), 0)
                  from public.eval_scores s
                  join public.eval_items i on i.id = s.item_id
                  join public.eval_item_levels l on l.id = s.level_id
                  where s.student_id = v_st.id and i.task_id = tk.id),
        'max_total', (select coalesce(sum(i.max_score), 0) from public.eval_items i where i.task_id = tk.id),
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'name', i.name,
            'max_score', i.max_score,
            'my_score', (select l.score from public.eval_scores s
                         join public.eval_item_levels l on l.id = s.level_id
                         where s.student_id = v_st.id and s.item_id = i.id),
            'levels', (select coalesce(jsonb_agg(jsonb_build_object(
                          'description', l.description,
                          'score', l.score,
                          'selected', exists (select 1 from public.eval_scores s
                                              where s.student_id = v_st.id and s.level_id = l.id)
                        ) order by l.sort, l.id), '[]'::jsonb)
                       from public.eval_item_levels l where l.item_id = i.id)
          ) order by i.sort, i.id), '[]'::jsonb)
          from public.eval_items i where i.task_id = tk.id)
      ) as t
    from public.eval_tasks tk
    where tk.school = v_st.school
      and tk.school_year = v_st.school_year
      and tk.published
      and exists (select 1 from public.eval_scores s
                  join public.eval_items i on i.id = s.item_id
                  where s.student_id = v_st.id and i.task_id = tk.id)
  ) x;

  return jsonb_build_object(
    'student', jsonb_build_object('school', v_st.school, 'class_name', v_st.class_name,
                                  'number', v_st.number, 'name', v_st.name,
                                  'school_year', v_st.school_year),
    'tasks', v_tasks);
end;
$$;

revoke all on function public.copy_eval_task(bigint, text, int) from public, anon;
grant execute on function public.save_eval_task(jsonb) to authenticated;
grant execute on function public.copy_eval_task(bigint, text, int) to authenticated;
grant execute on function public.student_eval_view(text, text, int, text) to anon, authenticated;
