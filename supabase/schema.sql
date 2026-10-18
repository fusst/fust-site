-- FUSST Hub security and feature migration.
-- Apply the entire script once in the Supabase SQL Editor as the project owner.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  degree text not null default 'BSSE',
  semester smallint not null default 5 check (semester between 1 and 8),
  section text not null default 'A',
  role text not null default 'student',
  created_at timestamptz not null default now()
);

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('student', 'cr', 'teacher', 'technical_team', 'owner'));
alter table public.profiles
  add column if not exists roles text[] not null default array['student']::text[],
  add column if not exists headline text not null default '',
  add column if not exists bio text not null default '',
  add column if not exists linkedin_url text not null default '',
  add column if not exists avatar_path text not null default '';
update public.profiles
  set roles = array[role]::text[]
  where roles = array['student']::text[] and role <> 'student';
alter table public.profiles
  drop constraint if exists profiles_roles_check;
alter table public.profiles
  add constraint profiles_roles_check
  check (
    cardinality(roles) > 0
    and roles <@ array['student', 'cr', 'teacher', 'technical_team', 'owner']::text[]
  );
alter table public.profiles enable row level security;
create index if not exists profiles_roles_gin_idx on public.profiles using gin (roles);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('timetable-images', 'timetable-images', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view profile photos" on storage.objects;
drop policy if exists "Authenticated users can view profile photos" on storage.objects;
create policy "Authenticated users can view profile photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'profile-photos');
drop policy if exists "Users can upload their own profile photos" on storage.objects;
create policy "Users can upload their own profile photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can update their own profile photos" on storage.objects;
create policy "Users can update their own profile photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can delete their own profile photos" on storage.objects;
create policy "Users can delete their own profile photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  category text not null default 'academic'
    check (category in ('academic', 'events', 'urgent', 'community')),
  audience text not null default 'all'
    check (audience in ('all', 'students', 'cr', 'teachers', 'technical_team')),
  author_name text not null default '' check (char_length(author_name) <= 120),
  is_pinned boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.notices
  add column if not exists audience text not null default 'all';
alter table public.notices
  add column if not exists author_roles text[] not null default array[]::text[];
update public.notices as n
  set author_roles = p.roles
  from public.profiles as p
  where n.created_by = p.id and cardinality(n.author_roles) = 0;
alter table public.notices
  drop constraint if exists notices_category_check;
alter table public.notices
  add constraint notices_category_check
  check (category in ('academic', 'events', 'urgent', 'community'));
alter table public.notices
  drop constraint if exists notices_audience_check;
alter table public.notices
  add constraint notices_audience_check
  check (audience in ('all', 'students', 'cr', 'teachers', 'technical_team', 'owner'));
alter table public.notices enable row level security;
create index if not exists notices_created_at_idx on public.notices (created_at desc);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '',
  course_code text not null default '',
  due_at timestamptz not null,
  author_name text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.assignments enable row level security;
create index if not exists assignments_due_at_idx on public.assignments (due_at);

create table if not exists public.timetable (
  id uuid primary key default gen_random_uuid(),
  course_code text not null check (char_length(trim(course_code)) between 1 and 30),
  course_name text not null check (char_length(trim(course_name)) between 1 and 120),
  instructor text not null default '',
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  room text not null default '',
  building_name text not null default '',
  floor_number smallint,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.timetable
  add column if not exists semester smallint not null default 5,
  add column if not exists section text not null default 'A',
  add column if not exists effective_from date not null default current_date,
  add column if not exists effective_until date,
  add column if not exists week_type text not null default 'all',
  add column if not exists building_name text not null default '',
  add column if not exists floor_number smallint;
alter table public.timetable
  drop constraint if exists timetable_floor_number_check;
alter table public.timetable
  add constraint timetable_floor_number_check
  check (floor_number is null or floor_number between -3 and 99);
alter table public.timetable
  drop constraint if exists timetable_building_name_check;
alter table public.timetable
  add constraint timetable_building_name_check
  check (char_length(building_name) <= 120);
alter table public.timetable
  drop constraint if exists timetable_week_type_check;
alter table public.timetable
  add constraint timetable_week_type_check
  check (week_type in ('all', 'even', 'odd'));
alter table public.timetable
  drop constraint if exists timetable_dates_check;
alter table public.timetable
  add constraint timetable_dates_check
  check (effective_until is null or effective_until >= effective_from);
alter table public.timetable enable row level security;
create index if not exists timetable_day_time_idx on public.timetable (day_of_week, start_time);
create index if not exists timetable_schedule_idx
  on public.timetable (semester, section, effective_from, effective_until);

create table if not exists public.portal_timetable_images (
  asset_key text primary key check (asset_key = 'bsse'),
  storage_path text not null check (
    storage_path ~ '^published/timetable-[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}[.](jpg|png|webp)$'
  ),
  original_name text not null check (char_length(btrim(original_name)) between 1 and 180),
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now()
);
alter table public.portal_timetable_images enable row level security;

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  notice_id uuid references public.notices (id) on delete cascade,
  title text not null,
  body text not null default '',
  category text not null default 'academic',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.user_notifications enable row level security;
create index if not exists user_notifications_inbox_idx
  on public.user_notifications (user_id, created_at desc);

create table if not exists public.support_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (char_length(trim(subject)) between 1 and 160),
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.support_threads enable row level security;
create index if not exists support_threads_inbox_idx
  on public.support_threads (status, updated_at desc);
create index if not exists support_threads_user_idx
  on public.support_threads (user_id, updated_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
alter table public.support_messages
  alter column expires_at set default (now() + interval '7 days');
alter table public.support_messages enable row level security;
create index if not exists support_messages_thread_idx
  on public.support_messages (thread_id, created_at);
create index if not exists support_messages_expiry_idx
  on public.support_messages (expires_at);

create table if not exists public.portal_settings (
  singleton boolean primary key default true check (singleton),
  maintenance_mode boolean not null default false,
  maintenance_message text not null default 'We’ll be right back. The portal is undergoing scheduled maintenance.',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.portal_settings enable row level security;
insert into public.portal_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.staff_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.staff_audit_log enable row level security;
create index if not exists staff_audit_log_created_at_idx
  on public.staff_audit_log (created_at desc);

create or replace function public.current_user_has_any_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and roles && allowed_roles
  );
$$;

create or replace function public.is_portal_poster()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_user_has_any_role(
    array['cr', 'teacher', 'owner']::text[]
  );
$$;

create or replace function public.create_student_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, roles)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), array['student']::text[]);
  return new;
