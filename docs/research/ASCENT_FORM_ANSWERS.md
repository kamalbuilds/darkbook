# Ascent Airtable: paste-ready answers + 3-min demo shot list

Form: https://airtable.com/appdfQFBoIXdYtre1/shrgT3UqGzcvIHS5Z (closes today, 2026-09-03). Each teammate submits separately.

## Fields

**Attend IRL:** Yes
**Superteam India member:** (your status)
**City:** (yours)

**What are you working on (live links):**
DarkBook: size-private perpetuals CLOB on Solana. Exact order size is bound by a SHA-256 commitment and revealed only at settlement; side, price, and size band stay public so price-time matching still works. Matching runs on a MagicBlock Ephemeral Rollup (sub-50ms), settlement is atomic on Solana, marks from Pyth Lazer, 8h funding, on-chain liquidations.
- App: https://darkbook-ascent.vercel.app
- Code: https://github.com/kamalbuilds/darkbook (4k LOC Anchor + TS SDK + settler/liquidator/funding services)
- Devnet program: 3F99U2rZ2fob5NBgVTqQYqMq8whF4WUqiZXgeaYPE7yf
- Privacy truth table: https://github.com/kamalbuilds/darkbook/blob/master/docs/PRIVACY_MODEL.md

**Project demo:** (Loom link, record per shot list below)

**How long:** >6 months (if counting pre-repo design; git history starts May 2026)

**Traction:**
Devnet live with e2e tests (bankrun). Integrations shipped: MagicBlock ER matching, Pyth Lazer, Jito bundle settlement, Helius Geyser, Encrypt and Ika bridges, Umbra post-settlement shielding. Submitted to Colosseum Frontier 2026 (main track + MagicBlock privacy, Eitherway DeFi infra, Encrypt x Ika sidetracks). Did not place; published a public autopsy and rewrote every claim to match on-chain fields. No mainnet users yet. The gap is market makers and first size-sensitive traders, not code.

**Category:** Bootstrapped

**Hope to achieve:** Bootstrap liquidity for your project; Get connected with Market Makers, VCs etc.

Optional free text if there is room: "30-day GTM experiment we want to run: 3 MMs quoting SOL-PERP on devnet with real flow, then capped-OI mainnet on MagicBlock mainnet ER (us.magicblock.app is GA). Need market-structure critique on whether size-band + commit-reveal is enough MEV protection for MMs."

## 3-minute Loom shot list (no slides)

0:00 Landing at darkbook-ascent.vercel.app. Read the one-liner aloud: exact size hidden until settlement, side/price/band public.
0:20 /trade. Connect Phantom on devnet. Show USDC collateral deposit tx in explorer.
0:50 Place order: pick side, price, size band, leverage, enter exact size. Show the Order account in explorer: commitment hash present, size_lots absent.
1:30 Second wallet (or second tab) places crossing order. Show ER match (ticker/ER block) and fill.
2:00 claim_fill on Solana: show explorer tx where plaintext size is revealed and the Position account appears with size_lots.
2:30 Positions page: mark from Pyth, funding, close or liquidate path.
2:50 Close: "Devnet today. Ascent ask: MMs and market-structure review to take this to capped mainnet."

Prep notes:
- `scripts/` is gitignored and not on disk, so README's `bun run demo` / `seed-demo.ts` do not exist. Use the UI + a devnet USDC faucet for two wallets instead, or run `tests/e2e-demo.ts` with anchor test for a terminal demo.
- Ticker shows OFFLINE until the ER websocket connects. If it stays OFFLINE on camera, say it is devnet ER and move on rather than hiding it.
- Do not say "identity hidden", "encrypted orderbook", or "Hyperliquid cannot copy". Trader pubkey and leverage are public.
