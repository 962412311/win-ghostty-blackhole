# bh codex token 模式闭环与运行时优化设计

> **历史设计：** 本文记录第一阶段闭环方案。当前实现见
> [全形态联动与慢速弹簧设计](2026-07-15-bh-codex-all-shapes-slow-spring-design.md)；
> 本文中的 `480` 秒周期和 `smootherstep` 过渡参数已经失效。保留正文仅用于追溯，
> 不得作为当前实施依据。

日期：2026-07-10

## 目标

只优先优化 `bh codex`：token 上下文占比固定时，黑洞轨迹在固定周期后回到同一位置，
且首尾速度连续；上下文占比变化时，大小、形态、活动范围和移动状态使用同一平滑等级，
不突变、不重启轨迹。`bh token` 手动测试入口与 Claude 接入保持可用。

## 已确认根因

1. 当前 token 轨迹混合 `lissa(t * TOKEN_CALM)`、`lissa(t * TOKEN_RUSH)` 和另一组
   wobble 频率。它们没有一个适合实际观察的共同短周期，因此不能验证一次可见周期的
   位置和速度闭合。
2. Windows Terminal 官方定义 `Time` 为 shader 启用后的秒数。当前实现却用整个
   `WindowsTerminal.exe` 的启动时间生成 `TOKEN_GLIDE_START`；每次切换 live shader
   后，两套时间基准不一致，既会破坏等级过渡，也会让移动相位回到起点。
3. `codex-beacon` 每次采样都调用 `publishLevel()`。启动竞态会生成多个
   `level-glider`；现场已观察到同一 owner 同时存在 4 个 glider，其中多个进程阻塞在
   WSL/NTFS 路径操作。
4. 每个 glider 以 10ms 周期写终端色块和 JSON 状态；Codex beacon 又重复扫描进程树、
   SQLite 和最多 4MB rollout 尾部，造成不必要的终端争用和磁盘负载。
5. 多格 token packet 代码目前没有生产调用方，却增加了 shader 分支、纹理探测和维护
   成本；方案 A 不再依赖它。
6. 目标变化时切换 live shader 会触发 Windows Terminal 编译停顿，短过渡会在首个可见帧
   前结束，表现为“卡死后突变”；持续写底部色格又会与 Codex TUI 输入区争用。
7. 实际窗口验证表明，OSC 11 虽能修改终端背景色，但 `Background` uniform 和终端纹理
   都不会把该变化作为可靠的动态 shader 输入；写入真实终端单格后等级立即变化。因此
   Codex 必须保留一个真实单格通道，但位置不能在底部输入行。

## Shader 设计

### 严格闭环轨迹

新增 Windows 本地参数：

- `TOKEN_LOOP_SEC = 480.0`：8 分钟主周期。
- `TOKEN_CALM_TURNS = 1.0`：低上下文路径在主周期内重复 1 次。
- `TOKEN_RUSH_TURNS = 4.0`：高上下文路径在主周期内重复 4 次。
- `TOKEN_WOBBLE_X_TURNS = 15.0`、`TOKEN_WOBBLE_Y_TURNS = 19.0`：恢复约为
  原始四分之一速度的微幅移动，并保持整数圈闭合。
- `TOKEN_MOTION_TIME_OFFSET`：shader 安装或重载时写入的墙钟周期偏移。

有效相位按以下关系计算：

```text
phase = 2*pi * fmod(TOKEN_MOTION_TIME_OFFSET + Time, TOKEN_LOOP_SEC)
               / TOKEN_LOOP_SEC
calm  = tokenLoopWander(phase * TOKEN_CALM_TURNS)
rush  = tokenLoopWander(phase * TOKEN_RUSH_TURNS)
wander = lerp(calm, rush, g)
```

`tokenLoopWander()` 只使用整数谐波；wobble 使用固定的 `15/19` 整数圈，不对相位乘以
连续变化的速度。这样在 `phase = 0` 和 `2*pi` 时：

- calm 与 rush 的位置分别相同；
- calm 与 rush 的一阶导数分别相同；
- 两条路径在周期边界具有相同基准位置，因此 `g` 正在平滑变化时也不会产生边界跳变。

### 跨 shader 重载保持相位

`Time` 继续只表示当前 shader 启用后的时间。宿主每次安装或更新 shader 时，将当前墙钟
秒数对 `TOKEN_LOOP_SEC` 取模后写入 `TOKEN_MOTION_TIME_OFFSET`。live0/live1 切换后，
新 shader 从当前墙钟相位继续运动，不再回到轨迹起点。

等级 fallback 的 `TOKEN_GLIDE_START` 改为 shader 本地 `0.0`，使 `smootherstep`
从新 shader 启用时开始。已有 `TOKEN_LEVEL_FROM`、`TOKEN_LEVEL_TARGET` 和
`TOKEN_GLIDE_DURATION` 保留。

### 等级统一驱动

同一个平滑等级 `g` 继续同时驱动：

