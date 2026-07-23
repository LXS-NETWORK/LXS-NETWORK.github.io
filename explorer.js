/* LXS Block Explorer — a full client-side explorer (like Etherscan) for the LXS
   chain. Reads everything straight from the public RPC. No backend, no indexer:
   address history is built by scanning blocks on demand (the chain is small). */

const RPC = "https://lxsnetwork.duckdns.org";
const CHAIN_ID = 22540;
const SCAN_CAP = 30000;   // deepest block scan for an address history
const BATCH = 40;         // blocks per batched RPC request

/* ---------- rpc ---------- */
let _id = 0;
async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++_id, method, params }) });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || "rpc error");
  return d.result;
}
async function rpcBatch(calls) {
  const body = calls.map(c => ({ jsonrpc: "2.0", id: ++_id, method: c.method, params: c.params }));
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const arr = await r.json();
  const byId = {}; arr.forEach(x => byId[x.id] = x.result);
  return body.map(b => byId[b.id]);
}

/* ---------- format ---------- */
const toInt = (h) => h == null ? 0 : parseInt(h, 16);
const toBig = (h) => h == null ? 0n : BigInt(h);
function lxs(wei) {
  const b = toBig(wei); const whole = b / 10n ** 18n; const frac = b % 10n ** 18n;
  let f = frac.toString().padStart(18, "0").replace(/0+$/, "");
  return grp(whole.toString()) + (f ? "." + f : "");
}
function grp(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
const shortHash = (h) => h ? h.slice(0, 12) + "…" + h.slice(-8) : "—";
const shortAddr = (a) => a ? a.slice(0, 10) + "…" + a.slice(-6) : "—";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function age(tsHex) {
  const ts = toInt(tsHex); if (!ts) return "—";
  let s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return s + " sec" + (s === 1 ? "" : "s") + " ago";
  if (s < 3600) { const m = Math.floor(s / 60); return m + " min" + (m === 1 ? "" : "s") + " ago"; }
  if (s < 86400) { const h = Math.floor(s / 3600); return h + " hr" + (h === 1 ? "" : "s") + " ago"; }
  const d = Math.floor(s / 86400); return d + " day" + (d === 1 ? "" : "s") + " ago";
}
const dateStr = (tsHex) => { const ts = toInt(tsHex); return ts ? new Date(ts * 1000).toLocaleString() : "—"; };
function coinsMined(h) { let r = 25, era = 1e6, t = 0; while (h > 0 && r >= 1e-9) { const k = Math.min(h, era); t += k * r; h -= k; r /= 2; } return t; }
function blockReward(h) { let r = 25; const era = Math.floor(h / 1e6); for (let i = 0; i < era; i++) r /= 2; return r; }
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

/* links */
const aBlock = (n, txt) => `<a href="#/block/${n}">${txt == null ? "#" + grp(String(n)) : txt}</a>`;
const aTx = (h) => `<a class="mono" href="#/tx/${h}">${shortHash(h)}</a>`;
const aAddr = (a, mono = true) => a ? `<a class="${mono ? "mono" : ""}" href="#/address/${a}">${shortAddr(a)}</a>` : `<span class="dim">—</span>`;
const copy = (v) => `<button class="cp" title="Copy" data-cp="${esc(v)}">⧉</button>`;

/* ---------- shell ---------- */
const $ = (id) => document.getElementById(id);
function setContent(html) { $("exp-content").innerHTML = html; wireCopies(); }
function wireCopies() {
  document.querySelectorAll(".cp").forEach(b => b.onclick = () => {
    const v = b.dataset.cp; const t = document.createElement("textarea"); t.value = v; document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); } catch (e) {}
    try { if (navigator.clipboard) navigator.clipboard.writeText(v); } catch (e) {}
    t.remove(); const o = b.textContent; b.textContent = "✓"; setTimeout(() => b.textContent = o, 1000);
  });
}
function loading(what) { setContent(`<div class="loading">Loading ${esc(what)}…</div>`); }
function errBox(msg) { setContent(`<div class="card"><h2>Not found</h2><p class="dim">${esc(msg)}</p><p><a href="#/">← Back to explorer home</a></p></div>`); }

/* ---------- search ---------- */
function doSearch(q) {
  q = (q || "").trim();
  if (!q) return;
  if (/^0x[0-9a-fA-F]{64}$/.test(q)) { location.hash = "#/tx/" + q; return; }      // tx or block hash
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) { location.hash = "#/address/" + q; return; }  // address
  if (/^\d+$/.test(q)) { location.hash = "#/block/" + q; return; }                  // block number
  alert("Enter a block number, a 0x… address, a tx hash, or a block hash.");
}

