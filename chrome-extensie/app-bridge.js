// Brug tussen de app-pagina en de extensie. Alleen berichten van de app-pagina zelf worden doorgegeven.
document.documentElement.dataset.adsBridge = '1';
window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.source !== 'ads-app' || m.type !== 'lookup') return;
  chrome.runtime.sendMessage({ type: 'lookup', email: String(m.email || ''), orders: (m.orders || []).map(String).slice(0, 5) }, (res) => {
    const err = chrome.runtime.lastError;
    window.postMessage({ source: 'ads-ext', type: 'result', id: m.id, ...(err ? { error: err.message } : res) }, location.origin);
  });
});
