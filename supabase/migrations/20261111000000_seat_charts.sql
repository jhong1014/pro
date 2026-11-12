/* =========================================================
   자리표 ([자리표] 탭)
   - 학년도 · 학교 · 반마다 자리표를 여러 장 저장합니다 (새로 저장할 때마다 이력으로 남음).
   - 줄 · 열 수와 사용할 수 없는 자리(고장 난 컴퓨터 등)를 자리표마다 함께 저장합니다.
   - seats 에는 학생 번호 · 이름을 그대로 적어 두어, 나중에 명단이 바뀌어도 이력이 남습니다.
   - 선생님(app_users에 등록된 계정)만 읽고 쓸 수 있습니다.
========================================================= */
create table if not exists public.seat_charts (
  id          bigint generated always as identity primary key,
  school_year int  not null,
  school      text not null check (length(trim(school)) > 0),
  class_name  text not null check (length(trim(class_name)) > 0),
  title       text not null default '',
  start_date  date not null,
  row_count   int  not null check (row_count between 1 and 12),
  col_count   int  not null check (col_count between 1 and 12),
  blocked     jsonb not null default '[]'::jsonb,  -- [[줄, 열], ...] (0부터)
  seats       jsonb not null default '[]'::jsonb,  -- [{r, c, id, number, name}, ...]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists seat_charts_class_idx
  on public.seat_charts (school_year, school, class_name, start_date desc);

alter table public.seat_charts enable row level security;
drop policy if exists "allowed users full access" on public.seat_charts;
create policy "allowed users full access" on public.seat_charts for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
