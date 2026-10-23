// Plain, accessible transactional email templates.
const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function actionEmail(opts: { heading: string; intro: string; actionLabel: string; url: string; footer?: string }) {
  const text = `${opts.heading}\n\n${opts.intro}\n\n${opts.actionLabel}: ${opts.url}\n\n${opts.footer ?? ""}`.trim();
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f4;font-family:Inter,Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="font-size:13px;letter-spacing:.08em;font-weight:700">RGXM</td></tr>
<tr><td style="padding-top:24px;font-size:20px;font-weight:600">${escape(opts.heading)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.55;color:#3f3f46">${escape(opts.intro)}</td></tr>
<tr><td style="padding-top:24px"><a href="${escape(opts.url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px">${escape(opts.actionLabel)}</a></td></tr>
<tr><td style="padding-top:24px;font-size:12px;line-height:1.5;color:#71717a">${escape(opts.footer ?? "")}<br>If the button doesn't work, paste this link into your browser:<br>${escape(opts.url)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
