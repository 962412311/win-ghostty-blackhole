# 运维与排障手册

文档日期：2026-07-01。

## 基础健康检查

归档包环境：

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/codex-blackhole-supervisor.js
bash -n blackhole-windows-terminal/bh
bash -n blackhole-windows-terminal/claude-blackhole-statusline.sh
node blackhole-windows-terminal/verify-blackhole-port.js
```

Git 源码工作区额外检查：

```bash
git diff --check
```

Windows 侧检查：

```cmd
where node
node --version
where claude
blackhole-windows-terminal\bh.cmd __run_claude --version
```

WSL 侧检查：

```bash
command -v node
node --version
command -v codex
command -v sqlite3
```

## Windows Terminal profile 检查

`Blackhole` profile 必须存在，并含有：

```jsonc
"experimental.pixelShaderPath": "C:\\Users\\YOUR_USER\\terminal-shaders\\blackhole_winterminal.hlsl"
```

运行时可能会自动切换到：

```text
blackhole_winterminal_live0.hlsl
blackhole_winterminal_live1.hlsl
```

这是正常行为，用于刷新 `TOKEN_LEVEL`。

## 常见问题

### `bh` 找不到命令

Windows：

- 运行 `scripts\install-windows.cmd`。
- 确认 `%USERPROFILE%\bin` 已加入 PATH。
- 重新打开 Windows Terminal。

WSL：

- 运行 `bash scripts/install-wsl.sh`。
- 确认 `~/.local/bin` 已加入 PATH。

### `bh demo` 没有黑洞

- 确认 Windows Terminal profile 名称是 `Blackhole`，或设置 `BLACKHOLE_WT_PROFILE`。
- 运行 `bh mode`，确认输出路径是 Windows 侧 `terminal-shaders`。
- 重新打开一个 `Blackhole` 标签页。

### `bh codex` 模型和手动 Codex 不一致

`codex-blackhole-supervisor.js` 会优先使用 WSL `PATH` 上的 `codex`。如果仍不一致：

```bash
command -v codex
CODEX_BLACKHOLE_CODEX_BIN=/path/to/codex bh codex
```

### Claude Code hook 报 `/mnt/c/... No such file`

- 重新运行 `bh claude`，它会重装 bridge。
- 如果 Windows 用户名无法自动识别，设置 `BLACKHOLE_WINDOWS_USER`。
- 确认 `C:\Users\YOUR_USER\.claude\claude-blackhole-statusline.sh` 存在。

### Claude 只显示色块或文本状态栏

- 默认状态栏只输出近黑色兼容色块，不应该显示 `[..........]` 文本。
- 如果看到文本，检查是否设置了 `CLAUDE_BLACKHOLE_SHOW_STATUSLINE=1`。
- 重新运行 `bh claude` 以刷新 helper。

### 滚动会话后黑洞消失

当前版本通过 `TOKEN_LEVEL` fallback 解决该问题。若仍消失：

```bash
node blackhole-windows-terminal/blackhole-statusline.js level-test 0.5
```

然后检查 Windows Terminal profile 是否切到 `blackhole_winterminal_live0/1.hlsl`。

### 初始大小或移动速度不合适

调整 `blackhole-windows-terminal/blackhole_winterminal.hlsl`：

- `TOKEN_AREA_MIN`：初始大小。
- `TOKEN_CALM`：低上下文移动速度。
- `TOKEN_RUSH`：高上下文移动速度。

改完运行：

```bash
node blackhole-windows-terminal/verify-blackhole-port.js
bh token
node blackhole-windows-terminal/blackhole-statusline.js level-test 0.2
```

## 清理运行时文件

可删除以下运行时生成物，之后重新运行 `bh token`、`bh codex` 或 `bh claude` 会再生成：

```text
C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal_live0.hlsl
C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal_live1.hlsl
C:\Users\YOUR_USER\terminal-shaders\blackhole-live-level.txt
```
