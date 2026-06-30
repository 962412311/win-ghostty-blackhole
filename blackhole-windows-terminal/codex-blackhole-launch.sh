#!/usr/bin/env bash
set -euo pipefail

repo="/mnt/i/QtWorkData/MyTools/my_ghostty_blackhole"
supervisor="$repo/blackhole-windows-terminal/codex-blackhole-supervisor.js"

if ! command -v node >/dev/null 2>&1; then
  echo "node not found" >&2
  exec "$real_codex" "$@"
fi

exec node "$supervisor" "$@"
