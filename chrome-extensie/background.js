// Zoekt in een geopend tabblad met het webshopbeheer (adviesdrogisterij.nl/App) naar bestellingen.
// Er gaan geen gegevens naar andere servers: het resultaat gaat alleen terug naar de app. Klantgegevens worden niet opgeslagen;
// de extensie onthoudt alleen namen (kolomnamen, filtervelden, het adres van het beheer) en welk zoekfilter werkt.
// Staat de bestelling niet in een geopende lijst, dan vraagt de extensie hem gericht op via het ingelogde beheer zelf:
// altijd met een filter op dat ene ordernummer of mailadres en maximaal 5 resultaten, nooit een hele lijst.
const APP_PREFIX = 'https://rensstam.github.io/Antwoorden-Adviesdrogisterij.nl/';
const ADMIN = /^https:\/\/(www\.)?adviesdrogisterij\.nl\/App/i;
const MAX_TRIES = 14, TIME_BUDGET = 9000; // gericht zoeken: hooguit zoveel verzoeken / milliseconden per zoekactie

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'lookup' || !sender.url || !sender.url.startsWith(APP_PREFIX)) return false;
  lookup(msg).then(reply, (e) => reply({ error: 'Fout in de extensie: ' + (e?.message || e), ver: VER }));
  return true; // antwoord komt later
});
const VER = chrome.runtime.getManifest().version;