end;
$$;

create or replace function public.guard_notice_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.current_user_has_any_role(array['owner']::text[])
    and (
      new.author_name is distinct from old.author_name
      or new.audience is distinct from old.audience
      or new.created_by is distinct from old.created_by
      or new.author_roles is distinct from old.author_roles
    ) then
    raise exception 'Only the portal owner can change notice authors, audiences, or creators'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute function public.create_student_profile();

create or replace function public.stamp_portal_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_roles text[];
  requested_author_name text;
begin
  requested_author_name := new.author_name;
  select p.roles, p.full_name
    into actor_roles, new.author_name
    from public.profiles as p
    where p.id = (select auth.uid());

  if new.audience <> 'all' and not ('owner' = any(coalesce(actor_roles, array[]::text[]))) then
    raise exception 'Only the portal owner can target a notice to selected roles'
      using errcode = '42501';
  end if;

  if 'owner' = any(coalesce(actor_roles, array[]::text[]))
    and char_length(trim(coalesce(requested_author_name, ''))) > 0 then
    new.author_name := left(trim(requested_author_name), 120);
  else
    select coalesce(nullif(trim(p.full_name), ''), split_part(u.email, '@', 1), 'FUSST Hub')
      into new.author_name
      from public.profiles as p
      join auth.users as u on u.id = p.id
      where p.id = (select auth.uid());
    new.author_name := coalesce(new.author_name, 'FUSST Hub');
  end if;

  new.author_roles := coalesce(actor_roles, array[]::text[]);
  new.created_by := (select auth.uid());
  return new;
end;
$$;

