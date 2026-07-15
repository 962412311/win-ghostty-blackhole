# 会话交接记录

文档日期：2026-07-15。

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
- Codex 使用逐标签页顶部单格 marker；手动 token/Claude 使用 shader `TOKEN_LEVEL`
  live0/live1 fallback，避免会话未填满窗口或滚动后永久丢失黑洞。
- `bh codex` 已改为逐标签页单 beacon 控制：`500ms` 采样上下文，目标变化时在进程内
  计算阻尼弹簧与短尾矢量混合曲线，默认回弹强度 `0.0`，全程单调、无超调；小跨度
  至少 `1.6` 秒，大跨度约 `6.0` 秒收敛。中途改变目标会继承当时的位置和速度。闭环
  移动先用 `480ms` 淡出，大小/形态完成后再用 `2400ms` 淡入。大小阶段使用 11-bit
  高精度等级，稳态使用兼容旧窗口的 8-bit 等级和 5-bit 移动权重；两种 packet 通过
  magic 和反向校验区分。supervisor 在同步帧提交前写入 marker，并在安全输出块后补写。
  该链路不重载 shader，也不触碰底部输入行。
- 外层启动和标签页内 `prepare-codex` 都写入 `0.02` 可见地板，不会在 supervisor
  启动前被手动 token 的 `TOKEN_LEVEL=-1` 覆盖。
- 手动 `bh token` 和 Claude 保留单例 `level-glider` 兼容链路；独占 lock 和持锁后二次
  PID 检查避免并发 statusLine/hook 创建多个写入者。
- `level-watch` 只读 glider current 状态，并在 owner 变化后退出，不再用 10ms 周期
  回写 JSON；旧 watcher 不会持续影响新的 Codex 会话。
- Codex rollout 解析按文件大小和修改时间缓存，并优先读取实际 rollout；只有读取不到
  有效等级时才查询 SQLite thread 状态。
- `blackhole-live-owner.json` 只约束手动 token/Claude 的共享 runtime shader 写入；
  Codex marker 属于标签页，多个 `bh codex` beacon 可独立运行、互不覆盖。
- Windows Terminal 根配置启用 `experimental.rendering.forceFullRepaint=true`，Codex
  marker 只传递等级和移动权重，shader `Time` 不依赖 marker 变化也能持续推进。
- `demo`、`pomodoro` 等静态模式会交替写入 `blackhole_winterminal_<mode>_live0/1.hlsl`
  并切换 Windows Terminal profile，避免同一路径 shader 编译缓存导致旧效果残留。
- `bh demo` 会运行隐藏 `demo-keepalive`，用近黑色全屏清屏触发整个 viewport 重绘，
  避免终端内容静止时 Windows Terminal 暂停 shader 重绘导致大小看起来不变化。
- Demo 回落阶段只缩小到 `DEMO_LEVEL_FLOOR`，形态参数、路径相位和吸积盘内部动画时间都保持末态。
- 初始黑洞调小，token 中心移动提速为原来的两倍并保持严格闭环；`DRIFT_SPEED`、
  吸积盘内部动画和 demo 时间不变：
  - `TOKEN_AREA_MIN = 0.0030`
  - `TOKEN_LOOP_SEC = 240.0000`
  - `TOKEN_CALM_TURNS = 1.0000`
  - `TOKEN_RUSH_TURNS = 4.0000`
  - `TOKEN_WOBBLE_X_TURNS = 15.0000`
  - `TOKEN_WOBBLE_Y_TURNS = 19.0000`
  - `DEMO_XFADE = 0.7200`
  - `DEMO_LEVEL_FLOOR = 0.0350`
- token 路径在周期首尾的位置和一阶速度均闭合；runtime shader 切换时通过
  `TOKEN_MOTION_TIME_OFFSET` 继承墙钟相位，不会跳回路径起点。
- token 大小、活动范围、路径混合以及形态共用同一个弹簧等级 `g`。形态严格按
  `demoTour(1) -> 2 -> 3 -> 4 -> 5 -> 6 -> 0` 依次贯穿全部 7 个唯一可见预设，每段覆盖
  `temp`、`incl`、`roll`、`inner`、`outer`、`opac`、`dopp`、`beam`、`gain`、`contr`、
  `wind`、`speed`、`expo`、`star` 全部 14 个 `DiskLook` 字段。
- 旧的多格 token packet、底部 marker 和 Codex 重绘脉冲均已移除；Codex 只写一个
  随终端行列动态定位的顶部近黑 marker，且 marker 与 TUI 输出由同一个 supervisor
  串行写入；手动 token/Claude 保留各自兼容链路。
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
node blackhole-windows-terminal/codex-blackhole-supervisor.js --proxy-self-test
bash -n blackhole-windows-terminal/bh
bash -n blackhole-windows-terminal/claude-blackhole-statusline.sh
node blackhole-windows-terminal/verify-blackhole-port.js
```

如果当前目录是 Git 源码工作区，再额外运行 `git diff --check`。

`verify-blackhole-port.js` 的通过输出应包含：

```text
OK: 41 model constants, 8 local tuning constants, 55 formula anchors, 35 host-adaptation anchors, 91 statusline anchors, 11 bh-mode anchors, 9 bh.cmd anchors, 11 supervisor anchors, 1 supervisor-proxy samples, 8 demo-tour presets, 7 token-look knots, 16 Codex-marker codec samples, 1 Codex-marker layout sample, 28 Codex-spring samples, and 5 token-loop samples verified.
```

## 注意事项

- 旧的 `codex-blackhole-launch.sh`、`codex-blackhole-hook.sh`、
  `codex-blackhole-wsl.cmd` 已改成自定位，但主入口仍建议使用 `bh` / `bh.cmd`。
- `ghostty-blackhole-src/` 是上游参考源码，源码树 Git 忽略；复现归档包会包含它，便于离线校验。
- 不要直接手改 Windows Terminal `settings.json` 中的 live shader 路径；运行
  `bh token`、`bh pomodoro` 或 `bh mode` 让脚本维护。
- 番茄钟/时钟模式只承诺视觉周期；Windows Terminal shader 无法原样实现系统时间
  uniform、输入空闲检测、响铃、通知、弹窗或每标签页独立 shader 模式。Codex token
  等级可通过每个标签页自己的顶部 marker 独立传递。
- 视觉效果最终以真实 Windows Terminal 窗口确认。
