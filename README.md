# win-ghostty-blackhole

Windows Terminal 黑洞像素着色器项目。核心 shader 基于原仓库
[s0xDk/ghostty-blackhole](https://github.com/s0xDk/ghostty-blackhole)
中的 Ghostty blackhole shader 源码移植；`ghostty-blackhole-src/`
是本地参考检出目录。当前支持：

- `bh demo`：打开独立动态黑洞演示。
- `bh token`：打开手动 token 测试模式。
- `bh pomodoro` 或 `bh clock`：打开按本地墙钟运行的 55/5 番茄钟模式。
- `bh codex` 或 `bh`：在 Blackhole 终端中启动 WSL Codex，并按真实上下文比例驱动黑洞。
- `bh claude`：在 Blackhole 终端中启动 Windows Claude Code，并接入 token/statusLine 模式。

番茄钟/时钟模式在 Windows Terminal 下只负责视觉表现：55/5 周期和黑洞增长/收缩
公式可用，但 Windows Terminal shader 不能读取真实系统时间、不能检测终端输入空闲，
也不能触发响铃、通知或弹窗。

![Blackhole demo](docs/demo.gif)

## 快速使用

新电脑复现安装见 [docs/INSTALL_REPRODUCE.md](docs/INSTALL_REPRODUCE.md)。

已安装后，在 Windows `cmd` 或 WSL 中运行：

```cmd
:: 打开独立动态黑洞演示
bh demo

:: 打开手动 token 测试模式
bh token

:: 打开按本地墙钟运行的 55/5 番茄钟模式
bh pomodoro

:: 启动 WSL Codex，并按真实上下文比例驱动黑洞
bh codex

:: 启动 Windows Claude Code，并接入 token/statusLine 模式
bh claude

:: 查看当前 Blackhole shader 模式
bh mode
```

手动测试黑洞强度：

```cmd
bh token
node blackhole-windows-terminal\blackhole-statusline.js level-test 0.5
```

常用等级：`0.05`、`0.2`、`0.5`、`0.8`、`1.0`。

## 核心目录

- `blackhole-windows-terminal/`：运行核心目录，包含 HLSL shader、`bh`/`bh.cmd`、
  Windows Terminal profile 更新、Codex/Claude beacon 和校验脚本。
- `docs/`：安装复现、架构、运行手册、交接和归档清单。
- `scripts/`：Windows/WSL 安装脚本和复现包打包脚本。
- `ghostty-blackhole-src/`：上游参考源码检出目录，仅用于本地校验，不提交到仓库。

## 调整参数

主要视觉参数在 `blackhole-windows-terminal/blackhole_winterminal.hlsl`：

- `TOKEN_AREA_MIN`：初始/最小显示比例。
- `TOKEN_AREA_MAX`：最大显示比例。
- `TOKEN_EASE`：上下文等级到尺寸的曲线，`1.0` 为线性。
- `TOKEN_LOOP_SEC`：token 移动路径的闭环周期，默认 `240` 秒；中心位移速度为上一版的 2 倍。
- `TOKEN_CALM_TURNS` / `TOKEN_RUSH_TURNS`：低/高上下文等级在一个周期内的整数圈数。
- `TOKEN_WOBBLE_X_TURNS` / `TOKEN_WOBBLE_Y_TURNS`：微幅移动的闭环圈数，默认
  `15` / `19`，与主路径一起在 240 秒周期首尾闭合。
- `DEMO_XFADE`：demo 形态插值宽度，值越大形态转换越慢。
- `DEMO_LEVEL_FLOOR`：demo 循环回落时的最小等级，避免长时间运行后卡在不可见状态。

`bh codex` 由单一 beacon 采样上下文，并在当前标签页顶部安全区写入一个近黑色标记格。
目标变化采用 0 回弹、无超调的阻尼曲线，大跳变最长约 6 秒；尺寸阶段把单格 marker
切换为 11-bit 高精度等级，默认每 `10ms` 更新，后段不会因量化精度下降而卡顿。闭环
移动先用 `480ms` 平滑淡出，大小和形态独占完成过渡后再用 `2400ms` 缓慢恢复，避免
结束时快速追赶路径。supervisor 通过 WSL PTY 在 Codex 同步绘制帧提交前后恢复 marker，
滚动时仍保持当前等级。该过程不重载 shader，也不触碰底部输入行。HLSL 固定采样该
标记，大小、全部形态参数、活动范围和路径混合使用同一连续值；形态按上游
`demoTour(1) -> 2 -> 3 -> 4 -> 5 -> 6 -> 0` 依次平滑贯穿全部 7 个唯一可见预设。

改完后重新运行 `bh demo`、`bh token`、`bh pomodoro`、`bh codex` 或 `bh claude` 让运行时
shader 生效。

## 验证

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/codex-blackhole-supervisor.js
bash -n blackhole-windows-terminal/bh
bash -n blackhole-windows-terminal/claude-blackhole-statusline.sh
node blackhole-windows-terminal/verify-blackhole-port.js
git diff --check
```

`verify-blackhole-port.js` 会对比 Ghostty 原始 shader，确保主体常量和公式锚点保持一致。

## 复现包

仓库会跟踪最新复现归档：

- `dist/win-ghostty-blackhole-repro-2026-07-01.tar.gz`
- `dist/win-ghostty-blackhole-repro-2026-07-01.sha256`

该归档包含上游参考目录 `ghostty-blackhole-src/`，新电脑可直接离线运行严格
shader 校验。重新生成归档：

```bash
bash scripts/package-repro.sh
```

输出位于 `dist/`，归档内容、排除规则和校验方法见
[docs/PACKAGE_MANIFEST.md](docs/PACKAGE_MANIFEST.md)。

## 文档

- [docs/INSTALL_REPRODUCE.md](docs/INSTALL_REPRODUCE.md)：另一台电脑复现安装。
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：架构和数据通道。
- [docs/RUNBOOK.md](docs/RUNBOOK.md)：验证、运维和排障。
- [docs/HANDOFF.md](docs/HANDOFF.md)：阶段交接。
- [blackhole-windows-terminal/README.md](blackhole-windows-terminal/README.md)：运行核心目录说明。
