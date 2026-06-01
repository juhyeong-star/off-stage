-- ============================================================
-- 2026_06_02_cross_device_sync.sql
--
-- 두 가지 데이터를 PC 간 동기화하기 위해 Supabase 에 저장:
--  1) 알림 읽음 상태 — 한 PC 에서 읽었으면 다른 PC 에서도 읽음 처리
--  2) 도형(shapes)/우주(universe)/폴더(playlist) 의 사용자 위치 — 한 PC 에서 배치한 그대로
--
-- 양쪽 모두 read 는 자기 자신만, write 도 자기 자신만 RLS 로 제한.
-- ============================================================

-- ── 1) 알림 읽음 상태 ───────────────────────────────────────
-- notif_id 는 클라이언트가 생성하는 안정적인 ID (예: 'note_xxx', 'follow_xxx').
-- 같은 사용자가 같은 ID 를 두 번 읽음 처리해도 멱등 (primary key 충돌).
create table if not exists public.notification_reads (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  notif_id  text not null,
  read_at   timestamptz not null default now(),
  primary key (user_id, notif_id)
);

alter table public.notification_reads enable row level security;

drop policy if exists "notif_reads_self_select" on public.notification_reads;
create policy "notif_reads_self_select"
  on public.notification_reads for select
  using (auth.uid() = user_id);

drop policy if exists "notif_reads_self_insert" on public.notification_reads;
create policy "notif_reads_self_insert"
  on public.notification_reads for insert
  with check (auth.uid() = user_id);

drop policy if exists "notif_reads_self_delete" on public.notification_reads;
create policy "notif_reads_self_delete"
  on public.notification_reads for delete
  using (auth.uid() = user_id);

-- ── 2) 오브제(도형/우주/폴더) 위치 ──────────────────────────
-- scope: 'shape' | 'universe' | 'playlist'
-- scope_id: playlist 폴더 ID (그 외엔 '' 빈 문자열)
-- item_id: 트랙/노트/폴더 ID
-- pass: shape 페이지에서 같은 트랙이 여러 번 그려질 때의 인덱스 (그 외엔 0)
create table if not exists public.user_object_positions (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  scope     text not null check (scope in ('shape','universe','playlist')),
  scope_id  text not null default '',
  item_id   text not null,
  pass      int  not null default 0,
  x_pct     real not null default 0,
  y_px      real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, scope_id, item_id, pass)
);

create index if not exists user_object_positions_user_scope_idx
  on public.user_object_positions (user_id, scope);

alter table public.user_object_positions enable row level security;

drop policy if exists "obj_pos_self_select" on public.user_object_positions;
create policy "obj_pos_self_select"
  on public.user_object_positions for select
  using (auth.uid() = user_id);

drop policy if exists "obj_pos_self_upsert" on public.user_object_positions;
create policy "obj_pos_self_upsert"
  on public.user_object_positions for insert
  with check (auth.uid() = user_id);

drop policy if exists "obj_pos_self_update" on public.user_object_positions;
create policy "obj_pos_self_update"
  on public.user_object_positions for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "obj_pos_self_delete" on public.user_object_positions;
create policy "obj_pos_self_delete"
  on public.user_object_positions for delete
  using (auth.uid() = user_id);
