# Windows Terminal Blackhole Shader

Files:
- `blackhole_winterminal.hlsl`: Windows Terminal HLSL shader.
- `blackhole-statusline.js`: shared Claude Code/Codex token data bridge.
- `bh.cmd`: Windows `cmd` entrypoint for mode switching and tool launch.
- `bh`: WSL entrypoint for mode switching and Codex launch.
- `claude-blackhole-statusline.cmd`: Windows Claude Code statusLine wrapper.
- `codex-blackhole-hook.sh`: optional WSL Codex hook wrapper.
- `settings-snippet.jsonc`: Windows Terminal settings fragment.
- `claude-settings-snippet.jsonc`: Claude Code settings fragment.

Recommended setup:
1. Copy `blackhole_winterminal.hlsl` to `C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal.hlsl`.
2. Add one Windows Terminal profile named `Blackhole` with `experimental.pixelShaderPath` pointing at that file.
3. Have that profile start `cmd` and prepend this directory to `PATH`.

Manual entrypoints:
- `bh demo`: install the demo shader and open a new `Blackhole` tab.
- `bh token`: install the Claude/Codex token shader and open a new `Blackhole` tab.
- `bh pomodoro`: install the pomodoro shader and open a new `Blackhole` tab.
- `bh mode`: print the installed shader path and last requested mode.
- `bh` or `bh claude` in Windows `cmd`: install token mode and open a new `Blackhole` tab running native Windows Claude Code.
- `bh` or `bh codex` in WSL: install token mode and open a new `Blackhole` tab running WSL Codex in the current directory.
- `bh codex` in Windows `cmd`: map the current Windows directory through `wslpath`, then open a new `Blackhole` tab running WSL Codex.

Claude Code on native Windows:
- Put `blackhole-statusline.js` and `claude-blackhole-statusline.cmd` in `C:\Users\YOUR_USER\.claude\`.
- Add the `statusLine` block from `claude-settings-snippet.jsonc`.

Codex CLI under WSL:
- The `bh` wrapper starts a small beacon process that periodically paints the encoded token block near the bottom-left of the Windows Terminal surface.

If token mode does not react:
- Set `DEBUG_TOKEN_SAMPLE_POINT = 1` in the shader and check that the magenta marker covers the first colored block.
- Then set `DEBUG_TOKEN_SAMPLE_POINT = 0`.
