#!/bin/bash
# Pre-build hook: ensure Pyodide is fetched before building the saver.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYODIDE_DIR="$SCRIPT_DIR/Resources/pyodide"
if [ ! -f "$PYODIDE_DIR/pyodide.js" ]; then
  echo "Pyodide not found; fetching..."
  "$SCRIPT_DIR/fetch-pyodide.sh"
fi
