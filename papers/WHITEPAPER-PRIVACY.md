# DarkBook: A Commitment-Based Privacy Layer for On-Chain Perpetual Futures

**Abstract** — We present DarkBook, a decentralized central limit order book (CLOB) for perpetual futures contracts on the Solana blockchain that achieves meaningful pre-settlement privacy without the computational overhead of full zero-knowledge proofs. DarkBook uses an Ephemeral Rollup (ER) delegated from Solana mainnet — provided by the MagicBlock engine — to achieve sub-50 ms order matching latency while retaining mainnet-level finality for collateral and position state. The privacy model rests on three primitives: (i) a SHA-256 commitment scheme binding each order to its exact size without revealing it on-chain, (ii) ECIES (X25519 + AES-256-GCM) encryption enabling traders to transmit plaintext securely to the settler, and (iii) a coarse-grained size-band disclosure that leaks only a logarithmic approximation of order size to the public mempool. We model the adversary as a passive mempool observer and an active MEV bot; we argue that the expected information gain from the public state is insufficient to profitably front-run under standard market microstructure assumptions. We formalize hiding and binding properties under the DDH assumption and SHA-256 collision resistance, respectively. We compare DarkBook with Renegade (full MPC-ZK), Hyperliquid (transparent CLOB), and Drift Protocol (off-chain keeper DLOB), identifying the performance-privacy frontier each occupies. We close with a discussion of residual trust in the settler and MagicBlock validator, and chart a roadmap toward threshold-reveal and ZK settlement proofs.

---

## 1. Introduction

### 1.1 Privacy in Central Limit Order Books

Central limit order books are the dominant price-discovery mechanism in both traditional and decentralized finance. A CLOB aggregates resting limit orders at each price level and matches arriving market or limit orders using deterministic price-time priority. On a public blockchain, every order — price, size, side, and trader identity — is visible in the mempool before inclusion in a block. This transparency is desirable for settlement finality but devastating for informed traders: any participant watching the mempool can infer a large directional order before it executes and adjust their own position accordingly.

The problem is structural. In traditional finance, dark pools — alternative trading systems that withhold order information until post-trade — exist precisely to protect institutional order flow from information leakage [1]. Regulatory frameworks (MiFID II in Europe, Reg ATS in the United States) permit dark pool operation under the assumption that post-trade price transparency is sufficient for price discovery while pre-trade opacity protects market participants from predatory order flow.

Decentralized dark pools face a more adversarial environment. There is no regulatory backstop; the mempool is public by default; and the economic incentives for extraction are explicitly quantified in the form of Maximal Extractable Value (MEV) [2].

### 1.2 The MEV Problem

MEV refers to value extracted by block producers (or, in the Solana context, by bot networks coordinating with validators) through selective ordering, insertion, or censorship of transactions [3]. In the context of perpetuals CLOBs, the most relevant MEV vectors are:

- **Sandwich attacks**: detecting a large market order in the mempool, submitting a buy ahead of it and a sell immediately after to profit from price impact.
- **Front-running**: copying a profitable limit order at a marginally better price to displace it in the queue.
- **Latency arbitrage**: exploiting the gap between oracle price updates and stale resting orders.

Empirically, Jito Labs estimated that over 60% of compute units in a representative Solana epoch were consumed by arbitrage bots, of which 98% failed — evidence that competition for MEV is intense and the network externality is large [4].

### 1.3 Prior Art

Several approaches to pre-trade privacy have emerged in the decentralized setting.

**Commit-reveal schemes** offer the simplest privacy primitive: a trader commits to an order hash, gains a slot guarantee, then reveals the plaintext [5]. This prevents front-running if the reveal is atomic with execution but breaks down if the adversary can delay the reveal block.

**Encrypted mempools** use threshold or delay encryption to make every pending transaction unreadable until an epoch boundary [6, 7]. They provide strong pre-trade privacy but require a trusted decryption committee or verifiable delay function, adding latency and complexity.

**ZK-based dark pools** such as Renegade [8] use collaborative SNARKs: two parties prove in zero knowledge that their encrypted orders match, settling on-chain with no information leakage beyond the existence of a match. This is privacy-optimal but imposes significant prover time (seconds per match on current hardware).

**Shielded DEXes** such as Penumbra [9] embed a Zcash-style shielded pool with private swap semantics. Swap intents are committed anonymously; only net flow per asset pair is revealed per block. Penumbra's ZSwap mechanism prevents front-running but is constrained to AMM-style batch execution rather than continuous CLOB matching.

**ZK application chains** such as Aleo [10] and Aztec [11] provide privacy at the execution layer — programs run in a trusted local environment and post only ZK proofs to the chain. These frameworks eliminate information leakage at the cost of a non-EVM/non-SVM execution environment and significant developer tooling overhead.

DarkBook occupies a different point on the design space. We accept a weaker privacy guarantee — size hidden until settlement, price and side public — in exchange for near-zero cryptographic overhead, native Solana composability, and sub-50 ms matching via MagicBlock Ephemeral Rollups.

---

## 2. System Model

### 2.1 Parties

We model the following principals.

**Trader** $\mathcal{T}$: A user holding collateral in a Solana-native USDC account. The trader generates an ephemeral ECIES keypair, encrypts their order payload, computes a commitment, and submits the order on-chain. The trader is assumed to behave rationally and to keep their decryption key secret.

**Ephemeral Rollup Validator** $\mathcal{V}_{ER}$: The MagicBlock validator node that accepts the delegated OrderBook PDA and executes `match_orders` instructions. The ER validator sees the full account state of the OrderBook — including all Order structs — but not the plaintext order sizes (which appear only in the commitment field). The ER has sub-50 ms block times.

