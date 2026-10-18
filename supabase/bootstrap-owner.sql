-- Replace OWNER_LOGIN_EMAIL with the first owner's Supabase Auth email, then run once.
do $$
declare
  owner_email text := 'OWNER_LOGIN_EMAIL';
  owner_id uuid;
begin
  if owner_email = 'OWNER_LOGIN_EMAIL' then
    raise exception 'Replace OWNER_LOGIN_EMAIL with the owner account email before running this script';
  end if;

  select p.id
    into owner_id
    from public.profiles as p
    join auth.users as u on u.id = p.id
    where lower(u.email) = lower(owner_email)
    for update of p;

  if owner_id is null then
    raise exception 'No profile found for that email. Create the account, confirm the email, sign in, and retry.';
  end if;

  update public.profiles
    set role = 'owner', roles = array['owner']::text[]
    where id = owner_id;

  insert into public.staff_audit_log (actor_id, action, subject_id, details)
  values (owner_id, 'initial_owner_bootstrapped', owner_id, jsonb_build_object('source', 'bootstrap-owner.sql'));
end;
$$;
