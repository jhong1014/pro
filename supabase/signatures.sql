/* =========================================================
   성적 확인 서명 (school_year_settings.sql 다음에 실행)
   - 학생 : 공개된 성적을 확인하고 "이상 없음" 체크 + 손글씨 서명
            (학생 1명 · 학년도마다 1건, 다시 서명하면 새 서명으로 바뀜)
   - 서명할 때의 성적을 snapshot으로 함께 저장
     → 서명 뒤 점수가 바뀌면 "재확인 필요"로 표시
   - 선생님 : eval_signature_list() 로 반 · 학교 단위 서명 자료 조회
========================================================= */

create table if not exists public.eval_signatures (
  id         bigint generated always as identity primary key,
  student_id bigint not null unique references public.eval_students (id) on delete cascade,
  snapshot   jsonb not null,                -- 서명할 때 본 과제별 · 채점 요소별 점수
  signature  text not null,                 -- 서명 그림 (data:image/png;base64,...)
  signed_at  timestamptz not null default now()
);
alter table public.eval_signatures enable row level security;
drop policy if exists "allowed users full access" on public.eval_signatures;
create policy "allowed users full access" on public.eval_signatures for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));

/* ---------- 학생 1명의 공개 과제 결과 (내부용) ---------- */
create or replace function public.eval_student_tasks(p_student_id bigint)
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
      and tk.published
      and exists (select 1 from public.eval_scores s
                  join public.eval_items i on i.id = s.item_id
                  where s.student_id = st.id and i.task_id = tk.id)
  ) x;
$$;

/* ---------- 서명 비교용 요약 : 과제 · 채점 요소별 점수만 ---------- */
create or replace function public.eval_snapshot(p_tasks jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t -> 'id',
    'title', t -> 'title',
    'total', t -> 'total',
    'max_total', t -> 'max_total',
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'name', i -> 'name', 'max_score', i -> 'max_score', 'score', i -> 'my_score') order by io), '[]'::jsonb)
              from jsonb_array_elements(t -> 'items') with ordinality as e(i, io))
  ) order by o), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) with ordinality as a(t, o);
$$;

/* ---------- 학생 조회 : 결과 + 서명 상태 ---------- */
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
  v_sig public.eval_signatures;
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

  v_tasks := public.eval_student_tasks(v_st.id);
  select * into v_sig from public.eval_signatures where student_id = v_st.id;

  return jsonb_build_object(
    'student', jsonb_build_object('school', v_st.school, 'class_name', v_st.class_name,
                                  'number', v_st.number, 'name', v_st.name,
                                  'school_year', v_st.school_year),
    'tasks', v_tasks,
    'signature', case when v_sig.id is null then null else jsonb_build_object(
      'signed_at', v_sig.signed_at,
      'signature', v_sig.signature,
      'matches', v_sig.snapshot = public.eval_snapshot(v_tasks)) end);
end;
$$;

/* ---------- 학생 서명 : 확인코드를 다시 확인한 뒤 저장 ---------- */
create or replace function public.student_eval_sign(p_school text, p_class text, p_number int, p_code text, p_signature text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_id bigint;
begin
  v := public.student_eval_view(p_school, p_class, p_number, p_code);
  if v ? 'error' then return v; end if;
  if jsonb_array_length(v -> 'tasks') = 0 then
    return jsonb_build_object('error', '확인할 성적이 없습니다.');
  end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(p_signature) > 300000 then
    return jsonb_build_object('error', '서명을 다시 해 주세요.');
  end if;

  select id into v_id from public.eval_students
  where school = p_school and class_name = p_class and number = p_number
    and access_code = trim(coalesce(p_code, ''))
  order by school_year desc
  limit 1;

  insert into public.eval_signatures (student_id, snapshot, signature, signed_at)
  values (v_id, public.eval_snapshot(v -> 'tasks'), p_signature, now())
  on conflict (student_id) do update
    set snapshot = excluded.snapshot, signature = excluded.signature, signed_at = excluded.signed_at;

  return public.student_eval_view(p_school, p_class, p_number, p_code);
end;
$$;

/* ---------- 선생님 : 학교(학년도) 전체 서명 자료 ---------- */
create or replace function public.eval_signature_list(p_year int, p_school text)
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
    cross join lateral (select public.eval_snapshot(public.eval_student_tasks(st.id)) as cur) c
    left join public.eval_signatures sg on sg.student_id = st.id
    where st.school_year = p_year and st.school = p_school
  );
end;
$$;

-- eval_student_tasks 는 학생 id만으로 결과를 돌려주므로 외부에서 직접 부르지 못하게 막음
revoke all on function public.eval_student_tasks(bigint) from public, anon, authenticated;
revoke all on function public.eval_snapshot(jsonb) from public, anon;
revoke all on function public.eval_signature_list(int, text) from public, anon;
grant execute on function public.eval_snapshot(jsonb) to authenticated;
grant execute on function public.eval_signature_list(int, text) to authenticated;
grant execute on function public.student_eval_view(text, text, int, text) to anon, authenticated;
grant execute on function public.student_eval_sign(text, text, int, text, text) to anon, authenticated;
