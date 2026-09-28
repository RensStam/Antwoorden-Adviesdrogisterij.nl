// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function "mail": koppeling tussen de app en de eigen mailbox (IMAP).
//
// De app stuurt bij elk verzoek het toegangsbewijs van de kluis mee (afgeleid van het app-wachtwoord).
// Deze functie controleert dat eerst bij de database en logt pas daarna in op de mailbox. De inloggegevens
// van de mailbox staan alleen als geheime instellingen (Secrets) in Supabase, nooit in de app of in de code.
//
// Acties: ping (verbinding testen), list (inbox), get (één mail lezen), draft (antwoord als concept opslaan).
// Mails worden alleen gelezen (niet als gelezen gemarkeerd, niet verplaatst of verwijderd).
//
// Secrets (Supabase → Edge Functions → Secrets):
//   IMAP_HOST               bijv. mail.adviesdrogisterij.nl
//   IMAP_PORT               993 (standaard, SSL/TLS) of 143 (STARTTLS)
//   IMAP_USER               bijv. info@adviesdrogisterij.nl
//   IMAP_PASSWORD           het wachtwoord van de mailbox
//   MAIL_FROM_NAME          (optioneel) afzendernaam in concepten, standaard "Adviesdrogisterij.nl"
//   MAIL_FROM               (optioneel) afzenderadres in concepten, standaard IMAP_USER
//   IMAP_DRAFTS             (optioneel) naam van de conceptenmap, als die niet vanzelf wordt gevonden
//   IMAP_ALLOW_SELF_SIGNED  (optioneel) "true" als de mailserver een eigen (niet-officieel) certificaat heeft
//   IMAP_SECURE             (optioneel) "false" om STARTTLS te gebruiken op een andere poort dan 143

import { ImapFlow } from 'npm:imapflow@1.7.8';
import PostalMime from 'npm:postal-mime@2.7.6';

const env = (k: string) => Deno.env.get(k) ?? '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

