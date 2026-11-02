/* =========================================================
   수행평가 (학생 명단 · 평가 기준 · 점수 · 학생 조회)
   - Supabase SQL Editor에서 한 번 실행하면 됩니다.
   - 선생님(app_users에 등록된 계정)만 테이블에 접근할 수 있고,
     학생은 student_eval_view() 함수로 본인 결과만 조회합니다.
========================================================= */

/* ---------- 학생 명단 ---------- */
create table if not exists public.eval_students (
  id          bigint generated always as identity primary key,
  school      text not null,
  class_name  text not null,                 -- 예: 1-3
  number      int  not null,
  name        text not null,
  access_code text not null default lpad((floor(random() * 1000000))::int::text, 6, '0'),
  fail_count  int  not null default 0,       -- 학생 조회 확인코드 연속 실패 횟수
  locked_until timestamptz,
  created_at  timestamptz not null default now(),
  unique (school, class_name, number)
);

/* ---------- 수행 과제 (평가 기준표 1장) ---------- */
create table if not exists public.eval_tasks (
  id          bigint generated always as identity primary key,
  school      text not null,
  title       text not null,                 -- 수행 과제
  target      text,                          -- 대상 (예: 1학년)
  weight_pct  numeric,                       -- 반영 비율(%) - 선생님 화면용
  standards   text,                          -- 성취기준
  achievement_levels jsonb not null default '[]'::jsonb,  -- [{grade:'A', desc:'…'}]
  eval_types  text[] not null default '{}',  -- 평가 유형
  notes       text,                          -- 유의사항
  published   boolean not null default false,-- 학생 공개
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists eval_tasks_school_idx on public.eval_tasks (school);

/* ---------- 채점 요소 ---------- */
create table if not exists public.eval_items (
  id        bigint generated always as identity primary key,
  task_id   bigint not null references public.eval_tasks (id) on delete cascade,
  sort      int not null default 0,
  name      text not null,                   -- 예: 내용의 적절성
  max_score numeric not null default 0       -- 배점
);
create index if not exists eval_items_task_idx on public.eval_items (task_id);

/* ---------- 채점 기준 (채점 요소별 단계와 점수) ---------- */
create table if not exists public.eval_item_levels (
  id          bigint generated always as identity primary key,
  item_id     bigint not null references public.eval_items (id) on delete cascade,
  sort        int not null default 0,
  description text not null,
  score       numeric not null,
  unique (id, item_id)
);
create index if not exists eval_item_levels_item_idx on public.eval_item_levels (item_id);

/* ---------- 학생 점수 : 채점 요소마다 채점 기준 하나를 고름 ---------- */
create table if not exists public.eval_scores (
  id         bigint generated always as identity primary key,
  student_id bigint not null references public.eval_students (id) on delete cascade,
  item_id    bigint not null references public.eval_items (id) on delete cascade,
  level_id   bigint not null,
  updated_at timestamptz not null default now(),
  unique (student_id, item_id),
  -- 고른 기준이 반드시 그 채점 요소의 기준이어야 함
  foreign key (level_id, item_id) references public.eval_item_levels (id, item_id) on delete cascade
);
create index if not exists eval_scores_item_idx on public.eval_scores (item_id);
create index if not exists eval_scores_level_idx on public.eval_scores (level_id);

/* ---------- 권한 : 선생님만 ---------- */
alter table public.eval_students    enable row level security;
alter table public.eval_tasks       enable row level security;
alter table public.eval_items       enable row level security;
alter table public.eval_item_levels enable row level security;
alter table public.eval_scores      enable row level security;

drop policy if exists "allowed users full access" on public.eval_students;
drop policy if exists "allowed users full access" on public.eval_tasks;
drop policy if exists "allowed users full access" on public.eval_items;
drop policy if exists "allowed users full access" on public.eval_item_levels;
drop policy if exists "allowed users full access" on public.eval_scores;
create policy "allowed users full access" on public.eval_students    for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy "allowed users full access" on public.eval_tasks       for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy "allowed users full access" on public.eval_items       for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy "allowed users full access" on public.eval_item_levels for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
create policy "allowed users full access" on public.eval_scores      for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));

