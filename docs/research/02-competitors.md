| Competitor | Chain | Privacy Mechanism | Status | Activity |
| :--- | :--- | :--- | :--- | :--- |
| **DarkBook** | Solana | Commitment (SHA-256) | Devnet | Alpha |
| **Arcium Umbra** | Solana | MPC/FHE | Devnet | High |
| **Hyperliquid (HIP-3)** | Arbitrum | Encrypted Orderbook | Mainnet | Very High |
| **Penumbra** | Cosmos | Shielded Pool/FHE | Mainnet | High |
| **Drift Protocol** | Solana | MEV-Protection (Dutch) | Mainnet | Very High |
| **Jupiter Perps** | Solana | MEV-Protection | Mainnet | Extreme |
| **Lighter** | Arbitrum | Off-chain Matching | Mainnet | Medium |
| **Renegade** | Ethereum | MPC Dark Pool | Mainnet | Medium |

### Verdict
DarkBook is currently **partially covered**. Size-only privacy via SHA-256 commitments is effective, but Ephemeral Rollup (MagicBlock) is an architectural choice, not a privacy feature. The wedge (size privacy on Solana) is valuable, yet lacks adoption compared to Hyperliquid or established MEV-protected protocols. **Hyperliquid Kill-Factor**: They already handle massive scale with encrypted matching/MEV protections that achieve low latency without needing ephemeral rollups. To win, DarkBook must prove that Solana native order-flow requires size encryption at the *commitment* layer to prevent adversarial frontrunning before settlement.
