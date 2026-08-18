// Scheduled weekly (Sunday 03:00 UTC, see netlify.toml).
// Exports the ENTIRE profiles table as gzipped JSON and emails it to you as an
// attachment - a "someone ran the wrong SQL" insurance policy that costs nothing.
// Restore = unzip the .json.gz and upsert the rows back (each row carries its email key).

import { gzipSync } from 'node:zlib';

const SUPABASE_URL = process.env.THE_NUCI_SUPABASE_URL || 'https://dsuiqkcjfayazzvfwdqk.supabase.co';
const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.THE_NUCI_RESEND_API_KEY;
const BACKUP_TO = process.env.THE_NUCI_BACKUP_EMAIL || 'hello@thenuci.com';
const FROM = 'The Nuci <team@thenuci.com>';

export default async (req) => {
  if (!SERVICE_KEY || !RESEND_API_KEY) {
    return new Response('missing env (service key / resend key)', { status: 200 });
  }

  // Pull every row, paged so it also works when the table grows.
  const all = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*&order=email.asc`, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Range-Unit': 'items',
        'Range': `${from}-${from + PAGE - 1}`
      }
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('backup fetch failed', res.status, t.slice(0, 200));
      return new Response('fetch failed', { status: 200 });
    }
    const page = await res.json();
    all.push(...page);
    if (!Array.isArray(page) || page.length < PAGE) break;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const json = JSON.stringify({ exported_at: new Date().toISOString(), rows: all.length, profiles: all });
  const gz = gzipSync(Buffer.from(json, 'utf8'));
  const sizeKb = Math.round(gz.length / 1024);

  // Resend attachment limit is ~40MB; warn instead of failing if we ever get close.
  if (gz.length > 30 * 1024 * 1024) {
    console.error(`backup too large to email (${sizeKb} KB) - switch to storage-bucket backups`);
    await sendMail(`⚠️ The Nuci backup too large (${sizeKb} KB)`,
      `<p>The weekly profiles backup is now ${sizeKb} KB gzipped - too big to email safely. Time to switch backups to a storage bucket or enable Supabase PITR.</p>`, null, null);
    return new Response('too large', { status: 200 });
  }

  const ok = await sendMail(
    `The Nuci weekly backup - ${all.length} profiles (${stamp})`,
    `<p>Attached: full <b>profiles</b> table export, ${all.length} rows, ${sizeKb} KB gzipped JSON.</p>
     <p>Restore: gunzip the file, then upsert the <code>profiles</code> array back into the table (conflict key: email).</p>`,
    `nuci-profiles-backup-${stamp}.json.gz`,
    gz.toString('base64')
  );

  console.log(`backup: ${all.length} rows, ${sizeKb} KB, emailed=${ok}`);
  return new Response(`ok rows=${all.length} kb=${sizeKb}`, { status: 200 });
};

async function sendMail(subject, html, filename, base64) {
  try {
    const body = { from: FROM, to: [BACKUP_TO], subject, html };
    if (filename && base64) body.attachments = [{ filename, content: base64 }];
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) console.error('backup mail failed', res.status, (await res.text().catch(() => '')).slice(0, 200));
    return res.ok;
  } catch (e) { console.error('backup mail error', String(e)); return false; }
}

export const config = { schedule: '0 3 * * 0' };