/* ---------- HOME ---------- */
async function renderHome() {
  loading("the LXS chain");
  try {
    const [num, gp] = await Promise.all([rpc("eth_blockNumber"), rpc("eth_gasPrice").catch(() => "0x1")]);
    const height = toInt(num);
    // last up to 12 blocks
    const from = Math.max(0, height - 11);
    const calls = [];
    for (let n = height; n >= from; n--) calls.push({ method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), true] });
    const blocks = (await rpcBatch(calls)).filter(Boolean);
    const latest = blocks[0] || {};
    // block time from oldest→newest of what we fetched
    let bt = "—";
    const timed = blocks.filter(b => toInt(b.number) >= 1); // genesis has an artificial timestamp
    if (timed.length >= 2) {
      const dt = toInt(timed[0].timestamp) - toInt(timed[1].timestamp); // most recent interval
      if (dt > 0) bt = dt >= 60 ? (dt / 60).toFixed(1) + " min" : dt + " s";
    }
    const mined = coinsMined(height);
    // recent txs from these blocks
    let txs = [];
    blocks.forEach(b => (b.transactions || []).forEach(t => txs.push({ ...t, ts: b.timestamp })));
    txs = txs.slice(0, 12);

    const stat = (label, val) => `<div class="stat"><div class="sl">${label}</div><div class="sv">${val}</div></div>`;
    const blockRows = blocks.map(b => `<tr>
      <td>${aBlock(toInt(b.number))}</td>
      <td class="dim">${age(b.timestamp)}</td>
      <td>${aAddr(b.miner)}</td>
      <td class="r">${(b.transactions || []).length} txn</td>
      <td class="r dim">${grp(String(toInt(b.gasUsed)))}</td></tr>`).join("");
    const txRows = txs.length ? txs.map(t => `<tr>
      <td>${aTx(t.hash)}</td>
      <td class="dim">${age(t.ts)}</td>
      <td>${aAddr(t.from)}</td>
      <td>${t.to ? aAddr(t.to) : '<span class="tag">Contract creation</span>'}</td>
      <td class="r">${lxs(t.value)} LXS</td></tr>`).join("")
      : `<tr><td colspan="5" class="dim" style="text-align:center;padding:18px">No transactions yet</td></tr>`;

    setContent(`
      <div class="stats">
        ${stat("Latest block", aBlock(height))}
        ${stat("Coins mined", grp(Math.round(mined).toString()) + " LXS")}
        ${stat("Block reward", blockReward(height) + " LXS")}
        ${stat("Avg block time", bt)}
        ${stat("Difficulty", grp(String(toInt(latest.difficulty))))}
        ${stat("Gas price", grp(String(toInt(gp))) + " wei")}
      </div>
      <div class="two">
        <div class="card"><div class="ch"><h2>Latest blocks</h2><a href="#/blocks">View all →</a></div>
          <table class="tbl"><thead><tr><th>Block</th><th>Age</th><th>Miner</th><th class="r">Txns</th><th class="r">Gas used</th></tr></thead><tbody>${blockRows}</tbody></table></div>
        <div class="card"><div class="ch"><h2>Latest transactions</h2></div>
          <table class="tbl"><thead><tr><th>Tx hash</th><th>Age</th><th>From</th><th>To</th><th class="r">Value</th></tr></thead><tbody>${txRows}</tbody></table></div>
      </div>`);
  } catch (e) { errBox("Could not reach the LXS network. " + e.message); }
}

/* ---------- BLOCKS list ---------- */
async function renderBlocks(page) {
  loading("blocks");
  try {
    const height = toInt(await rpc("eth_blockNumber"));
    const per = 25; const start = height - page * per;
    const from = Math.max(0, start - per + 1);
    const calls = [];
    for (let n = start; n >= from; n--) if (n >= 0) calls.push({ method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), false] });
    const blocks = (await rpcBatch(calls)).filter(Boolean);
    const rows = blocks.map(b => `<tr>
      <td>${aBlock(toInt(b.number))}</td>
      <td class="dim">${age(b.timestamp)}</td>
      <td class="dim">${dateStr(b.timestamp)}</td>
      <td>${aAddr(b.miner)}</td>
      <td class="r">${(b.transactions || []).length}</td>
      <td class="r dim">${grp(String(toInt(b.gasUsed)))}</td></tr>`).join("");
    const nav = `<div class="pager">${page > 0 ? `<a href="#/blocks/${page - 1}">← Newer</a>` : `<span class="dim">← Newer</span>`}
      <span class="dim">Page ${page + 1}</span>
      ${from > 0 ? `<a href="#/blocks/${page + 1}">Older →</a>` : `<span class="dim">Older →</span>`}</div>`;
    setContent(`<div class="card"><div class="ch"><h2>Blocks</h2><span class="dim">${grp(String(height + 1))} total</span></div>
      <table class="tbl"><thead><tr><th>Block</th><th>Age</th><th>Time</th><th>Miner</th><th class="r">Txns</th><th class="r">Gas used</th></tr></thead><tbody>${rows}</tbody></table>${nav}</div>`);
  } catch (e) { errBox(e.message); }
}

