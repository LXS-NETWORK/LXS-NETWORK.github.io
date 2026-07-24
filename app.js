// ============================ CONFIG ============================
// All launch-time values live in config.js (window.LXS_CONFIG), loaded
// before this file. Do not hardcode them here — edit config.js instead.
const CONFIG = window.LXS_CONFIG || {
  RPC_URL: "http://127.0.0.1:8545",   // your PUBLIC LXS RPC (the server node)
  CHAIN_ID: 2254,
  FACTORY_ADDRESS: "",                // the deployed PumpFactory address (fill after you deploy it)
  FAUCET_URL: "",                     // gas faucet; empty = RPC_URL + "/faucet" (node -faucet)
};
const FAUCET_URL = CONFIG.FAUCET_URL || (CONFIG.RPC_URL.replace(/\/+$/, "") + "/faucet");
// ===============================================================

const CHAIN_ID_HEX = "0x" + CONFIG.CHAIN_ID.toString(16);
const CREATED_TOPIC = "0x4a1c716cc2323435ec5a77a7556c84da77d1ca36f6bd248bdd6e398a18ffe14b"; // Created(address,address,string,string,bytes)
const SEL = { name: "0x06fdde03", symbol: "0x95d89b41", reserveNative: "0xbf36b536", balanceOf: "0x70a08231",
  virtualNative: "0xff490386", curveTokens: "0x0d93caf7", totalSupply: "0x18160ddd",
  quoteBuy: "0x4beb394c", feeBps: "0x24a9d853",
  // graduation: once a curve fills, the coin moves to a standard LxsSwap pool
  graduated: "0xe7c2b772", pool: "0x16f0115b", getReserves: "0x0902f1ac", token0: "0x0dfe1681",
  allowance: "0xdd62ed3e", approve: "0x095ea7b3",
  // router (trade a graduated coin): quotes + swaps
  rQuoteBuy: "0x0d7a94f6", rQuoteSell: "0xd98b2f5c", rBuy: "0xe4848a9d", rSell: "0xe64e822c" };
const ROUTER = CONFIG.ROUTER_ADDRESS || "";
const WLXS = CONFIG.WLXS_ADDRESS || "";

let account = null;

function eth(method, params = []) {
  if (!window.ethereum) return Promise.reject(new Error("No wallet found — install MetaMask."));
  return window.ethereum.request({ method, params });
}

// readRpc makes a READ-ONLY call straight to the public LXS RPC — no wallet needed.
// This is what lets ANYONE browse the tokens other people have launched before (or
// without ever) connecting MetaMask. Signing anything (create/buy/sell) still goes
// through eth()/the wallet.
function readRpc(method, params = []) {
  return fetch(CONFIG.RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then(r => r.json()).then(j => {
    if (j.error) throw new Error(j.error.message || "rpc error");
    return j.result;
  });
}
const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";
const esc = (s) => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const padL = (h, n = 64) => h.replace(/^0x/, "").padStart(n, "0");
const uint = (bi) => padL(bi.toString(16));
const toWei = (n) => BigInt(Math.floor(Number(n) * 1e6)) * (10n ** 12n); // 6-dp precision * 1e12
const fromWei = (bi) => Number(bi / (10n ** 14n)) / 1e4;
// compact LXS display: thousands for big market caps, significant digits for tiny per-token prices
function fmtLxs(bi) {
  const n = Number(bi) / 1e18;
  if (n === 0) return "0";
  if (n >= 1000) return Math.round(n).toLocaleString("en-US");
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.0001) return (+n.toPrecision(3)).toString();
  // tiny per-token price — expand to a plain decimal, never scientific "e-7"
  const decimals = Math.min(-Math.floor(Math.log10(n)) + 2, 18);
  return n.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "");
}

function encBytes(bytes) {
  let hex = ""; for (const x of bytes) hex += x.toString(16).padStart(2, "0");
  if (hex.length % 64 !== 0) hex = hex.padEnd(hex.length + (64 - (hex.length % 64)), "0");
  return uint(BigInt(bytes.length)) + hex;
}
function encString(s) { return encBytes(new TextEncoder().encode(s)); }
function decodeString(hex) {
  hex = (hex || "").replace(/^0x/, "");
  if (hex.length < 128) return "";
  const len = parseInt(hex.slice(64, 128), 16);
  try { return new TextDecoder().decode(new Uint8Array(((hex.slice(128, 128 + len * 2)).match(/../g) || []).map(h => parseInt(h, 16)))); }
  catch { return ""; }
}
const ethCall = (to, data) => readRpc("eth_call", [{ to, data }, "latest"]); // read-only: works without a wallet
const addrFromWord = (w) => "0x" + w.replace(/^0x/, "").slice(24);

