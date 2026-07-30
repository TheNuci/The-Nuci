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

-- Link each profile to its auth user. Existing rows keep working (user_id fills in on
-- their next authenticated write); new rows get it immediately.
alter table public.profiles add column if not exists user_id uuid;
create index if not exists idx_profiles_user_id on public.profiles(user_id);

-- ── Ownership-based Row Level Security ──
-- The anon key is public (it ships in the browser), so "using (true)" would let anyone
-- read or edit every profile. Instead we scope every operation to the CALLER'S OWN row,
-- identified from their verified login JWT:
--   * auth.uid()  = the logged-in user's id
--   * auth.jwt()->>'email' = the logged-in user's email
-- A row is "yours" if its user_id matches your uid, OR (for older rows created before
-- user_id existed) its email matches your token's email. Anonymous, unauthenticated
-- callers match nothing and therefore see nothing.
drop policy if exists "anon can read profiles"   on public.profiles;
drop policy if exists "anon can insert profiles"  on public.profiles;
drop policy if exists "anon can update profiles"  on public.profiles;
drop policy if exists "anon can upsert profiles"  on public.profiles;
drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile insert" on public.profiles;
drop policy if exists "own profile update" on public.profiles;

create policy "own profile read" on public.profiles
  for select using (
    auth.uid() = user_id
    or (auth.jwt() ->> 'email') = email
  );

create policy "own profile insert" on public.profiles
  for insert with check (
    auth.uid() = user_id
    or (auth.jwt() ->> 'email') = email
  );

create policy "own profile update" on public.profiles
  for update using (
    auth.uid() = user_id
    or (auth.jwt() ->> 'email') = email
  ) with check (
    auth.uid() = user_id
    or (auth.jwt() ->> 'email') = email
  );

-- Deletes are handled server-side by the delete-user function (service role), which now
-- verifies the caller's token first. No client delete policy is granted.

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
