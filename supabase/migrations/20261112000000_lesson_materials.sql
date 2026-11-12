/* =========================================================
   수업 자료 보관함 (진도 관리 › [자료 보관함] 탭, 진도 상세 창의 "수업 자료")
   - lesson_materials     : 자료 한 건 (학년 · 단원 · 종류 · 제목 · 링크 주소). 학년도와 상관없이 유지됩니다.
   - lesson_material_uses : 어느 진도 기록(records)에 어떤 자료를 붙였는지. "사용한 반"은 여기서 계산합니다.
   - 파일은 올리지 않고 링크(구글 드라이브 등) 주소만 저장합니다.
   - 선생님(app_users에 등록된 계정)만 읽고 쓸 수 있습니다.
========================================================= */
create table if not exists public.lesson_materials (
  id         bigint generated always as identity primary key,
  grade      text not null default '',
  unit       text not null default '',
  kind       text not null default '링크',
  title      text not null check (length(trim(title)) > 0),
  url        text not null check (url ~* '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_material_uses (
  id          bigint generated always as identity primary key,
  material_id bigint not null references public.lesson_materials(id) on delete cascade,
  record_id   bigint not null references public.records(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (material_id, record_id)
);
create index if not exists lesson_material_uses_record_idx on public.lesson_material_uses (record_id);

alter table public.lesson_materials enable row level security;
drop policy if exists "allowed users full access" on public.lesson_materials;
create policy "allowed users full access" on public.lesson_materials for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));

alter table public.lesson_material_uses enable row level security;
drop policy if exists "allowed users full access" on public.lesson_material_uses;
create policy "allowed users full access" on public.lesson_material_uses for all to authenticated
  using ((select public.is_allowed_user())) with check ((select public.is_allowed_user()));
