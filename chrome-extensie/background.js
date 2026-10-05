// Zoekt in een geopend tabblad met het webshopbeheer (adviesdrogisterij.nl/App) naar bestellingen.
// Er gaan geen gegevens naar andere servers: het resultaat gaat alleen terug naar de app. Klantgegevens worden niet opgeslagen;
// de extensie onthoudt alleen kolomnamen (bijv. 'number' = 'Ordernummer') en welk zoekfilter werkt.
// Staat de bestelling niet in een geopende lijst, dan vraagt de extensie hem gericht op via het ingelogde beheer zelf:
// altijd met een filter op dat ene ordernummer of mailadres en maximaal 5 resultaten, nooit een hele lijst.
const APP_PREFIX = 'https://rensstam.github.io/Antwoorden-Adviesdrogisterij.nl/';
const ADMIN = /^https:\/\/(www\.)?adviesdrogisterij\.nl\/App/i;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'lookup' || !sender.url || !sender.url.startsWith(APP_PREFIX)) return false;
  (async () => {
    const tabs = (await chrome.tabs.query({})).filter((t) => t.url && ADMIN.test(t.url));
    if (!tabs.length) return reply({ error: 'Open je webshopbeheer (adviesdrogisterij.nl/App) in Chrome en log in.' });
    // In alle tabbladen met het beheer en in alle frames daarbinnen zoeken (tabbladen in het beheer zijn vaak frames)
    const found = [], seen = new Set(), lineRows = []; let lists = 0, rows = 0, frames = 0, lastError = '';
    for (const tab of tabs) {
      let res = [];
      try { res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN', func: lookupInExt, args: [msg.email, msg.orders] }); }
      catch (e) { lastError = String(e?.message || e); continue; }
      for (const fr of res) {
        const r = fr && fr.result; if (!r) continue;
        if (r.noExt) continue;
        frames++; lists += r.lists || 0; rows += r.rows || 0;
        for (const o of r.orders || []) { const k = JSON.stringify({ ...o, _refs: undefined }); if (!seen.has(k)) { seen.add(k); found.push(o); } }
        lineRows.push(...(r.lineRows || []));
        if (r.labels) await saveLabels(r.labels);
      }
    }
    // Niet in een geopende lijst? Gericht opvragen via het beheer (alleen deze ene bestelling)
    const main = tabs[0]; let loggedOut = false;
    if (!found.length && (msg.email || (msg.orders || []).length)) {
      const res = await searchOrders(main, msg.email, msg.orders || []);
      if (res.loggedOut) loggedOut = true;
      for (const o of res.orders) { const k = JSON.stringify({ ...o, _refs: undefined, _oid: undefined }); if (!seen.has(k)) { seen.add(k); found.push(o); } }
    }
    // Artikelen van de gevonden bestellingen die nog niet in het beheer geladen zijn
    for (const o of found.slice(0, 3)) {
      const refs = new Set(o._refs || []);
      if (!o._oid || lineRows.some((lr) => lr.refs.some((v) => refs.has(v)))) continue;
      const res = await inTab(main, adminSearch, ['Orderline', [{ field: 'orderIdById', type: 'id', value: String(o._oid) }], 50]);
      const labels = (await getStore('labels')).lines || {};
      for (const raw of (res && res.rows) || []) lineRows.push({ refs: [String(o._oid)], line: rawToRow(raw, labels, true) });
      refs.add(String(o._oid)); o._refs = [...refs];
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
    if (found.length) return reply({ orders: found.slice(0, 5) });
    if (loggedOut) return reply({ orders: [], lists, rows: 0, info: 'mogelijk uitgelogd' });
    if (!frames && lastError) return reply({ error: lastError });
    reply({ orders: [], lists, rows, info: `doorzocht: ${lists} lijst${lists === 1 ? '' : 'en'} met samen ${rows} regels` });
  })();
  return true; // antwoord komt later
});

