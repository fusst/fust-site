create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  degree text not null default 'BSSE',
  semester smallint not null default 5 check (semester between 1 and 8),
  section text not null default 'A',
  role text not null default 'student' check (role in ('student', 'cr', 'teacher')),
  created_at timestamptz not null default now()
);

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  category text not null default 'academic' check (category in ('academic', 'events', 'urgent')),
  author_name text not null default '',
  is_pinned boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

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

create table if not exists public.timetable (
  id uuid primary key default gen_random_uuid(),
  course_code text not null check (char_length(trim(course_code)) between 1 and 30),
  course_name text not null check (char_length(trim(course_name)) between 1 and 120),
  instructor text not null default '',
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  room text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists notices_created_at_idx on public.notices (created_at desc);
create index if not exists assignments_due_at_idx on public.assignments (due_at);
create index if not exists timetable_day_time_idx on public.timetable (day_of_week, start_time);

create or replace function public.is_portal_poster()
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
      and role in ('cr', 'teacher')
  );
$$;

create or replace function public.create_student_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;
create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute function public.create_student_profile();

alter table public.profiles enable row level security;
alter table public.notices enable row level security;
alter table public.assignments enable row level security;
alter table public.timetable enable row level security;

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Teachers can update profiles" on public.profiles;
create policy "Teachers can update profiles"
  on public.profiles for update to authenticated
  using (
    exists (
      select 1 from public.profiles as actor
      where actor.id = (select auth.uid()) and actor.role = 'teacher'
    )
  )
  with check (
    exists (
      select 1 from public.profiles as actor
      where actor.id = (select auth.uid()) and actor.role = 'teacher'
    )
  );

drop policy if exists "Authenticated users can read notices" on public.notices;
create policy "Authenticated users can read notices"
  on public.notices for select to authenticated using (true);
drop policy if exists "CRs and teachers can insert notices" on public.notices;
create policy "CRs and teachers can insert notices"
  on public.notices for insert to authenticated with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can update notices" on public.notices;
create policy "CRs and teachers can update notices"
  on public.notices for update to authenticated
  using ((select public.is_portal_poster()))
  with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can delete notices" on public.notices;
create policy "CRs and teachers can delete notices"
  on public.notices for delete to authenticated using ((select public.is_portal_poster()));

drop policy if exists "Authenticated users can read assignments" on public.assignments;
create policy "Authenticated users can read assignments"
  on public.assignments for select to authenticated using (true);
drop policy if exists "CRs and teachers can insert assignments" on public.assignments;
create policy "CRs and teachers can insert assignments"
  on public.assignments for insert to authenticated with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can update assignments" on public.assignments;
create policy "CRs and teachers can update assignments"
  on public.assignments for update to authenticated
  using ((select public.is_portal_poster()))
  with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can delete assignments" on public.assignments;
create policy "CRs and teachers can delete assignments"
  on public.assignments for delete to authenticated using ((select public.is_portal_poster()));

drop policy if exists "Authenticated users can read timetable" on public.timetable;
create policy "Authenticated users can read timetable"
  on public.timetable for select to authenticated using (true);
drop policy if exists "CRs and teachers can insert timetable" on public.timetable;
create policy "CRs and teachers can insert timetable"
  on public.timetable for insert to authenticated with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can update timetable" on public.timetable;
create policy "CRs and teachers can update timetable"
  on public.timetable for update to authenticated
  using ((select public.is_portal_poster()))
  with check ((select public.is_portal_poster()));
drop policy if exists "CRs and teachers can delete timetable" on public.timetable;
create policy "CRs and teachers can delete timetable"
  on public.timetable for delete to authenticated using ((select public.is_portal_poster()));

revoke all on public.profiles, public.notices, public.assignments, public.timetable
  from anon, public;
revoke all on public.profiles, public.notices, public.assignments, public.timetable
  from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, degree, semester, section, role) on public.profiles to authenticated;
grant select, insert, update, delete on public.notices, public.assignments, public.timetable
  to authenticated;

revoke all on function public.is_portal_poster() from public, anon;
grant execute on function public.is_portal_poster() to authenticated;
revoke all on function public.create_student_profile() from public, anon, authenticated;
