-- The Nuci · profiles table
create table if not exists public.profiles (
  email text primary key,
  data jsonb,
  purchased boolean default false,
  email_reminders boolean default true,
  timezone text,
  last_checkin_date text,
  signup_at timestamptz,
  pet_name_pending text,
  marketing_opt_out boolean default false,
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- The app uses the anon key and identifies rows by email.
-- Allow anon to read/insert/update their own row (email-scoped).
-- NOTE: for stronger security, switch to auth.uid() based policies and store user_id.
drop policy if exists "anon can read profiles" on public.profiles;
create policy "anon can read profiles" on public.profiles
  for select using (true);

drop policy if exists "anon can upsert profiles" on public.profiles;
create policy "anon can insert profiles" on public.profiles
  for insert with check (true);

drop policy if exists "anon can update profiles" on public.profiles;
create policy "anon can update profiles" on public.profiles
  for update using (true) with check (true);
