-- ================================================================
-- Fix: role was not being set from signup metadata
-- Run this in Supabase Dashboard → SQL Editor → Run
-- ================================================================

-- 1) Update the trigger so role/avatar are read from signup metadata
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, avatar_url, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_user_meta_data->>'role', 'listener')
  )
  on conflict (id) do update set
    name       = excluded.name,
    avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
    role       = coalesce(excluded.role, profiles.role);
  return new;
end;
$$ language plpgsql security definer;

-- 2) Re-attach trigger (idempotent)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3) Promote any existing stuck accounts that had 'artist' or 'admin' in metadata
--    but were saved as 'listener' due to the old trigger bug.
update public.profiles p
set role = u.raw_user_meta_data->>'role'
from auth.users u
where p.id = u.id
  and p.role = 'listener'
  and u.raw_user_meta_data->>'role' in ('artist','admin');

-- 4) Quick manual override — uncomment + fill in your email to force your own account to 'artist'
-- update public.profiles
-- set role = 'artist'
-- where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
