// Zoekt in een geopend tabblad met het webshopbeheer (adviesdrogisterij.nl/App) naar bestellingen.
// Er wordt niets opgeslagen en er gaan geen gegevens naar andere servers: het resultaat gaat alleen terug naar de app.
const APP_PREFIX = 'https://rensstam.github.io/Antwoorden-Adviesdrogisterij.nl/';
const ADMIN = /^https:\/\/(www\.)?adviesdrogisterij\.nl\/App/i;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'lookup' || !sender.url || !sender.url.startsWith(APP_PREFIX)) return false;
  (async () => {
    const tabs = (await chrome.tabs.query({})).filter((t) => t.url && ADMIN.test(t.url));
    if (!tabs.length) return reply({ error: 'Open je webshopbeheer (adviesdrogisterij.nl/App) in Chrome, log in en open Beheer orders.' });
    // In alle tabbladen met het beheer en in alle frames daarbinnen zoeken (tabbladen in het beheer zijn vaak frames)
    const found = [], seen = new Set(); let lists = 0, rows = 0, frames = 0, lastError = '';
    for (const tab of tabs) {
      let res = [];
      try { res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN', func: lookupInExt, args: [msg.email, msg.orders] }); }
      catch (e) { lastError = String(e?.message || e); continue; }
      for (const fr of res) {
        const r = fr && fr.result; if (!r) continue;
        if (r.noExt) continue;
        frames++; lists += r.lists || 0; rows += r.rows || 0;
        for (const o of r.orders || []) { const k = JSON.stringify(o); if (!seen.has(k)) { seen.add(k); found.push(o); } }
      }
    }
    if (found.length) return reply({ orders: found.slice(0, 5) });
    if (!frames) return reply({ error: lastError || 'In het geopende beheer is geen bestellijst gevonden. Open Beheer orders en wacht tot de lijst geladen is.' });
    reply({ orders: [], lists, rows, info: `doorzocht: ${lists} lijst${lists === 1 ? '' : 'en'} met samen ${rows} regels` });
  })();
  return true; // antwoord komt later
});

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
  const results = [], seen = new Set(); let rows = 0;
  lists.forEach((cols, st) => {
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
      if (Object.keys(row).length && !seen.has(key)) { seen.add(key); results.push(row); }
    });
  });
  return { orders: results.slice(0, 5), lists: lists.size, rows };
}