// ---------- calldata ----------
function createCalldata(name, symbol, imgBytes, minTokensOut) {
  const n = encString(name), s = encString(symbol), img = encBytes(imgBytes || new Uint8Array());
  const off = (h) => uint(BigInt(h));
  const nl = n.length / 2, sl = s.length / 2;
  // four head words: offsets to name, symbol, image, then the static minTokensOut (head is 0x80)
  const head = off(0x80) + off(0x80 + nl) + off(0x80 + nl + sl) + uint(BigInt(minTokensOut || 0));
  return "0xdf5c2a2e" + head + n + s + img;                 // create(string,string,bytes,uint256)
}
const buyCalldata = () => "0xd96a094a" + uint(0n);           // buy(minTokensOut=0)
const sellCalldata = (amtWei) => "0xd79875eb" + uint(amtWei) + uint(0n); // sell(amount, minNativeOut=0)

// ---------- coin image (a thumbnail carried in the Created event, no off-chain host) ----------
// Resize any uploaded picture to a small square JPEG so it fits under the 12 KB on-chain cap.
async function fileToThumb(file) {
  if (!file) return new Uint8Array();
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const S = 96, c = document.createElement("canvas"); c.width = S; c.height = S;
  const ctx = c.getContext("2d");
  const scale = Math.max(S / img.width, S / img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
  for (const q of [0.8, 0.6, 0.4]) {
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (buf.length <= 12288) return buf;            // under the on-chain cap
  }
  return new Uint8Array();                          // too big even at low quality — skip rather than revert
}
// Decode the JPEG thumbnail from a Created log's data into a data URL (or null if none).
function imageFromLog(dataHex) {
  const d = (dataHex || "").replace(/^0x/, "");
  const off = parseInt(d.slice(192, 256) || "0", 16) * 2;   // word3 = byte offset to the image
  if (!off || off + 64 > d.length) return null;
  const len = parseInt(d.slice(off, off + 64), 16);
  if (!len) return null;
  const bytesHex = d.slice(off + 64, off + 64 + len * 2);
  if (bytesHex.length < len * 2) return null;
  return "data:image/jpeg;base64," + hexToB64(bytesHex);
}
function hexToB64(hex) {
  let bin = ""; for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(bin);
}

// ---------- wallet ----------
async function connect() {
  try {
    account = (await eth("eth_requestAccounts"))[0];
    document.getElementById("connect").textContent = short(account);
    document.getElementById("create").disabled = false;
    document.getElementById("create").textContent = "Create token";
    document.getElementById("wallet").style.display = "";
    document.getElementById("wAddr").textContent = account;
    refreshBalance();
    loadCoins();
  } catch (e) { alert(e.message || e); }
}

// disconnect clears the wallet from THIS screen — the site never auto-shows an
// address, and this wipes it after use on a shared or public computer. It only
// forgets the connection locally (a dApp cannot truly un-approve MetaMask); the
// key and funds are untouched.
function disconnect() {
  account = null;
  document.getElementById("wallet").style.display = "none";
  document.getElementById("wAddr").textContent = "—";
  document.getElementById("wBal").textContent = "— LXS";
  document.getElementById("connect").textContent = "Connect Wallet";
  const create = document.getElementById("create");
  create.disabled = true;
  create.textContent = "Connect wallet to create";
}

// ---------- native LXS: balance + send ----------
async function refreshBalance() {
  if (!account) return;
  try {
    const bal = BigInt(await eth("eth_getBalance", [account, "latest"]) || "0x0");
    document.getElementById("wBal").textContent = fromWei(bal).toLocaleString() + " LXS";
  } catch { /* leave the last shown value */ }
}
// Get a little LXS for gas from the node's faucet — so a brand-new wallet (0 balance)
// can pay for its first action (e.g. creating a token). One claim per address.
async function getGas() {
  if (!account) return;
  const msg = document.getElementById("gasMsg");
  msg.className = "msg"; msg.textContent = "Requesting gas…";
  try {
    const res = await fetch(FAUCET_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: account }),
    });
    if (!res.ok) throw new Error((await res.text()).trim() || ("HTTP " + res.status));
    msg.className = "msg ok"; msg.textContent = "Gas sent — refreshing balance…";
    setTimeout(refreshBalance, 4000);
  } catch (e) { msg.className = "msg err"; msg.textContent = "Faucet: " + (e.message || e); }
}
async function sendLXS() {
  const to = document.getElementById("sendTo").value.trim();
  const amt = document.getElementById("sendAmt").value;
  const msg = document.getElementById("sendMsg");
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) { msg.className = "msg err"; msg.textContent = "Enter a valid 0x… address."; return; }
  if (!amt || Number(amt) <= 0) { msg.className = "msg err"; msg.textContent = "Enter an LXS amount to send."; return; }
  msg.className = "msg"; msg.textContent = "Confirm in your wallet…";
  try {
    const tx = await eth("eth_sendTransaction", [{ from: account, to, value: "0x" + toWei(amt).toString(16), gas: "0x5208" }]);
    msg.className = "msg ok"; msg.textContent = "Sent! " + short(tx);
    document.getElementById("sendAmt").value = "";
    setTimeout(refreshBalance, 1500);
  } catch (e) { msg.className = "msg err"; msg.textContent = e.message || String(e); }
}
async function addNetwork() {
  try {
    await eth("wallet_addEthereumChain", [{
      chainId: CHAIN_ID_HEX, chainName: "LXS", rpcUrls: [CONFIG.RPC_URL],
      nativeCurrency: { name: "LXS", symbol: "LXS", decimals: 18 },
    }]);
  } catch (e) { alert(e.message || e); }
}

