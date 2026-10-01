#!/bin/bash
# Ensure the pinned, checksum-verified Pyodide runtime is present.
set -euo pipefail
exec "$(dirname "$0")/fetch-pyodide.sh"