create or replace function public.create_notice_inbox_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_notifications (user_id, notice_id, title, body, category)
  select p.id, new.id, new.title, left(new.body, 500), new.category
  from public.profiles as p
  where (
      new.audience = 'all'
      or (new.audience = 'students' and 'student' = any(p.roles))
      or (new.audience = 'cr' and 'cr' = any(p.roles))
      or (new.audience = 'teachers' and 'teacher' = any(p.roles))
      or (new.audience = 'technical_team' and 'technical_team' = any(p.roles))
      or (new.audience = 'owner' and 'owner' = any(p.roles))
    );
  return new;
end;
$$;

create or replace function public.stamp_portal_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := (select auth.uid());
  select coalesce(nullif(trim(p.full_name), ''), split_part(u.email, '@', 1), 'FUSST Hub')
    into new.author_name
    from public.profiles as p
    join auth.users as u on u.id = p.id
    where p.id = (select auth.uid());
  new.author_name := coalesce(new.author_name, 'FUSST Hub');
  return new;
end;
$$;

create or replace function public.stamp_timetable_class()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists stamp_notice_author_before_insert on public.notices;
create trigger stamp_notice_author_before_insert
  before insert on public.notices
  for each row execute function public.stamp_portal_notice();
drop trigger if exists guard_notice_admin_fields_before_update on public.notices;
create trigger guard_notice_admin_fields_before_update
  before update on public.notices
  for each row execute function public.guard_notice_admin_fields();
drop trigger if exists create_notice_notifications_after_insert on public.notices;
create trigger create_notice_notifications_after_insert
  after insert on public.notices
  for each row execute function public.create_notice_inbox_notifications();
drop trigger if exists stamp_assignment_author_before_insert on public.assignments;
create trigger stamp_assignment_author_before_insert
  before insert on public.assignments
  for each row execute function public.stamp_portal_assignment();
drop trigger if exists stamp_timetable_creator_before_insert on public.timetable;
create trigger stamp_timetable_creator_before_insert
  before insert on public.timetable
  for each row execute function public.stamp_timetable_class();

create or replace function public.update_support_thread_timestamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_threads
    set updated_at = greatest(now(), created_at + interval '1 microsecond')
    where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists bump_support_thread_after_message on public.support_messages;
create trigger bump_support_thread_after_message
  after insert on public.support_messages
  for each row execute function public.update_support_thread_timestamp();

create or replace function public.validate_support_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_user_id uuid;
  thread_status text;
begin
  select t.user_id, t.status
    into owner_user_id, thread_status
    from public.support_threads as t
    where t.id = new.thread_id
    for update;

  if owner_user_id is null then
    raise exception 'Support conversation does not exist' using errcode = '23503';
  end if;
  if thread_status = 'closed' then
    raise exception 'This support conversation is closed' using errcode = '42501';
  end if;
  if owner_user_id <> (select auth.uid())
    and not public.current_user_has_any_role(array['technical_team', 'owner']::text[]) then
    raise exception 'Only the conversation owner and technical support can reply'
      using errcode = '42501';
  end if;

  new.sender_id := (select auth.uid());
  new.expires_at := now() + interval '7 days';
  return new;
end;
$$;

drop trigger if exists validate_support_message_before_insert on public.support_messages;
create trigger validate_support_message_before_insert
  before insert on public.support_messages
  for each row execute function public.validate_support_message();

