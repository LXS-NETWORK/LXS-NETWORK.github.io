/* LXS Wallet service worker — installs as a PWA and works offline, but ALWAYS
   shows the latest version when online (network-first). RPC/faucet calls are
   never cached (always hit the live network). */
const CACHE = "lxs-wallet-v3";
const ASSETS = [
  "wallet.html", "wallet.js", "ethers.umd.min.js", "manifest.json",
  "lxs-logo.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never intercept live network calls (balances, faucet, tx broadcast).
  if (e.request.method !== "GET" || url.hostname.endsWith("duckdns.org")) return;
  // App shell: NETWORK-FIRST so updates always show; fall back to cache offline.
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); return r; })
      .catch(() => caches.match(e.request))
  );
});
