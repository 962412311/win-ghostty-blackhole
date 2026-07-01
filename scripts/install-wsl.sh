#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo="$(cd "$script_dir/.." && pwd -P)"
tool_dir="$repo/blackhole-windows-terminal"
bin_dir="$HOME/.local/bin"

if ! command -v node >/dev/null 2>&1; then
  echo "node not found in WSL PATH" >&2
  exit 127
fi

mkdir -p "$bin_dir"
chmod +x "$tool_dir/bh" "$tool_dir/claude-blackhole-statusline.sh" \
  "$tool_dir/codex-blackhole-launch.sh" "$tool_dir/codex-blackhole-hook.sh"
ln -sf "$tool_dir/bh" "$bin_dir/bh"

node "$tool_dir/bh-mode.js" token >/dev/null

echo "Installed WSL bh shim: $bin_dir/bh"
echo "If bh is not found, add this to your shell profile:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""