create or replace function public.create_support_thread(thread_subject text, first_message text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_thread_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to contact the technical team' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(thread_subject, ''))) not between 1 and 160 then
    raise exception 'Add a subject between 1 and 160 characters';
  end if;
  if char_length(trim(coalesce(first_message, ''))) not between 1 and 4000 then
    raise exception 'Add a message between 1 and 4000 characters';
  end if;

  insert into public.support_threads (user_id, subject)
  values ((select auth.uid()), trim(thread_subject))
  returning id into created_thread_id;

  insert into public.support_messages (thread_id, sender_id, body)
  values (created_thread_id, (select auth.uid()), trim(first_message));

  return created_thread_id;
end;
$$;

create or replace function public.set_support_thread_status(thread_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new_status not in ('open', 'in_progress', 'closed') then
    raise exception 'Unsupported support conversation status';
  end if;
  if not public.current_user_has_any_role(array['technical_team', 'owner']::text[]) then
    raise exception 'Only technical team members can change conversation status'
      using errcode = '42501';
  end if;

  update public.support_threads
    set status = new_status, updated_at = now()
    where id = thread_id;
  if not found then
    raise exception 'Support conversation not found';
  end if;
end;
$$;

create or replace function public.change_profile_roles(target_profile_id uuid, new_roles text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_roles text[];
  normalized_roles text[];
  display_role text;
begin
  if (select auth.uid()) is null
    or not public.current_user_has_any_role(array['owner']::text[]) then
    raise exception 'Only the portal owner can manage user roles'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(73420261018);
  if coalesce(cardinality(new_roles), 0) = 0
    or not (new_roles <@ array['student', 'cr', 'teacher', 'technical_team', 'owner']::text[]) then
    raise exception 'Choose at least one supported portal role';
  end if;
  select array_agg(distinct role_name order by role_name)
    into normalized_roles
    from unnest(new_roles) as role_name;

  select roles into previous_roles
    from public.profiles
    where id = target_profile_id
    for update;
  if not found then
    raise exception 'User profile not found';
  end if;

  if target_profile_id = (select auth.uid())
    and 'owner' = any(previous_roles)
    and not ('owner' = any(normalized_roles)) then
    raise exception 'Use another owner account to remove your own owner role';
  end if;
  if 'owner' = any(previous_roles)
    and not ('owner' = any(normalized_roles))
    and (select count(*) from public.profiles where 'owner' = any(roles)) <= 1 then
    raise exception 'Promote another owner before removing the last owner';
  end if;

  display_role := case
    when 'owner' = any(normalized_roles) then 'owner'
    when 'teacher' = any(normalized_roles) then 'teacher'
    when 'cr' = any(normalized_roles) then 'cr'
    when 'technical_team' = any(normalized_roles) then 'technical_team'
    else 'student'
  end;
  update public.profiles
    set roles = normalized_roles, role = display_role
    where id = target_profile_id;
  insert into public.staff_audit_log (actor_id, action, subject_id, details)
  values (
    (select auth.uid()),
    'role_changed',
    target_profile_id,
    jsonb_build_object('previous_roles', previous_roles, 'new_roles', normalized_roles)
  );
end;
$$;

create or replace function public.change_profile_role(target_profile_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.change_profile_roles(target_profile_id, array[new_role]::text[]);
end;
$$;

drop function if exists public.list_portal_users();
create or replace function public.list_portal_users()
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  roles text[],
  degree text,
  semester smallint,
  section text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.current_user_has_any_role(array['owner']::text[]) then
    raise exception 'Only the portal owner can view user account details'
      using errcode = '42501';
  end if;

  return query
    select p.id, u.email::text, p.full_name, p.role, p.roles, p.degree, p.semester, p.section, p.created_at
    from public.profiles as p
    join auth.users as u on u.id = p.id
    order by p.created_at desc;
end;
$$;

drop function if exists public.update_my_profile(text, text, text, text);
create or replace function public.update_my_profile(
  new_full_name text,
  new_headline text,
  new_bio text,
  new_linkedin_url text,
  new_avatar_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to update your profile' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(new_full_name, ''))) not between 1 and 100
    or char_length(trim(coalesce(new_headline, ''))) > 120
    or char_length(trim(coalesce(new_bio, ''))) > 500
    or char_length(trim(coalesce(new_linkedin_url, ''))) > 300 then
    raise exception 'Check your name, headline, bio, and LinkedIn URL lengths';
  end if;
  if trim(coalesce(new_linkedin_url, '')) <> ''
    and trim(new_linkedin_url) !~ '^https://(www\.)?linkedin\.com/' then
    raise exception 'LinkedIn URL must start with https://linkedin.com/';
  end if;
  if trim(coalesce(new_avatar_path, '')) <> ''
    and trim(new_avatar_path) !~ (
      '^' || (select auth.uid())::text || '/avatar-[[:xdigit:]-]+\.(jpg|png|webp)$'
    ) then
    raise exception 'Profile photos must belong to your account and use a supported image type';
  end if;

  update public.profiles
    set full_name = trim(new_full_name),
        headline = trim(coalesce(new_headline, '')),
        bio = trim(coalesce(new_bio, '')),
        linkedin_url = trim(coalesce(new_linkedin_url, '')),
        avatar_path = trim(coalesce(new_avatar_path, ''))
    where id = (select auth.uid());
  if not found then
    raise exception 'Your portal profile was not found';
  end if;
end;
$$;

create or replace function public.publish_timetable_image(image_path text, image_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_path text;
begin
  if (select auth.uid()) is null
    or not public.current_user_has_any_role(array['technical_team', 'owner']::text[]) then
    raise exception 'Only the technical team or portal owner can publish the timetable'
      using errcode = '42501';
  end if;
  if image_path is null
    or image_path !~ '^published/timetable-[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}[.](jpg|png|webp)$'
    or image_name is null
    or char_length(btrim(image_name)) not between 1 and 180 then
    raise exception 'Choose a timetable image with a supported filename';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(73420261019);
  select storage_path into previous_path
    from public.portal_timetable_images
    where asset_key = 'bsse'
    for update;

  insert into public.portal_timetable_images (asset_key, storage_path, original_name, uploaded_by, updated_at)
    values ('bsse', image_path, btrim(image_name), (select auth.uid()), pg_catalog.now())
    on conflict (asset_key) do update
      set storage_path = excluded.storage_path,
          original_name = excluded.original_name,
          uploaded_by = excluded.uploaded_by,
          updated_at = excluded.updated_at;

  insert into public.staff_audit_log (actor_id, action, details)
    values (
      (select auth.uid()),
      'timetable_image_published',
      jsonb_build_object('original_name', btrim(image_name))
    );
  return previous_path;
end;
$$;

create or replace function public.publish_timetable_week(
  schedule_entries jsonb,
  target_semester smallint,
  target_section text,
  valid_from date,
  valid_until date,
  recurrence text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if (select auth.uid()) is null
    or not public.is_portal_poster() then
    raise exception 'Only verified CRs, teachers, and owners can publish a timetable'
      using errcode = '42501';
  end if;
  if target_semester is null
    or target_semester not between 1 and 8
    or char_length(trim(coalesce(target_section, ''))) not between 1 and 12
    or valid_from is null
    or (valid_until is not null and valid_until < valid_from)
    or recurrence is null
    or recurrence not in ('all', 'even', 'odd') then
    raise exception 'Check the timetable semester, section, date range, and recurrence';
  end if;
  if schedule_entries is null or jsonb_typeof(schedule_entries) <> 'array' then
    raise exception 'Timetable rows must be supplied as a CSV-derived JSON array';
  end if;
  if jsonb_array_length(schedule_entries) not between 1 and 100 then
    raise exception 'Add between 1 and 100 timetable classes';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(schedule_entries) as entry(
      day_of_week smallint,
      course_code text,
      course_name text,
      start_time time,
      end_time time,
      instructor text,
      room text,
      building_name text,
      floor_number smallint
    )
    where entry.day_of_week is null
      or entry.day_of_week not between 0 and 6
      or char_length(trim(coalesce(entry.course_code, ''))) not between 1 and 30
      or char_length(trim(coalesce(entry.course_name, ''))) not between 1 and 120
      or entry.start_time is null
      or entry.end_time is null
      or entry.end_time <= entry.start_time
      or char_length(coalesce(entry.instructor, '')) > 120
      or char_length(coalesce(entry.room, '')) > 80
      or char_length(coalesce(entry.building_name, '')) > 120
      or (entry.floor_number is not null and entry.floor_number not between -3 and 99)
  ) then
    raise exception 'One or more timetable rows have invalid day, course, time, instructor, or location details';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(schedule_entries) with ordinality as first_entry(value, row_number)
    join jsonb_array_elements(schedule_entries) with ordinality as second_entry(value, row_number)
      on first_entry.row_number < second_entry.row_number
    where (first_entry.value ->> 'day_of_week')::smallint = (second_entry.value ->> 'day_of_week')::smallint
      and (first_entry.value ->> 'start_time')::time < (second_entry.value ->> 'end_time')::time
      and (second_entry.value ->> 'start_time')::time < (first_entry.value ->> 'end_time')::time
  ) then
    raise exception 'Two classes overlap on the same day';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_semester::text || ':' || upper(trim(target_section)), 0)
  );
  update public.timetable
    set effective_until = valid_from - 1
    where semester = target_semester
      and upper(section) = upper(trim(target_section))
      and effective_from < valid_from
      and coalesce(effective_until, 'infinity'::date) >= valid_from;
  delete from public.timetable
    where semester = target_semester
      and upper(section) = upper(trim(target_section))
      and effective_from >= valid_from
      and (valid_until is null or effective_from <= valid_until);

  insert into public.timetable (
    course_code, course_name, instructor, day_of_week, start_time, end_time, room,
    building_name, floor_number,
    semester, section, effective_from, effective_until, week_type, created_by
  )
  select entry.course_code, entry.course_name, coalesce(entry.instructor, ''),
         entry.day_of_week, entry.start_time, entry.end_time, coalesce(entry.room, ''),
         coalesce(entry.building_name, ''), entry.floor_number,
         target_semester, upper(trim(target_section)), valid_from, valid_until, recurrence,
         (select auth.uid())
  from jsonb_to_recordset(schedule_entries) as entry(
    day_of_week smallint,
    course_code text,
    course_name text,
    start_time time,
    end_time time,
    instructor text,
    room text,
    building_name text,
    floor_number smallint
  );
  get diagnostics inserted_count = row_count;

  insert into public.staff_audit_log (actor_id, action, details)
  values (
    (select auth.uid()),
    'timetable_published',
    jsonb_build_object(
      'semester', target_semester,
      'section', upper(trim(target_section)),
      'valid_from', valid_from,
      'valid_until', valid_until,
      'recurrence', recurrence,
      'class_count', inserted_count
    )
  );
  return inserted_count;
end;
$$;

create or replace function public.set_portal_maintenance(enabled boolean, message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.current_user_has_any_role(array['owner']::text[]) then
    raise exception 'Only the portal owner can enable or disable maintenance mode'
      using errcode = '42501';
  end if;
  if char_length(trim(coalesce(message, ''))) not between 1 and 500 then
    raise exception 'Add a maintenance message between 1 and 500 characters';
  end if;

  update public.portal_settings
    set maintenance_mode = enabled,
        maintenance_message = trim(message),
        updated_by = (select auth.uid()),
        updated_at = now()
    where singleton = true;
  insert into public.staff_audit_log (actor_id, action, details)
  values (
    (select auth.uid()),
    case when enabled then 'maintenance_enabled' else 'maintenance_disabled' end,
    jsonb_build_object('message', trim(message))
  );
end;
$$;

create or replace function public.mark_notification_read(notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_notifications
    set read_at = coalesce(read_at, now())
    where id = notification_id
      and user_id = (select auth.uid());
  if not found then
    raise exception 'Notification not found or does not belong to this account'
      using errcode = '42501';
  end if;
end;
$$;

-- Profiles are public to authenticated classmates, but only the owner's RPC
-- can change roles. Never grant direct role-column updates to users.
drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
  on public.profiles for select to authenticated using (true);
drop policy if exists "Teachers can update profiles" on public.profiles;
revoke all on public.profiles from anon, public, authenticated;
grant select on public.profiles to authenticated;

drop policy if exists "Authenticated users can read notices" on public.notices;
create policy "Authenticated users can read notices"
  on public.notices for select to authenticated using (true);
drop policy if exists "CRs and teachers can insert notices" on public.notices;
create policy "CRs and teachers can insert notices"
  on public.notices for insert to authenticated
  with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can update notices" on public.notices;
create policy "CRs and teachers can update notices"
  on public.notices for update to authenticated
  using ((select public.is_portal_poster()))
  with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can delete notices" on public.notices;
create policy "CRs and teachers can delete notices"
  on public.notices for delete to authenticated
  using (
    created_by = (select auth.uid())
    or (select public.current_user_has_any_role(array['owner']::text[]))
  );
revoke all on public.notices from anon, public, authenticated;
grant select, insert, update, delete on public.notices to authenticated;

drop policy if exists "Authenticated users can read assignments" on public.assignments;
create policy "Authenticated users can read assignments"
  on public.assignments for select to authenticated using (true);
drop policy if exists "CRs and teachers can insert assignments" on public.assignments;
create policy "CRs and teachers can insert assignments"
  on public.assignments for insert to authenticated
  with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can update assignments" on public.assignments;
create policy "CRs and teachers can update assignments"
  on public.assignments for update to authenticated
  using ((select public.is_portal_poster()))
  with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can delete assignments" on public.assignments;
create policy "CRs and teachers can delete assignments"
  on public.assignments for delete to authenticated
  using ((select public.is_portal_poster()));
revoke all on public.assignments from anon, public, authenticated;
grant select, insert, update, delete on public.assignments to authenticated;

drop policy if exists "Authenticated users can read timetable" on public.timetable;
create policy "Authenticated users can read timetable"
  on public.timetable for select to authenticated using (true);
drop policy if exists "CRs and teachers can insert timetable" on public.timetable;
create policy "CRs and teachers can insert timetable"
  on public.timetable for insert to authenticated
  with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can update timetable" on public.timetable;
create policy "CRs and teachers can update timetable"
  on public.timetable for update to authenticated
  using ((select public.is_portal_poster()))
  with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can delete timetable" on public.timetable;
create policy "CRs and teachers can delete timetable"
  on public.timetable for delete to authenticated
  using ((select public.is_portal_poster()));
revoke all on public.timetable from anon, public, authenticated;
grant select, insert, update, delete on public.timetable to authenticated;

drop policy if exists "Authenticated users can read the current timetable image" on public.portal_timetable_images;
create policy "Authenticated users can read the current timetable image"
  on public.portal_timetable_images for select to authenticated using (true);
revoke all on public.portal_timetable_images from anon, public, authenticated;
grant select on public.portal_timetable_images to authenticated;

drop policy if exists "Authenticated users can view timetable images" on storage.objects;
create policy "Authenticated users can view timetable images"
  on storage.objects for select to authenticated
  using (bucket_id = 'timetable-images');
drop policy if exists "Technical team and owners can upload timetable images" on storage.objects;
create policy "Technical team and owners can upload timetable images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'timetable-images'
    and (storage.foldername(name))[1] = 'published'
    and (select public.current_user_has_any_role(array['technical_team', 'owner']::text[]))
  );
drop policy if exists "Technical team and owners can delete timetable images" on storage.objects;
create policy "Technical team and owners can delete timetable images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'timetable-images'
    and (storage.foldername(name))[1] = 'published'
    and (select public.current_user_has_any_role(array['technical_team', 'owner']::text[]))
  );

drop policy if exists "Users can read their own notifications" on public.user_notifications;
create policy "Users can read their own notifications"
  on public.user_notifications for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.user_notifications from anon, public, authenticated;
grant select on public.user_notifications to authenticated;

drop policy if exists "Users can read their own support threads" on public.support_threads;
create policy "Users can read their own support threads"
  on public.support_threads for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.current_user_has_any_role(array['technical_team', 'owner']::text[]))
  );
drop policy if exists "Users can open support threads" on public.support_threads;
create policy "Users can open support threads"
  on public.support_threads for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Support staff can update support threads" on public.support_threads;
create policy "Support staff can update support threads"
  on public.support_threads for update to authenticated
  using ((select public.current_user_has_any_role(array['technical_team', 'owner']::text[])))
  with check ((select public.current_user_has_any_role(array['technical_team', 'owner']::text[])));
revoke all on public.support_threads from anon, public, authenticated;
grant select, insert on public.support_threads to authenticated;
grant update (status) on public.support_threads to authenticated;

drop policy if exists "Thread participants can read unexpired messages" on public.support_messages;
create policy "Thread participants can read unexpired messages"
  on public.support_messages for select to authenticated
  using (
    expires_at > now()
    and exists (
      select 1 from public.support_threads as t
      where t.id = thread_id
        and (
          t.user_id = (select auth.uid())
          or (select public.current_user_has_any_role(array['technical_team', 'owner']::text[]))
        )
    )
  );
drop policy if exists "Thread participants can reply" on public.support_messages;
create policy "Thread participants can reply"
  on public.support_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.support_threads as t
      where t.id = thread_id
        and t.status <> 'closed'
        and (
          t.user_id = (select auth.uid())
          or (select public.current_user_has_any_role(array['technical_team', 'owner']::text[]))
        )
    )
  );
