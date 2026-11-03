/* =========================================================
   학교 메모 (대시보드 "학교 메모" 카드)
   - 학교마다 여러 개의 메모 (교무실 번호, 와이파이, 수업 교실, 준비물 등)
   - 학년도와 상관없이 유지됩니다.
   - 선생님(app_users에 등록된 계정)만 읽고 쓸 수 있습니다.
========================================================= */
create table if not exists public.school_memos (
  id         bigint generated always as identity primary key,
  school     text not null check (length(trim(school)) > 0),
  content    text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists school_memos_school_idx on public.school_memos (school);

alter table public.school_memos enable row level security;
drop policy if exists "allowed users full access" on public.school_memos;
create policy "allowed users full access" on public.school_memos for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