// ---------- create ----------
async function createCoin() {
  const name = document.getElementById("name").value.trim();
  const symbol = document.getElementById("symbol").value.trim();
  const msg = document.getElementById("createMsg");
  if (!CONFIG.FACTORY_ADDRESS) { msg.className = "msg"; msg.textContent = "The token launchpad is launching soon."; return; }
  if (!name || !symbol) { msg.className = "msg err"; msg.textContent = "Fill in a name and symbol."; return; }
  msg.className = "msg"; msg.textContent = "Preparing image…";
  try {
    const img = await fileToThumb(document.getElementById("image").files[0]);
    // optional dev-buy: seed the coin with your own first buy IN THE SAME TX, so no sniper
    // can take the opening price between create and the first buy.
    const devBuy = document.getElementById("devbuy").value;
    const value = devBuy && Number(devBuy) > 0 ? "0x" + toWei(devBuy).toString(16) : "0x0";
    msg.textContent = "Confirm in your wallet…";
    // 1.3M covers a plain create (~1.02M–1.17M); a create+buy needs more, so raise the limit then
    const gas = value === "0x0" ? "0x13D620" : "0x1E8480";
    const tx = await eth("eth_sendTransaction", [{ from: account, to: CONFIG.FACTORY_ADDRESS, data: createCalldata(name, symbol, img, 0), value, gas }]);
    msg.className = "msg ok"; msg.textContent = "Token created! " + short(tx) + " — it's now live and tradeable.";
    setTimeout(loadCoins, 1500);
  } catch (e) { msg.className = "msg err"; msg.textContent = e.message || String(e); }
}

// ---------- deterministic coin icon (generated from the address; no storage, no upload) ----------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A unique 5x5 mirrored identicon per coin — same address always yields the same
// icon, so every viewer sees the same picture with zero shared storage.
function coinIcon(addr) {
  const h = (addr || "0x0").replace(/^0x/, "").toLowerCase().padStart(8, "0");
  const rnd = mulberry32(parseInt(h.slice(0, 8), 16) >>> 0);
  const hue = Math.floor(rnd() * 360);
  const fg = `hsl(${hue},65%,56%)`;
  const spot = `hsl(${(hue + 70) % 360},72%,62%)`;
  const bg = `hsl(${hue},26%,13%)`;
  let cells = "";
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (rnd() > 0.5) {
      const c = rnd() > 0.85 ? spot : fg;
      cells += `<rect x="${x}" y="${y}" width="1.03" height="1.03" fill="${c}"/>`;
      if (x < 2) cells += `<rect x="${4 - x}" y="${y}" width="1.03" height="1.03" fill="${c}"/>`;
    }
  }
  return `<svg class="ic" viewBox="0 0 5 5" preserveAspectRatio="xMidYMid meet" style="background:${bg}" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`;
}

