use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

// ─── Enums ───────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Long,
    Short,
}

impl Default for Side {
    fn default() -> Self {
        Side::Long
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum SizeBand {
    /// ≤ 10 lots
    Small,
    /// ≤ 100 lots
    Medium,
    /// ≤ 1000 lots
    Large,
    /// > 1000 lots
    Whale,
}

impl Default for SizeBand {
    fn default() -> Self {
        SizeBand::Small
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PositionStatus {
    Open,
    Closed,
    Liquidated,
}

impl Default for PositionStatus {
    fn default() -> Self {
        PositionStatus::Open
    }
}

// ─── Market ──────────────────────────────────────────────────────────────────

/// Mainnet PDA: seeds = [b"market", asset_id]
#[account]
#[derive(Default)]
pub struct Market {
    /// 8-byte asset identifier
    pub asset_id: [u8; 8],
    /// Pyth feed id for this market's oracle
    pub oracle_feed_id: [u8; 32],
    pub funding_interval_secs: i64,
    pub max_leverage_bps: u16,
    pub taker_fee_bps: u16,
    pub maker_rebate_bps: u16,
    /// Total open long size in lots
    pub total_long_size: u64,
    /// Total open short size in lots
    pub total_short_size: u64,
    pub last_funding_ts: i64,
    /// Cumulative funding index for longs (signed, scaled by 1e9)
    pub cum_funding_long: i64,
    /// Cumulative funding index for shorts (signed, scaled by 1e9)
    pub cum_funding_short: i64,
    /// Realized losses collected from losing closes and liquidations.
    /// Winning closes may only withdraw PnL that is backed by this pool.
    pub realized_loss_pool: u64,
    pub paused: bool,
    pub bump: u8,
    /// Authority that initialized this market
    pub admin: Pubkey,
}

impl Market {
    pub const LEN: usize = 8   // discriminator
        + 8   // asset_id
        + 32  // oracle_feed_id
        + 8   // funding_interval_secs
        + 2   // max_leverage_bps
        + 2   // taker_fee_bps
        + 2   // maker_rebate_bps
        + 8   // total_long_size
        + 8   // total_short_size
        + 8   // last_funding_ts
        + 8   // cum_funding_long
        + 8   // cum_funding_short
        + 8   // realized_loss_pool
        + 1   // paused
        + 1   // bump
        + 32; // admin
}

// ─── CollateralVault ─────────────────────────────────────────────────────────

/// Mainnet PDA: seeds = [b"vault", market]
/// This is the authority PDA over the SPL token account.
#[account]
#[derive(Default)]
pub struct CollateralVault {
    pub market: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
}

impl CollateralVault {
    pub const LEN: usize = 8 + 32 + 32 + 1;
}

// ─── UserAccount ─────────────────────────────────────────────────────────────

/// Mainnet PDA: seeds = [b"user", market, owner]
#[account]
#[derive(Default)]
pub struct UserAccount {
    pub owner: Pubkey,
    pub market: Pubkey,
    /// Total deposited (in token lamports, i.e. USDC micro-units)
    pub deposited_amount: u64,
    /// Amount currently locked as collateral across open orders + positions
    pub locked_amount: u64,
    /// Cumulative realized PnL (signed, in token lamports)
    pub realized_pnl: i64,
    /// Monotonically increasing index for position PDAs
    pub next_position_idx: u64,
    pub bump: u8,
}

impl UserAccount {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1;

    pub fn unlocked_amount(&self) -> u64 {
        self.deposited_amount.saturating_sub(self.locked_amount)
    }
}

// ─── Position ────────────────────────────────────────────────────────────────

/// Mainnet PDA: seeds = [b"pos", market, owner, position_idx_le_bytes]
#[account]
#[derive(Default)]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub side: Side,
    /// Size in lots (revealed at settlement)
    pub size_lots: u64,
    /// Entry price in price ticks
    pub entry_price_ticks: u64,
    /// Collateral locked for this position (USDC micro-units)
    pub collateral_locked: u64,
    pub opened_ts: i64,
    /// Last cum_funding_long or cum_funding_short value when funding was accrued
    pub last_funding_index: i64,
    pub status: PositionStatus,
    pub leverage_bps: u16,
    pub position_idx: u64,
    pub bump: u8,
}

impl Position {
    pub const LEN: usize = 8    // discriminator
        + 32  // owner
        + 32  // market
        + 1   // side
        + 8   // size_lots
        + 8   // entry_price_ticks
        + 8   // collateral_locked
        + 8   // opened_ts
        + 8   // last_funding_index
        + 1   // status
        + 2   // leverage_bps
        + 8   // position_idx
        + 1; // bump
}

// ─── Order (zero-copy compatible) ────────────────────────────────────────────

/// Each order stored in the OrderBook fixed arrays.
/// 96-byte fixed layout: 4 orders per price level × 256 levels per side = 1024 max per side.
/// `side` field is redundant on-chain (location implies side) but kept so events
/// and tombstone-marked entries can be inspected without context.
/// `_pad` ensures `[Order; 4]` packs cleanly with the level header on 8-byte alignment.
#[repr(C)]
#[derive(AnchorSerialize, Clone, Copy, Pod, Zeroable)]
pub struct Order {
    pub order_id: u64,
    pub trader: [u8; 32],
    /// 0 = Long (bid), 1 = Short (ask)
    pub side: u8,
    /// 0=Small, 1=Medium, 2=Large, 3=Whale
    pub size_band: u8,
    pub leverage_bps: u16,
    pub _pad: [u8; 4],
    pub price_ticks: u64,
    pub commitment: [u8; 32],
    pub placed_slot: u64,
}

impl Order {
    pub const SIZE: usize = core::mem::size_of::<Order>();

    /// Tombstone marker: order_id == 0 means "logically deleted".
    /// Lazy delete avoids shifting on cancel; reaped during pop_best or compaction.
    #[inline]
    pub fn is_tombstone(&self) -> bool {
        self.order_id == 0
    }
}

// ─── Fill (zero-copy compatible) ─────────────────────────────────────────────

#[repr(C)]
#[derive(AnchorSerialize, Clone, Copy, Pod, Zeroable)]
pub struct Fill {
    pub fill_id: u64,
    pub taker_order_id: u64,
    pub maker_order_id: u64,
    pub taker: [u8; 32],
    pub maker: [u8; 32],
    pub price_ticks: u64,
    /// 0=Small, 1=Medium, 2=Large, 3=Whale
    pub size_band: u8,
    /// 1 if claimed
    pub claimed: u8,
    pub _pad: [u8; 6],
    pub matched_slot: u64,
}

impl Fill {
    pub const SIZE: usize = core::mem::size_of::<Fill>();
}

// ─── Price bucket for zero-copy book ─────────────────────────────────────────

/// Each price level holds up to 4 orders (time-priority within the price/band).
/// price_ticks == 0 means empty bucket. count == 0 with price != 0 means an
/// emptied-but-not-yet-compacted slot (cheap to skip, expensive to shift).
///
/// 16-byte header keeps the Order array 8-byte aligned (Solana BPF requirement).
#[repr(C)]
#[derive(AnchorSerialize, Clone, Copy, Pod, Zeroable)]
pub struct PriceBucket {
    pub price_ticks: u64,
    pub count: u64,
    pub orders: [Order; 4],
}

// ─── OrderBook (zero-copy) ───────────────────────────────────────────────────

/// Delegated to ER PDA: seeds = [b"book", market]
///
/// Sizing math (target: ≤ 256KB so commit cost stays bounded):
///   Order      = 96 bytes (see Order)
///   PriceBucket = 16 (header) + 4 * 96 = 400 bytes
///   Fill       = 112 bytes
///
///   bids       = 256 * 400 = 102_400 bytes  (1024 resting orders)
///   asks       = 256 * 400 = 102_400 bytes  (1024 resting orders)
///   fills      = 256 * 112 =  28_672 bytes  (ring buffer)
///   metadata   = 32 (market) + 7*8 (counters) + 16 (pad) = 104 bytes
///   discriminator = 8
///   ───────────────────────────────────────
///   total      ≈ 233_584 bytes  (~228 KB)
///
/// Why not smaller:
///  - Anchor zero_copy + #[repr(C)] gives us O(1) access without per-field deser.
///  - 256 levels per side covers the realistic crossing band on a perp book —
///    BTC perp at 0.10$ ticks needs ~50 levels per 0.5% band; we leave headroom.
///  - 4 orders per level is enough for time-priority queueing within a tick;
///    overflow returns FillQueueFull and the caller can re-price.
///
/// MagicBlock ER caps individual account size at 10 MB; the binding constraint
/// is commit bandwidth, not size. Empirically, MagicBlock streams deltas at
/// commit_frequency_ms cadence so a 228KB account commits in < 50ms.
#[account(zero_copy)]
#[repr(C)]
pub struct OrderBook {
    pub market: [u8; 32],
    /// Monotonically increasing order id counter (starts at 1; 0 = tombstone marker)
    pub next_order_id: u64,
    /// Monotonically increasing fill id counter
    pub next_fill_id: u64,
    pub last_match_slot: u64,
    pub last_commit_slot: u64,
    /// Number of valid bids (sorted descending by price)
    pub bid_count: u64,
    /// Number of valid asks (sorted ascending by price)
    pub ask_count: u64,
    /// Current number of fills in the ring buffer (wraps at FILL_QUEUE_CAP)
    pub fill_count: u64,
    /// Ring buffer write cursor
    pub fill_head: u64,
    /// Set to 1 when book is delegated to ER, 0 otherwise. Match must be 1; mainnet ix must be 0.
    pub is_delegated: u8,
    pub _pad: [u8; 15],
    pub bids: [PriceBucket; 256],
    pub asks: [PriceBucket; 256],
    pub fills: [Fill; 256],
}

impl OrderBook {
    pub const MAX_LEVELS: usize = 256;
    pub const ORDERS_PER_LEVEL: usize = 4;
    pub const MAX_FILLS: usize = 256;

    pub const LEN: usize = 8   // discriminator
        + 32  // market
        + 8   // next_order_id
        + 8   // next_fill_id
        + 8   // last_match_slot
        + 8   // last_commit_slot
        + 8   // bid_count
        + 8   // ask_count
        + 8   // fill_count
        + 8   // fill_head
        + 16  // _pad
        + Self::MAX_LEVELS * core::mem::size_of::<PriceBucket>()
        + Self::MAX_LEVELS * core::mem::size_of::<PriceBucket>()
        + Self::MAX_FILLS * core::mem::size_of::<Fill>();

    /// Insert a bid (buy) order, keeping bids sorted DESCENDING by price.
    /// Returns false if the level is full and no more level slots remain.
    /// Uses binary search to find the insertion point: O(log n) comparisons,
    /// then O(n) shift in the worst case. The shift is unavoidable for an
    /// array-backed sorted structure but moves contiguous 400-byte buckets
    /// which the BPF VM handles as a tight memcpy loop.
    pub fn insert_bid(&mut self, order: Order) -> bool {
        self.insert_order(order, true)
    }

    /// Insert an ask (sell) order, keeping asks sorted ASCENDING by price.
    pub fn insert_ask(&mut self, order: Order) -> bool {
        self.insert_order(order, false)
    }

    fn insert_order(&mut self, order: Order, is_bid: bool) -> bool {
        let side_buckets = if is_bid {
            &mut self.bids
        } else {
            &mut self.asks
        };
        let count_ref = if is_bid {
            &mut self.bid_count
        } else {
            &mut self.ask_count
        };

        let count = *count_ref as usize;
        let price = order.price_ticks;

        // Binary search for an existing level at this price, or the insertion point.
        // For bids the array is sorted descending; we negate the comparison.
        let (found_idx, insert_pos) = bsearch_levels(side_buckets, count, price, is_bid);

        if let Some(bi) = found_idx {
            let c = side_buckets[bi].count as usize;
            if c >= Self::ORDERS_PER_LEVEL {
                // Try compacting tombstones in this level before giving up.
                let live = compact_level(&mut side_buckets[bi]);
                if live >= Self::ORDERS_PER_LEVEL {
                    return false;
                }
                side_buckets[bi].orders[live] = order;
                side_buckets[bi].count = (live + 1) as u64;
                return true;
            }
            side_buckets[bi].orders[c] = order;
            side_buckets[bi].count += 1;
            return true;
        }

        if count >= Self::MAX_LEVELS {
            return false;
        }

        // Shift buckets right to make room. Worst case: 256 * 400 = 102KB memmove.
        if count > insert_pos {
            for i in (insert_pos..count).rev() {
                side_buckets[i + 1] = side_buckets[i];
            }
        }

        let mut bucket = PriceBucket::zeroed();
        bucket.price_ticks = price;
        bucket.count = 1;
        bucket.orders[0] = order;
        side_buckets[insert_pos] = bucket;
        *count_ref += 1;

        true
    }

    /// Remove and return the best bid (highest price, time-priority).
    /// Skips tombstoned orders inside the top level.
    pub fn pop_best_bid(&mut self) -> Option<Order> {
        self.pop_best(true)
    }

    /// Remove and return the best ask (lowest price, time-priority).
    pub fn pop_best_ask(&mut self) -> Option<Order> {
        self.pop_best(false)
    }

    fn pop_best(&mut self, is_bid: bool) -> Option<Order> {
        let side_buckets = if is_bid {
            &mut self.bids
        } else {
            &mut self.asks
        };
        let count_ref = if is_bid {
            &mut self.bid_count
        } else {
            &mut self.ask_count
        };

        loop {
            let count = *count_ref as usize;
            if count == 0 {
                return None;
            }

            let bucket = &mut side_buckets[0];
            let c = bucket.count as usize;

            // Skip tombstones at the head (lazy delete reaping)
            let mut head = 0usize;
            while head < c && bucket.orders[head].is_tombstone() {
                head += 1;
            }

            if head >= c {
                // Whole top level is tombstoned — drop level and retry
                evict_top_level(side_buckets, count);
                *count_ref -= 1;
                continue;
            }

            let order = bucket.orders[head];
            // Shift remaining orders down past the consumed/tombstoned head
            let new_count = c - head - 1;
            for i in 0..new_count {
                bucket.orders[i] = bucket.orders[head + 1 + i];
            }
            // Zero trailing slots so tombstone scans stay clean
            for i in new_count..c {
                bucket.orders[i] = Order::zeroed();
            }
            bucket.count = new_count as u64;

            if bucket.count == 0 {
                evict_top_level(side_buckets, count);
                *count_ref -= 1;
            }

            return Some(order);
        }
    }

    /// Lazy cancel: stamps the order with a tombstone and returns the order's
    /// (price_ticks, leverage_bps, size_band) so the caller can refund collateral.
    /// Skips the bucket-shift cost — actual reclamation happens on pop_best or
    /// the next insert into the same level.
    ///
    /// Worst case: O(L*K) linear scan over L levels × K orders/level.
    /// At 256 * 4 = 1024 orders, that's ~1k id comparisons.
    pub fn cancel_order(&mut self, order_id: u64, is_bid: bool) -> Option<(u64, u16, u8)> {
        let (side_buckets, count_ref) = if is_bid {
            (&mut self.bids, &mut self.bid_count)
        } else {
            (&mut self.asks, &mut self.ask_count)
        };
        let bucket_count = *count_ref as usize;
        for bi in 0..bucket_count {
            let order_count = side_buckets[bi].count as usize;
            for oi in 0..order_count {
                if side_buckets[bi].orders[oi].order_id == order_id {
                    let order = side_buckets[bi].orders[oi];
                    // Tombstone in place — no shifting.
                    side_buckets[bi].orders[oi] = Order::zeroed();
                    return Some((order.price_ticks, order.leverage_bps, order.size_band));
                }
            }
        }
        None
    }

    /// Hard remove (for paths that need immediate reclamation, e.g. tests).
    pub fn remove_order(&mut self, order_id: u64, is_bid: bool) -> bool {
        let (side_buckets, count_ref) = if is_bid {
            (&mut self.bids, &mut self.bid_count)
        } else {
            (&mut self.asks, &mut self.ask_count)
        };

        let bucket_count = *count_ref as usize;
        for bi in 0..bucket_count {
            let order_count = side_buckets[bi].count as usize;
            for oi in 0..order_count {
                if side_buckets[bi].orders[oi].order_id == order_id {
                    for j in oi..order_count - 1 {
                        side_buckets[bi].orders[j] = side_buckets[bi].orders[j + 1];
                    }
                    side_buckets[bi].orders[order_count - 1] = Order::zeroed();
                    side_buckets[bi].count -= 1;

                    if side_buckets[bi].count == 0 {
                        for i in bi..bucket_count - 1 {
                            side_buckets[i] = side_buckets[i + 1];
                        }
                        side_buckets[bucket_count - 1] = PriceBucket::zeroed();
                        *count_ref -= 1;
                    }
                    return true;
                }
            }
        }
        false
    }

    /// Append a fill to the ring buffer. Refuses to overwrite unclaimed fills.
    pub fn push_fill(&mut self, fill: Fill) -> bool {
        if self.fill_count as usize >= Self::MAX_FILLS {
            return false;
        }

        let mut cursor = self.fill_head as usize % Self::MAX_FILLS;
        for _ in 0..Self::MAX_FILLS {
            let existing = self.fills[cursor];
            if existing.fill_id == 0 || existing.claimed != 0 {
                self.fills[cursor] = fill;
                self.fill_head = ((cursor + 1) % Self::MAX_FILLS) as u64;
                self.fill_count = match self.fill_count.checked_add(1) {
                    Some(count) => count,
                    None => return false,
                };
                return true;
            }
            cursor = (cursor + 1) % Self::MAX_FILLS;
        }
        false
    }

    /// Find a fill by id. Searches all slots because claims may free holes.
    pub fn find_fill(&self, fill_id: u64) -> Option<usize> {
        for idx in 0..Self::MAX_FILLS {
            let fill = self.fills[idx];
            if fill.fill_id == fill_id && fill.claimed == 0 {
                return Some(idx);
            }
        }
        None
    }

    /// Mark a fill claimed and return a copy of it.
    pub fn claim_fill(&mut self, fill_id: u64) -> Option<Fill> {
        let idx = self.find_fill(fill_id)?;
        self.fills[idx].claimed = 1;
        self.fill_count = self.fill_count.checked_sub(1)?;
        Some(self.fills[idx])
    }

    /// Peek at the best bid price (skips fully-tombstoned top levels).
    pub fn best_bid_price(&self) -> Option<u64> {
        peek_best(&self.bids, self.bid_count as usize)
    }

    /// Peek at the best ask price (skips fully-tombstoned top levels).
    pub fn best_ask_price(&self) -> Option<u64> {
        peek_best(&self.asks, self.ask_count as usize)
    }

    /// Return live order count on the bid side (excludes tombstones).
    pub fn live_bid_count(&self) -> usize {
        live_count(&self.bids, self.bid_count as usize)
    }

    /// Return live order count on the ask side (excludes tombstones).
    pub fn live_ask_count(&self) -> usize {
        live_count(&self.asks, self.ask_count as usize)
    }
}

// ─── Bucket-array helpers (free functions to avoid borrow conflicts) ─────────

/// Binary search across the sorted level array. Returns:
///   (Some(idx), idx)         if a level at exactly `price` exists
///   (None, insertion_point)  otherwise
///
/// `is_bid == true` means the array is sorted DESCENDING (highest price first).
fn bsearch_levels(
    levels: &[PriceBucket],
    count: usize,
    price: u64,
    is_bid: bool,
) -> (Option<usize>, usize) {
    let mut lo = 0usize;
    let mut hi = count;
    while lo < hi {
        let mid = (lo + hi) / 2;
        let p = levels[mid].price_ticks;
        if p == price {
            return (Some(mid), mid);
        }
        let go_right = if is_bid { p > price } else { p < price };
        if go_right {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    (None, lo)
}

/// Compact tombstones inside a single bucket. Returns new live count.
fn compact_level(bucket: &mut PriceBucket) -> usize {
    let c = bucket.count as usize;
    let mut write = 0usize;
    for read in 0..c {
        if !bucket.orders[read].is_tombstone() {
            if write != read {
                bucket.orders[write] = bucket.orders[read];
            }
            write += 1;
        }
    }
    for i in write..c {
        bucket.orders[i] = Order::zeroed();
    }
    bucket.count = write as u64;
    write
}

/// Drop the top level (index 0) and shift the rest left by one.
fn evict_top_level(side_buckets: &mut [PriceBucket], count: usize) {
    for i in 0..count - 1 {
        side_buckets[i] = side_buckets[i + 1];
    }
    side_buckets[count - 1] = PriceBucket::zeroed();
}

/// Peek at the price of the first non-fully-tombstoned level.
fn peek_best(levels: &[PriceBucket], count: usize) -> Option<u64> {
    for i in 0..count {
        let bucket = &levels[i];
        let c = bucket.count as usize;
        let mut live = false;
        for j in 0..c {
            if !bucket.orders[j].is_tombstone() {
                live = true;
                break;
            }
        }
        if live {
            return Some(bucket.price_ticks);
        }
    }
    None
}

/// Count live (non-tombstone) orders across all live levels.
fn live_count(levels: &[PriceBucket], count: usize) -> usize {
    let mut total = 0usize;
    for i in 0..count {
        let bucket = &levels[i];
        let c = bucket.count as usize;
        for j in 0..c {
            if !bucket.orders[j].is_tombstone() {
                total += 1;
            }
        }
    }
    total
}