- 阴影半径和屏幕面积映射；
- `tokenLook(g)` 的温度、倾角、roll 和对比度；
- roam box、边距、活动幅度；
- calm/rush 闭环路径混合。

黑洞物理、测地线积分、引力透镜和吸积盘主体公式不改。

## bh codex 运行时设计

`codex-beacon` 改为单进程控制器，不再通过 `publishLevel()` 为 Codex 启动
`level-glider`：

1. 上下文采样默认每 500ms 执行一次，仍允许通过 `CODEX_BLACKHOLE_INTERVAL_MS` 调整。
2. Windows Terminal 根配置启用 `experimental.rendering.forceFullRepaint=true`，稳态
   `Time` 动画不依赖 marker 内容变化。
3. 目标等级先量化到 shader 实际支持的精度。目标变化时，beacon 在进程内用
   `smootherstep` 计算中间等级，并通过当前标签页顶部安全区的单格近黑 marker 发送。
4. 新目标在旧过渡中途到达时，以旧曲线当时的实际值作为新的 `from`，重新计算
   duration，保证连续。
5. 过渡检查默认 `10ms`，仅在近黑编码值变化或刷新到期时输出；稳态默认每 `50ms`
   重写同一 marker，以抵抗 Codex TUI 覆盖。marker 根据当前 `columns/rows` 动态定位，
   覆盖 HLSL 固定采样点 `TOKEN_DATA_UV_TOP`，不触碰底部输入行。
6. 初始等级保持 `0.02`；Codex PID/rollout 绑定、`resume` 和 `new` 检测保持不变。
   marker 位于各标签页自己的终端缓冲区，因此 Codex beacon 不参与共享 shader owner 互斥。

通用 `level-glider` 继续服务 `bh token` 和 Claude。`ensureLevelGlider()` 先独占创建
`blackhole-level-glider.lock`，持锁后再次检查现有 PID，再 spawn 并登记真实子 PID，
确保同一 base path 和 owner 只有一个 glider。`level-watch` 只读 glider current 状态，
owner 变化后自行退出。

## 采样与 I/O 优化

- PID 已绑定时，先直接从实际打开的 rollout 读取 token 等级；只有 rollout 中没有等级
  时才查询 SQLite。
- rollout 尾部结果按路径、文件大小和修改时间缓存；文件未变化时不重复读取 4MB。
- Codex 目标未变化时不写 `blackhole-level-target.json`、settings 或 live shader；终端侧
  只按默认 `50ms` 周期重写同一个 marker。
- Codex 路径不再持续写 `blackhole-level-current.json`。
- Codex marker 每像素只增加一次固定纹理采样；仅当 marker 和 runtime fallback 都无效时
  才进入手动 token/Claude 的多探针兼容路径。
- 删除没有生产调用方的多格 token packet 编解码、packet beacon 和对应常量；保留单格
  token beacon，供 `bh token`/Claude 兼容路径使用。

## 失败处理

- 找不到活动 rollout 时输出最小等级 `0.02`，不继承其他会话。
- marker 输出失败时保留当前画面，下一过渡帧重试，不清空终端。
- supervisor 退出时 Codex beacon 自行退出，不终止其他会话进程。
- 输出失败不改变 token 状态，也不创建替代 glider。

## 验证与验收

自动验证：

- verifier 检查 480 秒主周期、1/4 整数圈数、墙钟相位偏移和整数谐波公式锚点。
- 对 `g = 0, 0.25, 0.5, 0.75, 1` 数值验证周期首尾位置误差不超过 `1e-6`、
  一阶速度误差不超过 `1e-5`。
- verifier 确认 `codexBeacon()` 不调用 `publishLevel()` 或 `ensureLevelGlider()`。
- verifier 确认 Codex marker 与 `TOKEN_DATA_UV_TOP` 对齐、HLSL 只采样一次、序列只写
  一个动态顶部字符格且不含底部坐标；同时确认 glider 独占 lock、持锁后二次 PID
  检查和 watcher owner 退出约束存在。
- 运行项目规定的 Node/bash 语法检查、公式 verifier 和 `git diff --check`。
- 重新生成并校验 `dist/win-ghostty-blackhole-repro-2026-07-01.*`。

真实 Windows Terminal 验收由用户肉眼确认：

- `bh codex` 首次打开不黑屏、不冻结，Codex TUI 可立即操作。
- 固定上下文下连续移动，无可见周期边界跳回起点。
- 上下文目标变化时大小、形态和活动范围平滑连续。
- `resume`、`new` 后等级正确更新，旧标签页不闪退。
- marker 不可见，窗口填满后仍可输入，缩放及窗口高度超过 2000 像素时等级仍可读取。

## 文档影响

实现完成后同步 `README.md`、`blackhole-windows-terminal/README.md`、
`docs/ARCHITECTURE.md`、`docs/RUNBOOK.md`、`docs/INSTALL_REPRODUCE.md`、
`docs/HANDOFF.md` 和 `AGENTS.md`，删除旧的多 glider、全局 WT 时间基准和非闭环速度说明。