// ---------- list + trade ----------
// Reads the curve state that prices a coin. price/market-cap come straight from the curve:
// eff = virtualNative + reserveNative; price = eff/curveTokens; marketCap = price * totalSupply.
async function curveStats(coin) {
  const [nm, sym, reserve, vnat, ctok, tsup, bal, gradHex] = await Promise.all([
    ethCall(coin, SEL.name).then(decodeString),
    ethCall(coin, SEL.symbol).then(decodeString),
    ethCall(coin, SEL.reserveNative).then(h => BigInt(h || "0x0")),
    ethCall(coin, SEL.virtualNative).then(h => BigInt(h || "0x0")),
    ethCall(coin, SEL.curveTokens).then(h => BigInt(h || "0x0")),
    ethCall(coin, SEL.totalSupply).then(h => BigInt(h || "0x0")),
    account ? ethCall(coin, SEL.balanceOf + padL(account)).then(h => BigInt(h || "0x0")) : Promise.resolve(0n),
    ethCall(coin, SEL.graduated).then(h => BigInt(h || "0x0")).catch(() => 0n),
  ]);
  // Graduated: the curve is closed and the coin trades on a standard LxsSwap pool.
  // Price/market-cap/liquidity now come from the pool's reserves, not the curve.
  if (gradHex !== 0n) {
    const pool = "0x" + (await ethCall(coin, SEL.pool)).slice(-40);
    const [t0, resHex] = await Promise.all([
      ethCall(pool, SEL.token0).then(h => "0x" + h.slice(-40)),
      ethCall(pool, SEL.getReserves),
    ]);
    const r0 = BigInt("0x" + resHex.slice(2, 66)), r1 = BigInt("0x" + resHex.slice(66, 130));
    const coinIs0 = t0.toLowerCase() === coin.toLowerCase();
    const rTok = coinIs0 ? r0 : r1, rLxs = coinIs0 ? r1 : r0;
    const price = rTok > 0n ? (rLxs * (10n ** 18n)) / rTok : 0n;
    const mc = rTok > 0n ? (rLxs * tsup) / rTok : 0n;
    return { coin, nm, sym, reserve: rLxs, price, mc, bal, progress: 100, tsup, vnat, ctok: rTok, graduated: true, pool };
  }
  const eff = vnat + reserve;
  const price = ctok > 0n ? (eff * (10n ** 18n)) / ctok : 0n;   // LXS-wei per 1 token
  const mc = ctok > 0n ? (eff * tsup) / ctok : 0n;              // market cap in LXS-wei
  const sold = tsup > ctok ? tsup - ctok : 0n;
  const progress = tsup > 0n ? Number((sold * 10000n) / tsup) / 100 : 0;
  return { coin, nm, sym, reserve, price, mc, bal, progress, tsup, vnat, ctok, graduated: false, pool: null };
}

async function loadCoins() {
  const box = document.getElementById("coins");
  if (!CONFIG.FACTORY_ADDRESS) { box.innerHTML = '<p class="dim">The token launchpad is launching soon — check back shortly.</p>'; return; }
  box.innerHTML = '<p class="dim">Loading…</p>';
  try {
    const latest = parseInt(await readRpc("eth_blockNumber"), 16);
    const from = Math.max(0, latest - 9000);
    const logs = await readRpc("eth_getLogs", [{
      address: CONFIG.FACTORY_ADDRESS, fromBlock: "0x" + from.toString(16), toBlock: "latest",
      topics: [CREATED_TOPIC],
    }]);
    if (!logs.length) { box.innerHTML = '<p class="dim">No tokens yet — launch the first one.</p>'; return; }
    // first data word = coin address; the thumbnail rides later in the same log
    const coins = logs.map(lg => ({ addr: addrFromWord(lg.data.slice(0, 66)), img: imageFromLog(lg.data), block: parseInt(lg.blockNumber, 16) || 0 }));
    // fetch every coin's curve state, then rank by market cap so the ones with real buying float to the top
    const stats = (await Promise.all(coins.map(async c => {
      const st = await curveStats(c.addr).catch(() => null);
      if (st) { st.img = c.img; st.block = c.block; }
      return st;
    }))).filter(Boolean);
    stats.sort((a, b) => (a.mc < b.mc ? 1 : a.mc > b.mc ? -1 : 0));
    box.innerHTML = "";
    for (const st of stats) renderCoin(box, st);
  } catch (e) { box.innerHTML = '<p class="dim">Couldn\'t reach the network — tokens appear here once a live LXS node is up.</p>'; }
}