async function lookup(msg) {
  const tabs = (await chrome.tabs.query({})).filter((t) => t.url && ADMIN.test(t.url));
  if (!tabs.length) return { error: 'Open je webshopbeheer (adviesdrogisterij.nl/App) in Chrome en log in.', ver: VER };
  const diag = { tabs: tabs.length, frames: 0, extFrames: 0, lists: 0, rows: 0, tries: [] };
  // 1. In alle tabbladen met het beheer en alle frames daarbinnen: de geopende lijsten doorzoeken
  const found = [], seen = new Set(), lineRows = []; let lastError = '';
  for (const tab of tabs) {
    let res = [];
    try { res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN', func: lookupInExt, args: [msg.email, msg.orders] }); }
    catch (e) { lastError = String(e?.message || e); continue; }
    for (const fr of res) {
      diag.frames++;
      const r = fr && fr.result; if (!r || r.noExt) continue;
      diag.extFrames++; diag.lists += r.lists || 0; diag.rows += r.rows || 0;
      for (const o of r.orders || []) { const k = rowKey(o); if (!seen.has(k)) { seen.add(k); found.push(o); } }
      lineRows.push(...(r.lineRows || []));
      if (r.learn) await saveLearn(r.learn);
    }
  }
  if (!diag.frames && lastError) return { error: lastError, ver: VER };
  // 2. Niet in een geopende lijst? Gericht opvragen via het beheer (alleen deze ene bestelling)
  const learn = await getStore('learn');
  if (!learn.labels) { const old = await getStore('labels'); if (Object.keys(old).length) { learn.labels = old; await setStore('learn', learn); } }
  let target = null, loggedOut = false, searched = false;
  if (!found.length && (msg.email || (msg.orders || []).length)) {
    target = await pickTarget(tabs[0], learn, diag);
    if (target) {
      searched = true;
      const res = await searchOrders(target, learn, msg.email, msg.orders || [], !!msg.auto, diag);
      loggedOut = res.loggedOut;
      for (const o of res.orders) { const k = rowKey(o); if (!seen.has(k)) { seen.add(k); found.push(o); } }
    }
  }
  // 3. Artikelen van de gevonden bestellingen die nog niet in het beheer geladen zijn
  if (found.length && !loggedOut) {
    target = target || await pickTarget(tabs[0], learn, diag);
    const ep = (learn.endpoints && learn.endpoints.lines) || {};
    for (const o of found.slice(0, 3)) {
      const refs = new Set(o._refs || []);
      if (!target || lineRows.some((lr) => lr.refs.some((v) => refs.has(v)))) continue;
      // Intern order-id: eerst het bekende id, dan andere nummers van de bestelling (bijv. als het id anders heet)
      const ids = [...new Set([o._oid, ...(o._refs || [])].filter((v) => v && /^\d{3,12}$/.test(String(v))).map(String))].slice(0, 4);
      for (const id of ids) {
        const res = await adminRequest(target, { object: ep.object || 'Orderline', method: ep.method, parameters: ep.parameters, filters: [{ field: 'orderIdById', type: 'id', value: id }], limit: 50 });
        diag.tries.push({ wat: 'orderregels', status: res.status, http: res.http, rijen: (res.rows || []).length });
        if (res.status === 'loggedout') { loggedOut = true; break; }
        // alleen regels die echt bij dit id horen (als het antwoord een order-veld heeft)
        const own = (res.rows || []).filter((raw) => { const ks = Object.keys(raw || {}).filter((k) => /order/i.test(k)); return !ks.length || ks.some((k) => String(raw[k]) === id); });
        if (!own.length) continue;
        for (const raw of own) lineRows.push({ refs: [id], line: rawToRow(raw, (learn.labels && learn.labels.lines) || {}, true) });
        refs.add(id); o._refs = [...refs]; break;
      }
    }
  }
  for (const o of found) {
    const refs = new Set(o._refs || []); delete o._refs; delete o._oid;
    const lines = [], seenL = new Set();
    for (const lr of lineRows) {
      if (!lr.refs.some((v) => refs.has(v))) continue;
      const k = JSON.stringify(lr.line); if (seenL.has(k) || lines.length >= 40) continue;
      seenL.add(k); lines.push(lr.line);
    }
    if (lines.length) o._lines = lines;
  }
  if (found.length) return { orders: found.slice(0, 5), ver: VER };
  return { orders: [], ver: VER, loggedOut, searched, lists: diag.lists, rows: diag.rows, diag };
}
const rowKey = (o) => JSON.stringify({ ...o, _refs: undefined, _oid: undefined });

async function getStore(k) { try { return (await chrome.storage.local.get(k))[k] || {}; } catch { return {}; } }
async function setStore(k, v) { try { await chrome.storage.local.set({ [k]: v }); } catch { /* niet erg */ } }
// Geleerde namen bewaren (kolomnamen, filtervelden, adres en objectnamen van het beheer). Nooit inhoud.
async function saveLearn(l) {
  const cur = await getStore('learn');
  for (const part of ['labels', 'filterDefs']) {
    cur[part] = cur[part] || {};
    for (const kind of ['orders', 'lines']) if (l[part] && l[part][kind] && Object.keys(l[part][kind]).length) cur[part][kind] = Object.assign(cur[part][kind] || {}, l[part][kind]);
  }
  if (l.filterParams) cur.filterParams = l.filterParams;
  if (l.endpoints) { cur.endpoints = cur.endpoints || {}; for (const kind of ['orders', 'lines']) if (l.endpoints[kind]) cur.endpoints[kind] = Object.assign(cur.endpoints[kind] || {}, l.endpoints[kind]); }
  if (l.urls && l.urls.length) cur.urls = [...new Set([...l.urls, ...(cur.urls || [])])].slice(0, 4);
  await setStore('learn', cur);
}

// Het frame van het beheer kiezen waarin we verzoeken doen, en de mogelijke adressen van datahandler.php
async function pickTarget(tab, learn, diag) {
  let res = [];
  try { res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN', func: probeFrame }); }
  catch { return null; }
  const frames = res.map((r) => ({ frameId: r.frameId, ...(r.result || {}) })).filter((f) => f.href && ADMIN.test(f.href));
  if (!frames.length) return null;
  const best = frames.find((f) => f.dh && f.dh.length) || frames.find((f) => f.ext) || frames.find((f) => f.frameId === 0) || frames[0];
  const derive = (href) => { try { return [new URL('datahandler.php', href).href, new URL('datahandler.php', href.replace(/\/?([?#].*)?$/, '/')).href]; } catch { return []; } };
  const trusted = [...new Set([learn.dhUrl, ...frames.flatMap((f) => f.dh || []), ...(learn.urls || [])].filter(Boolean))];
  const guessed = [...new Set([...derive(best.href), ...derive(frames[0].href)])].filter((u) => !trusted.includes(u));
  const urls = [...trusted.map((u) => ({ u, trusted: true })), ...guessed.map((u) => ({ u, trusted: false }))];
  diag.adres = trusted.length ? trusted[0].replace(/^https?:\/\/[^/]+/, '') : 'nog niet gezien (gok: ' + (guessed[0] || '').replace(/^https?:\/\/[^/]+/, '') + ')';
  return { tabId: tab.id, frameId: best.frameId, urls };
}
function probeFrame() {
  let dh = [];
  try { dh = [...new Set(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /datahandler\.php/i.test(n)).map((n) => n.replace(/[?#].*$/, '')))]; } catch { /* geen */ }
  return { href: location.href, ext: !!(window.Ext && window.Ext.ComponentMgr), dh };
}
// Eén gefilterd verzoek in het gekozen frame; onthoudt welk adres werkt
async function adminRequest(target, req) {
  let res = null;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: target.tabId, frameIds: [target.frameId] }, world: 'MAIN', func: adminSearch, args: [{ ...req, urls: target.urls }] });
    res = r && r.result;
  } catch (e) { return { status: 'error', note: String(e?.message || e).slice(0, 80) }; }
  if (!res) return { status: 'error', note: 'geen antwoord' };
  if (res.url && res.status === 'ok') { // dit adres werkt: voortaan als eerste (en als betrouwbaar) gebruiken
    const clean = res.url.replace(/[?#].*$/, '');
    target.urls = [{ u: clean, trusted: true }, ...target.urls.filter((x) => x.u !== clean)];
    const l = await getStore('learn'); if (l.dhUrl !== clean) { l.dhUrl = clean; await setStore('learn', l); }
  }
  return res;
}

const SKIP = /e-?mail|telefoon|phone|wachtwoord|password|sessie|session|\bip\b|iban|hash|token|referentie|transactiecode|^id$|_id$|[a-z]Id$|ById$/;
const SKIP_I = /e-?mail|telefoon|phone|wachtwoord|password|sessie|session|\bip\b|iban|hash|token|referentie|transactiecode|^id$|_id$/i;
// Waarschijnlijke Nederlandse kopjes voor Engelse veldnamen (tot de echte kolomnamen uit het beheer geleerd zijn)
const GUESS = { number: 'Ordernummer', orderNumber: 'Ordernummer', ordernumber: 'Ordernummer', firstName: 'Klant voornaam', firstname: 'Klant voornaam', lastName: 'Klant achternaam', lastname: 'Klant achternaam',
  status: 'Status', trackAndTrace: 'Track en Trace code', trackandtrace: 'Track en Trace code', trackTrace: 'Track en Trace code', paymentMethod: 'Betaalmethode', totalInclVat: 'Bedrag incl. BTW', total: 'Bedrag incl. BTW',
  shippingCosts: 'Verzendkosten', street: 'Afleverstraat', houseNumber: 'Aflevernummer', houseNumberAddition: 'Aflevernummer toevoegsel', zipcode: 'Afleverpostcode', postcode: 'Afleverpostcode', postalCode: 'Afleverpostcode',
  city: 'Afleverplaats', country: 'Afleverland', remark: 'Opmerking', comment: 'Opmerking', internalRemark: 'Interne opmerking', internalComment: 'Interne opmerking', orderDate: 'Orderdatum', date: 'Orderdatum', invoiceNumber: 'Factuurnummer', processedOnOrderList: 'Verwerkt op bestellijst',
  description: 'Omschrijving', productName: 'Omschrijving', name: 'Omschrijving', quantity: 'Aantal', qty: 'Aantal', amount: 'Aantal', price: 'Prijs', articleNumber: 'Artikelnummer' };
// Ruwe rij van de server -> zelfde vorm als uit een geopende lijst (kopjes als labels, gevoelige velden eruit)
function rawToRow(raw, labels, isLine) {
  const row = {};
  for (const [k, v0] of Object.entries(raw || {})) {
    if (v0 === null || v0 === undefined || typeof v0 === 'object') continue;
    const v = String(v0).trim(), label = labels[k] || (isLine || !['name', 'description', 'quantity', 'qty', 'amount', 'price', 'articleNumber'].includes(k) ? GUESS[k] : '') || k;
    if (!v || SKIP.test(k) || SKIP_I.test(label) || isLine && /order|bestelling/i.test(k)) continue;
    row[label] = v.slice(0, isLine ? 160 : 200);
  }
  if (!isLine) {
    const mk = Object.keys(raw || {}).find((k) => /e-?mail/i.test(k) || /e-?mail/i.test(labels[k] || '')), mail = mk ? String(raw[mk]).trim() : '';
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) row._email = mail;
    if (raw && raw.id !== undefined) row._oid = String(raw.id);
    row._refs = Object.entries(raw || {}).filter(([k, v]) => /id$|order|^nr$|number/i.test(k) && v !== null && typeof v !== 'object').map(([, v]) => String(v)).filter((v) => v.length >= 3);
  }
  return row;
}

// Gericht zoeken. Volgorde: het filter dat eerder werkte, dan de filtervelden van de lijst Beheer orders zelf
// (geleerd zodra die eens open stond), dan een paar gangbare namen (alleen als je zelf op Zoeken klikt).
// Een filter telt alleen als het antwoord echt die bestelling bevat. Het werkende filter wordt onthouden.
async function searchOrders(target, learn, email, orders, auto, diag) {
  const labels = (learn.labels && learn.labels.orders) || {}, defs = (learn.filterDefs && learn.filterDefs.orders) || {};
  const known = await getStore('filters'), ep = (learn.endpoints && learn.endpoints.orders) || {};
  const fp = learn.filterParams || {};
  const byLabel = (re) => Object.keys(labels).filter((k) => re.test(labels[k]));
  const plan = [];
  const add = (kind, value, field, type, guess) => { if (field && !plan.some((p) => p.kind === kind && p.value === value && p.field === field && p.type === type)) plan.push({ kind, value, field, type, guess }); };
  const nrFields = byLabel(/^ordernummer$|^order ?nr|^bestelnummer$/i), mailFields = byLabel(/e-?mail/i);
  orders.slice(0, 3).forEach((nr, i) => {
    if (known.nr) add('nr', nr, known.nr.field, known.nr.type);
    for (const f of nrFields) add('nr', nr, f, defs[f] || 'string');
    for (const f of nrFields) if (!defs[f]) add('nr', nr, f, 'numeric');
    if (!auto && i === 0) for (const f of ['number', 'orderNumber', 'ordernumber', 'ordernummer', 'orderNr']) for (const t of ['string', 'numeric']) add('nr', nr, f, t, true);
  });
  if (email) {
    if (known.email) add('email', email, known.email.field, known.email.type);
    for (const f of mailFields) add('email', email, f, defs[f] || 'string');
    if (!auto) for (const f of ['email', 'customerEmail', 'emailAddress', 'emailaddress']) add('email', email, f, 'string', true);
  }
  const out = [], t0 = Date.now(), done = new Set();
  let tries = 0;
  for (const p of plan) {
    if (done.has(p.kind + p.value)) continue;
    if (tries >= MAX_TRIES || Date.now() - t0 > TIME_BUDGET) { diag.gestopt = 'tijd of aantal pogingen op'; break; }
    tries++;
    const res = await adminRequest(target, { object: ep.object || 'Order', method: ep.method, parameters: ep.parameters, prefix: fp.prefix, encode: fp.encode,
      filters: [{ field: p.field, type: p.type, value: p.value }], limit: 5 });
    const match = (res.rows || []).filter((raw) => Object.values(raw || {}).some((v) => v !== null && typeof v !== 'object' && String(v).trim().toLowerCase() === String(p.value).trim().toLowerCase()));
    diag.tries.push({ wat: p.kind === 'nr' ? 'ordernummer' : 'e-mailadres', veld: p.field, type: p.type, status: res.status, http: res.http, rijen: (res.rows || []).length, raak: match.length, ...(res.note ? { let: res.note } : {}), ...(res.keys ? { velden: res.keys.slice(0, 25).join(',') } : {}) });
    if (res.status === 'loggedout') return { orders: [], loggedOut: true };
    if (!match.length) continue;
    known[p.kind] = { field: p.field, type: p.type }; await setStore('filters', known);
    out.push(...match.map((raw) => rawToRow(raw, labels)));
    done.add(p.kind + p.value);
    if (out.length) break;
  }
  return { orders: out.slice(0, 5), loggedOut: false };
}

// Draait in het beheer (in het gekozen frame): één gefilterd verzoek zoals het beheer het zelf doet, met de eigen
// inlogsessie. Altijd met filter en een kleine limiet; het antwoord gaat alleen terug naar de extensie.
async function adminSearch(req) {
  const { urls, object, method, parameters, filters, limit, prefix = 'filter', encode = false } = req;
  if (!filters || !filters.length) return { status: 'error', note: 'geen filter' };
  const lim = String(Math.min(limit || 5, 50));
  const body = new URLSearchParams({ object, method: method || 'Search', parameters: parameters || JSON.stringify(['filter', 'start', 'limit']), start: '0', limit: lim });
  if (encode) body.append(prefix, JSON.stringify(filters.map((f) => ({ field: f.field, type: f.type, value: f.value, ...(f.type === 'numeric' ? { comparison: 'eq' } : {}) }))));
  else filters.forEach((f, i) => { body.append(`${prefix}[${i}][field]`, f.field); body.append(`${prefix}[${i}][data][type]`, f.type); body.append(`${prefix}[${i}][data][value]`, f.value); if (f.type === 'numeric') body.append(`${prefix}[${i}][data][comparison]`, 'eq'); });
  const looksLogin = (t) => /<input[^>]+type=["']?password/i.test(t) || /(sessie|session)[^.]{0,30}(verlopen|expired)|niet (meer )?ingelogd|not logged in|please log ?in|log opnieuw in|login required/i.test(t);
  let last = { status: 'error', note: 'geen adres' };
  for (const cand of urls || []) {
    const url0 = typeof cand === 'string' ? cand : cand.u, trusted = typeof cand === 'string' || !!cand.trusted;
    let u; try { u = new URL(url0, location.href); } catch { continue; }
    if (u.origin !== location.origin) continue;
    if (!u.searchParams.has('action')) u.searchParams.set('action', 'read');
    let res, txt;
    try {
      res = await fetch(u.href, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body });
      txt = await res.text();
    } catch { last = { status: 'error', note: 'netwerkfout' }; continue; }
    if (res.status === 404 || res.status === 405) { last = { status: 'error', http: res.status, note: 'adres niet gevonden' }; continue; }
    if (res.status === 401 || res.status === 403) return { status: 'loggedout', http: res.status, url: u.href };
    if (trusted && res.redirected && /log.?in|inlog|signin|auth/i.test(res.url)) return { status: 'loggedout', http: res.status, url: u.href };
    // JSON lezen; eventuele PHP-meldingen ervoor overslaan
    let j = null; const at = txt.search(/[[{]/);
    if (at >= 0) { try { j = JSON.parse(txt.slice(at)); } catch { j = null; } }
    if (j === null) {
      // Een gegokt adres dat geen JSON geeft, is waarschijnlijk gewoon het verkeerde adres: volgende proberen
      if (!trusted) { last = { status: 'error', http: res.status, note: 'adres gaf geen gegevens' }; continue; }
      // Een hele webpagina waar gegevens horen te komen = vrijwel altijd de inlogpagina (een PHP-fout is geen hele pagina)
      const page = res.status < 400 && /^\s*(<!doctype html|<html)/i.test(txt) && !/fatal error|warning:|exception|sqlstate|stack trace/i.test(txt);
      return looksLogin(txt) || page ? { status: 'loggedout', http: res.status, url: u.href } : { status: 'error', http: res.status, note: res.status >= 500 ? 'serverfout' : 'geen geldig antwoord', url: u.href };
    }
    if (j && typeof j === 'object' && !Array.isArray(j) && j.success === false) {
      const m = String(j.msg || j.message || j.error || j.errors || '');
      if (looksLogin(m) || /log.?in|ingelogd|sessie|session|auth/i.test(m)) return { status: 'loggedout', http: res.status, url: u.href };
      return { status: 'error', http: res.status, note: 'beheer gaf een fout', url: u.href };
    }
    const isRows = (a) => Array.isArray(a) && a.every((x) => x && typeof x === 'object' && !Array.isArray(x));
    let arr = isRows(j) ? j : null;
    if (!arr && j && typeof j === 'object') for (const k of ['data', 'rows', 'results', 'items', 'records', 'result']) if (isRows(j[k])) { arr = j[k]; break; }
    if (!arr && j && typeof j === 'object') arr = Object.values(j).find(isRows) || [];
    const rows = arr.slice(0, Number(lim));
    return { status: 'ok', http: res.status, rows, url: u.href, keys: rows[0] ? Object.keys(rows[0]).slice(0, 60) : [] };
  }
  return last;
}

// Draait in het beheer (Ext JS 3.4), in elk frame: zoekt in de geladen lijsten naar het mailadres of ordernummer,
// en leert de namen van kolommen, filters en het adres van het beheer (geen inhoud).
function lookupInExt(email, orders) {
  const Ext = window.Ext;
  if (!Ext || !Ext.ComponentMgr) return { noExt: true };
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const fmt = (v) => v instanceof Date ? v.toLocaleString('nl-NL') : (v === null || v === undefined ? '' : String(v));
  const wantEmail = String(email || '').trim().toLowerCase();
  const wantOrders = new Set((orders || []).map((o) => String(o).trim()).filter(Boolean));
  // Gevoelige of interne velden worden nooit doorgegeven (naam en adres wel, voor het overzicht in de app)
  const skip = /e-?mail|telefoon|wachtwoord|password|sessie|session|\bip\b|iban|hash|token|referentie|transactiecode|^id$|_id$/i;
  // Lijsten verzamelen: tabellen (met kolomnamen) en losse stores
  const lists = new Map(), grids = new Map(); // store -> kolommen [{label, key}] / store -> tabel
  Ext.ComponentMgr.all.each((c) => {
    if (!c || !c.store || !c.store.each || typeof c.getColumnModel !== 'function') return;
    const cols = (c.getColumnModel().config || []).filter((col) => col && col.dataIndex).map((col) => ({ label: strip(col.header) || col.dataIndex, key: col.dataIndex }));
    if (cols.length) { lists.set(c.store, cols); grids.set(c.store, c); }
  });
  const mgr = Ext.StoreMgr || (Ext.data && Ext.data.StoreManager);
  if (mgr && mgr.each) mgr.each((st) => { if (st && st.each && !lists.has(st)) lists.set(st, null); });
  const results = [], seen = new Set(), hits = []; let rows = 0;
  const isName = (k) => /omschrijving|artikel ?naam|product ?naam|productnaam|^product$|^artikel$|titel|^naam$/i.test(k);
  const isQty = (k) => /aantal|qty|quantity|stuks/i.test(k);
  const fieldsOf = (cols, st) => cols || (() => { let f = null; st.each((r) => { if (!f) f = Object.keys(r.data || {}).map((k) => ({ label: k, key: k })); }); return f || []; })();
  // Lijst met orderregels (artikel + aantal), niet de orderlijst zelf (die heeft status en betaalmethode)
  const isLineList = (fields) => fields.some((f) => isName(f.label) || isName(f.key)) && fields.some((f) => isQty(f.label) || isQty(f.key))
    && !fields.some((f) => /betaalmethode|^status$/i.test(f.label));
  const isOrderList = (fields) => !isLineList(fields) && fields.some((f) => /^ordernummer$|^order ?nr|^bestelnummer$/i.test(f.label) || /ordernum|ordernr/i.test(f.key));
  lists.forEach((cols, st) => {
    if (isLineList(fieldsOf(cols, st))) { st.each(() => { rows++; }); return; }
    st.each((r) => {
      rows++;
      const d = r.data || {};
      const vals = Object.values(d).map((v) => fmt(v).trim());
      const hitEmail = wantEmail && vals.some((v) => v.toLowerCase() === wantEmail);
      const hitOrder = wantOrders.size && vals.some((v) => wantOrders.has(v) || wantOrders.has(v.replace(/^#/, '')));
      if (!hitEmail && !hitOrder) return;
      const row = {};
      const fields = cols || Object.keys(d).map((k) => ({ label: k, key: k }));
      for (const f of fields) {
        const val = fmt(d[f.key]).trim();
        if (!val || skip.test(f.label) || skip.test(f.key) || typeof d[f.key] === 'object' && !(d[f.key] instanceof Date)) continue;
        row[f.label] = val.slice(0, 200);
      }
      // Mailadres van de klant apart (alleen als ontvanger voor een nieuw concept, niet voor de AI)
      const mailKey = (cols || []).find((f) => /e-?mail/i.test(f.label)) || { key: Object.keys(d).find((k) => /e-?mail/i.test(k)) };
      const mail = mailKey.key ? fmt(d[mailKey.key]).trim() : '';
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) row._email = mail;
      const key = JSON.stringify(row);
      if (d.id !== undefined || r.id !== undefined) row._oid = String(d.id !== undefined ? d.id : r.id);
      if (Object.keys(row).length && !seen.has(key)) { seen.add(key); results.push(row); hits.push({ row, rec: r, store: st }); }
    });
  });
  // Orderregels (artikelen): elke regel krijgt de waarden van zijn order-velden mee (ordernummer / intern order-id);
  // de koppeling aan de bestelling gebeurt daarna, ook als de regels in een ander frame van het beheer staan.
  for (const h of hits.slice(0, 5)) {
    const d = h.rec.data || {};
    h.row._refs = [h.rec.id, ...Object.keys(d).filter((k) => /id$|order|^nr$/i.test(k)).map((k) => d[k])]
      .filter((v) => v !== undefined && v !== null && typeof v !== 'object').map((v) => String(v).trim()).filter((v) => v.length >= 3);
  }
  const lineRows = [];
  lists.forEach((cols, st) => {
    const fields = fieldsOf(cols, st);
    if (!isLineList(fields)) return;
    st.each((r) => {
      if (lineRows.length >= 300) return;
      const ld = r.data || {};
      const refs = Object.keys(ld).filter((k) => /order|bestelling/i.test(k)).map((k) => fmt(ld[k]).trim()).filter((v) => v.length >= 3);
      if (!refs.length) return;
      const line = {};
      for (const f of fields) {
        const val = fmt(ld[f.key]).trim();
        if (!val || skip.test(f.label) || skip.test(f.key) || /order|bestelling/i.test(f.key) || typeof ld[f.key] === 'object' && !(ld[f.key] instanceof Date)) continue;
        line[f.label] = val.slice(0, 160);
      }
      if (Object.keys(line).length) lineRows.push({ refs, line });
    });
  });
  // Leren (alleen namen): kolomkopjes, filtervelden van de lijst (Ext GridFilters), adres en objectnaam van de lijst
  const learn = { labels: { orders: {}, lines: {} }, filterDefs: { orders: {}, lines: {} }, endpoints: {}, urls: [] };
  const short = (v) => typeof v === 'string' && v.length <= 120 ? v : undefined;
  lists.forEach((cols, st) => {
    const fields = fieldsOf(cols, st);
    const kind = isLineList(fields) ? 'lines' : isOrderList(fields) ? 'orders' : '';
    if (!kind) return;
    if (cols) for (const c of cols) learn.labels[kind][c.key] = c.label;
    try {
      const g = grids.get(st), gf = g && (g.filters || (g.plugins && [].concat(g.plugins).find((p) => p && p.filters && p.filters.each)));
      if (gf && gf.filters && gf.filters.each) {
        gf.filters.each((f) => { if (f && f.dataIndex && typeof f.type === 'string') learn.filterDefs[kind][f.dataIndex] = f.type; });
        if (kind === 'orders') learn.filterParams = { prefix: short(gf.paramPrefix) || 'filter', encode: !!gf.encode };
      }
    } catch { /* geen filters */ }
    try {
      const bp = st.baseParams || {}, ep = {};
      for (const k of ['object', 'method', 'parameters']) if (short(bp[k])) ep[k] = bp[k];
      if (Object.keys(ep).length) learn.endpoints[kind] = ep;
      const px = st.proxy || {}, u = px.url || (px.conn && px.conn.url) || st.url;
      if (typeof u === 'string' && /datahandler/i.test(u)) learn.urls.push(new URL(u, location.href).href.replace(/[?#].*$/, ''));
    } catch { /* geen adres */ }
  });
  return { orders: results.slice(0, 5), lineRows, learn, lists: lists.size, rows };
}