/* ---------- BLOCK detail ---------- */
async function renderBlock(id) {
  loading("block " + id);
  try {
    const isHash = /^0x[0-9a-fA-F]{64}$/.test(id);
    const b = isHash ? await rpc("eth_getBlockByHash", [id, true]) : await rpc("eth_getBlockByNumber", ["0x" + parseInt(id, 10).toString(16), true]);
    if (!b) return errBox("Block " + id + " does not exist.");
    const n = toInt(b.number), height = toInt(await rpc("eth_blockNumber"));
    const gu = toInt(b.gasUsed), gl = toInt(b.gasLimit), pct = gl ? (gu / gl * 100).toFixed(1) : "0";
    const txs = b.transactions || [];
    const row = (k, v) => `<div class="erow"><div class="ek">${k}</div><div class="ev">${v}</div></div>`;
    const txList = txs.length ? `<div class="card"><div class="ch"><h2>${txs.length} transaction${txs.length === 1 ? "" : "s"}</h2></div>
      <table class="tbl"><thead><tr><th>Tx hash</th><th>From</th><th>To</th><th class="r">Value</th></tr></thead><tbody>${txs.map(t => `<tr>
        <td>${aTx(t.hash)}</td><td>${aAddr(t.from)}</td><td>${t.to ? aAddr(t.to) : '<span class="tag">Contract creation</span>'}</td><td class="r">${lxs(t.value)} LXS</td></tr>`).join("")}</tbody></table></div>` : "";
    setContent(`
      <div class="titlebar"><h1>Block <span class="grad">#${grp(String(n))}</span></h1>
        <div class="navbtns">${n > 0 ? aBlock(n - 1, "‹ Prev") : ""} ${n < height ? aBlock(n + 1, "Next ›") : ""}</div></div>
      <div class="card">
        ${row("Height", grp(String(n)))}
        ${row("Timestamp", age(b.timestamp) + " <span class='dim'>(" + dateStr(b.timestamp) + ")</span>")}
        ${row("Transactions", txs.length + " in this block")}
        ${row("Mined by", aAddr(b.miner) + " " + copy(b.miner))}
        ${row("Block reward", blockReward(n) + " LXS")}
        ${row("Difficulty", grp(String(toInt(b.difficulty))))}
        ${row("Gas used", grp(String(gu)) + " <span class='dim'>(" + pct + "%)</span><div class='bar'><span style='width:" + pct + "%'></span></div>")}
        ${row("Gas limit", grp(String(gl)))}
        ${row("Nonce", b.nonce)}
        ${row("Hash", "<span class='mono'>" + esc(b.hash) + "</span> " + copy(b.hash))}
        ${row("Parent hash", (n > 0 ? aBlock(n - 1, "<span class='mono'>" + esc(b.parentHash) + "</span>") : "<span class='mono'>" + esc(b.parentHash) + "</span>"))}
        ${row("State root", "<span class='mono'>" + esc(b.stateRoot) + "</span>")}
      </div>${txList}`);
  } catch (e) { errBox(e.message); }
}