function renderCoin(box, st) {
  const { coin, nm, sym, reserve, price, mc, bal, progress } = st;
  const card = document.createElement("div"); card.className = "coin";
  const pct = Math.min(100, Math.max(0, progress)).toFixed(1);
  card.innerHTML =
    `<div class="chead">${st.img ? `<img class="ic" src="${st.img}" alt="" onerror="this.style.visibility='hidden'">` : coinIcon(coin)}<div class="cmeta"><div class="sym">${esc(sym) || "?"}</div><div class="nm">${esc(nm) || ""}</div></div>
       <div class="mc">MC ${fmtLxs(mc)} LXS</div></div>
     <div class="bar"><span style="width:${pct}%"></span></div>
     <div class="sup">price ${fmtLxs(price)} · liq ${fromWei(reserve)} LXS · ${pct}% sold · you ${fromWei(bal)} ${esc(sym)}</div>
     <div class="addr">${coin}</div>
     <div class="trade">
       <input class="buyAmt" type="number" placeholder="LXS" step="0.01" min="0">
       <button class="buy">Buy</button>
       <input class="sellAmt" type="number" placeholder="${esc(sym)}" step="1" min="0">
       <button class="sell ghost">Sell</button>
     </div>`;
  card.querySelector(".buy").onclick = (e) => { e.stopPropagation(); buy(coin, card.querySelector(".buyAmt").value); };
  card.querySelector(".sell").onclick = (e) => { e.stopPropagation(); sell(coin, card.querySelector(".sellAmt").value); };
  // Clicking the card (anywhere but the trade inputs) opens the full token view with a price chart.
  card.querySelector(".chead").onclick = () => openToken(coin, st.img, st.block);
  card.querySelector(".sup").onclick = () => openToken(coin, st.img, st.block);
  card.querySelector(".chead").style.cursor = "pointer";
  box.appendChild(card);
}

async function buy(coin, lxs) {
  if (!lxs || Number(lxs) <= 0) return alert("Enter an LXS amount to spend.");
  try {
    await eth("eth_sendTransaction", [{ from: account, to: coin, data: buyCalldata(), value: "0x" + toWei(lxs).toString(16), gas: "0x30D40" }]);
    setTimeout(loadCoins, 1500); setTimeout(refreshBalance, 1500);
  } catch (e) { alert(e.message || e); }
}
async function sell(coin, amount) {
  if (!amount || Number(amount) <= 0) return alert("Enter a token amount to sell.");
  try {
    await eth("eth_sendTransaction", [{ from: account, to: coin, data: sellCalldata(toWei(amount)), gas: "0x30D40" }]);
    setTimeout(loadCoins, 1500); setTimeout(refreshBalance, 1500);
  } catch (e) { alert(e.message || e); }
}

// Once a coin has graduated it no longer trades on its curve — buy/sell go through
// the LxsSwap router (native LXS <-> token, one atomic tx, 20-min deadline).
const DEADLINE = () => BigInt(Math.floor(Date.now() / 1000) + 1200);
async function routerBuy(coin, lxs) {
  if (!ROUTER) return alert("Router not configured.");
  const data = SEL.rBuy + padL(coin) + uint(0n) + padL(account) + uint(DEADLINE());
  await eth("eth_sendTransaction", [{ from: account, to: ROUTER, data, value: "0x" + toWei(lxs).toString(16), gas: "0x7A120" }]);
  setTimeout(loadCoins, 1500); setTimeout(refreshBalance, 1500);
}
async function routerSell(coin, amount) {
  if (!ROUTER) return alert("Router not configured.");
  const wei = toWei(amount);
  const allowed = BigInt(await ethCall(coin, SEL.allowance + padL(account) + padL(ROUTER)) || "0x0");
  if (allowed < wei) { // one-time approval so the router can pull the tokens
    await eth("eth_sendTransaction", [{ from: account, to: coin, data: SEL.approve + padL(ROUTER) + uint(wei), gas: "0x186A0" }]);
  }
  const data = SEL.rSell + padL(coin) + uint(wei) + uint(0n) + padL(account) + uint(DEADLINE());
  await eth("eth_sendTransaction", [{ from: account, to: ROUTER, data, gas: "0x7A120" }]);
  setTimeout(loadCoins, 1500); setTimeout(refreshBalance, 1500);
}

// ---------- token detail view + price chart ----------
let tmCoin = null, tmImg = null, tmBlock = 0, tmTimer = null;

// One round-trip for the chart's many samples (JSON-RPC batch).
async function readBatch(calls) {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }));
  const res = await fetch(CONFIG.RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const arr = await res.json();
  const out = []; for (const r of (Array.isArray(arr) ? arr : [])) out[r.id] = r.result;
  return out;
}

