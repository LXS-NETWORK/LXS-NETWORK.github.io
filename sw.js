/* LXS Wallet service worker — caches the app shell so it installs as a PWA and
   opens offline. RPC/faucet calls are never cached (always hit the live network). */
const CACHE = "lxs-wallet-v1";
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
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never intercept the live network calls (balances, faucet, tx broadcast).
  if (e.request.method !== "GET" || url.hostname.endsWith("duckdns.org")) return;
  // App shell: cache-first, fall back to network.
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
