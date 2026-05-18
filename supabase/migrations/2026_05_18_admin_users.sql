-- Admin user management
-- Purpose:
--   1) Allow users with role='admin' to UPDATE any profile (so they can promote/demote others)
--   2) Promote 김주형 to admin

-- ── 1. RLS policy: admins can update any profile ─────────────
drop policy if exists "profiles_admin_update_any" on public.profiles;
create policy "profiles_admin_update_any" on public.profiles
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ── 2. Promote 김주형 to admin ────────────────────────────────
-- Matches by name. If multiple rows have this name, only the first is updated.
update public.profiles
set role = 'admin'
where id = (
  select id from public.profiles where name = '김주형' order by created_at asc limit 1
);
