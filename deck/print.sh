#!/usr/bin/env bash
# DarkBook Pitch Deck → PDF
# Renders the Reveal.js deck to a single PDF using headless Chrome/Chromium.

set -euo pipefail

cd "$(dirname "$0")"
DECK_DIR="$(pwd)"
OUT="$DECK_DIR/deck.pdf"
URL="file://$DECK_DIR/index.html?print-pdf"

# Locate a working browser binary.
BROWSER=""
for candidate in \
  "chromium" \
  "chromium-browser" \
  "google-chrome" \
  "google-chrome-stable" \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
do
  if command -v "$candidate" >/dev/null 2>&1 || [ -x "$candidate" ]; then
    BROWSER="$candidate"
    break
  fi
done

if [ -z "$BROWSER" ]; then
  echo "ERROR: No Chrome/Chromium binary found." >&2
  echo "Install one of: chromium, google-chrome, brave-browser." >&2
  exit 1
fi

echo "→ Using browser: $BROWSER"
echo "→ Source:        $URL"
echo "→ Output:        $OUT"
echo ""

"$BROWSER" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --hide-scrollbars \
  --no-pdf-header-footer \
  --virtual-time-budget=30000 \
  --run-all-compositor-stages-before-draw \
  --no-pdf-header-footer \
  --print-to-pdf="$OUT" \
  --print-to-pdf-no-header \
  "$URL"

if [ -f "$OUT" ]; then
  SIZE=$(ls -lh "$OUT" | awk '{print $5}')
  echo ""
  echo "✓ PDF rendered: $OUT ($SIZE)"
else
  echo "✗ PDF generation failed." >&2
  exit 1
fi
