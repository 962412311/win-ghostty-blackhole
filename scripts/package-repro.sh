#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo="$(cd "$script_dir/.." && pwd -P)"
out_dir="$repo/dist"
name="win-ghostty-blackhole-repro-2026-07-01"

mkdir -p "$out_dir"
tar -C "$repo" \
  --exclude='./.git' \
  --exclude='./ghostty-blackhole-src/.git' \
  --exclude='./dist' \
  --exclude='./blackhole-windows-terminal/__pycache__' \
  --exclude='./blackhole-windows-terminal/blackhole_winterminal*_live[01].hlsl' \
  --exclude='./blackhole-windows-terminal/blackhole-live-level.txt' \
  --exclude='./blackhole-windows-terminal/blackhole-live-owner.json' \
  --exclude='./blackhole-windows-terminal/blackhole-level-target.json' \
  --exclude='./blackhole-windows-terminal/blackhole-level-current.json' \
  --exclude='./blackhole-windows-terminal/blackhole-level-glider.json' \
  --exclude='./blackhole-windows-terminal/blackhole-level-glider.lock' \
  --exclude='./blackhole-windows-terminal/blackhole-level-command.txt' \
  --exclude='*.pyc' \
  -czf "$out_dir/$name.tar.gz" \
  .

(cd "$out_dir" && sha256sum "$name.tar.gz" > "$name.sha256")
echo "$out_dir/$name.tar.gz"
echo "$out_dir/$name.sha256"
