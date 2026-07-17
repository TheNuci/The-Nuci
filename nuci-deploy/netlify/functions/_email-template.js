// Shared premium email template for The Nuci (forest-editorial, matches the app).
// All emails use emailShell(...) so branding + unsubscribe footer stay consistent.
const C = { bg:'#F2F1EC', card:'#FBFBF8', ink:'#1A211C', sec:'#5C6660', sage:'#6B8F71', forest:'#3E5A47', border:'#E6E3DA' };

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function button(label, href){
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0"><tr>
    <td style="background:${C.forest};border-radius:14px"><a href="${href}" style="display:inline-block;padding:14px 26px;font-family:Arial,sans-serif;font-size:15px;color:#F4F1E9;text-decoration:none;font-weight:bold">${esc(label)}</a></td></tr></table>`;
}
function accent(t){ return `<span style="font-family:Georgia,serif;font-style:italic;color:${C.forest}">${esc(t)}</span>`; }
function eyebrow(t){ return `<div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${C.sage};font-family:Arial,sans-serif;font-weight:bold">${esc(t)}</div>`; }
function h1(html){ return `<h1 style="margin:8px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.15;font-weight:normal;color:${C.ink};letter-spacing:-0.01em">${html}</h1>`; }
function para(t,mt){ return `<p style="margin:${mt==null?14:mt}px 0 0;font-size:15px;line-height:1.6;color:${C.sec};font-family:Arial,sans-serif">${t}</p>`; }
function heroBlock(tag, titleHtml, bodyHtml){
  return `<tr><td style="padding:30px 30px 26px">${eyebrow(tag)}${h1(titleHtml)}${bodyHtml}</td></tr>`;
}
function infoBox(innerHtml){
  return `<tr><td style="padding:0 30px 30px"><table role="presentation" width="100%" style="background:${C.bg};border-radius:14px" cellpadding="0" cellspacing="0"><tr><td style="padding:16px 18px">${innerHtml}</td></tr></table></td></tr>`;
}

// unsubscribeUrl: pass the real per-user unsubscribe link. If omitted, a mailto fallback is used.
function emailShell({ preheader='', inner='', unsubscribeUrl='' }){
  const unsub = unsubscribeUrl || 'mailto:hello@thenuci.com?subject=Unsubscribe';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>The Nuci</title></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:28px 0">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%">
      <tr><td style="padding:4px 32px 24px">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:25px;font-weight:400;letter-spacing:-0.01em"><span style="color:${C.sage}">The</span> <span style="color:${C.ink}">Nuci</span><span style="color:${C.sage}">.</span></div>
      </td></tr>
      <tr><td style="padding:0 20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.border};border-radius:22px;overflow:hidden">
          ${inner}
        </table>
      </td></tr>
      <tr><td style="padding:24px 32px 28px">
        <div style="height:1px;background:${C.border};margin:0 0 18px"></div>
        <p style="margin:0;font-size:12px;line-height:1.7;color:${C.sec};font-family:Arial,sans-serif">
          The Nuci, behaviour plans for calmer pets. Contact us at <a href="mailto:hello@thenuci.com" style="color:${C.sec}">hello@thenuci.com</a>. You're receiving this because you have a plan with The Nuci. <a href="${unsub}" style="color:${C.sage};text-decoration:underline">Unsubscribe</a> from these emails.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

module.exports = { C, esc, button, accent, eyebrow, h1, para, heroBlock, infoBox, emailShell };
