# 会话交接记录

文档日期：2026-07-01。

## 已完成能力

- 完成 Ghostty 黑洞 shader 到 Windows Terminal HLSL 的移植。
- `bh demo` 可打开动态演示黑洞。
- `bh token` 可手动测试固定上下文等级。
- `bh codex` 可在 Windows Terminal 中启动 WSL Codex，并按上下文比例驱动黑洞。
- `bh claude` 可在 Windows Terminal 中启动 Windows Claude Code，并按上下文比例驱动黑洞。
- Codex 新会话初始等级回到最小比例，不继承旧同目录会话。
- Codex 启动时优先使用 WSL `PATH` 上的 `codex`，保持手动启动时的默认模型和推理强度。
- Claude Code bridge 自动安装到 Windows `~/.claude`，兼容 `/mnt/c/...` 和 `/c/...` bash 环境。
- 去除了可见橙色色块；当前兼容色块为近黑色。
- 通过 shader `TOKEN_LEVEL` live0/live1 fallback 解决内容未填满窗口、滚动 scrollback 后黑洞消失的问题。
- 初始黑洞调小，移动速度调慢：
  - `TOKEN_AREA_MIN = 0.0030`
  - `TOKEN_CALM = 0.0200`
  - `TOKEN_RUSH = 0.5500`
- WSL 和 Windows 入口已改为按脚本所在目录自定位，适合打包迁移。

## 当前主要入口

- Windows：`blackhole-windows-terminal/bh.cmd`
- WSL：`blackhole-windows-terminal/bh`
- 模式安装和 Windows Terminal profile 更新：`blackhole-windows-terminal/bh-mode.js`
- 上下文解析和 beacon：`blackhole-windows-terminal/blackhole-statusline.js`
- Codex supervisor：`blackhole-windows-terminal/codex-blackhole-supervisor.js`
- Claude bridge：`blackhole-windows-terminal/claude-blackhole-statusline.sh`

## 验证基线

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/codex-blackhole-supervisor.js
bash -n blackhole-windows-terminal/bh
bash -n blackhole-windows-terminal/claude-blackhole-statusline.sh
node blackhole-windows-terminal/verify-blackhole-port.js
```

如果当前目录是 Git 源码工作区，再额外运行 `git diff --check`。

`verify-blackhole-port.js` 的通过输出应包含：

```text
OK: 42 model constants, 3 local tuning constants, 43 formula anchors, and 3 host-adaptation anchors verified.
```

## 注意事项

- 旧的 `codex-blackhole-launch.sh`、`codex-blackhole-hook.sh`、
  `codex-blackhole-wsl.cmd` 已改成自定位，但主入口仍建议使用 `bh` / `bh.cmd`。
- `ghostty-blackhole-src/` 是上游参考源码，Git 忽略；复现归档包会包含它，便于离线校验。
- 不要直接手改 Windows Terminal `settings.json` 中的 live shader 路径；运行 `bh token`
  或 `bh mode` 让脚本维护。
- 视觉效果最终以真实 Windows Terminal 窗口确认。
