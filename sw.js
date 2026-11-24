// Offline support. The page is network-first (so updates show at once) and falls back to the cached copy.
// Fonts are cached as they load. The last live camera frame and the crowd feed are kept so the Crowds tab still shows it offline. Weather (Open-Meteo) is never cached here; the page keeps its own copy.
const PREFIX = "umrah-";
const V = PREFIX + "v2";
const CORE = ["./", "index.html", "stories.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const BASE = new URL("./", self.location).pathname;
const FRAME = BASE + "__live-frame.jpg";   // cache key for the last live camera frame (never a real file)
const FRAME_AT = BASE + "__live-frame-at";   // when that frame was saved
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
  // Live Haram camera frame (Crowds tab): always fetch fresh, keep the last one for offline.
  // The page rotates the i/i1–i4 hosts, so every host shares one saved copy.
  if (/^i\d?\.ytimg\.com$/.test(u.hostname) && u.pathname.endsWith("/maxresdefault_live.jpg")) {
    // Tell the page whether it got a fresh frame or the saved one (and when that was saved).
    const tell = msg => self.clients.get(e.clientId).then(c => c && c.postMessage(Object.assign({type: "frame"}, msg))).catch(() => {});
    e.respondWith(fetch(r).then(res => {
      if (res.ok || res.type === "opaque") {
        const cp = res.clone(), at = Date.now();
        const save = caches.open(V).then(c => Promise.all([c.put(FRAME, cp), c.put(FRAME_AT, new Response(String(at)))]));
        try { e.waitUntil(save); } catch (_) {}
        tell({live: true, at});
      }
      return res;
    }).catch(() => caches.match(FRAME).then(m => {
      if (!m) return Response.error();
      caches.match(FRAME_AT).then(x => x ? x.text() : "0").then(at => tell({live: false, at: +at || 0}));
      return m;
    })));
    return;
  }
  // Crowd feed (latest Kaaba view + readings): always fetch fresh, keep the last copy for offline.
  // Saved without the ?v= / ?m= cache-buster so the newest copy replaces the old one.
  if (u.hostname === "raw.githubusercontent.com" && u.pathname.startsWith("/razilzul/haram-crowd-feed/feed/")) {
    const key = u.origin + u.pathname;
    e.respondWith(fetch(r).then(res => {
      if (res.ok || res.type === "opaque") { const cp = res.clone(); const save = caches.open(V).then(c => c.put(key, cp)); try { e.waitUntil(save); } catch (_) {} }
      return res;
    }).catch(() => caches.match(key).then(m => m || Response.error())));
    return;
  }
  if (u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(V).then(c => c.match(r).then(m => {
      const net = fetch(r).then(res => { if (res.ok || res.type === "opaque") c.put(r, res.clone()); return res; }).catch(() => m);
      return m || net;
    })));
    return;
  }
  // Place stories text: network-first like the page, so a text fix shows at once; the saved copy works offline.
  if (u.origin === self.location.origin && u.pathname === BASE + "stories.js") {
    const cached = () => caches.match("stories.js");
    const net = fetch(u.href, {cache: "no-cache"}).then(res => {
      if (res.ok) { const cp = res.clone(); const save = caches.open(V).then(c => c.put("stories.js", cp)); try { e.waitUntil(save); } catch (_) {} return res; }
      return cached().then(m => m || res);
    });
    net.catch(() => {});
    const slow = new Promise(ok => setTimeout(ok, 3000)).then(() => cached()).then(m => m || net);
    e.respondWith(Promise.race([net, slow]).catch(() => cached()));
    return;
  }
  // Other files of the guide (icons, place photos): cache-first, saved the first time they load.
  if (u.origin === self.location.origin && u.pathname.startsWith(BASE)) {
    e.respondWith(caches.match(r, {ignoreSearch: true}).then(m => m || fetch(r).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); }
      return res;
    })));
  }
});