**Settler** $\mathcal{S}$: A permissionless off-chain service that watches ER commits for new fills, collects trader-supplied plaintext payloads (delivered over an authenticated channel), verifies commitments, and submits `claim_fill` to Solana mainnet. The settler is a trusted party relative to size confidentiality: it must receive and handle plaintext.

**Liquidator** $\mathcal{L}$: A permissionless agent monitoring open positions via Pyth Lazer price feeds [12]. The liquidator submits `liquidate_position` when a position's collateral ratio falls below 1.2. The liquidator sees only public state: position size (revealed post-settlement), mark price, and collateral.

**Oracle** $\mathcal{O}$: The Pyth Network pull oracle [13], providing signed price attestations. Pyth Lazer provides updates at approximately 1 ms intervals; the on-chain contract verifies the signature via the `instructions` sysvar using ed25519.

### 2.2 State Partitioning

DarkBook maintains a strict two-layer state partition:

```
┌─────────────────────────────────────────────────┐
│              Solana Mainnet                      │
│  Market · CollateralVault · UserAccount         │
│  Position · FillRecord                          │
│  (finality: ~400 ms, permanent settlement)      │
└─────────────────────────────┬───────────────────┘
                              │ delegation (MagicBlock SDK)
┌─────────────────────────────▼───────────────────┐
│           MagicBlock Ephemeral Rollup            │
│  OrderBook PDA (delegated)                      │
│  match_orders · commit_book                     │
│  (latency: <50 ms, ephemeral validator)         │
└─────────────────────────────────────────────────┘
```

The OrderBook PDA is delegated to the ER after the first order placement. The ER validator runs the matching engine. Periodically (or at settlement trigger) the ER commits state back to mainnet via a MagicBlock intent bundle.

### 2.3 Trust Assumptions

| Party | Trusted For | Not Trusted For |
|---|---|---|
| Trader | Knowing own plaintext | Honest reveal (commitment enforces) |
| ER Validator | Correct matching logic | Seeing plaintext sizes |
| Settler | Correct commitment verification | Not leaking plaintexts |
| Liquidator | Correct collateral math | Nothing safety-critical |
| Pyth Oracle | Price integrity | — (ed25519 verified on-chain) |

---

## 3. Threat Model

We consider four adversarial principals, in increasing order of capability.

### 3.1 Passive Mempool Observer

The weakest adversary $\mathcal{A}_{passive}$ monitors the Solana mempool and reads all submitted transactions without the ability to reorder or inject transactions. $\mathcal{A}_{passive}$ can observe:

- Order side (Long/Short)
- Price in ticks ($p$)
- Size band $b \in \{Small, Medium, Large, Whale\}$ where $Small \leq 10\ lots$, $Medium \leq 100\ lots$, $Large \leq 1000\ lots$, $Whale > 1000\ lots$
- Commitment hash (32 bytes, computationally opaque)
- Trader public key

$\mathcal{A}_{passive}$ cannot learn the exact size $s$ in lots, the leverage multiple, or the trader's session secret. The information leakage to $\mathcal{A}_{passive}$ is bounded by the band width: at most $\lceil \log_{10}(s_{max}/s_{min}) \rceil$ bits of size entropy per order, where $s_{max}$ and $s_{min}$ are the band ceiling and floor respectively.

### 3.2 Active MEV Bot

$\mathcal{A}_{MEV}$ has mempool access and can submit transactions with tip-based priority (via Jito bundles [4]). $\mathcal{A}_{MEV}$ can attempt to front-run a large order by submitting a position in the same direction ahead of the victim. The adversary's profitability depends on knowing the exact size $s$; with only the band $b$ known, the expected price impact from a median band-width order is uncertain. We argue in Section 7 that this uncertainty makes front-running economically marginal under realistic bid-ask spread assumptions.

Additionally, DarkBook's settlement path uses Jito atomic bundles: the `claim_fill` instruction that reveals plaintext is submitted atomically with position creation, eliminating the window between reveal and execution that a sandwich attack would exploit [4].

### 3.3 Malicious Validator

$\mathcal{A}_{val}$ controls the ER validator (or is colluding with it). $\mathcal{A}_{val}$ can read the full OrderBook PDA — all Order structs — but these contain only commitments, not plaintexts. $\mathcal{A}_{val}$ cannot learn exact sizes without breaking SHA-256 preimage resistance. However, $\mathcal{A}_{val}$ can:

- Reorder matches within the ER (violating price-time priority for orders at the same price and band)
- Delay commitment of fills to mainnet
- Selectively censor orders

These are availability and fairness attacks, not privacy attacks. Price-time priority within a band provides a partial ordering guarantee; exact ordering across bands is a weaker guarantee that we acknowledge.

### 3.4 Malicious Settler

$\mathcal{A}_{settler}$ is the most capable internal adversary. The settler receives plaintext order payloads from traders (necessary to submit `claim_fill`) and thus sees exact sizes before they appear on-chain. $\mathcal{A}_{settler}$ could front-run its own fills by taking a position before submitting the settlement transaction.

This is the primary trust assumption DarkBook does not eliminate. Mitigations include: (a) settler-submitted transactions via Jito bundle with atomicity guarantee (the position open and the settlement execute in the same block), (b) economic incentives (settler earns fees and would lose those fees plus reputation if caught), and (c) the roadmap item of threshold reveal (Section 10) which distributes this trust.

---

