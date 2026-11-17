#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
binary="$(realpath "${1:?Usage: bash scripts/start-local.sh /path/to/rippled [relative-work-dir]}")"
work_dir="$repo/.local/${2:-ledger}"
if [[ "${2:-ledger}" == *[!a-zA-Z0-9_-]* ]]; then
    echo "Use a simple name for the local ledger directory." >&2
    exit 1
fi
"$binary" --version
mkdir -p "$work_dir"
cd "$work_dir"
exec "$binary" --standalone --ledgerfile "$repo/.bedrock/node-config/genesis.json" \
    --conf "$repo/.bedrock/node-config/xrpld.cfg"
