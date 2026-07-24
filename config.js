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

  // Deployed PumpFactory (launchpad) contract address — graduation-wired build.
  FACTORY_ADDRESS: "0xEb1C2689D3be98c41DE720B1570693799D732871",   // PumpFactory v2 (auto-graduation to LxsSwap)

  // LXS-native Uniswap-V2 DEX: coins graduate here once their curve takes 300 LXS.
  SWAP_FACTORY_ADDRESS: "0x207870320b9eC645A80c42d486debD06c24866BE", // LxsSwapFactory
  WLXS_ADDRESS: "0x35dc0B4B19D9531Bb8432bC31D5deE3c1BDE87be",         // wrapped LXS (pool base asset)

  // Free-gas faucet endpoint. Leave "" to default to RPC_URL + "/faucet".
  FAUCET_URL: "",                          // FILLED IN AT LAUNCH (optional)

  // Base URL where the miner downloads are hosted (used by mine.html).
  MINER_DOWNLOAD_BASE_URL: "https://github.com/LXS-NETWORK/LXS/releases/latest/download",

  // Public GitHub repo (shown on mine.html / docs.html).
  GITHUB_URL: "https://github.com/LXS-NETWORK/LXS",
};
