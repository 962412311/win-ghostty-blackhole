# 项目 Agent 交接说明

本项目是 Ghostty 黑洞 shader 的 Windows Terminal 移植与工具化封装。后续 Agent
接手时优先阅读：

- [README.md](README.md)：项目入口和常用命令。
- [docs/INSTALL_REPRODUCE.md](docs/INSTALL_REPRODUCE.md)：另一台电脑的复现安装步骤。
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：运行机制、数据通道和设计取舍。
- [docs/RUNBOOK.md](docs/RUNBOOK.md)：验证命令、排障和环境变量。
- [docs/HANDOFF.md](docs/HANDOFF.md)：2026-07-01 会话完成项和遗留状态。

## 维护边界

- 黑洞主体算法和公式以 `ghostty-blackhole-src/blackhole.glsl` 为参考源。
- `blackhole-windows-terminal/verify-blackhole-port.js` 必须持续校验上游公式锚点。
- Windows 本地视觉调优只允许集中在 `TOKEN_AREA_MIN`、`TOKEN_CALM`、`TOKEN_RUSH`
  等明确列入 verifier 的 local tuning 常量中。
- Windows Terminal 真实视觉验证以用户肉眼确认为准；不要默认依赖截图自动判断。
- 所有面向用户的文档保持中文。

## 常用验证

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/codex-blackhole-supervisor.js
bash -n blackhole-windows-terminal/bh
bash -n blackhole-windows-terminal/claude-blackhole-statusline.sh
node blackhole-windows-terminal/verify-blackhole-port.js
```

如果当前目录是 Git 源码工作区，再额外运行 `git diff --check`。
