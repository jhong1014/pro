/* =========================================================
   바이브코딩 갤러리 : 영역별 점수 · 대화기록 링크
   1) 대화기록 링크 (gallery_chat_links)
      - 학생이 작품을 올릴 때 AI와 나눈 대화기록 공유 링크를 함께 받습니다.
      - 선생님 모드와 작품 주인(수정 비밀번호)만 볼 수 있습니다.
   2) 영역별 점수 (gallery_item_scores)
      - 수행평가관리에서 갤러리 학교와 연결한 채점 요소(영역)마다
        갤러리 선생님 모드에서 그 영역의 채점 기준 점수를 바로 고릅니다.
      - 고른 점수는 학번이 같은 학생의 수행평가 점수로 자동 입력됩니다.
      - 예전 한 칸짜리 점수(30·22·14·6, gallery_scores)는 더 이상 반영하지 않습니다.
========================================================= */

/* ---------- 1) 대화기록 링크 ---------- */
create table if not exists public.gallery_chat_links (
  work_id    bigint primary key references public.gallery_works (id) on delete cascade,
  url        text not null check (url ~* '^https?://\S+$' and char_length(url) <= 1000),
  updated_at timestamptz not null default now()
);
alter table public.gallery_chat_links enable row level security;
revoke all on public.gallery_chat_links from anon, authenticated;

create or replace function public.gallery_clean_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare v text := nullif(trim(coalesce(p_url, '')), '');
begin
  if v is null then return null; end if;
  if v !~* '^https?://\S+$' or char_length(v) > 1000 then
    raise exception '대화기록 링크는 https:// 로 시작하는 주소여야 해요';
  end if;
  return v;
end;
$$;

