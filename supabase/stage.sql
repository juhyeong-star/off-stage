-- ================================================================
-- Project Stage (#함께만드는중) + 하나증권 SPO 연동 슬롯
-- 사용자에게는 "투자/수익률" 같은 단어 절대 노출 X.
-- 백엔드만 STO 지분 자동 할당.
-- ================================================================

-- 1) 트랙에 프로젝트 진행 단계 컬럼 추가 (같은 project_id 안의 트랙들은 동일 stage 공유)
alter table public.tracks
  add column if not exists project_stage text default 'demo'
  check (project_stage in ('demo','voting','released','concert'));

-- 2) 후원자 테이블에 하나증권 STO 연동용 슬롯 (UI 노출 X)
alter table public.track_backers
  add column if not exists hana_alloc_id text,        -- 하나증권에서 발급한 지분 ID
  add column if not exists hana_alloc_at timestamptz, -- 지분 할당 시각
  add column if not exists tier text default 'free';  -- 'free','small','medium','large' (지분 등급)

-- 3) 공감홀 이벤트 (STO 주주 전용 오프라인 행사)
create table if not exists public.shareholder_events (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid,                  -- 어떤 프로젝트의 공연인지
  artist_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  venue text,                       -- '공감홀 1층' 등
  event_date timestamptz not null,
  -- 참석 자격: 최소 후원 금액 (이 금액 이상 후원한 backer만 RSVP 가능)
  min_amount_krw integer default 0,
  capacity integer default 50,
  description text default '',
  cover_url text,
  created_at timestamptz not null default now()
);
alter table public.shareholder_events enable row level security;
create policy "shareholder_events_public_read"
  on public.shareholder_events for select using (true);
create policy "shareholder_events_artist_write"
  on public.shareholder_events for all using (auth.uid() = artist_id);

-- 4) 공감홀 RSVP — 주주만 신청 가능 (백엔드에서 amount 검증)
create table if not exists public.shareholder_rsvps (
  event_id uuid not null references public.shareholder_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rsvp_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.shareholder_rsvps enable row level security;
create policy "shareholder_rsvps_public_read"
  on public.shareholder_rsvps for select using (true);
create policy "shareholder_rsvps_self_write"
  on public.shareholder_rsvps for all using (auth.uid() = user_id);
-- NOTE: 자격 검증 (amount_krw >= min_amount_krw)은 백엔드 함수 또는 클라이언트 게이트에서.
