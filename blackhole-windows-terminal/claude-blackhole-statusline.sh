#!/usr/bin/env bash

input="$(cat)"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P 2>/dev/null || dirname -- "$0")"

helper=""
for candidate in "$script_dir/blackhole-statusline.js" \
  "$HOME/.claude/blackhole-statusline.js"; do
  if [ -f "$candidate" ]; then
    helper="$candidate"
    break
  fi
done

if [ -z "$helper" ]; then
  exit 0
fi

if command -v node >/dev/null 2>&1; then
  printf '%s' "$input" | node "$helper" claude-statusline
  exit 0
fi

if command -v node.exe >/dev/null 2>&1; then
  helper_win="$helper"
  case "$helper_win" in
    /mnt/[a-zA-Z]/*)
      drive="${helper_win#/mnt/}"
      drive="${drive%%/*}"
      rest="${helper_win#/mnt/$drive/}"
      helper_win="$(printf '%s' "$drive" | tr '[:lower:]' '[:upper:]'):/$rest"
      ;;
    /[a-zA-Z]/*)
      drive="${helper_win#/}"
      drive="${drive%%/*}"
      rest="${helper_win#/$drive/}"
      helper_win="$(printf '%s' "$drive" | tr '[:lower:]' '[:upper:]'):/$rest"
      ;;
  esac
  printf '%s' "$input" | node.exe "$helper_win" claude-statusline
fi

exit 0