/* ---------- TX detail ---------- */
async function renderTx(hash) {
  loading("transaction");
  try {
    const [tx, rc, num] = await Promise.all([
      rpc("eth_getTransactionByHash", [hash]),
      rpc("eth_getTransactionReceipt", [hash]).catch(() => null),
      rpc("eth_blockNumber")]);
    if (!tx) {
      // maybe it's a block hash
      const b = await rpc("eth_getBlockByHash", [hash, false]).catch(() => null);
      if (b) { location.hash = "#/block/" + toInt(b.number); return; }
      return errBox("No transaction or block with hash " + hash + ". It may be pending (not yet mined).");
    }
    const bn = toInt(tx.blockNumber), height = toInt(num), conf = tx.blockNumber ? (height - bn + 1) : 0;
    const success = rc ? rc.status === "0x1" : null;
    const gu = rc ? toInt(rc.gasUsed) : null, gl = toInt(tx.gas), pct = (gu != null && gl) ? (gu / gl * 100).toFixed(1) : null;
    const fee = (gu != null) ? lxs("0x" + (BigInt(gu) * toBig(tx.gasPrice)).toString(16)) : "—";
    const created = rc && rc.contractAddress;
    const badge = tx.blockNumber == null ? `<span class="badge pend">● Pending</span>`
      : success ? `<span class="badge ok">✓ Success</span>` : `<span class="badge bad">✗ Failed</span>`;
    const row = (k, v) => `<div class="erow"><div class="ek">${k}</div><div class="ev">${v}</div></div>`;
    const input = tx.input && tx.input !== "0x";
    setContent(`
      <div class="titlebar"><h1>Transaction</h1></div>
      <div class="card">
        ${row("Tx hash", "<span class='mono'>" + esc(tx.hash) + "</span> " + copy(tx.hash))}
        ${row("Status", badge)}
        ${row("Block", tx.blockNumber == null ? "<span class='dim'>Pending</span>" : aBlock(bn) + " <span class='dim'>(" + conf + " confirmation" + (conf === 1 ? "" : "s") + ")</span>")}
        ${row("Timestamp", tx.blockNumber == null ? "—" : "<span id='tx-age'>…</span>")}
        ${row("From", aAddr(tx.from) + " " + copy(tx.from))}
        ${row(created ? "To (contract created)" : "To", created ? aAddr(rc.contractAddress) + ' <span class="tag">Created</span> ' + copy(rc.contractAddress) : (tx.to ? aAddr(tx.to) + " " + copy(tx.to) : '<span class="tag">Contract creation</span>'))}
        ${row("Value", "<b>" + lxs(tx.value) + " LXS</b>")}
        ${row("Transaction fee", fee + " LXS")}
        ${row("Gas price", grp(String(toInt(tx.gasPrice))) + " wei")}
        ${row("Gas limit / used", grp(String(gl)) + (gu != null ? " / " + grp(String(gu)) + " <span class='dim'>(" + pct + "%)</span>" : ""))}
        ${row("Nonce", toInt(tx.nonce))}
        ${row("Position in block", tx.transactionIndex == null ? "—" : toInt(tx.transactionIndex))}
        ${input ? row("Input data", "<textarea class='inp' readonly>" + esc(tx.input) + "</textarea>") : ""}
      </div>
      ${rc && rc.logs && rc.logs.length ? `<div class="card"><div class="ch"><h2>${rc.logs.length} event log${rc.logs.length === 1 ? "" : "s"}</h2></div>${rc.logs.map((lg, i) => `<div class="log"><div class="dim">#${i} · ${aAddr(lg.address)}</div>${(lg.topics || []).map(t => `<div class='mono sm'>${esc(t)}</div>`).join("")}${lg.data && lg.data !== "0x" ? "<div class='mono sm dim'>data: " + esc(lg.data.slice(0, 138)) + (lg.data.length > 138 ? "…" : "") + "</div>" : ""}</div>`).join("")}</div>` : ""}`);
    // fill timestamp
    if (tx.blockNumber != null) {
      const b = await rpc("eth_getBlockByNumber", [tx.blockNumber, false]).catch(() => null);
      if (b && $("tx-age")) $("tx-age").innerHTML = age(b.timestamp) + " <span class='dim'>(" + dateStr(b.timestamp) + ")</span>";
    }
  } catch (e) { errBox(e.message); }
}

/* ---------- ADDRESS ---------- */
async function renderAddress(addr) {
  loading("address");
  try {
    const [balance, nonce, code, num] = await Promise.all([
      rpc("eth_getBalance", [addr, "latest"]),
      rpc("eth_getTransactionCount", [addr, "latest"]),
      rpc("eth_getCode", [addr, "latest"]).catch(() => "0x"),
      rpc("eth_blockNumber")]);
    const height = toInt(num);
    const isContract = code && code !== "0x" && code.length > 2;
    const row = (k, v) => `<div class="erow"><div class="ek">${k}</div><div class="ev">${v}</div></div>`;
    setContent(`
      <div class="titlebar"><h1>${isContract ? "Contract" : "Address"}</h1></div>
      <div class="card">
        ${row("Address", "<span class='mono'>" + esc(addr) + "</span> " + copy(addr))}
        ${row("Balance", "<b class='grad'>" + lxs(balance) + " LXS</b>")}
        ${row("Transactions sent", grp(String(toInt(nonce))))}
        ${isContract ? row("Type", "<span class='tag'>Contract</span> " + (code.length - 2) / 2 + " bytes of code") : ""}
      </div>
      <div class="card"><div class="ch"><h2>Transactions</h2><span class="dim" id="scan-note">scanning…</span></div>
        <table class="tbl"><thead><tr><th>Tx hash</th><th>Block</th><th>Age</th><th></th><th>From / To</th><th class="r">Value</th></tr></thead>
        <tbody id="addr-txs"><tr><td colspan="6" class="dim" style="text-align:center;padding:16px">Scanning the chain for this address…</td></tr></tbody></table>
      </div>
      <div class="card" id="mined-card" style="display:none"><div class="ch"><h2>Blocks mined</h2><span class="dim" id="mined-count"></span></div>
        <table class="tbl"><thead><tr><th>Block</th><th>Age</th><th class="r">Txns</th><th class="r">Reward</th></tr></thead><tbody id="addr-mined"></tbody></table>
      </div>`);
    scanAddress(addr, height);
  } catch (e) { errBox(e.message); }
}