class UserError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// ---------- toegang: alleen met een geldig toegangsbewijs van de kluis ----------
async function verify(token: string, apikey: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new UserError('Niet ingelogd in de app.', 401);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey };
  if (apikey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + apikey; // oude JWT-sleutels
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/vault_verify`, {
    method: 'POST', headers, body: JSON.stringify({ p_token: token }),
  });
  if (r.ok) return;
  const t = await r.text();
  if (/invalid_token/.test(t)) throw new UserError('Toegang geweigerd: log opnieuw in in de app.', 401);
  if (/vault_verify/.test(t)) throw new UserError('Voer eerst het bijgewerkte supabase/setup.sql uit in Supabase.', 500);
  throw new UserError('Controle bij de database mislukt: ' + t.slice(0, 200), 502);
}

// ---------- verbinding met de mailbox ----------
function imap() {
  if (!env('IMAP_HOST') || !env('IMAP_USER') || !env('IMAP_PASSWORD')) {
    throw new UserError('De mailbox is nog niet ingesteld: vul IMAP_HOST, IMAP_USER en IMAP_PASSWORD in bij de Secrets van Supabase.', 500);
  }
  const port = Number(env('IMAP_PORT') || 993);
  return new ImapFlow({
    host: env('IMAP_HOST'),
    port,
    // Standaard direct versleuteld (SSL/TLS); alleen poort 143 (of IMAP_SECURE=false) gebruikt STARTTLS
    secure: env('IMAP_SECURE') ? env('IMAP_SECURE') !== 'false' : port !== 143,
    auth: { user: env('IMAP_USER'), pass: env('IMAP_PASSWORD') },
    tls: { rejectUnauthorized: env('IMAP_ALLOW_SELF_SIGNED') !== 'true' },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

function connectError(e: any): string {
  const m = String(e?.message || e), code = String(e?.code || '');
  if (e?.authenticationFailed || /AUTHENTICATIONFAILED|authentication failed|invalid credentials|LOGIN failed/i.test(m)) {
    return 'Inloggen op de mailserver mislukt: controleer IMAP_USER en IMAP_PASSWORD.';
  }
  if (code === 'ENOTFOUND' || /ENOTFOUND|getaddrinfo|failed to lookup|dns error/i.test(m)) {
    return `Mailserver "${env('IMAP_HOST')}" niet gevonden: controleer IMAP_HOST.`;
  }
  if (/certificate|self[- ]signed|CERT_|UNABLE_TO_VERIFY|UnknownIssuer|invalid peer/i.test(m)) {
    return 'Het certificaat van de mailserver wordt niet vertrouwd. Heeft je server een eigen certificaat? Zet dan de Secret IMAP_ALLOW_SELF_SIGNED op true.';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|timed? ?out|connection refused|closed/i.test(m + code)) {
    return `Geen verbinding met ${env('IMAP_HOST')} op poort ${env('IMAP_PORT') || 993}: controleer IMAP_HOST en IMAP_PORT (meestal 993). (${m})`;
  }
  return 'Verbinden met de mailserver mislukt: ' + m;
}

async function withImap<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = imap();
  try { await c.connect(); } catch (e) { throw new UserError(connectError(e), 502); }
  try { return await fn(c); }
  finally { try { await c.logout(); } catch { try { c.close(); } catch { /* al dicht */ } } }
}

// Conceptenmap zoeken: eerst de officiële markering (\Drafts), dan op naam
async function draftsPath(c: ImapFlow): Promise<string> {
  if (env('IMAP_DRAFTS')) return env('IMAP_DRAFTS');
  const list = await c.list();
  const byUse = list.find((f: any) => f.specialUse === '\\Drafts');
  if (byUse) return byUse.path;
  const byName = list.find((f: any) => /^(inbox[./])?(drafts|draft|concepten|concept|klad)$/i.test(f.path));
  if (byName) return byName.path;
  throw new UserError('Geen conceptenmap gevonden. Vul bij de Secrets IMAP_DRAFTS in met de naam van je conceptenmap (bijv. Drafts of INBOX.Drafts).', 500);
}

// ---------- inbox ----------
async function listInbox(c: ImapFlow, unreadOnly: boolean, limit: number) {
  const lock = await c.getMailboxLock('INBOX');
  try {
    const exists = (c.mailbox && (c.mailbox as any).exists) || 0;
    if (!exists) return [];
    let range: string, byUid = false;
    if (unreadOnly) {
      const uids = (await c.search({ seen: false }, { uid: true })) || [];
      if (!uids.length) return [];
      range = uids.slice(-limit).join(','); byUid = true;
    } else {
      range = `${Math.max(1, exists - limit + 1)}:*`;
    }
    const out = [];
    for await (const m of c.fetch(range, { uid: true, envelope: true, flags: true, internalDate: true }, { uid: byUid })) {
      const f = m.envelope?.from?.[0] || {};
      const d = m.envelope?.date || m.internalDate;
      out.push({
        uid: m.uid,
        subject: m.envelope?.subject || '',
        from: { name: f.name || '', address: f.address || '' },
        date: d ? new Date(d).toISOString() : null,
        seen: !!m.flags?.has('\\Seen'),
      });
    }
    return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  } finally { lock.release(); }
}

// ---------- één mail lezen ----------
const MAX_SOURCE = 1_500_000; // grotere mails (bijlagen) worden afgekapt; de tekst staat vrijwel altijd vooraan
function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const bracket = (id?: string) => !id ? '' : id.trim().startsWith('<') ? id.trim() : `<${id.trim()}>`;

async function readMessage(c: ImapFlow, uid: number) {
  const lock = await c.getMailboxLock('INBOX');
  try {
    const meta = await c.fetchOne(String(uid), { uid: true, size: true }, { uid: true });
    if (!meta) throw new UserError('Deze mail bestaat niet meer (verplaatst of verwijderd?). Vernieuw de inbox.', 404);
    const src = await c.fetchOne(String(uid),
      { uid: true, source: (meta.size || 0) > MAX_SOURCE ? { start: 0, maxLength: MAX_SOURCE } : true }, { uid: true });
    if (!src || !src.source) throw new UserError('Deze mail kon niet worden gelezen. Vernieuw de inbox en probeer het opnieuw.', 404);
    const p: any = await PostalMime.parse(src.source);
    const text: string = (p.text && p.text.trim() ? p.text : htmlToText(p.html || ''))
      .replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    return {
      uid,
      subject: p.subject || '',
      from: { name: p.from?.name || '', address: p.from?.address || '' },
      replyTo: (p.replyTo || []).map((a: any) => ({ name: a.name || '', address: a.address || '' })).filter((a: any) => a.address),
      date: p.date || null,
      messageId: bracket(p.messageId),
      references: (p.references || '').trim(),
      text: text.slice(0, 20000),
      attachments: (p.attachments || []).map((a: any) => a.filename).filter(Boolean),
    };
  } finally { lock.release(); }
}

// ---------- antwoord als concept ----------
const utf8b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const wrap76 = (s: string) => s.match(/.{1,76}/g)?.join('\r\n') ?? '';
// Koptekst met niet-ASCII-tekens coderen (RFC 2047), in stukjes zodat regels kort blijven
function encodeWords(s: string) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const parts: string[] = [];
  let cur = '';
  for (const ch of s) {
    if (new TextEncoder().encode(cur + ch).length > 45) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts.map((p) => `=?UTF-8?B?${utf8b64(p)}?=`).join('\r\n ');
}
function address(name: string, addr: string) {
  if (!name) return `<${addr}>`;
  const n = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '\\$&')}"` : encodeWords(name);
  return `${n} <${addr}>`;
}
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Handtekening (HTML uit Outlook): gevaarlijke onderdelen eruit, alleen plaatjes van internet (https)
function cleanSignature(html: string) {
  return html.slice(0, 60000)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form|meta|link|title|xml)\b[\s\S]*?(<\/\1>|\/?>)/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '')
    .replace(/<img\b(?![^>]*\bsrc\s*=\s*["']https:\/\/)[^>]*>/gi, '');
}
type Signature = { html?: string; text?: string };

function buildReply(orig: Awaited<ReturnType<typeof readMessage>>, replyText: string, sig: Signature = {}) {
  const fromAddr = env('MAIL_FROM') || env('IMAP_USER');
  const fromName = env('MAIL_FROM_NAME') || 'Adviesdrogisterij.nl';
  const to = orig.replyTo[0] || orig.from;
  if (!to.address) throw new UserError('Deze mail heeft geen afzenderadres; een concept kan niet worden gemaakt.');
  const subject = /^\s*(re|antw|aw|sv)\s*:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`;
  const domain = (fromAddr.split('@')[1] || 'adviesdrogisterij.nl').replace(/[^a-z0-9.-]/gi, '');
  const refs = [orig.references, orig.messageId].filter(Boolean).join(' ').trim();
  let when = '';
  try { when = orig.date ? new Date(orig.date).toLocaleString('nl-NL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }) : ''; } catch { /* geen datum */ }
  const who = orig.from.name ? `${orig.from.name} <${orig.from.address}>` : orig.from.address;
  const intro = `Op ${when ? when + ' ' : ''}schreef ${who}:`;
  const reply = replyText.replace(/\r/g, '').trim();
  const quoted = orig.text.slice(0, 10000);
  const sigText = (sig.text || '').replace(/\r/g, '').trim().slice(0, 5000);
  const sigHtml = cleanSignature(sig.html || '').trim();
  const plain = `${reply}${sigText ? '\n\n' + sigText : ''}\n\n${intro}\n${quoted.split('\n').map((l) => '> ' + l).join('\n')}\n`.replace(/\n/g, '\r\n');
  const html = '<html><body>' +
    '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">' +
    reply.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('') +
    '</div>' +
    (sigHtml ? `<div>${sigHtml}</div>` : sigText ? `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${escHtml(sigText).replace(/\n/g, '<br>')}</div>` : '') +
    '<br>' +
    `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${escHtml(intro)}</div>` +
    `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${escHtml(quoted).replace(/\n/g, '<br>')}</blockquote>` +
    '</body></html>';
  const boundary = '=_ads_' + crypto.randomUUID().replace(/-/g, '');
  const headers = [
    `From: ${address(fromName, fromAddr)}`,
    `To: ${address(to.name, to.address)}`,
    `Subject: ${encodeWords(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    ...(orig.messageId ? [`In-Reply-To: ${orig.messageId}`, `References: ${refs.split(/\s+/).join('\r\n ')}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  return [
    ...headers, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(utf8b64(plain)),
    `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', wrap76(utf8b64(html)),
    `--${boundary}--`, '',
  ].join('\r\n');
}

async function makeDraft(c: ImapFlow, uid: number, replyText: string, sig: Signature) {
  const orig = await readMessage(c, uid);
  const folder = await draftsPath(c);
  await c.append(folder, buildReply(orig, replyText, sig), ['\\Draft', '\\Seen'], new Date());
  return { ok: true, folder, to: (orig.replyTo[0] || orig.from).address, subject: orig.subject };
}

// ---------- verzoeken van de app ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Alleen POST is toegestaan.' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    await verify(String(body.token || ''), req.headers.get('apikey') || env('SUPABASE_ANON_KEY'));
    const action = String(body.action || '');
    if (action === 'ping') {
      return json(await withImap(async (c) => {
        const st = await c.status('INBOX', { messages: true, unseen: true });
        let drafts: string | null = null, warning = '';
        try { drafts = await draftsPath(c); } catch (e) { warning = (e as Error).message; }
        return { ok: true, user: env('IMAP_USER'), drafts, warning, messages: st.messages, unseen: st.unseen };
      }));
    }
    if (action === 'list') {
      const limit = Math.min(Math.max(Number(body.limit) || 40, 1), 100);
      return json({ messages: await withImap((c) => listInbox(c, !!body.unreadOnly, limit)) });
    }
    const uid = Number(body.uid);
    if (!Number.isInteger(uid) || uid <= 0) throw new UserError('Ongeldige mail.');
    if (action === 'get') return json({ message: await withImap((c) => readMessage(c, uid)) });
    if (action === 'draft') {
      const text = String(body.text || '').trim();
      if (!text) throw new UserError('Het antwoord is leeg.');
      if (text.length > 50000) throw new UserError('Het antwoord is te lang.');
      const sig: Signature = { html: String(body.signatureHtml || ''), text: String(body.signatureText || '') };
      return json(await withImap((c) => makeDraft(c, uid, text, sig)));
    }
    throw new UserError('Onbekende actie.');
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Er ging iets mis in de mailkoppeling: ' + ((e as Error)?.message || e) }, 500);
  }
});
