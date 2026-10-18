# FUSST Hub Supabase setup

## 1. Apply the database migration

In your Supabase project, open **SQL Editor → New query**, paste the full contents of [`schema.sql`](./schema.sql), and run it. The migration upgrades existing single-role profiles to role arrays, preserves existing timetable rows, and configures RLS, notices, inbox notifications, support retention, member profiles and profile-photo storage, and versioned timetables. FUSST Hub is designed for one BSSE class community; its member directory and class updates are for that cohort, not a university-wide directory.

The cleanup job requires the Supabase `pg_cron` extension. Supabase projects generally make this extension available by default; if the migration reports that it is unavailable, enable **Database → Extensions → pg_cron** and rerun the script.

## 2. Bootstrap the first owner

1. Open your website and create an account using the email you want as the portal owner.
2. Confirm your email and sign in at least once so Supabase creates your profile.
3. In **Supabase → SQL Editor**, open [`bootstrap-owner.sql`](./bootstrap-owner.sql), replace `OWNER_LOGIN_EMAIL` with that Supabase Auth email, and run the script once. Keep the real address out of source control.
4. Sign out and sign back in. Your verified account will now have a **Staff console**.

This one-time bootstrap must be run by the Supabase project owner in the SQL Editor. Public sign-up and the browser role-preview control cannot create an owner.

## 3. Give users access

Sign into the portal with the bootstrapped owner account. Open **Staff console → People & roles** and select any combination of roles for a registered account:

- **Student:** standard read access and access to their own support conversations.
- **Class Representative:** can publish notices, assignments, and timetable updates.
- **Teacher:** can publish notices, assignments, and timetable updates.
- **Technical Team:** can access the private support queue and reply to users.
- **Portal Owner:** full administration, custom notices, role management, and maintenance controls.

New accounts always start as students. The owner-only `change_profile_roles` database function validates role assignments, blocks removal of the last owner, and records each change in the owner activity log. Existing CRs and teachers retain their access after migration. The older single-role `change_profile_role` RPC remains as a compatibility wrapper.

**Roles & Members** groups authenticated member profiles by each of their assigned roles, in this order: Portal Owner, Technical Team, Teacher, Class Representative, and Student. Members can edit their own display name, headline, bio, LinkedIn profile, and profile photo. Photos can be JPG, PNG, or WebP up to 5 MB; they are stored in a private `profile-photos` bucket and shown with expiring signed URLs to signed-in members. Each account can upload or delete only files under its own account folder. Email addresses and role-management controls are not shown there. Profile-photo uploads require the latest schema migration; existing text profile edits remain supported before the migration is applied.

## 4. Use the portal

- **Inbox:** every published notice automatically creates a private in-app notification for each account that matches the notice audience. Sign in to see read/unread status and live updates.
- **Technical support:** signed-in users can report an issue; only that user and the technical team/owner can read or reply to the conversation. Each message is hidden immediately after seven days and physically purged by the scheduled database job.
- **Notices:** CRs, teachers, and owners can publish. The database stamps the author's verified roles. Authors can delete their own notices; only an owner can delete anyone's. Owners can also choose an audience, set a custom official display name, and pin notices. Notifications stay in the in-app inbox; email delivery is not configured.
- **Timetable:** select a view date, semester, and section. Authorized publishers can paste up to 100 CSV rows to publish a complete schedule in one database transaction. Set an effective date range and weekly, odd-week, or even-week recurrence. Replacing an overlapping schedule preserves the older timetable records up to the new effective date. CSV columns: `day,course_code,course_name,start_time,end_time,instructor,room` (24-hour times; Sunday through Saturday or 0–6).
- **Maintenance:** Supabase `portal_settings` is the source of truth. Only the owner-only `set_portal_maintenance` RPC can change it; local browser state and role previews cannot activate maintenance mode. If settings cannot be read, the portal shows a connection error rather than assuming a status.
- **Android app:** the mobile dashboard includes a dismissible download notice for [`downloads/fusst-hub.apk`](../downloads/fusst-hub.apk). Download and install the APK on Android; approve the Android “install unknown apps” prompt for your browser if required. Android push alerts depend on the APK’s Firebase project and notification backend being configured separately; the portal’s in-app inbox does not itself send Android push notifications.

## Data and security notes

- Only authenticated accounts can read member, notice, assignment, and timetable data.
- RLS applies role checks in Postgres; hiding or previewing controls in the frontend does not grant access.
- The browser must contain only the Supabase project URL and **anon/publishable** key. Never place a service-role key or database password in `js/config.js`.
- Apply schema changes in the Supabase SQL Editor; the frontend cannot execute database migrations.
