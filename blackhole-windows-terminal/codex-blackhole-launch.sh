#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
supervisor="$script_dir/codex-blackhole-supervisor.js"

if ! command -v node >/dev/null 2>&1; then
  echo "node not found" >&2
  exit 127
fi

exec node "$supervisor" "$@"