async function scanAddress(addr, height) {
  const A = addr.toLowerCase();
  const found = [], mined = [];
  const from = Math.max(0, height - SCAN_CAP);
  let scanned = 0;
  for (let hi = height; hi >= from; hi -= BATCH) {
    const lo = Math.max(from, hi - BATCH + 1);
    const calls = [];
    for (let n = hi; n >= lo; n--) calls.push({ method: "eth_getBlockByNumber", params: ["0x" + n.toString(16), true] });
    const blocks = (await rpcBatch(calls)).filter(Boolean);
    blocks.forEach(b => {
      if ((b.miner || "").toLowerCase() === A) mined.push(b);
      (b.transactions || []).forEach(t => {
        if ((t.from || "").toLowerCase() === A || (t.to || "").toLowerCase() === A) found.push({ ...t, ts: b.timestamp });
      });
    });
    scanned += blocks.length;
    const note = $("scan-note"); if (note) note.textContent = "scanned " + grp(String(scanned)) + " blocks";
    renderAddrTxs(found, A);
    renderMined(mined);
    await new Promise(r => setTimeout(r, 0));
  }
  const note = $("scan-note");
  if (note) note.textContent = found.length + " tx" + (found.length === 1 ? "" : "s") + " · scanned " + grp(String(scanned)) + " blocks" + (from > 0 ? " (last " + grp(String(SCAN_CAP)) + ")" : "");
  if (!found.length) $("addr-txs").innerHTML = `<tr><td colspan="6" class="dim" style="text-align:center;padding:16px">No transactions found for this address.</td></tr>`;
}
function renderAddrTxs(found, A) {
  const tb = $("addr-txs"); if (!tb || !found.length) return;
  tb.innerHTML = found.slice(0, 200).map(t => {
    const out = (t.from || "").toLowerCase() === A;
    const other = out ? t.to : t.from;
    return `<tr><td>${aTx(t.hash)}</td><td>${aBlock(toInt(t.blockNumber))}</td><td class="dim">${age(t.ts)}</td>
      <td>${out ? '<span class="io out">OUT</span>' : '<span class="io in">IN</span>'}</td>
      <td>${other ? aAddr(other) : '<span class="tag">Contract creation</span>'}</td>
      <td class="r">${lxs(t.value)} LXS</td></tr>`;
  }).join("");
}
function renderMined(mined) {
  if (!mined.length) return;
  const card = $("mined-card"); if (card) card.style.display = "";
  const c = $("mined-count"); if (c) c.textContent = mined.length + " block" + (mined.length === 1 ? "" : "s");
  const tb = $("addr-mined"); if (tb) tb.innerHTML = mined.slice(0, 200).map(b => `<tr>
    <td>${aBlock(toInt(b.number))}</td><td class="dim">${age(b.timestamp)}</td><td class="r">${(b.transactions || []).length}</td><td class="r">${blockReward(toInt(b.number))} LXS</td></tr>`).join("");
}

/* ---------- router ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [seg, arg, arg2] = h.split("/");
  window.scrollTo(0, 0);
  if (!seg || seg === "") return renderHome();
  if (seg === "blocks") return renderBlocks(parseInt(arg || "0", 10) || 0);
  if (seg === "block") return renderBlock(arg);
  if (seg === "tx") return renderTx(arg);
  if (seg === "address") return renderAddress(arg);
  renderHome();
}
window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", () => {
  const si = $("exp-search"), sb = $("exp-search-btn");
  if (sb) sb.onclick = () => doSearch(si.value);
  if (si) si.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(si.value); });
  route();
  // auto-refresh home every 12s
  setInterval(() => { if ((location.hash.replace(/^#\/?/, "") || "") === "") renderHome(); }, 12000);
});
