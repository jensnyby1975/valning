// Gör appen användbar offline (t.ex. i spåret utan täckning). Väder kräver nät.
const CACHE = "vallaguiden-v2";
const FILER = ["./", "index.html", "css/stil.css", "js/motor.js", "js/app.js", "data/vallor.js", "data/kunskap.js", "data/forum.js",
  "manifest.webmanifest", "ikoner/ikon.svg", "ikoner/ikon-192.png", "ikoner/ikon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILER))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n)))));
  self.clients.claim();
});
// Nät först (så forumdata och uppdateringar syns), cache som reserv.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    const kopia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, kopia)); return r;
  }).catch(() => caches.match(e.request)));
});