-- 올리기 : 대화기록 링크(p_chat_url) 추가. 예전 화면(링크 없이 호출)도 그대로 동작
drop function if exists public.gallery_upload(text, text, text, text, text, text, text);
create or replace function public.gallery_upload(p_title text, p_school text, p_hakbun text, p_name text,
                                                 p_desc text, p_html text, p_pw text, p_chat_url text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r gallery_works; v_url text := gallery_clean_url(p_chat_url);
begin
  if char_length(coalesce(p_pw,'')) < 4 then raise exception '비밀번호는 4자 이상'; end if;
  insert into gallery_works (title, school, hakbun, name, author, description, html)
  values (trim(p_title), p_school, p_hakbun, trim(p_name), trim(p_name), nullif(trim(p_desc),''), p_html)
  returning * into r;
  insert into gallery_owner_pw (work_id, pw_hash) values (r.id, crypt(p_pw, gen_salt('bf')));
  if v_url is not null then
    insert into gallery_chat_links (work_id, url) values (r.id, v_url);
  end if;
  return jsonb_build_object('id', r.id, 'title', r.title, 'school', r.school, 'hakbun', r.hakbun, 'name', r.name,
    'author', r.author, 'description', r.description, 'likes', r.likes, 'created_at', r.created_at, 'updated_at', r.updated_at);
end $$;

-- 고치기 : p_chat_url 이 null 이면 그대로, '' 이면 지움
drop function if exists public.gallery_update(bigint, text, text, text, text, text, text, text);
create or replace function public.gallery_update(p_id bigint, p_pw text, p_title text, p_name text, p_desc text,
                                                 p_html text, p_school text, p_hakbun text, p_chat_url text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r gallery_works; adm boolean; v_url text;
begin
  if not gallery_check_owner(p_id, p_pw) then return null; end if;
  adm := gallery_is_admin(p_pw);
  v_url := gallery_clean_url(p_chat_url);
  update gallery_works set
    title = trim(p_title), name = trim(p_name), author = trim(p_name),
    description = nullif(trim(p_desc),''), html = coalesce(nullif(p_html,''), html),
    school = case when adm then nullif(p_school,'') else school end,
    hakbun = case when adm then nullif(p_hakbun,'') else hakbun end,
    updated_at = now()
  where id = p_id returning * into r;
  if p_chat_url is not null then
    if v_url is null then
      delete from gallery_chat_links where work_id = p_id;
    else
      insert into gallery_chat_links (work_id, url) values (p_id, v_url)
      on conflict (work_id) do update set url = excluded.url, updated_at = now();
    end if;
  end if;
  return jsonb_build_object('id', r.id, 'title', r.title, 'school', r.school, 'hakbun', r.hakbun, 'name', r.name,
    'author', r.author, 'description', r.description, 'likes', r.likes, 'created_at', r.created_at, 'updated_at', r.updated_at);
end $$;

-- 작품 주인 · 선생님 : 한 작품의 대화기록 링크
create or replace function public.gallery_get_chat(p_id bigint, p_pw text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not gallery_check_owner(p_id, p_pw) then return null; end if;
  return (select url from gallery_chat_links where work_id = p_id);
end $$;

-- 선생님 : 모든 대화기록 링크
create or replace function public.gallery_get_chats(p_pw text)
returns table (work_id bigint, url text)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not gallery_is_admin(p_pw) then return; end if;
  return query select c.work_id, c.url from gallery_chat_links c;
end $$;

/* ---------- 2) 영역별 점수 ---------- */
create table if not exists public.gallery_item_scores (
  work_id    bigint  not null references public.gallery_works (id) on delete cascade,
  item_id    bigint  not null references public.eval_items (id) on delete cascade,
  score      numeric not null,
  updated_at timestamptz not null default now(),
  primary key (work_id, item_id)
);
create index if not exists gallery_item_scores_item_idx on public.gallery_item_scores (item_id);
alter table public.gallery_item_scores enable row level security;
revoke all on public.gallery_item_scores from anon, authenticated;

-- 선생님 : 갤러리 학교마다 연결된 영역 (가장 최근 학년도 · 학기의 수행 과제만)
create or replace function public.gallery_get_areas(p_pw text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not gallery_is_admin(p_pw) then return null; end if;
  return coalesce((
    select jsonb_object_agg(gallery_school, items)
    from (
      select x.gallery_school,
             jsonb_agg(jsonb_build_object(
               'id', x.item_id, 'name', x.name, 'max_score', x.max_score, 'task', x.title,
               'scores', (select coalesce(jsonb_agg(s order by s desc), '[]'::jsonb)
                          from (select distinct l.score as s from eval_item_levels l where l.item_id = x.item_id) d)
             ) order by x.task_id, x.sort, x.item_id) as items
      from (
        select l.gallery_school, l.item_id, i.name, i.max_score, i.sort, tk.id as task_id, tk.title,
               rank() over (partition by l.gallery_school order by tk.school_year desc, tk.semester desc) as rk
        from eval_gallery_links l
        join eval_items i on i.id = l.item_id
        join eval_tasks tk on tk.id = i.task_id
      ) x
      where x.rk = 1
      group by x.gallery_school
    ) g
  ), '{}'::jsonb);
end $$;

-- 선생님 : 모든 영역별 점수
create or replace function public.gallery_get_item_scores(p_pw text)
returns table (work_id bigint, item_id bigint, score numeric)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not gallery_is_admin(p_pw) then return; end if;
  return query select s.work_id, s.item_id, s.score from gallery_item_scores s;
end $$;

-- 선생님 : 영역 점수 매기기 (p_score 가 null 이면 지움)
create or replace function public.gallery_set_item_score(p_id bigint, p_item_id bigint, p_score numeric, p_pw text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_school text;
begin
  if not gallery_is_admin(p_pw) then return false; end if;
  if p_score is null then
    delete from gallery_item_scores where work_id = p_id and item_id = p_item_id;
    return true;
  end if;
  select school into v_school from gallery_works where id = p_id;
  if not found then raise exception '작품을 찾을 수 없어요'; end if;
  if not exists (select 1 from eval_gallery_links where item_id = p_item_id and gallery_school = v_school) then
    raise exception '이 학교와 연결된 영역이 아니에요';
  end if;
  if not exists (select 1 from eval_item_levels where item_id = p_item_id and score = p_score) then
    raise exception '이 영역에 없는 점수예요';
  end if;
  insert into gallery_item_scores (work_id, item_id, score) values (p_id, p_item_id, p_score)
  on conflict (work_id, item_id) do update set score = excluded.score, updated_at = now();
  return true;
end $$;

/* ---------- 수행평가 점수로 반영 ----------
   학생 한 명 · 영역 하나 : 학번이 같은 작품들의 그 영역 점수 중 가장 높은 점수
   (채점 기준에 같은 점수가 없으면 가장 가까운 기준) */
create or replace function public.eval_gallery_apply(p_item_id bigint, p_student_id bigint, p_clear boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.eval_gallery_links;
  v_hakbun text;
  v_best numeric;
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
  join public.gallery_item_scores gs on gs.work_id = w.id and gs.item_id = p_item_id
  where w.school = v_link.gallery_school and w.hakbun = v_hakbun;

  if v_best is null then
    if p_clear then
      delete from public.eval_scores where student_id = p_student_id and item_id = p_item_id;
      if found then return 'cleared'; end if;
    end if;
    return 'none';
  end if;

  select id into v_level from public.eval_item_levels
  where item_id = p_item_id
  order by abs(score - v_best), sort, id limit 1;
  if v_level is null then return 'none'; end if;

  insert into public.eval_scores (student_id, item_id, level_id, updated_at)
  values (p_student_id, p_item_id, v_level, now())
  on conflict (student_id, item_id) do update
    set level_id = excluded.level_id, updated_at = now()
    where public.eval_scores.level_id is distinct from excluded.level_id;
  return 'set';
end;
$$;

-- 갤러리 학교 · 학번 하나, 영역 하나에 반영
create or replace function public.eval_gallery_refresh_item(p_item_id bigint, p_gallery_school text, p_hakbun text, p_clear boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  if p_gallery_school is null or p_hakbun is null then return; end if;
  for r in
    select st.id as student_id
    from public.eval_gallery_links l
    join public.eval_items i on i.id = l.item_id
    join public.eval_tasks tk on tk.id = i.task_id
    join public.eval_students st on st.school = tk.school and st.school_year = tk.school_year
    where l.item_id = p_item_id and l.gallery_school = p_gallery_school
      and public.eval_hakbun(st.class_name, st.number) = p_hakbun
  loop
    perform public.eval_gallery_apply(p_item_id, r.student_id, p_clear);
  end loop;
end;
$$;

-- 다시 가져오기 : 점수는 있는데 학생 명단에서 찾지 못한 작품도 알려 줌
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

  select coalesce(jsonb_agg(jsonb_build_object('hakbun', w.hakbun, 'name', w.name, 'title', w.title, 'score', gs.score)
                            order by w.hakbun nulls first, w.id), '[]'::jsonb)
    into v_unmatched
  from public.gallery_works w
  join public.gallery_item_scores gs on gs.work_id = w.id and gs.item_id = p_item_id
  where w.school = v_link.gallery_school
    and not exists (select 1 from public.eval_students st
                    where st.school = v_task.school and st.school_year = v_task.school_year
                      and public.eval_hakbun(st.class_name, st.number) = w.hakbun);

  return jsonb_build_object('applied', v_applied, 'unmatched', v_unmatched);
end;
$$;

/* ---------- 트리거 ---------- */
-- 예전 한 칸짜리 점수는 더 이상 반영하지 않음
drop trigger if exists eval_gallery_scores_sync on public.gallery_scores;
drop function if exists public.eval_gallery_scores_trg();
drop function if exists public.eval_gallery_refresh(text, text, boolean);
drop function if exists public.eval_gallery_level(bigint, int);

-- 영역 점수를 매기거나 바꾸거나 지움
create or replace function public.gallery_item_scores_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare w record;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select school, hakbun into w from public.gallery_works where id = old.work_id;
    if found then perform public.eval_gallery_refresh_item(old.item_id, w.school, w.hakbun, true); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select school, hakbun into w from public.gallery_works where id = new.work_id;
    if found then perform public.eval_gallery_refresh_item(new.item_id, w.school, w.hakbun, true); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists gallery_item_scores_sync on public.gallery_item_scores;
create trigger gallery_item_scores_sync
after insert or update or delete on public.gallery_item_scores
for each row execute function public.gallery_item_scores_trg();

-- 작품을 지우기 전에 영역 점수를 먼저 지워서(작품 정보가 남아 있을 때) 수행평가 점수도 지워지게 함
create or replace function public.eval_gallery_works_del_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.gallery_item_scores where work_id = old.id;
  return old;
end;
$$;

-- 작품의 학교 · 학번이 바뀌면 그 작품에 점수가 있는 영역만 옛 학생 / 새 학생에게 다시 반영
create or replace function public.eval_gallery_works_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in select item_id from public.gallery_item_scores where work_id = new.id loop
    perform public.eval_gallery_refresh_item(r.item_id, old.school, old.hakbun, true);
    perform public.eval_gallery_refresh_item(r.item_id, new.school, new.hakbun, true);
  end loop;
  return null;
end;
$$;

drop trigger if exists eval_gallery_works_sync on public.gallery_works;
create trigger eval_gallery_works_sync
after update of school, hakbun on public.gallery_works
for each row execute function public.eval_gallery_works_trg();

drop trigger if exists eval_gallery_works_del on public.gallery_works;
create trigger eval_gallery_works_del
before delete on public.gallery_works
for each row execute function public.eval_gallery_works_del_trg();

/* ---------- 권한 ---------- */
revoke all on function public.gallery_clean_url(text) from public, anon, authenticated;
revoke all on function public.eval_gallery_apply(bigint, bigint, boolean) from public, anon, authenticated;
revoke all on function public.eval_gallery_refresh_item(bigint, text, text, boolean) from public, anon, authenticated;
revoke all on function public.gallery_item_scores_trg() from public, anon, authenticated;
revoke all on function public.eval_gallery_works_trg() from public, anon, authenticated;
revoke all on function public.eval_gallery_works_del_trg() from public, anon, authenticated;
revoke all on function public.eval_gallery_sync_item(bigint) from public, anon;
grant execute on function public.eval_gallery_sync_item(bigint) to authenticated;

grant execute on function public.gallery_upload(text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.gallery_update(bigint, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.gallery_get_chat(bigint, text) to anon, authenticated;
grant execute on function public.gallery_get_chats(text) to anon, authenticated;
grant execute on function public.gallery_get_areas(text) to anon, authenticated;
grant execute on function public.gallery_get_item_scores(text) to anon, authenticated;
grant execute on function public.gallery_set_item_score(bigint, bigint, numeric, text) to anon, authenticated;