// Real price-over-time: sample the bonding curve at up to 40 blocks. The node keeps
// ~128 blocks of state, so we sample from max(createdBlock, latest-120) to now.
// price = (virtualNative + reserveNative) / curveTokens at each sampled block.
// Real price history from Buy/Sell trade events. (The node returns only the LATEST
// state for historical eth_call, so we can't sample the curve at old blocks — but logs
// are always available.) Each trade's execution price = native/tokens exchanged.
const BUY_TOPIC = "0x1cbc5ab135991bd2b6a4b034a04aa2aa086dac1371cb9b16b8b5e2ed6b036bed";
const SELL_TOPIC = "0xed7a144fad14804d5c249145e3e0e2b63a9eb455b76aee5bc92d711e9bba3e4a";
async function priceHistory(coin, createdBlock) {
  try {
    const from = "0x" + Math.max(0, (createdBlock || 1) - 1).toString(16);
    const logs = await readRpc("eth_getLogs", [{ address: coin, fromBlock: from, toBlock: "latest", topics: [[BUY_TOPIC, SELL_TOPIC]] }]);
    if (!Array.isArray(logs) || logs.length < 1) return null;
    logs.sort((a, b) => (parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16)) || (parseInt(a.logIndex || "0x0", 16) - parseInt(b.logIndex || "0x0", 16)));
    const pts = [];
    for (const l of logs) {
      const d = (l.data || "0x").slice(2);
      if (d.length < 128) continue;
      const a = BigInt("0x" + d.slice(0, 64)), b = BigInt("0x" + d.slice(64, 128));
      const isBuy = (l.topics[0] || "").toLowerCase() === BUY_TOPIC;
      // buy: nativeIn / tokensOut · sell: nativeOut / tokensIn
      const num = isBuy ? a : b, den = isBuy ? b : a;
      if (den === 0n) continue;
      const price = Number(num * (10n ** 18n) / den) / 1e18;
      if (price > 0) pts.push({ ts: pts.length, price }); // even x-spacing per trade
    }
    return pts.length >= 2 ? pts : null;
  } catch (e) { return null; }
}

function drawTChart(canvas, pts) {
  const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height, pad = 10;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = pad + (H - 2 * pad) * i / 4; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke(); }
  if (!pts || pts.length < 2) {
    ctx.fillStyle = "#8b93a7"; ctx.font = "13px system-ui,sans-serif"; ctx.textAlign = "center";
    ctx.fillText("No trades yet — price appears once the curve moves", W / 2, H / 2); return;
  }
  const xs = pts.map(p => p.ts), ys = pts.map(p => p.price);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = t => pad + (W - 2 * pad) * (x1 === x0 ? 0.5 : (t - x0) / (x1 - x0));
  const Y = v => H - pad - (H - 2 * pad) * (y1 === y0 ? 0.5 : (v - y0) / (y1 - y0));
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(70,229,161,.28)"); g.addColorStop(1, "rgba(58,160,255,.02)");
  ctx.beginPath(); ctx.moveTo(X(xs[0]), H - pad); pts.forEach(p => ctx.lineTo(X(p.ts), Y(p.price)));
  ctx.lineTo(X(xs[xs.length - 1]), H - pad); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  const lg = ctx.createLinearGradient(0, 0, W, 0); lg.addColorStop(0, "#46e5a1"); lg.addColorStop(1, "#3aa0ff");
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(X(p.ts), Y(p.price)) : ctx.moveTo(X(p.ts), Y(p.price)));
  ctx.strokeStyle = lg; ctx.lineWidth = 2.2; ctx.lineJoin = "round"; ctx.stroke();
  ctx.beginPath(); ctx.arc(X(xs[xs.length - 1]), Y(ys[ys.length - 1]), 3.5, 0, 7); ctx.fillStyle = "#46e5a1"; ctx.fill();
}

async function openToken(coin, img, createdBlock) {
  tmCoin = coin; tmImg = img; tmBlock = createdBlock || 0;
  if (!location.hash.includes(coin)) { try { history.replaceState(null, "", "#/token/" + coin); } catch (e) {} } // shareable link
  const m = document.getElementById("tokenModal"); m.classList.add("open"); document.body.style.overflow = "hidden";
  document.getElementById("tm-ic").innerHTML = img ? `<img src="${img}" alt="" onerror="this.style.visibility='hidden'">` : coinIcon(coin);
  document.getElementById("tm-addr").textContent = coin;
  document.getElementById("tm-sym").textContent = "…"; document.getElementById("tm-nm").textContent = "";
  ["tm-price", "tm-mc", "tm-liq", "tm-sup", "tm-prog"].forEach(id => document.getElementById(id).textContent = "…");
  document.getElementById("tm-chg").textContent = "";
  drawTChart(document.getElementById("tm-chart"), null);
  tState = null; setMode("buy"); // fresh swap card for this token
  await renderTM(coin, createdBlock);
  // Auto-refresh while the token is open, so price + chart update live as trades land.
  clearInterval(tmTimer);
  tmTimer = setInterval(() => { tmCoin === coin ? renderTM(coin, createdBlock) : clearInterval(tmTimer); }, 15000);
}