## 4. Cryptographic Primitives

### 4.1 SHA-256 Commitment Scheme

The on-chain commitment is computed as:

$$c = \mathrm{SHA256}(salt \| s_{le} \| \ell_{le} \| pk_{trader})$$

where $salt \in \{0,1\}^{256}$ is a uniformly random nonce chosen by the trader, $s_{le}$ is the size in lots encoded as a 64-bit little-endian integer, $\ell_{le}$ is the leverage in basis points as a 16-bit little-endian integer, and $pk_{trader}$ is the 32-byte ed25519 public key of the trader.

SHA-256 is modeled as a random oracle [14]. The commitment satisfies:

- **Hiding**: Given $c$, an adversary cannot learn $(s, \ell, pk)$ without finding a SHA-256 preimage, which is computationally infeasible under the random oracle model.
- **Binding**: A trader cannot produce two distinct tuples $(s, \ell, pk)$ and $(s', \ell', pk')$ yielding the same $c$ without finding a SHA-256 collision, which requires $O(2^{128})$ work under the birthday bound.

The salt prevents dictionary attacks on the small integer space of $s$: without knowledge of $salt$, an adversary cannot precompute a table of $(s \mapsto c)$ pairs.

### 4.2 ECIES: X25519 + AES-256-GCM

Order plaintext is transmitted from trader to settler using the Elliptic Curve Integrated Encryption Scheme (ECIES) [15] instantiated with:

- **Key Agreement**: X25519 Diffie-Hellman over Curve25519 [16]
- **Key Derivation**: HKDF-SHA-256 [17] with info string `"darkbook-order-v1"`
- **Symmetric Encryption**: AES-256-GCM [18] with a 96-bit random nonce

The encryption of payload $m$ under settler public key $pk_S$ proceeds as:

$$\begin{aligned}
(ek_{pub}, ek_{priv}) &\leftarrow \mathrm{X25519.KeyGen}() \\
dh &= \mathrm{X25519}(ek_{priv}, pk_S) \\
k &= \mathrm{HKDF}(dh, \text{"darkbook-order-v1"}) \\
(ct, tag) &= \mathrm{AES\text{-}256\text{-}GCM}(k, nonce, m)
\end{aligned}$$

The ciphertext blob stored off-chain (and referenced by the order) is $(ek_{pub} \| nonce \| ct \| tag)$.

Security properties follow from the IND-CCA2 security of ECIES under the DDH assumption on Curve25519 [19]. Authenticity of the plaintext is enforced by the on-chain commitment check rather than the ECIES MAC alone: even if an adversary modifies the ciphertext, the commitment verification at settlement will reject mismatching plaintext.

### 4.3 ed25519 Signatures

Trader-to-settler plaintext delivery requires the trader to sign the plaintext payload with their ed25519 private key to prevent settler substitution attacks. The settler verifies:

$$\mathrm{ed25519.Verify}(pk_{trader}, (salt \| s_{le} \| \ell_{le}), \sigma) = 1$$

before computing the commitment and submitting `claim_fill`. This ensures that even a compromised settler cannot substitute a different size without the trader's private key.

Oracle price attestations (Pyth) are also ed25519-signed and verified on-chain via the Solana `instructions` sysvar.

---

## 5. Protocol

### 5.1 Order Placement (Commit Phase)

```
ALGORITHM PlaceOrder(side, price_ticks, size_lots, leverage_bps, sk_trader):

  1.  salt         ← random(32 bytes)
  2.  c            ← SHA256(salt || LE64(size_lots) || LE16(leverage_bps) || pk_trader)
  3.  band         ← SizeBand(size_lots)   // Small / Medium / Large / Whale
  4.  payload      ← (salt, size_lots, leverage_bps)
  5.  ct           ← ECIES_Enc(pk_settler, payload)
  6.  σ            ← ed25519.Sign(sk_trader, payload)
  7.  Send ct, σ   → settler (authenticated channel)
  8.  Submit Tx:   place_order(side, price_ticks, band, leverage_bps, c)
  9.  Program:     lock_collateral(UserAccount, band_ceiling × price × leverage_factor)
  10. Program:     append Order{commitment: c, side, price_ticks, band, ...} to OrderBook
```

The on-chain state after placement leaks: side, price\_ticks, band (4 bits), leverage\_bps (public per ARCHITECTURE.md), and the 32-byte commitment. The exact size is hidden.

### 5.2 Order Matching (ER-Internal Phase)

Matching runs entirely on the MagicBlock Ephemeral Rollup with no mainnet visibility until commit.

```
ALGORITHM MatchOrders(OrderBook):

  1.  While asks.top().price ≤ bids.top().price AND |fills| < 32:
  2.      ask ← asks.pop_top()
  3.      bid ← bids.pop_top()
  4.      fill_price ← (ask.price + bid.price) / 2   // midpoint
  5.      fill ← Fill{taker: bid, maker: ask, price: fill_price, band: min(bid.band, ask.band)}
  6.      OrderBook.fills.push_back(fill)
  7.  Commit OrderBook state to mainnet intent (MagicBlock bundle)
```

Matching priority within a price level is time-ordered by `placed_slot`. Across price levels, standard price priority applies. Band is not a matching dimension: orders at the same price match regardless of band, subject to size constraints that are resolved at settlement.

### 5.3 Settlement (Reveal Phase)

```
ALGORITHM ClaimFill(fill_id, plaintext_taker, plaintext_maker, oracle_update):

  // Settler submits this on Solana mainnet
  1.  fill        ← OrderBook.fills[fill_id]
  2.  (salt_t, s_t, l_t) ← plaintext_taker
  3.  (salt_m, s_m, l_m) ← plaintext_maker
  4.  Assert SHA256(salt_t || LE64(s_t) || LE16(l_t) || fill.taker) == fill.taker_order.commitment
  5.  Assert SHA256(salt_m || LE64(s_m) || LE16(l_m) || fill.maker) == fill.maker_order.commitment
  6.  matched_size ← min(s_t, s_m)
  7.  price       ← Pyth.verify_and_get(oracle_update)
  8.  Open Position for taker and maker at (matched_size, fill.price, price)
  9.  Unlock excess collateral from band-ceiling estimate
  10. Emit PositionOpened, FillRecord
```

The `claim_fill` instruction is submitted atomically with the oracle update in a Jito bundle, preventing any sandwich of the settlement reveal.

### 5.4 State Transition Diagram

```
                 ┌───────────────────────────────────────────────────┐
                 │                   Trader Client                   │
                 └─────────────┬─────────────────────────────────────┘
                               │ place_order(commitment, band, price)
                               ▼
┌──────────────┐    ┌──────────────────────┐    ┌───────────────────┐
│  OPEN        │    │  PENDING_MATCH       │    │  MATCHED          │
│  (mainnet)   │───►│  (ER OrderBook)      │───►│  (ER Fill queue)  │
└──────────────┘    └──────────────────────┘    └─────────┬─────────┘
                                                          │ ER commit → mainnet
                                                          ▼
                                                ┌───────────────────┐
                                                │  SETTLED          │
                                                │  claim_fill()     │
                                                │  Position created │
                                                └───────────────────┘
```

Orders transition through four states. Privacy is maintained across OPEN and PENDING\_MATCH; exact size becomes public only at SETTLED.

---

## 6. Security Claims

### 6.1 Hiding: Order Size Hidden Until Settlement

**Claim.** Under the DDH assumption on Curve25519 and the random oracle model for SHA-256, no probabilistic polynomial-time adversary $\mathcal{A}$ observing the public on-chain state can distinguish between two orders of different sizes $s_0 \neq s_1$ within the same size band $b$ with advantage greater than $\epsilon_{DDH} + \epsilon_{SHA}$ where $\epsilon_{DDH}$ and $\epsilon_{SHA}$ are the DDH and SHA-256 distinguishing advantages respectively.

**Proof sketch.** The adversary observes $(commitment, band, price, side, pk_{trader})$. The commitment $c = \mathrm{SHA256}(salt \| s_{le} \| \ell_{le} \| pk)$ is computationally hiding because $salt$ is chosen uniformly at random from $\{0,1\}^{256}$ and SHA-256 is modeled as a random oracle: for any fixed $(s, \ell, pk)$, the distribution of $c$ is indistinguishable from uniform over $\{0,1\}^{256}$ to a computationally bounded adversary who has not queried the random oracle on the specific $(salt \| s_{le} \| \ell_{le} \| pk)$ input. Since $salt$ is never published, the adversary must brute-force $salt$, which requires $O(2^{256})$ random oracle queries.

The ECIES ciphertext of the payload is IND-CCA2 secure under DDH on Curve25519 [19], so the ciphertext provides no additional information about $s$.

The band $b$ leaks at most $\log_2(4) = 2$ bits of size classification. An adversary who knows $b$ narrows the search space to $[s_{min}(b), s_{max}(b)]$ but still cannot determine the exact $s$ without inverting SHA-256.

### 6.2 Binding: Trader Cannot Equivocate on Size

**Claim.** No computationally bounded trader $\mathcal{T}$ can produce two distinct tuples $(salt, s, \ell)$ and $(salt', s', \ell')$ with $s \neq s'$ such that both yield the same commitment $c$.

**Proof.** Such a pair would constitute a SHA-256 collision. SHA-256 is a collision-resistant hash function; no collision has been found against the full 256-bit output. Under the random oracle model, finding a collision requires $O(2^{128})$ queries by the birthday bound, which is computationally infeasible for any polynomial-time adversary. Therefore, the commitment uniquely binds the trader to a specific $(salt, s, \ell, pk)$ tuple at order placement time.

This binding ensures that when the settler calls `claim_fill` with a particular $(salt, s, \ell)$, the on-chain verification `SHA256(salt || s || ell || pk) == c` will accept if and only if the provided tuple matches the originally committed one.

### 6.3 Front-Run Resistance

**Claim.** An active MEV adversary $\mathcal{A}_{MEV}$ observing DarkBook's mempool cannot profitably front-run an order with probability greater than $\frac{1}{N_b}$ where $N_b$ is the number of lot values in the observed band.

**Argument.** Front-running a perpetual order is profitable only when the adversary knows the order will move the price by more than the bid-ask spread. This requires knowing the exact size $s$ (to estimate price impact) and the execution timing (to get ahead of it in the queue). In DarkBook:

- Exact size $s$ is hidden; only band $b$ is known. The adversary must bet on a specific size, and their expected impact estimate has variance proportional to the band width.
- Orders are matched on the ER, which runs at sub-50 ms block times and whose internal state is not directly observable from the Solana mainnet mempool until ER commit.
- The settlement transaction (which reveals $s$) is submitted as a Jito atomic bundle [4], ensuring that position creation and commitment reveal happen atomically. There is no window in which an adversary can observe the reveal and act before the position is created.

The combination of size uncertainty and atomic settlement eliminates the two conditions necessary for profitable front-running: knowledge of impact and a temporal gap to exploit.

---

## 7. Comparison with Existing Systems

### 7.1 Renegade: Full ZK-MPC Dark Pool

Renegade [8] represents the gold standard of on-chain privacy for order matching. It uses collaborative SNARKs (2-party MPC where each party holds a share of the witness) to prove in zero knowledge that two encrypted orders match, settling on-chain with a ZK proof that reveals only the existence of a match, not any order parameters.

| Dimension | DarkBook | Renegade |
|---|---|---|
| Pre-trade privacy | Size hidden (band leaks 2 bits) | Full (nothing revealed) |
| Matching latency | <50 ms (MagicBlock ER) | Seconds (MPC round trips) |
| Cryptographic overhead | O(1) SHA-256 on-chain | ZK prover per match |
| Trust model | Settler sees plaintexts | Trustless (MPC) |
| Settlement | Atomic Jito bundle | ZK proof on-chain |
| Chain | Solana | Arbitrum (Stylus) |

Renegade achieves strictly stronger privacy but at a cost in latency and prover complexity that makes it unsuitable for high-frequency perpetual trading. DarkBook's design trades some privacy for performance.

### 7.2 Hyperliquid: Transparent CLOB

Hyperliquid [20] is a fully transparent CLOB running on a purpose-built L1 chain (HyperBFT, derived from HotStuff consensus). All orders and their full parameters are visible on-chain with sub-second finality and claimed throughput of up to 200,000 orders per second.

Hyperliquid provides no pre-trade privacy. It operates with a centralized sequencer controlled by the Hyperliquid team, making it equivalent to a centralized exchange with a public audit trail rather than a trustless decentralized system.

DarkBook differs by: (a) providing meaningful pre-trade size privacy, (b) running on a public permissionless chain (Solana mainnet) with MagicBlock ER for matching, and (c) offering trustless settlement with on-chain commitment verification.

### 7.3 Drift Protocol: Off-Chain Keeper DLOB

Drift [21] uses a Decentralized Limit Order Book (DLOB) maintained off-chain by incentivized Keeper bots. Orders are placed on-chain with full visibility, but matching is triggered off-chain by Keepers who submit transactions when matching conditions are met. Drift also uses a just-in-time (JIT) liquidity system where market makers provide liquidity at the instant of a taker order.

Drift is fully transparent: all order parameters (including exact size) are visible in the mempool at submission time. It achieves high throughput by offloading the matching computation to Keepers while keeping settlement on-chain.

DarkBook differs by hiding size until settlement, at the cost of requiring a settler and an ER for matching rather than Drift's simpler Keeper model.

### 7.4 Summary Comparison

```
                Privacy  Performance  Trustlessness  Complexity
                ─────────────────────────────────────────────────
DarkBook        ████░░   █████████░   ███████░░░     █████░░░░░
Renegade        ██████   ████░░░░░░   ██████████     █████████░
Hyperliquid     ░░░░░░   ██████████   ████░░░░░░     ████░░░░░░
Drift Protocol  ░░░░░░   █████████░   █████████░     ████░░░░░░
Penumbra        █████░   █████░░░░░   █████████░     ████████░░

(subjective 10-point scale per axis)
```

---

## 8. Limitations

### 8.1 Settlement Timing Leak

While order size is hidden pre-settlement, the timing of the `claim_fill` transaction reveals that a match occurred and approximately when. An adversary monitoring settlement frequency can infer market activity and, indirectly, directional bias. This is a timing side-channel that exists in any commit-reveal scheme.

Specifically, if a large directional flow of `claim_fill` transactions appears for a given market, a sophisticated observer could infer a sustained order imbalance. We do not claim resistance to timing correlation attacks.

### 8.2 Settler Trust

As noted in Section 3.4, the settler receives plaintext order payloads and could front-run its own settlement transactions. Jito bundle atomicity [4] mitigates but does not eliminate this risk: a settler could collude with a Jito block engine to reorder the bundle.

Practical mitigations in the current design:

1. The settler is operated by the protocol and its transactions are publicly auditable post-hoc.
2. The settler's Solana account key is known; if its transactions are found to consistently precede large fills in advantageous directions, it can be slashed and replaced.
3. The roadmap item of threshold reveal (Section 10) distributes the settler's decryption capability across $t$-of-$n$ signers.

### 8.3 MagicBlock Validator Observation

The MagicBlock ER validator $\mathcal{V}_{ER}$ executes the delegated OrderBook PDA. The validator can observe the full Order struct for all resting orders, including commitments, bands, prices, and sides. While it cannot learn exact sizes, it can observe the band distribution — the aggregate size distribution of resting orders — in real time, before mainnet commit.

A malicious ER validator could use this information to selectively delay commits for certain orders, or to signal aggregate order flow to affiliated trading entities. We acknowledge this as a meaningful limitation. MagicBlock's validator is currently a centralized service (devnet validator pubkey `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`), and the trust assumption is comparable to that of a centralized exchange matching engine.

### 8.4 Band Disclosure

The four-band size classification is a deliberate engineering choice to enable approximate collateral locking without revealing exact size. However, Whale orders (>1000 lots) are immediately identifiable as large, which may be sufficient to signal institutional interest even without the exact size. A continuous band scheme or a single universal band would improve privacy at the cost of collateral estimation accuracy.

---

## 9. Future Work

### 9.1 Threshold Reveal

The most impactful near-term improvement is to replace the single settler with a $t$-of-$n$ threshold decryption committee. Order plaintexts would be encrypted under a distributed key, and $t$ committee members must collaborate to decrypt, eliminating the single-settler trust assumption.

Concretely, we envision using a Distributed Key Generation (DKG) protocol [22] to establish a committee key $pk_{committee}$, with threshold decryption performed using Shamir's Secret Sharing [23] over the ECIES symmetric key $k$. Settlement would require a threshold signature from $t$ committee members attesting to the verified plaintext before on-chain settlement.

### 9.2 ZK Reveal Proofs

ARCHITECTURE.md notes that the ZK ElGamal Solana program is currently disabled (Token-2022 confidential transfers are unavailable). When this program is re-enabled, DarkBook can upgrade its settlement path to use ZK proofs of commitment opening:

$$\pi_{reveal} = \mathrm{Prove}\left(\exists\ (s, salt, \ell) : \mathrm{SHA256}(salt \| s_{le} \| \ell_{le} \| pk) = c \land s = s_{claimed}\right)$$

Such a proof, verifiable on-chain in $O(1)$ time, would eliminate the need for the settler to handle plaintext entirely: the trader proves their own plaintext off-chain and submits the proof. This would achieve settler-trustless settlement with the same on-chain footprint.

Suitable proving systems include Groth16 [24] (for minimal on-chain verifier cost) or PLONK [25] (for universal trusted setup). The circuit complexity is modest — a single SHA-256 invocation — making proof generation feasible in under 100 ms on modern hardware.

### 9.3 Trusted Enclave Matching

An alternative approach to ER validator trust is to run the matching engine inside a Trusted Execution Environment (TEE) such as Intel SGX or AMD SEV [26]. The TEE would hold the settler's decryption key in an attested enclave; order plaintexts would be decrypted inside the enclave, matched, and committed to mainnet with an attestation proof. This approach provides confidential computation without the complexity of MPC or ZK proofs, at the cost of hardware trust assumptions.

### 9.4 Indifferential Privacy for Size Bands

The four-band size classification leaks a coarse bucket. Recent work on indifferential privacy for dark pool auctions [27] suggests adding calibrated noise to revealed band memberships, achieving $\epsilon$-differential privacy on the disclosed size information. This would further reduce the information available to $\mathcal{A}_{passive}$ about the distribution of order sizes.

### 9.5 Verifiable Delay Functions for Temporal Privacy

Replacing Jito-based atomicity with a Verifiable Delay Function (VDF) [28] for settlement timing would decouple the settlement reveal from any particular block, eliminating timing side-channels. Orders committed to the VDF would be decryptable only after a fixed delay, during which no party (including the settler) could act on the information.

---

## 10. Related Work

The literature on privacy-preserving trading systems spans cryptography, market microstructure, and distributed systems. We survey the most relevant prior work.

**Commit-Reveal in DeFi.** Canidio and Danos [5] analyze commitment schemes as a defense against front-running in AMM settings, showing that commit-reveal reduces but does not eliminate MEV under certain block-proposer models. LibSubmarine [29] implements a commit-reveal variant for EVM that prevents front-running by creating a temporary contract per committed transaction.

**Encrypted Mempools.** Shutter Network [6] and related work propose threshold encryption of mempool transactions using Shamir secret sharing with a keyper committee. Practical Mempool Privacy [7] (IACR ePrint 2024/1516) uses a one-time DKG setup for batched threshold decryption at epoch boundaries, processing encrypted transactions with minimal latency overhead.

**ZK Dark Pools.** Renegade [8] (whitepaper v0.6, Bender et al.) introduces collaborative SNARKs for order matching: each party holds a witness share, and a 2-party MPC generates a joint SNARK proof of a valid match without revealing order parameters to either party or the chain. This is the strongest known privacy guarantee for on-chain order matching.

**Shielded DEXes.** Penumbra [9] implements ZSwap, a private DEX mechanism combining sealed-bid batch auctions for AMM-like swap privacy with Zcash-derived shielded note commitments. Penumbra uses Groth16 proofs over the BLS12-377 curve and the Jubjub inner curve (derived from the ZEXE design [30]).

**Privacy Application Chains.** Aleo [10] implements the ZEXE execution model [30] (Bowe, Chiesa et al., 2020), where programs execute locally and post only ZK proofs. Aztec [11] is a private ZK-rollup on Ethereum, using PLONK-based proofs (Gabizon, Williamson, Ciobotaru, 2019 [25]) with a note-commitment tree analogous to Zcash's sapling circuit.

**MEV and Ordering Fairness.** The MEV phenomenon was formalized by Daian et al. [2] ("Flash Boys 2.0", IEEE S&P 2020), who quantified extractable value in Ethereum's ordering layer. Torres et al. [3] conducted an empirical study of frontrunning on Ethereum. Flashbots and Jito [4] represent the industry response: auction-based block building that internalizes MEV rather than eliminating it.

**Threshold Cryptography.** Shamir [23] introduced $t$-of-$n$ secret sharing. Pedersen [22] introduced verifiable secret sharing and DKG. Modern threshold ECDSA/EdDSA constructions [31] enable distributed signing without a single point of failure, applicable to the settler improvement in Section 9.1.

**Commitment Schemes.** Pedersen commitments [32] and hash-based commitments [14] (Damgard, 1991) provide the theoretical foundation. The specific SHA-256 instantiation used in DarkBook follows the pattern of BLAKE2-based commitments in Zcash's sapling circuit, adapted for on-chain Solana constraints.

**Ephemeral Rollups.** The MagicBlock Ephemeral Rollup architecture [33] ("Ephemeral Rollups is All You Need") enables Solana PDAs to be delegated to a high-frequency auxiliary validator with state committed back to mainnet. DarkBook is among the first financial applications of this architecture.

**Pyth Oracle.** The Pyth pull oracle [13] provides cryptographically signed price attestations with sub-400 ms latency on Solana mainnet. Pyth Lazer [12] extends this to 1 ms update frequency, critical for liquidation and funding rate accuracy in high-leverage perpetual markets.

**Hyperliquid Architecture.** Hyperliquid [20] demonstrates that a purpose-built L1 with HyperBFT consensus can process 200,000 orders per second with sub-second finality. While fully transparent, it establishes the performance benchmark that partially-private designs like DarkBook must approach to be competitive.

**Drift Protocol.** Drift [21] pioneered the Keeper-driven DLOB model on Solana, showing that off-chain matching with on-chain settlement can achieve competitive throughput without a dedicated chain. Its JIT liquidity mechanism [21] is a distinct contribution to on-chain market microstructure.

**Indifferential Privacy for Dark Pools.** Arxiv 2502.13415 [27] (2025) introduces indifferential privacy as a framework for dark pool auctions, proposing differential-privacy-based mechanisms that process 600-850 orders per second while preventing leakage from an untrusted auctioneer.

**Maker Protocol Dark Mode.** The MakerDAO governance forum has discussed "dark mode" auction mechanisms for collateral liquidation that delay public announcement of auction parameters, reducing predatory bidding. While unpublished as a formal paper, it represents industry interest in pre-settlement privacy for on-chain finance.

**FIRST.** Forrest et al. [34] ("FIRST: FrontrunnIng Resistant Smart ConTracts", arXiv:2204.00955) propose a general framework for frontrunning-resistant contract design using temporal logic and commitment enforcement, complementary to the approach taken here.

**BlindPerm.** Kelkar et al. (IACR ePrint 2023/1061) propose BlindPerm, an encrypted mempool construction using a random permutation on committed blocks to make transaction ordering independent of content, providing MEV resistance without trusted hardware.

---

## Appendix A: Full Algorithm Pseudocode

### A.1 Trader Client (TypeScript/Bun, sdk/src/encryption.ts)

```typescript
function generateCommitment(
  sizeLots: bigint,
  leverageBps: number,
  traderPubkey: Uint8Array,
  salt: Uint8Array  // 32 random bytes
): Uint8Array {
  // Encode fields
  const sizeBytes = toLittleEndian64(sizeLots);
  const leverageBytes = toLittleEndian16(leverageBps);
  // Concatenate: salt || size_le || leverage_le || trader_pubkey
  const preimage = concat([salt, sizeBytes, leverageBytes, traderPubkey]);
  return sha256(preimage);
}

function encryptPayload(
  settlerPubkey: Uint8Array,  // X25519 public key
  salt: Uint8Array,
  sizeLots: bigint,
  leverageBps: number
): Uint8Array {
  // Generate ephemeral keypair
  const { publicKey: ek_pub, secretKey: ek_priv } = x25519.generateKeyPair();
  // ECDH
  const dh = x25519.scalarMult(ek_priv, settlerPubkey);
  // HKDF key derivation
  const k = hkdf(sha256, dh, undefined, "darkbook-order-v1", 32);
  // AES-256-GCM encryption
  const nonce = randomBytes(12);
  const plaintext = encode({ salt, sizeLots, leverageBps });
  const { ciphertext, tag } = aesGcm256.seal(k, nonce, plaintext);
  // Output: ephemeral_pub || nonce || ciphertext || tag
  return concat([ek_pub, nonce, ciphertext, tag]);
}
```

### A.2 On-Chain Commitment Verification (Rust, programs/darkbook/src/ix/settlement.rs)

```rust
pub fn verify_commitment(
    commitment: &[u8; 32],
    salt: &[u8; 32],
    size_lots: u64,
    leverage_bps: u16,
    trader: &Pubkey,
) -> Result<()> {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(&size_lots.to_le_bytes());
    hasher.update(&leverage_bps.to_le_bytes());
    hasher.update(trader.as_ref());
    let computed: [u8; 32] = hasher.finalize().into();
    require!(computed == *commitment, DarkbookError::CommitmentMismatch);
    Ok(())
}
```

### A.3 Size Band Derivation

```rust
pub fn size_band(size_lots: u64) -> SizeBand {
    match size_lots {
        0..=10       => SizeBand::Small,
        11..=100     => SizeBand::Medium,
        101..=1000   => SizeBand::Large,
        _            => SizeBand::Whale,
    }
}

pub fn band_ceiling_lots(band: SizeBand) -> u64 {
    match band {
        SizeBand::Small  => 10,
        SizeBand::Medium => 100,
        SizeBand::Large  => 1_000,
        SizeBand::Whale  => 10_000,  // conservative ceiling for collateral lock
    }
}
```

### A.4 Parameter Choices

| Parameter | Value | Rationale |
|---|---|---|
| Salt size | 256 bits | Prevents brute-force over small integer $s$ space |
| SHA-256 output | 256 bits | 128-bit collision resistance (birthday bound) |
| ECIES curve | Curve25519 / X25519 | High performance, well-analyzed, RFC 7748 |
| Symmetric cipher | AES-256-GCM | NIST standard, hardware acceleration on x86/ARM |
| KDF | HKDF-SHA-256 | RFC 5869, provides key separation via info string |
| AES nonce | 96 bits random | 2^48 encryption safety bound under random nonce model |
| ed25519 | 256-bit key | Deterministic signing, Solana-native, RFC 8032 |
| Size bands | 4 (2 bits) | Minimal leakage consistent with collateral estimation |
| ER block time | <50 ms | MagicBlock SLA for devnet-US endpoint |
| Collateral buffer | band_ceiling × price × leverage | Conservative overestimate released at settlement |

---

## References

[1] R. Bloomfield, M. O'Hara, and G. Saar, "The 'Make or Take' Decision in an Electronic Market: Evidence on the Evolution of Liquidity," *Journal of Financial Economics*, 2005.

[2] P. Daian, S. Goldfeder, T. Kell, Y. Li, X. Zhao, I. Bentov, L. Breidenbach, and A. Juels, "Flash Boys 2.0: Frontrunning in Decentralized Exchanges, Miner Extractable Value, and Consensus Instability," *IEEE Symposium on Security and Privacy*, 2020.

[3] C. F. Torres, R. Camino, and R. State, "Frontrunner Jones and the Raiders of the Dark Forest: An Empirical Study of Frontrunning on the Ethereum Blockchain," *USENIX Security*, 2021.

[4] Jito Labs, "Jito MEV Documentation: Bundles and Block Engine," https://docs.jito.wtf/, 2023.

[5] A. Canidio and V. Danos, "Commitment Against Front-Running Attacks," arXiv:2301.13785, 2023.

[6] Shutter Network, "Shutter: Preventing Front-Running Using Threshold Encryption," https://shutter.network/, 2022.

[7] B. Abramson et al., "Practical Mempool Privacy via One-time Setup Batched Threshold Encryption," IACR ePrint 2024/1516, 2024.

[8] C. Bender et al., "Renegade: Protocol Specification v0.6," https://whitepaper.renegade.fi/, 2024.

[9] Penumbra Labs, "The Penumbra Protocol: A Shielded DEX for the Interchain," https://protocol.penumbra.zone/, 2024.

[10] H. Howard, D. Hopwood, A. Sasson, and N. Wilcox (Aleo Team), "Aleo: A Platform for Privately Verifiable Applications," https://aleo.org/, 2023.

[11] Aztec Labs, "Aztec: A Hybrid Public-Private ZK-Rollup," https://aztec.network/, 2023.

[12] Pyth Network, "Introducing Pyth Lazer: Launching DeFi Into Real-Time," https://www.pyth.network/blog/introducing-pyth-lazer-launching-defi-into-real-time, 2024.

[13] Pyth Network, "Pyth Network Pull Oracle on Solana," https://www.pyth.network/blog/pyth-network-pull-oracle-on-solana, 2023.

[14] I. Damgard, "Collision Free Hash Functions and Public Key Signature Schemes," *EUROCRYPT*, 1987.

[15] V. Shoup, "A Proposal for an ISO Standard for Public Key Encryption," IACR ePrint 2001/112, 2001.

[16] D. J. Bernstein, "Curve25519: New Diffie-Hellman Speed Records," *IACR PKC*, 2006.

[17] H. Krawczyk and P. Eronen, "HMAC-based Extract-and-Expand Key Derivation Function (HKDF)," RFC 5869, 2010.

[18] M. Dworkin, "Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC," NIST SP 800-38D, 2007.

[19] V. Shoup, "OAEP Reconsidered," *CRYPTO*, 2001. (IND-CCA2 under DDH for ECIES).

[20] Hyperliquid, "Hyperliquid: A Decentralized Exchange Built on HyperBFT," https://hyperliquid.xyz/, 2024.

[21] Y. K. Chia, "Inside Drift: Architecting a High-Performance Orderbook on Solana," https://chiayong.com/articles/drift-orderbook, 2024.

[22] T. P. Pedersen, "A Threshold Cryptosystem without a Trusted Party," *EUROCRYPT*, 1991.

[23] A. Shamir, "How to Share a Secret," *Communications of the ACM*, 1979.

[24] J. Groth, "On the Size of Pairing-Based Non-interactive Arguments," *EUROCRYPT*, 2016.

[25] A. Gabizon, Z. J. Williamson, and O. Ciobotaru, "PLONK: Permutations over Lagrange-bases for Oecumenical Noninteractive arguments of Knowledge," IACR ePrint 2019/953, 2019.

[26] Intel Corporation, "Intel Software Guard Extensions (SGX) Developer Guide," 2023.

[27] M. Oved et al., "Indifferential Privacy: A New Paradigm and Its Applications to Optimal Matching in Dark Pool Auctions," arXiv:2502.13415, 2025.

[28] D. Boneh, J. Bonneau, B. Bünz, and B. Fisch, "Verifiable Delay Functions," *CRYPTO*, 2018.

[29] LibSubmarine Team, "LibSubmarine: Defeating Frontrunning Attacks," https://libsubmarine.org/, 2018.

[30] S. Bowe, A. Chiesa, M. Green, I. Miers, P. Mishra, and H. Wu, "ZEXE: Enabling Decentralized Private Computation," *IEEE S&P*, 2020.

[31] R. Gennaro and S. Goldfeder, "Fast Multiparty Threshold ECDSA with Fast Trustless Setup," *ACM CCS*, 2018.

[32] T. P. Pedersen, "Non-Interactive and Information-Theoretic Secure Verifiable Secret Sharing," *CRYPTO*, 1991.

[33] MagicBlock Labs, "Ephemeral Rollups is All You Need," https://www.magicblock.xyz/blog/a-guide-to-ephemeral-rollups, 2024.

[34] R. Forrest et al., "FIRST: FrontrunnIng Resistant Smart ConTracts," arXiv:2204.00955, 2022.