async function getStore(k) { try { return (await chrome.storage.local.get(k))[k] || {}; } catch { return {}; } }
async function setStore(k, v) { try { await chrome.storage.local.set({ [k]: v }); } catch { /* niet erg */ } }
// Kolomnamen onthouden (veldnaam -> kopje), alleen namen, geen inhoud
async function saveLabels(l) {
  const cur = await getStore('labels');
  for (const kind of ['orders', 'lines']) if (l[kind] && Object.keys(l[kind]).length) cur[kind] = Object.assign(cur[kind] || {}, l[kind]);
  await setStore('labels', cur);
}
async function inTab(tab, func, args) {
  try { const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func, args }); return res && res.result; }
  catch { return null; }
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
    row._refs = Object.entries(raw || {}).filter(([k, v]) => /^id$|order|^nr$|number/i.test(k) && v !== null && typeof v !== 'object').map(([, v]) => String(v)).filter((v) => v.length >= 3);
  }
  return row;
}
// Gericht zoeken: probeer de bekende (of waarschijnlijke) filtervelden; een filter telt alleen als het antwoord
// echt die bestelling bevat. Het werkende filter wordt onthouden (alleen veldnaam en type).
async function searchOrders(tab, email, orders) {
  const labels = (await getStore('labels')).orders || {}, known = await getStore('filters');
  const byLabel = (re) => Object.keys(labels).filter((k) => re.test(labels[k]));
  const tries = [];
  for (const nr of orders.slice(0, 3)) {
    const fields = [...new Set([...(known.nr ? [known.nr.field] : []), ...byLabel(/^ordernummer$/i), 'number', 'orderNumber', 'ordernumber', 'ordernummer', 'orderNr', 'nr'])];
    const types = known.nr ? [known.nr.type, 'string', 'numeric', 'id'] : ['string', 'numeric', 'id'];
    tries.push({ kind: 'nr', value: nr, fields, types: [...new Set(types)] });
  }
  if (email) {
    const fields = [...new Set([...(known.email ? [known.email.field] : []), ...byLabel(/e-?mail/i), 'email', 'customerEmail', 'emailAddress', 'emailaddress', 'customerEmailAddress', 'mail'])];
    tries.push({ kind: 'email', value: email, fields, types: ['string'] });
  }
  const out = [];
  for (const t of tries) {
    let done = false;
    for (const field of t.fields.slice(0, 8)) {
      for (const type of t.types) {
        const res = await inTab(tab, adminSearch, ['Order', [{ field, type, value: t.value }], 5]);
        if (!res) continue;
        if (res.loggedOut) return { orders: [], loggedOut: true };
        const match = (res.rows || []).filter((raw) => Object.values(raw || {}).some((v) => v !== null && typeof v !== 'object' && String(v).trim().toLowerCase() === String(t.value).trim().toLowerCase()));
        if (!match.length) continue;
        known[t.kind] = { field, type }; await setStore('filters', known);
        out.push(...match.map((raw) => rawToRow(raw, labels)));
        done = true; break;
      }
      if (done) break;
    }
    if (out.length) break;
  }
  return { orders: out.slice(0, 5) };
}

// Draait in het beheer (hoofdframe): één gefilterd verzoek zoals het beheer het zelf doet (met de eigen inlogsessie).
// Altijd met filter en een kleine limiet; het antwoord gaat alleen terug naar de extensie.
async function adminSearch(object, filters, limit) {
  if (!filters || !filters.length) return { rows: [] };
  const hit = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /datahandler\.php/i.test(n));
  const url = hit ? hit.replace(/\?.*$/, '') + '?action=read' : new URL('datahandler.php?action=read', location.href).href;
  if (new URL(url).origin !== location.origin) return { rows: [] };
  const body = new URLSearchParams({ object, method: 'Search', parameters: JSON.stringify(['filter', 'start', 'limit']), start: '0', limit: String(Math.min(limit || 5, 50)) });
  filters.forEach((f, i) => { body.append(`filter[${i}][field]`, f.field); body.append(`filter[${i}][data][type]`, f.type); body.append(`filter[${i}][data][value]`, f.value); if (f.type === 'numeric') body.append(`filter[${i}][data][comparison]`, 'eq'); });
  let txt;
  try {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, body });
    if (res.status === 401 || res.status === 403) return { loggedOut: true };
    txt = await res.text();
  } catch { return null; }
  if (!/^\s*[[{]/.test(txt)) return { loggedOut: true };
  let j; try { j = JSON.parse(txt); } catch { return null; }
  const isRows = (a) => Array.isArray(a) && a.every((x) => x && typeof x === 'object' && !Array.isArray(x));
  let arr = isRows(j) ? j : null;
  if (!arr && j && typeof j === 'object') for (const k of ['data', 'rows', 'results', 'items', 'records', 'result']) if (isRows(j[k])) { arr = j[k]; break; }
  if (!arr && j && typeof j === 'object') arr = Object.values(j).find(isRows) || [];
  return { rows: arr.slice(0, Math.min(limit || 5, 50)) };
}

// Draait in het beheer (Ext JS 3.4), in elk frame: zoekt in de geladen lijsten naar het mailadres of ordernummer.
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
  const lists = new Map(); // store -> kolommen [{label, key}]
  Ext.ComponentMgr.all.each((c) => {
    if (!c || !c.store || !c.store.each || typeof c.getColumnModel !== 'function') return;
    const cols = (c.getColumnModel().config || []).filter((col) => col && col.dataIndex).map((col) => ({ label: strip(col.header) || col.dataIndex, key: col.dataIndex }));
    if (cols.length) lists.set(c.store, cols);
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
  // Orderregels (artikelen): lijsten met een omschrijving/artikel en een aantal. Elke regel krijgt de waarden van
  // zijn order-velden mee (ordernummer / intern order-id); de koppeling aan de bestelling gebeurt daarna, ook als
  // de regels in een ander frame van het beheer staan.
  for (const h of hits.slice(0, 5)) {
    const d = h.rec.data || {};
    h.row._refs = [h.rec.id, ...Object.keys(d).filter((k) => /^id$|order|^nr$/i.test(k)).map((k) => d[k])]
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
  // Kolomnamen onthouden (veldnaam -> kopje), zodat gericht opgevraagde rijen dezelfde namen krijgen
  const labels = { orders: {}, lines: {} };
  lists.forEach((cols, st) => {
    if (!cols) return;
    const kind = isLineList(cols) ? 'lines' : cols.some((c) => /^ordernummer$/i.test(c.label)) ? 'orders' : '';
    if (kind) for (const c of cols) labels[kind][c.key] = c.label;
  });
  return { orders: results.slice(0, 5), lineRows, labels, lists: lists.size, rows };
}
