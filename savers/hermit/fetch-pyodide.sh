#!/bin/bash
# Download a pinned Pyodide release into Resources/pyodide/ for offline use,
# verifying every file against the checksums of the build that was tested.
# The folder is gitignored. Re-run safely; existing good files are kept.
set -euo pipefail

VERSION=0.27.5
CDN="https://cdn.jsdelivr.net/pyodide/v${VERSION}/full"
DEST="$(cd "$(dirname "$0")" && pwd)/Resources/pyodide"
mkdir -p "$DEST"

FILES=(
  "pyodide.js                                              7fdbe66e53f68f6a4e93c295a667371759be093d2bd402bb44545514584039b6"
  "pyodide.mjs                                             6bc4d7b4f6308c4bacd3aa784d7471ead9bf45f239aa5eb431815d6f1cffe58e"
  "pyodide.asm.js                                          3a889f073e628c2196c705b42fa0e955ba2e25c034b1e3dd589c35be675bc01b"
  "pyodide.asm.wasm                                        f7fefe563134714a17abd65516d94960e8dbd96fe6778a7a842947fc9686b3a1"
  "python_stdlib.zip                                       6030964967e447c887abc46c5f0967c55688644d759496de82a3ef09f49f5cba"
  "pyodide-lock.json                                       be1807745da93daa09d360b109c17a0e526e74d664d1f1b9870aafcce98ce426"
  "pygame_ce-2.4.1-cp312-cp312-pyodide_2024_0_wasm32.whl   c41a4bfb623b80d75d2772e083a4c081d386f97432044f516fa8601ab20d3c8a"
  "numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl       d9cc75a959bbfb14efe05e26ca04cb2c85acbdad8b0a07a1c0140c4b820b4eec"
)

sha() { shasum -a 256 "$1" | awk '{print $1}'; }

for entry in "${FILES[@]}"; do
  read -r name want <<<"$entry"
  path="$DEST/$name"
  if [ -f "$path" ] && [ "$(sha "$path")" = "$want" ]; then continue; fi
  echo "  fetching $name"
  curl -fsSL "$CDN/$name" -o "$path.part"
  got="$(sha "$path.part")"
  if [ "$got" != "$want" ]; then
    rm -f "$path.part"
    echo "ERROR: SHA-256 mismatch for $name (expected $want, got $got)" >&2
    exit 1
  fi
  mv "$path.part" "$path"
done
echo "Pyodide $VERSION verified in $DEST"
