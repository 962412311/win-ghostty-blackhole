# 会话交接记录

文档日期：2026-07-02。

## 已完成能力

- 完成 Ghostty 黑洞 shader 到 Windows Terminal HLSL 的移植。
- `bh demo` 可打开动态演示黑洞。
- `bh token` 可手动测试固定上下文等级。
- `bh pomodoro` / `bh clock` 可打开按本地墙钟运行的 55/5 番茄钟模式；Windows
  Terminal 侧没有 Ghostty 的 cursor idle uniform，因此不做终端空闲淡出。
- `bh codex` 可在 Windows Terminal 中启动 WSL Codex，并按上下文比例驱动黑洞。
- `bh claude` 可在 Windows Terminal 中启动 Windows Claude Code，并按上下文比例驱动黑洞。
- Codex 新会话初始等级回到最小比例，不继承旧同目录会话。
- Codex 通过 `resume` 切换旧会话后，会按该 Codex 进程实际打开的 rollout 继续驱动黑洞。
- Codex 通过 `new` 切到空会话后，即使旧 rollout 句柄还未关闭，也会根据 shell snapshot 回到最小比例。
- Codex 启动时优先使用 WSL `PATH` 上的 `codex`，保持手动启动时的默认模型和推理强度。
- Claude Code bridge 自动安装到 Windows `~/.claude`，兼容 `/mnt/c/...` 和 `/c/...` bash 环境。
- Claude Code 会校验 `session_id` 和 transcript 文件名，`new` 后不会继承旧 transcript 的大小。
- 去除了可见橙色色块；当前兼容色块为近黑色。
- 通过 shader `TOKEN_LEVEL` live0/live1 fallback 解决内容未填满窗口、滚动 scrollback 后黑洞消失的问题。
- 通过 `blackhole-live-owner.json` 和旧 Codex beacon 清理，避免多个上下文写入者
  抢同一个 runtime shader 导致黑洞反复变大变小。
- `demo`、`pomodoro` 等静态模式会交替写入 `blackhole_winterminal_<mode>_live0/1.hlsl`
  并切换 Windows Terminal profile，避免同一路径 shader 编译缓存导致旧效果残留。
- Demo 回落阶段只缩小尺寸，形态参数、路径相位和吸积盘内部动画时间都保持末态。
- 初始黑洞调小，移动速度调慢：
  - `TOKEN_AREA_MIN = 0.0030`
  - `TOKEN_CALM = 0.0050`
  - `TOKEN_RUSH = 0.1375`
- WSL 和 Windows 入口已改为按脚本所在目录自定位，适合打包迁移。
- 最新复现归档跟踪在 `dist/win-ghostty-blackhole-repro-2026-07-01.*`，包含
  `ghostty-blackhole-src/`，可在新电脑离线运行严格 shader 校验。

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
OK: 42 model constants, 3 local tuning constants, 55 formula anchors, and 13 host-adaptation anchors verified.
```

## 注意事项

- 旧的 `codex-blackhole-launch.sh`、`codex-blackhole-hook.sh`、
  `codex-blackhole-wsl.cmd` 已改成自定位，但主入口仍建议使用 `bh` / `bh.cmd`。
- `ghostty-blackhole-src/` 是上游参考源码，源码树 Git 忽略；复现归档包会包含它，便于离线校验。
- 不要直接手改 Windows Terminal `settings.json` 中的 live shader 路径；运行
  `bh token`、`bh pomodoro` 或 `bh mode` 让脚本维护。
- 番茄钟/时钟模式只承诺视觉周期；Windows Terminal shader 无法原样实现系统时间
  uniform、输入空闲检测、响铃、通知、弹窗或每标签页独立 shader 参数。
- 视觉效果最终以真实 Windows Terminal 窗口确认。
