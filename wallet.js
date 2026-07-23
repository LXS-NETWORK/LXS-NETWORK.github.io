/* LXS Wallet — NON-CUSTODIAL.
   Your private key lives ONLY on this device, encrypted with your password
   (standard keystore). Nothing about your key ever reaches any server — the app
   only reads your balance and broadcasts transactions you sign here. */

const RPC_URL   = "https://lxsnetwork.duckdns.org";
const CHAIN_ID  = 22540;
const FAUCET_URL = RPC_URL + "/faucet";
const STORE_KEY = "lxs_wallet_v1";

const NET = new ethers.Network("LXS", CHAIN_ID);
const provider = new ethers.JsonRpcProvider(RPC_URL, NET, { staticNetwork: NET });

let wallet = null;          // unlocked ethers.Wallet — in memory ONLY
let pendingWallet = null;   // a freshly created wallet awaiting backup + password

/* ---------- storage (encrypted keystore only) ---------- */
const getStored   = () => localStorage.getItem(STORE_KEY);
const setStored   = (j) => localStorage.setItem(STORE_KEY, j);
const clearStored = () => localStorage.removeItem(STORE_KEY);

/* ---------- ui helpers ---------- */
const SCREENS = ["setup", "create", "import", "unlock", "watch", "home"];
function show(id) {
  SCREENS.forEach(s => {
    const el = document.getElementById("screen-" + s);
    if (el) el.style.display = (s === id ? "block" : "none");
  });
}
function msg(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = "wmsg" + (kind ? " " + kind : "");
}
const fmt = (wei) => Number(ethers.formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 6 });

function boot() { show(getStored() ? "unlock" : "setup"); }

/* ---------- create a new wallet ---------- */
function startCreate() {
  pendingWallet = ethers.Wallet.createRandom();
  document.getElementById("create-address").textContent  = pendingWallet.address;
  document.getElementById("create-mnemonic").textContent = pendingWallet.mnemonic.phrase;
  msg("create-msg", "");
  document.getElementById("create-backup").checked = false;
  document.getElementById("create-pw").value = "";
  document.getElementById("create-pw2").value = "";
  show("create");
}
async function confirmCreate() {
  const pw  = document.getElementById("create-pw").value;
  const pw2 = document.getElementById("create-pw2").value;
  if (pw.length < 8)  return msg("create-msg", "Password must be at least 8 characters.", "err");
  if (pw !== pw2)     return msg("create-msg", "Passwords do not match.", "err");
  if (!document.getElementById("create-backup").checked)
    return msg("create-msg", "Please confirm you saved your recovery phrase.", "err");
  msg("create-msg", "Encrypting…");
  try {
    const json = await pendingWallet.encrypt(pw);
    setStored(json);
    wallet = pendingWallet.connect(provider);
    pendingWallet = null;
    openHome();
  } catch (e) { msg("create-msg", "Could not save wallet: " + (e.message || e), "err"); }
}

/* ---------- import an existing wallet ---------- */
async function confirmImport() {
  const secret = document.getElementById("import-secret").value.trim();
  const pw     = document.getElementById("import-pw").value;
  if (!secret) return msg("import-msg", "Paste your private key or recovery phrase.", "err");
  if (pw.length < 8) return msg("import-msg", "Password must be at least 8 characters.", "err");
  let w;
  try {
    if (secret.split(/\s+/).length >= 12) w = ethers.Wallet.fromPhrase(secret);
    else w = new ethers.Wallet(secret.startsWith("0x") ? secret : "0x" + secret);
  } catch (e) { return msg("import-msg", "That is not a valid private key or recovery phrase.", "err"); }
  msg("import-msg", "Encrypting…");
  try {
    const json = await w.encrypt(pw);
    setStored(json);
    wallet = w.connect(provider);
    openHome();
  } catch (e) { msg("import-msg", "Could not save wallet: " + (e.message || e), "err"); }
}

/* ---------- unlock / lock ---------- */
async function unlock() {
  const pw = document.getElementById("unlock-pw").value;
  if (!pw) return msg("unlock-msg", "Enter your password.", "err");
  msg("unlock-msg", "Unlocking…");
  try {
    const w = await ethers.Wallet.fromEncryptedJson(getStored(), pw);
    wallet = w.connect(provider);
    document.getElementById("unlock-pw").value = "";
    openHome();
  } catch (e) { msg("unlock-msg", "Wrong password.", "err"); }
}
function lock() { wallet = null; msg("home-msg", ""); show("unlock"); }

