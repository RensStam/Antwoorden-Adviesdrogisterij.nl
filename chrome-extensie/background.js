// Zoekt in een geopend tabblad met het webshopbeheer (adviesdrogisterij.nl/App) naar bestellingen.
// Er wordt niets opgeslagen en er gaan geen gegevens naar andere servers: het resultaat gaat alleen terug naar de app.
const APP_PREFIX = 'https://rensstam.github.io/Antwoorden-Adviesdrogisterij.nl/';
const ADMIN = /^https:\/\/(www\.)?adviesdrogisterij\.nl\/App/i;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'lookup' || !sender.url || !sender.url.startsWith(APP_PREFIX)) return false;
  (async () => {
    const tabs = (await chrome.tabs.query({})).filter((t) => t.url && ADMIN.test(t.url));
    if (!tabs.length) return reply({ error: 'Open je webshopbeheer (adviesdrogisterij.nl/App) in Chrome, log in en open Beheer orders.' });
    let lastError = '';
    for (const tab of tabs) {
      try {
        const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: lookupInExt, args: [msg.email, msg.orders] });
        if (res?.result?.error) { lastError = res.result.error; continue; }
        return reply(res.result);
      } catch (e) { lastError = String(e?.message || e); }
    }
    reply({ error: lastError || 'Zoeken in het webshopbeheer mislukt.' });
  })();
  return true; // antwoord komt later
});

// Draait in het beheer (Ext JS 3.4): zoekt in de geladen lijsten naar het mailadres of ordernummer.
function lookupInExt(email, orders) {
  const Ext = window.Ext;
  if (!Ext || !Ext.ComponentMgr) return { error: 'Het webshopbeheer is nog niet (volledig) geladen. Open Beheer orders en probeer het opnieuw.' };
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  const fmt = (v) => v instanceof Date ? v.toLocaleString('nl-NL') : (v === null || v === undefined ? '' : String(v));
  const wantEmail = String(email || '').trim().toLowerCase();
  const wantOrders = new Set((orders || []).map((o) => String(o).trim()).filter(Boolean));
  // Kolommen die de AI niet nodig heeft (staat al in de mail) of die gevoelig zijn
  const skip = /e-?mail|telefoon|voornaam|achternaam|wachtwoord|password|sessie|session|\bip\b|iban|hash|token/i;
  const results = [], seen = new Set();
  Ext.ComponentMgr.all.each((c) => {
    if (!c || !c.store || typeof c.getColumnModel !== 'function' || !c.store.each) return;
    const cols = (c.getColumnModel().config || []).filter((col) => col && col.dataIndex && strip(col.header));
    if (!cols.length) return;
    c.store.each((r) => {
      const d = r.data || {};
      const vals = Object.values(d).map((v) => fmt(v).trim());
      const hitEmail = wantEmail && vals.some((v) => v.toLowerCase() === wantEmail);
      const hitOrder = wantOrders.size && vals.some((v) => wantOrders.has(v));
      if (!hitEmail && !hitOrder) return;
      const row = {};
      for (const col of cols) {
        const label = strip(col.header), val = fmt(d[col.dataIndex]).trim();
        if (!val || skip.test(label) || skip.test(col.dataIndex)) continue;
        row[label] = val.slice(0, 200);
      }
      const key = JSON.stringify(row);
      if (Object.keys(row).length && !seen.has(key)) { seen.add(key); results.push(row); }
    });
  });
  return { orders: results.slice(0, 5), searched: { email: !!wantEmail, orders: [...wantOrders] } };
}
