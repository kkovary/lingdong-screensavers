#!/bin/bash
# Download a pinned Pyodide release into Resources/pyodide/ for offline use.
# Run from the repo root or from savers/hermit/.
set -euo pipefail

VERSION=0.27.5
CDN="https://cdn.jsdelivr.net/pyodide/v${VERSION}/full"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$SCRIPT_DIR/Resources/pyodide"

mkdir -p "$DEST"

# Core files
CORE_FILES=(
  pyodide.js
  pyodide.mjs
  pyodide.asm.js
  pyodide.asm.wasm
  python_stdlib.zip
  pyodide-lock.json
)

# Package wheels (no deps for either)
WHEELS=(
  "pygame_ce-2.4.1-cp312-cp312-pyodide_2024_0_wasm32.whl"
  "numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl"
)

# SHA-256 checksums for wheels (from pyodide-lock.json)
sha_for() {
  case "$1" in
    pygame_ce-*) echo "c41a4bfb623b80d75d2772e083a4c081d386f97432044f516fa8601ab20d3c8a" ;;
    numpy-*)     echo "d9cc75a959bbfb14efe05e26ca04cb2c85acbdad8b0a07a1c0140c4b820b4eec" ;;
    *)           echo "" ;;
  esac
}

echo "Fetching Pyodide $VERSION into $DEST ..."

for f in "${CORE_FILES[@]}"; do
  if [ ! -f "$DEST/$f" ]; then
    echo "  $f"
    curl -fsSL "$CDN/$f" -o "$DEST/$f"
  fi
done

for w in "${WHEELS[@]}"; do
  if [ ! -f "$DEST/$w" ]; then
    echo "  $w"
    curl -fsSL "$CDN/$w" -o "$DEST/$w"
    # Verify checksum
    expected=$(sha_for "$w")
    if [ -n "$expected" ]; then
      got=$(shasum -a 256 "$DEST/$w" | awk '{print $1}')
      if [ "$got" != "$expected" ]; then
        echo "ERROR: SHA-256 mismatch for $w" >&2
        echo "  expected: $expected" >&2
        echo "  got:      $got" >&2
        rm -f "$DEST/$w"
        exit 1
      fi
    fi
  fi
done

# Total size
du -sh "$DEST" | awk '{print "Pyodide vendored: " $1}'
echo "Done."