revoke all on public.support_messages from anon, public, authenticated;
grant select, insert on public.support_messages to authenticated;

drop policy if exists "Anyone can read maintenance status" on public.portal_settings;
create policy "Anyone can read maintenance status"
  on public.portal_settings for select to anon, authenticated using (singleton);
revoke all on public.portal_settings from public, anon, authenticated;
grant select on public.portal_settings to anon, authenticated;

drop policy if exists "Owners can read staff audit log" on public.staff_audit_log;
create policy "Owners can read staff audit log"
  on public.staff_audit_log for select to authenticated
  using ((select public.current_user_has_any_role(array['owner']::text[])));
revoke all on public.staff_audit_log from anon, public, authenticated;
grant select on public.staff_audit_log to authenticated;

revoke all on function public.current_user_has_any_role(text[]) from public, anon;
grant execute on function public.current_user_has_any_role(text[]) to authenticated;
revoke all on function public.is_portal_poster() from public, anon;
grant execute on function public.is_portal_poster() to authenticated;
revoke all on function public.create_student_profile() from public, anon, authenticated;
revoke all on function public.stamp_portal_notice() from public, anon, authenticated;
revoke all on function public.guard_notice_admin_fields() from public, anon, authenticated;
revoke all on function public.create_notice_inbox_notifications() from public, anon, authenticated;
revoke all on function public.stamp_portal_assignment() from public, anon, authenticated;
revoke all on function public.stamp_timetable_class() from public, anon, authenticated;
revoke all on function public.update_support_thread_timestamp() from public, anon, authenticated;
revoke all on function public.validate_support_message() from public, anon, authenticated;

