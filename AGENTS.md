# 项目 Agent 交接说明

本项目是 Ghostty 黑洞 shader 的 Windows Terminal 移植与工具化封装。后续 Agent
接手时优先阅读：

- [README.md](README.md)：项目入口和常用命令。
- [docs/INSTALL_REPRODUCE.md](docs/INSTALL_REPRODUCE.md)：另一台电脑的复现安装步骤。
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：运行机制、数据通道和设计取舍。
- [docs/RUNBOOK.md](docs/RUNBOOK.md)：验证命令、排障和环境变量。
- [docs/HANDOFF.md](docs/HANDOFF.md)：阶段完成项和遗留状态。

## 维护边界

- 黑洞主体算法和公式以 `ghostty-blackhole-src/blackhole.glsl` 为参考源。
- `blackhole-windows-terminal/verify-blackhole-port.js` 必须持续校验上游公式锚点。
- `ghostty-blackhole-src/` 不提交到 Git；从 GitHub clone 后如需严格校验，先运行
  `git clone https://github.com/s0xDk/ghostty-blackhole.git ghostty-blackhole-src`。
- `dist/win-ghostty-blackhole-repro-2026-07-01.*` 是发布给新电脑复现的归档包；
  影响安装、脚本、shader 或文档时，重新运行 `bash scripts/package-repro.sh` 并提交新包。
- `blackhole-live-owner.json` 用于限制共享 runtime shader 写入者；不要移除手动 token
  和 Claude 的 owner 检查。`bh codex` 只写本标签页顶部安全区的单格 marker，不参与
  该全局互斥。
- `bh codex` 的目标等级由每个会话自己的单个 `codex-beacon` 在进程内维护；目标变化时
  使用 `bounce=0.0`、最短 1.6 秒、最长 6 秒、距离倍率 8.0 的解析式临界阻尼核心，
  默认再应用 `timeWarp=5.0` 和 `vectorBlend=0.55` 的短尾矢量混合。过渡必须 0 回弹、
  无超调，并在 retarget 时继承 position 和 velocity；继承速度可能穿越目标时必须提高
  临界频率下限。新目标即使恰好等于当前位置，只要 velocity 尚未归零，也必须执行最短
  过渡。大小过渡与 240 秒闭环移动必须互斥：先用默认 480ms smootherstep 将移动权重
  降到 0，再执行大小/形态过渡，结束后用 2400ms smootherstep 恢复移动。过渡与稳态都
  默认每 `10ms` 生成单格近黑 marker 数据。普通包保留 8-bit 等级、5-bit 移动权重和
  原校验位；大小阶段使用反校验加固定 magic 的 11-bit 高精度等级包。不得改回与旧 beacon
  校验位冲突的裸模式位，也不得删除新旧包兼容验证。
  beacon 不得绕过 supervisor 直接写 `/dev/tty`。supervisor 必须通过 `script(1)` PTY
  串行转发 Codex 输出，在 `CSI ?2026l` 前把 marker 提交进同步帧，并在控制序列完整的
  输出块后用不推进光标的 `ECH` 再次恢复，避免滚动期间 marker 长时间缺失。
  HLSL 只采样 `TOKEN_DATA_UV_TOP` 一次。Codex 路径不得重载 shader、触碰底部输入行或
  启动 `level-glider`。
- `blackhole-level-target.json`、`blackhole-level-current.json` 和
  `blackhole-level-glider.json` 只用于手动 `bh token` 和 Claude 的兼容过渡链路。
  `level-glider` 必须先通过 `blackhole-level-glider.lock` 原子抢占，再登记真实子进程
  PID，避免并发 statusLine/hook 创建多个写入者。
- 手动 token/Claude beacon 只保留单格近黑色编码；`bh codex` 也只允许写一个按当前
  `columns/rows` 动态定位的顶部 marker。不要恢复底部 marker、多格 packet 协议、
  OSC 11 背景实验或持续改写整片终端内容。Codex marker 的终端行列必须由 supervisor
  的真实 TTY 动态计算，不能使用已变为 pipe 的 beacon stdout 尺寸。
- `bh codex` 依赖 Windows Terminal 根配置
  `experimental.rendering.forceFullRepaint=true` 推进 `Time` 动画；`bh-mode.js` 必须维护该值。
- `demo`、`pomodoro` 等静态模式通过 `blackhole_winterminal_<mode>_live0/1.hlsl`
  交替切换 Windows Terminal profile 路径，避免同一路径 shader 编译缓存残留。
- `bh demo` 依赖 `blackhole-statusline.js demo-keepalive` 触发 Windows Terminal 重绘；
  不要把 demo tab 改回完全静止的空命令行，否则 shader `Time` 可能停住。
- `bh token` 依赖 `blackhole-statusline.js level-watch` 在测试窗口内转发
  `blackhole-level-current.json` 的中间等级；watcher 只读该文件，并在 owner 变化后退出，
  不得自行回写 current 状态。不要把 token 测试窗口改回完全空命令行，否则外部
  `level-test` 只能通过 runtime shader 生效，无法验证隐藏色格兼容通道。
- Windows Terminal 的 shader `Time` 从 shader 启用/加载时从零开始。token 路径相位
  必须通过 `TOKEN_MOTION_TIME_OFFSET` 恢复，过渡起点固定使用 shader 本地时间 `0`；
  不要再使用 Windows Terminal 进程启动时间。
- token 移动路径使用 `TOKEN_LOOP_SEC`、整数 `TOKEN_CALM_TURNS`/
  `TOKEN_RUSH_TURNS` 和 `TOKEN_WOBBLE_X/Y_TURNS` 构造；修改路径时必须继续校验周期
  首尾的位置和一阶速度闭合。当前 `TOKEN_LOOP_SEC=240`，只加速中心位移，不得联动
  `DRIFT_SPEED` 或 demo 时间。
- token 大小、形态、活动范围和路径混合必须共用同一个 `g`。`tokenLook(g)` 固定按
  上游 `demoTour(1) -> 2 -> 3 -> 4 -> 5 -> 6 -> 0` 线性贯穿全部 7 个唯一可见形态，
  每段都插值全部 14 个字段；不要恢复只改少数字段、只在两个端点间插值或按时间切换
  token 形态的实现。
- Demo 回落阶段只缩小尺寸，形态参数、路径相位和吸积盘内部动画时间都保持末态；
  `DEMO_LEVEL_FLOOR` 用于避免长时间运行后停在不可见低点。修改 demo 时间/形态映射时
  必须同步 verifier 锚点。
- Windows 本地视觉调优只允许集中在 `TOKEN_AREA_MIN`、`TOKEN_LOOP_SEC`、
  `TOKEN_CALM_TURNS`、`TOKEN_RUSH_TURNS`、`TOKEN_WOBBLE_X_TURNS`、
  `TOKEN_WOBBLE_Y_TURNS`、`DEMO_XFADE`、`DEMO_LEVEL_FLOOR` 等明确列入 verifier
  的 local tuning 常量中。
- `MODE_POMODORO` 在 Windows Terminal 中用 `POMODORO_WALL_OFFSET` 补偿缺失的
  `iDate.w`；Windows Terminal 没有 Ghostty 的 `iTimeCursorChange`，空闲检测固定为未空闲。
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
