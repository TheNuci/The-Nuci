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
drop policy if exists "anon can insert profiles" on public.profiles;
create policy "anon can insert profiles" on public.profiles
  for insert with check (true);

drop policy if exists "anon can update profiles" on public.profiles;
create policy "anon can update profiles" on public.profiles
  for update using (true) with check (true);

-- ============ (referral system removed) ============
-- The referral/ambassador feature was removed. Existing referral_* columns, if any,
-- are simply left unused - no need to drop them. Nothing here creates them anymore.

-- ============ MARKETING CONSENT (GDPR Art. 6(1)(a)) ============
-- Separate, opt-in consent for educational/marketing emails. Never implied by signup.
-- marketing_consent_at records WHEN consent was given, which is required as proof.
alter table public.profiles add column if not exists marketing_consent boolean default false;
alter table public.profiles add column if not exists marketing_consent_at timestamptz;

create index if not exists idx_profiles_marketing_consent on public.profiles(marketing_consent);

-- Tip email scheduling (educational emails, consent-only)
alter table public.profiles add column if not exists last_tip_sent timestamptz;
alter table public.profiles add column if not exists tip_index int default 0;

-- Third abandoned-cart nudge (5 days after signup)
alter table public.profiles add column if not exists cart_nudge3_sent boolean default false;
