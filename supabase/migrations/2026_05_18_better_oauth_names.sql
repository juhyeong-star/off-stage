-- Better name extraction for OAuth signups
-- Before: only checked raw_user_meta_data->>'name', fell back to email prefix.
-- After:  checks name → full_name → nickname → user_name → preferred_username
--         → email prefix → fallback string. Also picks avatar from picture/avatar_url.

create or replace function public.handle_new_user()
returns trigger as $$
declare
  pick_name text;
  pick_avatar text;
begin
  pick_name := coalesce(
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'nickname', ''),
    nullif(new.raw_user_meta_data->>'user_name', ''),
    nullif(new.raw_user_meta_data->>'preferred_username', ''),
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(split_part(coalesce(new.email,''), '@', 1), ''),
    '익명'
  );
  pick_avatar := coalesce(
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'picture', ''),
    null
  );
  insert into public.profiles (id, name, avatar_url)
  values (new.id, pick_name, pick_avatar);
  return new;
end;
$$ language plpgsql security definer;
