# DarkBook Pitch Deck

Reveal.js pitch deck for **DarkBook** — institutional perps with hidden order book, sub-50ms matching on Solana.

Built for Frontier Hackathon 2026 + Colosseum accelerator interviews.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The full 12-slide deck (Reveal.js loaded from CDN) |
| `style.css` | Custom theme (black + emerald-400 + violet-500, JetBrains Mono) |
| `print.sh` | Render the deck to `deck.pdf` via headless Chrome |
| `deck.pdf` | Generated PDF (created by `print.sh`) |

## View locally

```bash
# any static server works
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Or just open `index.html` directly in a browser. (Reveal loads from a CDN, so internet is required on first view.)

## Keyboard shortcuts (Reveal.js defaults)

- `→` / `Space` — next slide
- `←` — previous slide
- `Esc` — slide overview
- `S` — open speaker notes
- `F` — fullscreen
- `?` — full keybinding list

## Print to PDF

```bash
chmod +x print.sh
./print.sh
```

The script auto-detects Chrome, Chromium, Brave, or Edge and writes `deck.pdf` to the same directory.

You can also do this manually:

```
file://<path>/index.html?print-pdf
```

then use the browser's `Print → Save as PDF` (set background graphics ON, margins NONE).

## Slide outline

1. **Title** — DarkBook, tagline, Frontier 2026
2. **Problem** — Pick two: privacy, speed, or decentralization
3. **Insight** — MagicBlock ER + commitment + Pyth Lazer = all three
4. **Product** — Trade UI mock (order book + chart + positions)
5. **Architecture** — 3-layer privacy diagram (commit → ER → Jito bundle)
6. **Why now** — Timeline of 2025–2026 unlocks (Galaxy, Anatoly, ER, Lazer, Token-2022)
7. **Market** — Hyperliquid $1.5T 2025 → $30M+ ARR for DarkBook at 10% capture
8. **Traction** — 14-day build, $55k stacked sidetracks, ER demo live
9. **Differentiation** — 6-row vs Drift / Dexlab / Vertex / Hyperliquid
10. **Roadmap** — Q3 mainnet → Q2 '27 TradFi license
11. **Team** — aarav1656 + open advisor slots
12. **Ask** — Standout/Grand prize + Adevar audit + MagicBlock co-build + $250k pre-seed

## Theme tokens

- Background `#0a0a0a` (true black)
- Emerald accent `#34d399` (emerald-400)
- Violet accent `#8b5cf6` (violet-500)
- Mono font `JetBrains Mono`
- Sans font `Inter`
