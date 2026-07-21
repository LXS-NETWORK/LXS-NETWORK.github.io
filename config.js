// ======================= LXS LAUNCH CONFIG =======================
// These are the ONLY values that change at launch. Everything on the
// site (app.js, docs.html, mine.html) reads them from here so nothing
// is hardcoded in two places. Fill each one in when the network goes live.
//
//   >>> FILLED IN AT LAUNCH <<<
// =================================================================
window.LXS_CONFIG = {
  // Public LXS RPC endpoint (the server node MetaMask/dApp talks to).
  RPC_URL: "https://lxsnetwork.duckdns.org",      // public HTTPS RPC (Caddy in front of the seed's :8545)

  // Chain ID for MetaMask / the launchpad.
  CHAIN_ID: 22540,                         // LXS mainnet

  // Deployed PumpFactory (launchpad) contract address.
  FACTORY_ADDRESS: "0xff2829484cb09c3e48f6371021de0c87964c7b2d",                     // FILLED IN AT LAUNCH — 0x… of the PumpFactory

  // Free-gas faucet endpoint. Leave "" to default to RPC_URL + "/faucet".
  FAUCET_URL: "",                          // FILLED IN AT LAUNCH (optional)

  // Base URL where the miner downloads are hosted (used by mine.html).
  MINER_DOWNLOAD_BASE_URL: "https://github.com/LXS-NETWORK/LXS/releases/latest/download",

  // Public GitHub repo (shown on mine.html / docs.html).
  GITHUB_URL: "https://github.com/LXS-NETWORK/LXS",
};
