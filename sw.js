// Offline support. The page is network-first (so updates show at once) and falls back to the cached copy.
// Fonts are cached as they load. Weather (Open-Meteo) is never cached here; the page keeps its own copy.
const PREFIX = "umrah-";
const V = PREFIX + "v2";
const CORE = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const BASE = new URL("./", self.location).pathname;
// Only the guide itself is stored as the offline page, never other pages on the same site.
const isApp = u => u.origin === self.location.origin && (u.pathname === BASE || u.pathname === BASE + "index.html");
self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE.map(p => new Request(p, {cache: "reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  // Remove only this guide's old caches; other apps on the same origin keep theirs.
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIX) && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.hostname === "api.open-meteo.com") return;
  if (r.mode === "navigate") {
    if (!isApp(u)) return;
    const cached = () => caches.match("index.html").then(m => m || caches.match("./"));
    // no-cache: always check the server, so a new release shows on the next open.
    const net = fetch(u.href, {cache: "no-cache", credentials: "same-origin"}).then(res => {
      if (res.ok) { const cp = res.clone(); const save = caches.open(V).then(c => c.put("index.html", cp)); try { e.waitUntil(save); } catch (_) {} return res; }
      return cached().then(m => m || res);
    });
    net.catch(() => {});
    // On a stalled connection, show the saved copy after 3 s (the fresh copy is still saved for next time).
    const slow = new Promise(ok => setTimeout(ok, 3000)).then(() => cached()).then(m => m || net);
    e.respondWith(Promise.race([net, slow]).catch(() => cached()));
    return;
  }
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(V).then(c => c.match(r).then(m => {
      const net = fetch(r).then(res => { if (res.ok || res.type === "opaque") c.put(r, res.clone()); return res; }).catch(() => m);
      return m || net;
    })));
    return;
  }
  if (u.origin === self.location.origin && u.pathname.startsWith(BASE)) {
    e.respondWith(caches.match(r, {ignoreSearch: true}).then(m => m || fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
      return res;
    })));
  }
});
