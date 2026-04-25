use crate::constants::FILLS_PER_MATCH;
use crate::errors::DarkbookError;
use crate::state::{Fill, OrderBook};
use anchor_lang::prelude::*;

/// Run up to FILLS_PER_MATCH matching rounds on the book.
/// Returns the number of fills created.
///
/// Match logic: while best_bid >= best_ask, pop both, create Fill, re-insert
/// remainder orders (partial fills not supported — each order is fully consumed
/// in one match because size is opaque; the commitment scheme means we can only
/// verify exact size at settlement, so we treat each order as atomic).
pub fn match_step(book: &mut OrderBook, slot: u64) -> Result<u8> {
    let mut filled: u8 = 0;

    while filled < FILLS_PER_MATCH as u8 {
        if book.fill_count as usize >= OrderBook::MAX_FILLS {
            break;
        }

        let best_bid = match book.best_bid_price() {
            Some(p) => p,
            None => break,
        };
        let best_ask = match book.best_ask_price() {
            Some(p) => p,
            None => break,
        };

        // No match possible
        if best_bid < best_ask {
            break;
        }

        let bid = match book.pop_best_bid() {
            Some(o) => o,
            None => break,
        };
        let ask = match book.pop_best_ask() {
            Some(o) => o,
            None => {
                // Re-insert bid since no ask available (shouldn't happen, but be safe)
                book.insert_bid(bid);
                return Ok(filled);
            }
        };

        // Self-match prevention: a trader must not match their own orders.
        // Re-insert both and break out of the loop (skip rather than fail tx).
        if bid.trader == ask.trader {
            book.insert_bid(bid);
            book.insert_ask(ask);
            break;
        }

        // Match executes at the maker's price (ask price, taker is bid side)
        // Taker = bid (aggressor crossed the spread), Maker = ask (passive)
        let fill_price = ask.price_ticks;

        let fill_id = book.next_fill_id;

        let fill = Fill {
            fill_id,
            taker_order_id: bid.order_id,
            maker_order_id: ask.order_id,
            taker: bid.trader,
            maker: ask.trader,
            price_ticks: fill_price,
            size_band: bid.size_band, // use taker's size_band; both verified at settlement
            claimed: 0,
            _pad: [0u8; 6],
            matched_slot: slot,
        };

        if !book.push_fill(fill) {
            let _ = book.insert_bid(bid);
            let _ = book.insert_ask(ask);
            break;
        }
        book.next_fill_id = fill_id.checked_add(1).ok_or(DarkbookError::Overflow)?;
        filled = filled.checked_add(1).ok_or(DarkbookError::Overflow)?;
    }

    Ok(filled)
}