revoke all on function public.create_support_thread(text, text) from public, anon;
grant execute on function public.create_support_thread(text, text) to authenticated;
revoke all on function public.set_support_thread_status(uuid, text) from public, anon;
grant execute on function public.set_support_thread_status(uuid, text) to authenticated;
revoke all on function public.change_profile_role(uuid, text) from public, anon;
grant execute on function public.change_profile_role(uuid, text) to authenticated;
revoke all on function public.change_profile_roles(uuid, text[]) from public, anon;
grant execute on function public.change_profile_roles(uuid, text[]) to authenticated;
revoke all on function public.list_portal_users() from public, anon;
grant execute on function public.list_portal_users() to authenticated;
revoke all on function public.update_my_profile(text, text, text, text, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text, text, text) to authenticated;
revoke all on function public.publish_timetable_week(jsonb, smallint, text, date, date, text) from public, anon;
grant execute on function public.publish_timetable_week(jsonb, smallint, text, date, date, text) to authenticated;
revoke all on function public.publish_timetable_image(text, text) from public, anon;
grant execute on function public.publish_timetable_image(text, text) to authenticated;
revoke all on function public.set_portal_maintenance(boolean, text) from public, anon;
grant execute on function public.set_portal_maintenance(boolean, text) to authenticated;
revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

-- Seven-day retention is enforced by RLS immediately, and pg_cron physically
-- deletes expired chat messages every 15 minutes on Supabase projects.
create extension if not exists pg_cron with schema pg_catalog;
do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'fussthub-expire-support-messages';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'fussthub-expire-support-messages',
    '*/15 * * * *',
    $job$delete from public.support_messages where expires_at <= now();$job$
  );
end;
$$;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'user_notifications'
    ) then
      alter publication supabase_realtime add table public.user_notifications;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'support_threads'
    ) then
      alter publication supabase_realtime add table public.support_threads;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'support_messages'
    ) then
      alter publication supabase_realtime add table public.support_messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'portal_settings'
    ) then
      alter publication supabase_realtime add table public.portal_settings;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'portal_timetable_images'
    ) then
      alter publication supabase_realtime add table public.portal_timetable_images;
    end if;
  end if;
end;
$$;