/* ---------- home ---------- */
function openHome() {
  document.getElementById("home-address").textContent = wallet.address;
  document.getElementById("home-secret").textContent = "";
  msg("home-msg", "");
  show("home");
  refreshBalance();
}
async function refreshBalance() {
  const el = document.getElementById("home-balance");
  el.textContent = "…";
  try {
    const bal = await provider.getBalance(wallet.address);
    el.textContent = fmt(bal);
  } catch (e) { el.textContent = "?"; msg("home-msg", "Could not reach the LXS network.", "err"); }
}
function copyAddress() {
  navigator.clipboard.writeText(wallet.address).then(
    () => msg("home-msg", "Address copied.", "ok"),
    () => msg("home-msg", wallet.address, "")
  );
}
async function send() {
  const to = document.getElementById("send-to").value.trim();
  const amount = document.getElementById("send-amount").value.trim();
  if (!ethers.isAddress(to)) return msg("home-msg", "Enter a valid LXS address (0x…).", "err");
  let value;
  try { value = ethers.parseEther(amount); } catch { return msg("home-msg", "Enter a valid amount.", "err"); }
  if (value <= 0n) return msg("home-msg", "Amount must be greater than 0.", "err");
  msg("home-msg", "Sending…");
  try {
    const fee = await provider.getFeeData();
    let gasPrice = fee.gasPrice ?? 1n;
    if (gasPrice < 1n) gasPrice = 1n;
    const tx = await wallet.sendTransaction({ to, value, type: 0, gasPrice });
    msg("home-msg", "Sent! Tx " + tx.hash.slice(0, 14) + "… — it confirms once the network mines a block.", "ok");
    document.getElementById("send-to").value = "";
    document.getElementById("send-amount").value = "";
    setTimeout(refreshBalance, 4000);
  } catch (e) {
    msg("home-msg", "Send failed: " + (e.shortMessage || e.message || e), "err");
  }
}
async function getGas() {
  msg("home-msg", "Requesting free gas…");
  try {
    const res = await fetch(FAUCET_URL, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: wallet.address })
    });
    const t = await res.text();
    msg("home-msg", res.ok ? "Gas requested — check your balance shortly." : ("Faucet: " + t), res.ok ? "ok" : "err");
    setTimeout(refreshBalance, 4000);
  } catch (e) { msg("home-msg", "Faucet unavailable right now.", "err"); }
}
async function reveal() {
  const pw = prompt("Enter your password to reveal your private key:");
  if (!pw) return;
  try {
    const w = await ethers.Wallet.fromEncryptedJson(getStored(), pw);
    document.getElementById("home-secret").textContent = w.privateKey;
  } catch { msg("home-msg", "Wrong password.", "err"); }
}
function removeWallet() {
  if (!confirm("Remove this wallet from THIS device? Make sure your recovery phrase / private key is backed up — this cannot be undone, and only that backup can restore your coins.")) return;
  clearStored(); wallet = null; boot();
}

/* ---------- watch-only addresses (view any LXS address, no key) ---------- */
const STORE_WATCH = "lxs_watch_v1";
const getWatch = () => { try { return JSON.parse(localStorage.getItem(STORE_WATCH)) || []; } catch (e) { return []; } };
const setWatch = (a) => localStorage.setItem(STORE_WATCH, JSON.stringify(a));

function showWatch() { show("watch"); msg("watch-msg", ""); renderWatch(); }
function watchBack() { if (wallet) openHome(); else boot(); }
function addWatch() {
  const v = document.getElementById("watch-input").value.trim();
  if (!ethers.isAddress(v)) return msg("watch-msg", "Enter a valid LXS address (0x…).", "err");
  const arr = getWatch(); if (!arr.includes(v)) arr.push(v); setWatch(arr);
  document.getElementById("watch-input").value = ""; msg("watch-msg", "");
  renderWatch();
}
function removeWatch(addr) { setWatch(getWatch().filter(a => a !== addr)); renderWatch(); }
async function renderWatch() {
  const list = document.getElementById("watch-list");
  const arr = getWatch();
  if (!arr.length) { list.innerHTML = '<p class="foot">No addresses yet — add one above.</p>'; document.getElementById("watch-total").textContent = "—"; return; }
  list.innerHTML = arr.map(a =>
    `<div class="addr"><div class="a">${a}</div><span class="wbal" id="wb_${a}">…</span><button class="ghost sm rmw" data-a="${a}">✕</button></div>`
  ).join("");
  list.querySelectorAll(".rmw").forEach(b => b.onclick = () => removeWatch(b.dataset.a));
  let total = 0n, done = 0;
  arr.forEach(a => {
    provider.getBalance(a).then(bal => {
      const el = document.getElementById("wb_" + a); if (el) el.textContent = fmt(bal) + " LXS";
      total += bal; if (++done === arr.length) document.getElementById("watch-total").textContent = fmt(total);
    }).catch(() => { const el = document.getElementById("wb_" + a); if (el) el.textContent = "—"; done++; });
  });
}

/* ---------- wire up ---------- */
window.addEventListener("DOMContentLoaded", () => {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on("btn-create", startCreate);
  on("btn-import", () => { msg("import-msg", ""); document.getElementById("import-secret").value=""; document.getElementById("import-pw").value=""; show("import"); });
  on("btn-confirm-create", confirmCreate);
  on("btn-confirm-import", confirmImport);
  on("btn-unlock", unlock);
  on("btn-lock", lock);
  on("btn-refresh", refreshBalance);
  on("btn-copy", copyAddress);
  on("btn-send", send);
  on("btn-getgas", getGas);
  on("btn-reveal", reveal);
  on("btn-watch", showWatch);
  on("btn-home-watch", showWatch);
  on("btn-watch-add", addWatch);
  on("btn-watch-back", watchBack);
  const wi = document.getElementById("watch-input");
  if (wi) wi.addEventListener("keydown", e => { if (e.key === "Enter") addWatch(); });
  setInterval(() => { const w = document.getElementById("screen-watch"); if (w && w.style.display !== "none") renderWatch(); }, 20000);
  document.querySelectorAll(".btn-remove").forEach(b => b.onclick = removeWallet);
  document.querySelectorAll(".back-setup").forEach(b => b.onclick = () => show(getStored() ? "unlock" : "setup"));
  document.getElementById("unlock-pw").addEventListener("keydown", e => { if (e.key === "Enter") unlock(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  boot();
});