// Fetch the coin's live curve state + price history and paint the open modal.
async function renderTM(coin, createdBlock) {
  const st = await curveStats(coin).catch(() => null);
  if (!st || tmCoin !== coin) return;
  document.getElementById("tm-sym").textContent = st.sym || "?";
  document.getElementById("tm-nm").textContent = st.nm || "";
  document.getElementById("tm-price").textContent = fmtLxs(st.price);
  document.getElementById("tm-mc").textContent = fmtLxs(st.mc) + " LXS";
  document.getElementById("tm-liq").textContent = fromWei(st.reserve) + " LXS";
  document.getElementById("tm-sup").textContent = fmtLxs(st.tsup);
  document.getElementById("tm-prog").textContent = st.graduated ? "Graduated ✓" : Math.min(100, Math.max(0, st.progress)).toFixed(1) + "%";
  const hintEl = document.getElementById("tm-hint");
  if (hintEl) hintEl.textContent = st.graduated
    ? "Now trading on the LxsSwap DEX pool (0.30% fee) — liquidity is locked."
    : "Estimate — includes a 1% trade fee. Price moves along the bonding curve as people trade.";
  // populate the swap card: fee (immutable, fetched once) + fresh balances
  let feeBps = (tState && tState.coin === coin) ? tState.feeBps : null;
  if (feeBps == null) feeBps = await ethCall(coin, SEL.feeBps).then(h => parseInt(h || "0x64", 16) || 100).catch(() => 100);
  const lxsBal = account ? BigInt(await eth("eth_getBalance", [account, "latest"]).catch(() => "0x0") || "0x0") : 0n;
  if (tmCoin === coin) {
    tState = { coin, sym: st.sym, reserve: st.reserve, vnat: st.vnat, ctok: st.ctok, feeBps, tokBal: st.bal, lxsBal, graduated: st.graduated, pool: st.pool };
    paintTrade();
    if (document.getElementById("tm-amt").value) updateQuote();
  }
  const pts = await priceHistory(coin, createdBlock);
  if (tmCoin !== coin) return;
  drawTChart(document.getElementById("tm-chart"), pts);
  const el = document.getElementById("tm-chg");
  if (pts && pts.length >= 2 && pts[0].price > 0) {
    const chg = (pts[pts.length - 1].price - pts[0].price) / pts[0].price * 100;
    el.textContent = (chg >= 0 ? "▲ +" : "▼ ") + chg.toFixed(1) + "%";
    el.className = "tchg " + (chg >= 0 ? "up" : "down");
  } else { el.textContent = ""; }
}
function closeToken() { tmCoin = null; clearInterval(tmTimer); document.getElementById("tokenModal").classList.remove("open"); document.body.style.overflow = ""; try { history.replaceState(null, "", location.pathname); } catch (e) {} }

// Deep-link: opening tokens.html#/token/0x… (a shared link) jumps straight to that token.
function openTokenFromHash() {
  const m = location.hash.match(/token\/(0x[0-9a-fA-F]{40})/);
  if (m) openToken(m[1], null, 0);
}
window.addEventListener("hashchange", openTokenFromHash);

