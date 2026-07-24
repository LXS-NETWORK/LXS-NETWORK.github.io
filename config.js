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
  FACTORY_ADDRESS: "0x79D4FCBB6d55dF60c386dDcE2740dc23c8bAF967",   // PumpFactory v2 (audited: gated graduation pool)

  // LXS-native Uniswap-V2 DEX: coins graduate here once their curve takes 300 LXS.
  SWAP_FACTORY_ADDRESS: "0x2A04964fffdE2Ed4C4656e0751DC25f13fdB9927", // LxsSwapFactory (gated first-mint)
  WLXS_ADDRESS: "0x35dc0B4B19D9531Bb8432bC31D5deE3c1BDE87be",         // wrapped LXS (pool base asset, unchanged)
  ROUTER_ADDRESS: "0x4f831b258fe42082664767df6dd19884bC230488",       // LxsSwapRouter (trade graduated coins)

  // Free-gas faucet endpoint. Leave "" to default to RPC_URL + "/faucet".
  FAUCET_URL: "",                          // FILLED IN AT LAUNCH (optional)

  // Base URL where the miner downloads are hosted (used by mine.html).
  MINER_DOWNLOAD_BASE_URL: "https://github.com/LXS-NETWORK/LXS/releases/latest/download",

  // Public GitHub repo (shown on mine.html / docs.html).
  GITHUB_URL: "https://github.com/LXS-NETWORK/LXS",
};
