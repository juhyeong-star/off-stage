-- ================================================================
-- Off-Stage Supabase Schema
-- Run this in: Dashboard → SQL Editor → New Query → paste all → Run
-- ================================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ================================================================
-- 1. PROFILES (extends auth.users)
-- ================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  avatar_url text,
  role text not null default 'listener' check (role in ('listener','artist','admin')),
  sns_instagram text,
  sns_youtube text,
  sns_tiktok text,
  sns_twitter text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_public_read"    on public.profiles for select using (true);
create policy "profiles_update_own"     on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own"     on public.profiles for insert with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ================================================================
-- 2. TRACKS (both demos and masters)
-- ================================================================
create table if not exists public.tracks (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null default uuid_generate_v4(),
  artist_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  audio_url text,
  cover_url text,
  -- versioning
  version text not null default 'final',       -- 'demo1','demo2',...,'final'
  version_label text,
  is_demo boolean not null default false,
  -- metadata
  artist_note text default '',                 -- per-track diary
  tags text[] default '{}',
  shape text default 'circle',
  shape_color text default '#FF9800',
  lines text[] default '{}',                    -- 3-line graffiti
  -- stats
  likes_count int not null default 0,
  plays_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists tracks_project_idx on public.tracks(project_id);
create index if not exists tracks_artist_idx  on public.tracks(artist_id);
create index if not exists tracks_tags_idx    on public.tracks using gin(tags);

alter table public.tracks enable row level security;
create policy "tracks_public_read"   on public.tracks for select using (true);
create policy "tracks_insert_own"    on public.tracks for insert with check (auth.uid() = artist_id);
create policy "tracks_update_own"    on public.tracks for update using (auth.uid() = artist_id);
create policy "tracks_delete_own"    on public.tracks for delete using (auth.uid() = artist_id);

-- ================================================================
-- 3. TRACK COMMENTS (낙서 on each demo/master)
-- ================================================================
create table if not exists public.track_comments (
  id uuid primary key default uuid_generate_v4(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null default '익명',
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists track_comments_track_idx on public.track_comments(track_id);
alter table public.track_comments enable row level security;
create policy "track_comments_public_read" on public.track_comments for select using (true);
create policy "track_comments_insert_auth" on public.track_comments for insert with check (auth.uid() is not null and author_id = auth.uid());
create policy "track_comments_delete_own"  on public.track_comments for delete using (auth.uid() = author_id);

-- ================================================================
-- 4. WALL NOTES (우리들의 벽 포스트잇)
-- ================================================================
create table if not exists public.wall_notes (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  text text not null,
  color text not null default 'yellow',
  rotation real not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists wall_notes_author_idx on public.wall_notes(author_id);
create index if not exists wall_notes_created_idx on public.wall_notes(created_at desc);
alter table public.wall_notes enable row level security;
create policy "wall_notes_public_read" on public.wall_notes for select using (true);
create policy "wall_notes_insert_auth" on public.wall_notes for insert with check (auth.uid() is not null);
create policy "wall_notes_delete_own"  on public.wall_notes for delete using (auth.uid() = author_id);

-- ================================================================
-- 5. WALL NOTE COMMENTS
-- ================================================================
create table if not exists public.wall_note_comments (
  id uuid primary key default uuid_generate_v4(),
  note_id uuid not null references public.wall_notes(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null default '익명',
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists wnc_note_idx on public.wall_note_comments(note_id);
alter table public.wall_note_comments enable row level security;
create policy "wnc_public_read" on public.wall_note_comments for select using (true);
create policy "wnc_insert_auth" on public.wall_note_comments for insert with check (auth.uid() is not null and author_id = auth.uid());

-- ================================================================
-- 6. PLAYLISTS
-- ================================================================
create table if not exists public.playlists (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  cover_url text,
  created_at timestamptz not null default now()
);
create table if not exists public.playlist_tracks (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id   uuid not null references public.tracks(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (playlist_id, track_id)
);
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
create policy "playlists_public_read" on public.playlists for select using (true);
create policy "playlists_own_write"   on public.playlists for all using (auth.uid() = owner_id);
create policy "pt_public_read"        on public.playlist_tracks for select using (true);
create policy "pt_owner_write"        on public.playlist_tracks for all using (
  exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = auth.uid())
);

-- ================================================================
-- 7. FOLLOWS (팬 관계)
-- ================================================================
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id)
);
alter table public.follows enable row level security;
create policy "follows_public_read" on public.follows for select using (true);
create policy "follows_own_write"   on public.follows for all using (auth.uid() = follower_id);

-- ================================================================
-- 8. RESERVATIONS (합주실 예약)
-- ================================================================
create table if not exists public.reservations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete set null,
  room text not null,
  reserved_date date not null,
  reserved_time text not null,
  created_at timestamptz not null default now(),
  unique (room, reserved_date, reserved_time)
);
alter table public.reservations enable row level security;
create policy "res_public_read" on public.reservations for select using (true);
create policy "res_insert_auth" on public.reservations for insert with check (auth.uid() = user_id);
create policy "res_delete_own"  on public.reservations for delete using (auth.uid() = user_id);

-- ================================================================
-- 9. EVENTS (커뮤니티 이벤트)
-- ================================================================
create table if not exists public.events (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  event_date date not null,
  banner_url text,
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;
create policy "events_public_read" on public.events for select using (true);
create policy "events_admin_write" on public.events for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- ================================================================
-- 10. STORAGE BUCKETS
-- ================================================================
insert into storage.buckets (id, name, public)
  values ('audio', 'audio', true),
         ('covers', 'covers', true),
         ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- Storage policies — public read, authenticated upload
create policy "audio_public_read"   on storage.objects for select using (bucket_id = 'audio');
create policy "audio_auth_upload"   on storage.objects for insert with check (bucket_id = 'audio' and auth.uid() is not null);
create policy "audio_owner_delete"  on storage.objects for delete using (bucket_id = 'audio' and owner = auth.uid());

create policy "covers_public_read"  on storage.objects for select using (bucket_id = 'covers');
create policy "covers_auth_upload"  on storage.objects for insert with check (bucket_id = 'covers' and auth.uid() is not null);

create policy "avatars_public_read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars_auth_upload" on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid() is not null);
