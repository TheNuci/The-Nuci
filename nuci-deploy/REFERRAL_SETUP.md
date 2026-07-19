# Referral sistem — navodila za zagon (live)

Referral šteje **samo potrjene nakupe**, nikoli same registracije.

## Kako deluje (tok)

1. Uporabnik A deli svoj link `thenuci.com/?ref=nuciXXXXXX` (ali QR kodo iz profila).
2. Uporabnik B pride prek tega linka → koda se shrani lokalno (localStorage).
3. Ko se B registrira → v Supabase se pri B zapiše `referred_by = nuciXXXXXX`.
4. Ko B **plača** (Stripe potrdi) → webhook poveča `referral_count` pri A za 1.
5. A vidi posodobljen števec v profilu; pri 5/8/10 doseže nagrado (€10/€20/€30).

Registracija brez nakupa **ne** poveča števca.

## 1) Supabase

Zaženi posodobljeno shemo `supabase_schema.sql` v Supabase SQL editorju.
Doda: `referral_code`, `referred_by`, `referral_count`, `referral_rewarded_at`
in funkcijo `increment_referral()`.

## 2) Netlify — okoljske spremenljivke

V Netlify → Site settings → Environment variables dodaj (če jih še ni):

- `SUPABASE_URL` — URL projekta
- `THE_NUCI_SUPABASE_SERVICE_ROLE_KEY` — service_role skrivni ključ (samo strežnik)
- `STRIPE_SECRET_KEY` — Stripe secret (sk_live_… za pravi denar)
- `STRIPE_WEBHOOK_SECRET` — dobiš v koraku 3 (whsec_…)

## 3) Stripe webhook

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**
2. URL: `https://thenuci.com/.netlify/functions/stripe-webhook`
3. Event: **checkout.session.completed**
4. Po kreiranju kopiraj **Signing secret** (whsec_…) → daj v Netlify kot `STRIPE_WEBHOOK_SECRET`

## 4) Payment Links — pomembno

Na vsakem Stripe Payment Linku vklopi **"Collect customer email"**.
Webhook uporablja kupčev email, da najde njegov profil (in s tem `referred_by`).

Brez emaila povezava kupec ↔ referrer ne deluje.

## Izplačilo nagrad

Ko A doseže tier, mu nagrado izplačaš **ročno** (npr. Stripe kupon / popust / nakazilo).
V bazi lahko zabeležiš `referral_rewarded_at`, da veš, komu si že izplačal.
Lahko kasneje avtomatiziramo, a za začetek je ročno najbolj varno.

## Test (priporočeno pred live)

1. Uporabi Stripe **test** ključe + test Payment Link.
2. Registriraj testnega userja B prek `?ref=` linka userja A.
3. Opravi testni nakup kot B (Stripe test kartica 4242 4242 4242 4242).
4. Preveri, da se `referral_count` pri A poveča za 1.
5. Ponovni nakup istega B **ne sme** znova povečati (webhook to prepreči).
