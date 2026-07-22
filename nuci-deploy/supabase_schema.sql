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

-- ============ REFERRALS ============
-- who referred this user (their referral code), and how many CONFIRMED PURCHASES
-- this user has driven. referral_count only ever increments on a real purchase.
alter table public.profiles add column if not exists referral_code text unique;
alter table public.profiles add column if not exists referred_by text;   -- referrer's referral_code
alter table public.profiles add column if not exists referral_count int default 0;
alter table public.profiles add column if not exists referral_rewarded_at timestamptz;

create index if not exists idx_profiles_referral_code on public.profiles(referral_code);
create index if not exists idx_profiles_referred_by on public.profiles(referred_by);

-- Atomic increment of a referrer's count. Called by the server (service role) ONLY
-- after a purchase is confirmed. Returns the new count.
create or replace function public.increment_referral(referrer_code text)
returns int
language plpgsql
security definer
as $$
declare
  new_count int;
begin
  update public.profiles
     set referral_count = coalesce(referral_count,0) + 1,
         updated_at = now()
   where referral_code = referrer_code
   returning referral_count into new_count;
  return new_count;
end;
$$;

-- ============ MARKETING CONSENT (GDPR Art. 6(1)(a)) ============
-- Separate, opt-in consent for educational/marketing emails. Never implied by signup.
-- marketing_consent_at records WHEN consent was given, which is required as proof.
alter table public.profiles add column if not exists marketing_consent boolean default false;
alter table public.profiles add column if not exists marketing_consent_at timestamptz;

create index if not exists idx_profiles_marketing_consent on public.profiles(marketing_consent);

-- Tip email scheduling (educational emails, consent-only)
alter table public.profiles add column if not exists last_tip_sent timestamptz;
alter table public.profiles add column if not exists tip_index int default 0;