// ─── Stress tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Order;
    use bytemuck::Zeroable;

    /// Allocate an OrderBook on the heap (it's ~228 KB; do NOT put it on the stack).
    fn fresh_book() -> Box<OrderBook> {
        // Safety: zero_copy account layout is just bytes; Zeroable impl is derived
        // for every nested struct. Box::new of a zeroed value is valid.
        let layout = std::alloc::Layout::new::<OrderBook>();
        unsafe {
            let ptr = std::alloc::alloc_zeroed(layout) as *mut OrderBook;
            assert!(!ptr.is_null());
            Box::from_raw(ptr)
        }
    }

    fn mk_order(id: u64, price: u64, side: u8) -> Order {
        let mut o = Order::zeroed();
        o.order_id = id;
        o.price_ticks = price;
        o.side = side;
        o.size_band = 0;
        o.leverage_bps = 1000;
        o.placed_slot = id; // monotone for time-priority assertions
        // Distinct trader pubkey per (side, id) so self-match guard doesn't fire.
        let mut t = [0u8; 32];
        t[0] = side;
        t[1..9].copy_from_slice(&id.to_le_bytes());
        o.trader = t;
        o
    }

    fn xorshift(state: &mut u64) -> u64 {
        let mut x = *state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        *state = x;
        x
    }

    #[test]
    fn ordering_preserved_under_random_inserts() {
        let mut book = fresh_book();
        let mut rng = 0xDEAD_BEEF_u64;

        // Cap inserts to MAX_LEVELS-ish since each random price likely makes a new level.
        // We use a price band of 256 ticks so collisions happen and exercise the per-level path.
        let n = 500u64;
        let mut next_id: u64 = 1;
        for i in 0..n {
            let price = 1000 + (xorshift(&mut rng) % 256);
            let side = (i % 2) as u8;
            let inserted = if side == 0 {
                book.insert_bid(mk_order(next_id, price, 0))
            } else {
                book.insert_ask(mk_order(next_id, price, 1))
            };
            if inserted {
                next_id += 1;
            }
        }

        // Bids must be sorted descending across all live levels.
        let bid_count = book.bid_count as usize;
        for i in 1..bid_count {
            assert!(
                book.bids[i - 1].price_ticks >= book.bids[i].price_ticks,
                "bids must be sorted descending: idx {} = {}, idx {} = {}",
                i - 1,
                book.bids[i - 1].price_ticks,
                i,
                book.bids[i].price_ticks
            );
        }
        // Asks must be sorted ascending.
        let ask_count = book.ask_count as usize;
        for i in 1..ask_count {
            assert!(
                book.asks[i - 1].price_ticks <= book.asks[i].price_ticks,
                "asks must be sorted ascending"
            );
        }
        // Each level must hold ≤ 4 orders.
        for i in 0..bid_count {
            assert!(book.bids[i].count as usize <= OrderBook::ORDERS_PER_LEVEL);
        }
        for i in 0..ask_count {
            assert!(book.asks[i].count as usize <= OrderBook::ORDERS_PER_LEVEL);
        }
    }

    #[test]
    fn match_step_only_emits_crossing_fills() {
        let mut book = fresh_book();

        // Build a book where some bids cross some asks.
        let mut id = 1u64;
        // Bids at 100..120 (10 levels)
        for p in 100..120u64 {
            assert!(book.insert_bid(mk_order(id, p, 0)));
            id += 1;
        }
        // Asks at 110..130 (overlap from 110..120)
        for p in 110..130u64 {
            assert!(book.insert_ask(mk_order(id, p, 1)));
            id += 1;
        }

        // 32 calls — but at most ~10 crossings will happen.
        let mut total = 0u8;
        for _ in 0..32 {
            let n = match_step(&mut book, 42).unwrap();
            total = total.saturating_add(n);
            if n == 0 {
                break;
            }
        }

        assert!(total > 0, "expected some crossing fills");

        // Every fill must be at a price where the original bid >= ask.
        let count = book.fill_count as usize;
        let head = book.fill_head as usize;
        for i in 0..count {
            let idx = (head.saturating_sub(count) + i) % OrderBook::MAX_FILLS;
            let f = &book.fills[idx];
            // Fill price is the maker (ask) price; assert price is in the crossing band.
            assert!(
                f.price_ticks >= 110 && f.price_ticks < 120,
                "fill price {} outside crossing band",
                f.price_ticks
            );
        }
    }

    #[test]
    fn cancel_marks_tombstones_and_pop_skips_them() {
        let mut book = fresh_book();
        let mut ids = Vec::new();
        let mut id = 1u64;

        // Pack 256 bids at descending prices (one per level).
        for p in (1000..1256u64).rev() {
            assert!(book.insert_bid(mk_order(id, p, 0)));
            ids.push((id, p));
            id += 1;
        }
        assert_eq!(book.bid_count as usize, 256);

        // Cancel 100 of them spread across the book.
        let mut cancelled = 0;
        for (oid, expected_price) in ids.iter().step_by(2).take(100) {
            let r = book.cancel_order(*oid, true);
            assert!(r.is_some(), "cancel({}) returned None", oid);
            let (price, _lev, _band) = r.unwrap();
            assert_eq!(price, *expected_price);
            cancelled += 1;
        }
        assert_eq!(cancelled, 100);

        // live_bid_count drops by 100; bid_count (logical) unchanged until popped.
        assert_eq!(book.live_bid_count(), 256 - 100);

        // Pop every remaining order. Tombstones must be skipped, prices must
        // come out in descending order.
        let mut last_price = u64::MAX;
        let mut popped = 0;
        while let Some(o) = book.pop_best_bid() {
            assert!(o.price_ticks <= last_price, "pop order broken");
            last_price = o.price_ticks;
            popped += 1;
        }
        assert_eq!(popped, 256 - 100);
    }

    #[test]
    fn full_book_capacity_smoke() {
        let mut book = fresh_book();
        let mut id = 1u64;
        // 256 levels × 4 orders/level = 1024 bids
        for level in 0..OrderBook::MAX_LEVELS as u64 {
            let price = 10_000 - level; // descending so highest at level 0
            for _ in 0..OrderBook::ORDERS_PER_LEVEL {
                assert!(book.insert_bid(mk_order(id, price, 0)));
                id += 1;
            }
        }
        assert_eq!(book.bid_count as usize, OrderBook::MAX_LEVELS);
        assert_eq!(book.live_bid_count(), 1024);

        // One more insert at a brand new price must fail (no level slots left).
        assert!(!book.insert_bid(mk_order(id, 1, 0)));
    }
}