document.getElementById("tm-close").onclick = closeToken;
document.getElementById("tokenModal").addEventListener("click", (e) => { if (e.target.id === "tokenModal") closeToken(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeToken(); });
// ---------- swap card (buy/sell with live quote) ----------
let tMode = "buy", tState = null, tQuoteTimer = null;
function fmtTok(n) {
  if (!isFinite(n) || n <= 0) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1000) return Math.round(n).toLocaleString("en-US");
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
function setMode(mode) {
  tMode = mode;
  document.getElementById("tm-tab-buy").classList.toggle("active", mode === "buy");
  document.getElementById("tm-tab-sell").classList.toggle("active", mode === "sell");
  document.getElementById("tm-action").className = "tbtn " + mode;
  document.getElementById("tm-paylbl").textContent = mode === "buy" ? "You pay" : "You sell";
  document.getElementById("tm-paysym").textContent = mode === "buy" ? "LXS" : (tState && tState.sym || "tokens");
  document.getElementById("tm-recvsym").textContent = mode === "buy" ? (tState && tState.sym || "tokens") : "LXS";
  document.getElementById("tm-amt").value = "";
  document.getElementById("tm-recv").textContent = "0";
  paintTrade();
}
function paintTrade() {
  const availB = document.getElementById("tm-avail"), availS = document.getElementById("tm-availsym"), quick = document.getElementById("tm-quick");
  const sym = tState && tState.sym || "";
  if (!account) { availB.textContent = "connect"; availS.textContent = ""; }
  else if (tMode === "buy") { availB.textContent = tState ? fromWei(tState.lxsBal).toLocaleString("en-US") : "…"; availS.textContent = "LXS"; }
  else { availB.textContent = tState ? fmtTok(fromWei(tState.tokBal)) : "…"; availS.textContent = sym; }
  quick.innerHTML = "";
  const add = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = fn; quick.appendChild(b); };
  if (tMode === "buy") [1, 10, 100, 1000].forEach(a => add(a >= 1000 ? "1K" : "" + a, () => { document.getElementById("tm-amt").value = a; updateQuote(); }));
  else [25, 50, 100].forEach(p => add(p === 100 ? "MAX" : p + "%", () => { if (tState) { document.getElementById("tm-amt").value = fromWei(tState.tokBal * BigInt(p) / 100n); updateQuote(); } }));
  document.getElementById("tm-action").textContent = (tMode === "buy" ? "Buy " : "Sell ") + sym;
}
function updateQuote() {
  clearTimeout(tQuoteTimer);
  const recv = document.getElementById("tm-recv");
  const amt = parseFloat(document.getElementById("tm-amt").value);
  if (!tState || !amt || amt <= 0) { recv.textContent = "0"; return; }
  recv.textContent = "…";
  tQuoteTimer = setTimeout(async () => {
    try {
      if (tState.graduated) { // quote against the LxsSwap pool via the router
        const sel = tMode === "buy" ? SEL.rQuoteBuy : SEL.rQuoteSell;
        const out = BigInt(await ethCall(ROUTER, sel + padL(tState.coin) + uint(toWei(amt))) || "0x0");
        recv.textContent = tMode === "buy" ? fmtTok(fromWei(out)) : fromWei(out).toLocaleString("en-US");
      } else if (tMode === "buy") {
        const out = BigInt(await ethCall(tState.coin, SEL.quoteBuy + uint(toWei(amt))) || "0x0");
        recv.textContent = fmtTok(fromWei(out));
      } else {
        const amtWei = toWei(amt), eff = tState.vnat + tState.reserve, ctok = tState.ctok;
        const gross = ctok + amtWei > 0n ? eff - (eff * ctok) / (ctok + amtWei) : 0n;
        const out = gross - (gross * BigInt(tState.feeBps)) / 10000n;
        recv.textContent = fromWei(out < 0n ? 0n : out).toLocaleString("en-US");
      }
    } catch { recv.textContent = "—"; }
  }, 280);
}
document.getElementById("tm-tab-buy").onclick = () => setMode("buy");
document.getElementById("tm-tab-sell").onclick = () => setMode("sell");
document.getElementById("tm-amt").oninput = updateQuote;
document.getElementById("tm-max").onclick = () => { if (tState && account) { document.getElementById("tm-amt").value = tMode === "buy" ? fromWei(tState.lxsBal) : fromWei(tState.tokBal); updateQuote(); } else if (!account) connect(); };
document.getElementById("tm-action").onclick = async () => {
  if (!account) { await connect(); return; }
  if (!tState) return;
  const amt = document.getElementById("tm-amt").value;
  if (!amt || Number(amt) <= 0) return alert("Enter an amount.");
  const c = tState.coin;
  if (tState.graduated) await (tMode === "buy" ? routerBuy(c, amt) : routerSell(c, amt));
  else await (tMode === "buy" ? buy(c, amt) : sell(c, amt));
  document.getElementById("tm-amt").value = ""; document.getElementById("tm-recv").textContent = "0";
  setTimeout(() => { if (tmCoin === c) renderTM(c, tmBlock); }, 2500);
};

// ---------- wire ----------
document.getElementById("connect").onclick = connect;
document.getElementById("addNet").onclick = addNetwork;
document.getElementById("create").onclick = createCoin;
document.getElementById("refresh").onclick = loadCoins;
document.getElementById("sendBtn").onclick = sendLXS;
document.getElementById("getGas").onclick = getGas;
document.getElementById("disconnect").onclick = disconnect;
// No auto-connect: the site shows NO address until the visitor clicks "Connect
// Wallet". On a shared/external computer nothing is exposed by simply opening
// the page — and "Disconnect" clears it again afterwards.
// Load the community's tokens immediately, read-only — no wallet needed to browse.
loadCoins();
openTokenFromHash(); // honor a shared #/token/… link on first load
// keep the balance fresh while the page is open
setInterval(refreshBalance, 15000);
