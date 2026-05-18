-- Admin-only RPC to expose auth metadata (email, last_sign_in_at, provider)
-- auth.users is locked to the service role by default; we expose narrow fields
-- via a SECURITY DEFINER function gated on the caller's admin role.

create or replace function public.admin_list_auth_meta()
returns table (
  id uuid,
  email text,
  last_sign_in_at timestamptz,
  provider text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Caller must be an admin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'admin only';
  end if;

  return query
  select
    u.id,
    u.email::text as email,
    u.last_sign_in_at,
    coalesce(u.raw_app_meta_data->>'provider', 'email')::text as provider
  from auth.users u;
end;
$$;

-- Only authenticated users can invoke; the function body re-checks admin role.
revoke all on function public.admin_list_auth_meta() from public;
grant execute on function public.admin_list_auth_meta() to authenticated;