/* =========================================================
   평가 기준 저장 (과제 + 채점 요소 + 채점 기준을 한 번에)
   - p.id 가 있으면 수정, 없으면 새로 만듦
   - 화면에서 지운 채점 요소/기준은 삭제 (그 기준으로 입력된 점수도 함께 삭제)
   - 선생님 권한으로 실행 (RLS 적용)
========================================================= */
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
    insert into public.eval_tasks (school, title, target, weight_pct, standards,
                                   achievement_levels, eval_types, notes, published)
    values (trim(p ->> 'school'), trim(p ->> 'title'), nullif(trim(p ->> 'target'), ''),
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

/* =========================================================
   평가 기준 복사 (다른 학교 또는 같은 학교로)
   - 점수는 복사하지 않고, 복사본은 학생 비공개로 시작
========================================================= */
create or replace function public.copy_eval_task(p_task_id bigint, p_school text)
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
  select * into v_src from public.eval_tasks where id = p_task_id;
  if not found then raise exception '평가 기준을 찾지 못했습니다.'; end if;

  insert into public.eval_tasks (school, title, target, weight_pct, standards,
                                 achievement_levels, eval_types, notes, published)
  values (trim(p_school),
          case when v_src.school = trim(p_school) then v_src.title || ' (복사)' else v_src.title end,
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

/* =========================================================
   학생 조회용 (로그인 없이 호출)
========================================================= */
-- 학생 화면 학교 목록
create or replace function public.eval_school_list()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct school from public.eval_students order by school;
$$;

-- 학생 화면 반 목록
create or replace function public.eval_class_list(p_school text)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct class_name from public.eval_students where school = p_school order by class_name;
$$;

-- 본인 평가 결과 (공개된 과제 중 점수가 입력된 것만)
-- 확인코드가 10번 연속 틀리면 10분간 잠김
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
  select * into v_st from public.eval_students
  where school = p_school and class_name = p_class and number = p_number;
  if not found then
    return jsonb_build_object('error', '학교·반·번호 또는 확인코드가 올바르지 않습니다.');
  end if;
  if v_st.locked_until is not null and v_st.locked_until > now() then
    return jsonb_build_object('error', '확인코드를 여러 번 틀렸습니다. 10분 뒤에 다시 시도하세요.');
  end if;
  if v_st.locked_until is not null then  -- 잠금 시간이 지났으면 횟수 초기화
    update public.eval_students set fail_count = 0, locked_until = null where id = v_st.id;
    v_st.fail_count := 0;
    v_st.locked_until := null;
  end if;
  if v_st.access_code <> trim(coalesce(p_code, '')) then
    update public.eval_students set
      fail_count = fail_count + 1,
      locked_until = case when fail_count + 1 >= 10 then now() + interval '10 minutes' else null end
    where id = v_st.id;
    return jsonb_build_object('error', '학교·반·번호 또는 확인코드가 올바르지 않습니다.');
  end if;
  if v_st.fail_count <> 0 or v_st.locked_until is not null then
    update public.eval_students set fail_count = 0, locked_until = null where id = v_st.id;
  end if;

  select coalesce(jsonb_agg(t order by t_id), '[]'::jsonb) into v_tasks
  from (
    select tk.id as t_id,
      jsonb_build_object(
        'title', tk.title,
        'target', tk.target,
        'standards', tk.standards,
        'eval_types', to_jsonb(tk.eval_types),
        'notes', tk.notes,
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
      and tk.published
      and exists (select 1 from public.eval_scores s
                  join public.eval_items i on i.id = s.item_id
                  where s.student_id = v_st.id and i.task_id = tk.id)
  ) x;

  return jsonb_build_object(
    'student', jsonb_build_object('school', v_st.school, 'class_name', v_st.class_name,
                                  'number', v_st.number, 'name', v_st.name),
    'tasks', v_tasks);
end;
$$;

revoke all on function public.save_eval_task(jsonb) from public, anon;
revoke all on function public.copy_eval_task(bigint, text) from public, anon;
grant execute on function public.save_eval_task(jsonb) to authenticated;
grant execute on function public.copy_eval_task(bigint, text) to authenticated;
grant execute on function public.eval_school_list() to anon, authenticated;
grant execute on function public.eval_class_list(text) to anon, authenticated;
grant execute on function public.student_eval_view(text, text, int, text) to anon, authenticated;
