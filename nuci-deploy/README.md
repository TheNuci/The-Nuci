# The Nuci

AI-powered 7-day pet behaviour plans. Single-file frontend (`index.html`) + 3 Netlify serverless functions + Supabase + Stripe.

## What's in here
- `index.html` — the whole app (UI + logic, single file)
- `netlify/functions/generate-plan.js` — builds the 7-day plan from the questionnaire (Claude Haiku). Falls back to a built-in template if no API key.
- `netlify/functions/regenerate-day.js` — adapts the next day after each check-in.
- `netlify/functions/welcome-email.js` — sends a welcome email via Resend (skipped silently if no key).
- `netlify.toml`, `package.json` — Netlify config (Node 18+, esbuild bundler).
- `supabase_schema.sql` — the `profiles` table + RLS policies.
- `.env.example` — the environment variables you need.

## Deploy (Netlify)
1. Push this folder to a Git repo and "Import from Git" in Netlify (or drag-and-drop the folder in the Netlify UI).
2. In **Site settings → Environment variables**, set:
   - `ANTHROPIC_API_KEY` (required for real AI plans; without it you get the template plan)
   - `CLAUDE_MODEL` (optional, defaults to `claude-haiku-4-5-20251001`)
   - `RESEND_API_KEY` + `WELCOME_FROM` (optional, for welcome emails)
3. Deploy. Functions are auto-served at `/.netlify/functions/*` — no extra config.

## Supabase
1. Create a project (or use the existing one referenced in `index.html`).
2. Run `supabase_schema.sql` in the SQL editor.
3. The URL + anon key are already set near the top of `index.html`. If you use a new project, update `SUPABASE_URL` and `SUPABASE_ANON_KEY` there.

## Stripe
- Payment links live in `index.html` (`STRIPE_PAYMENT_LINK`, `_3PACK`, `_5PACK`). They're currently **test-mode** links.
- Before launch: create **live** payment links, add the missing **5-pack** link, and set each link's success URL to `https://YOURDOMAIN/?paid=true`.

## Before launch checklist
- [ ] Swap Stripe test links → live links; add the 5-pack link.
- [ ] Set `ANTHROPIC_API_KEY` in Netlify.
- [ ] Run `supabase_schema.sql`.
- [ ] Hide the preview/demo entries (the "Preview the app", "Skip straight to the app", "Skip for now", questionnaire **Skip** button). They currently let anyone bypass signup/payment.
- [ ] Add a Terms line about digital-content / right-of-withdrawal (EU) if you keep no-refunds.

## Local preview
Open `index.html?demo=1` in a browser to walk the whole app without a backend (uses the template plan + skips Stripe).
