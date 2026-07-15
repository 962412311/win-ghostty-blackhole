# 架构说明

本文记录 Windows Terminal 黑洞效果的当前实现。文档日期：2026-07-15。

## 模块

- `blackhole_winterminal.hlsl`：Windows Terminal pixel shader。主体公式移植自
  `ghostty-blackhole-src/blackhole.glsl`。
- `bh-mode.js`：安装 shader 模式、更新 Windows Terminal profile、打开 `wt.exe`
  标签页、安装 Claude Code bridge。
- `blackhole-statusline.js`：上下文比例解析、token 编码、Codex 顶部单格通道、
  Claude/runtime shader 兼容更新和手动 token 过渡。
- `codex-blackhole-supervisor.js`：通过 `script(1)` PTY 运行真实 Codex，串行转发 TUI
  输出和 beacon marker，并维护子进程生命周期。
- `bh.cmd`：Windows `cmd` 入口。
- `bh`：WSL 入口。
- `claude-blackhole-statusline.sh`：Claude Code hook/statusLine 的 bash bridge。
- `verify-blackhole-port.js`：对比 Ghostty 原始 shader 的公式锚点和常量。

## Shader 模式

`SIZE_MODE` 有三种：

- `MODE_DEMO`：独立演示，按时间自动变化。
- `MODE_TOKENS`：由上下文比例驱动。
- `MODE_POMODORO`：番茄钟/时钟模式。

`bh demo`、`bh token`、`bh pomodoro`/`bh clock` 会重写运行时 shader 的
`SIZE_MODE`，并更新 Windows Terminal profile。

`bh demo` 打开的标签页会运行 `blackhole-statusline.js demo-keepalive`。Windows
Terminal 在终端内容完全静止时可能暂停或降低 shader 重绘频率；keepalive 会周期性执行
近黑色全屏清屏，只用于触发整个 viewport 重绘，不参与 token 解码。

`MODE_POMODORO` 的 55/5 周期、增长、收缩和漂移公式保持 Ghostty 原版。Ghostty
使用 `iDate.w` 读取墙钟；Windows Terminal shader 只暴露启用后的 `Time`，所以
`bh pomodoro` 安装 runtime shader 时会把当前本地当天秒数写入
`POMODORO_WALL_OFFSET`，HLSL 用 `POMODORO_WALL_OFFSET + Time * TIME_SCALE`
复刻原版的墙钟进度。Windows Terminal 没有 Ghostty 的 `iTimeCursorChange`
uniform，无法在 shader 内判断终端输入空闲，因此 idle fade 固定为未空闲。测试时可
临时设置 `BLACKHOLE_POMODORO_TIME_SCALE=100` 快速观察一轮变化。

### 番茄钟兼容边界

Windows Terminal 版可依赖的能力：

- 按本地墙钟推进 55/5 周期。
- 使用原版的增长、收缩、尺寸和漂移公式。
- 通过 `BLACKHOLE_POMODORO_TIME_SCALE` 快速验证周期变化。

确认无法在纯 Windows Terminal shader 中原样实现的能力：

- 直接读取真实系统时间；只能由启动脚本写入 `POMODORO_WALL_OFFSET`。
- 直接读取 Ghostty 的 `iTimeCursorChange` 或等价输入空闲时间；idle fade 固定为未空闲。
- 触发系统计时器行为，例如响铃、通知、弹窗或休息提醒。
- 给每个标签页提供完全独立的 shader 模式或编译参数；profile 的
  `experimental.pixelShaderPath` 是全局配置。Codex token 等级可通过每个标签页自己的
  顶部 marker 独立传递，但 demo/token/pomodoro 模式仍共享同一 profile 路径。

## Token 数据通道

Windows Terminal shader 无法直接读取进程内变量，因此项目按调用方保留三层输入：

1. Codex 主通道：beacon 通过 pipe 向 supervisor 发送近黑色颜色和 UV 数据；supervisor
   使用真实 TTY 的 `columns/rows` 在当前标签页顶部安全区生成一个 ANSI marker，使所在
   字符格覆盖 HLSL 的固定采样点 `TOKEN_DATA_UV_TOP`。该通道只占一个顶部字符格，
   不触发 shader 编译。
2. runtime fallback：手动 token/Claude 可写入 `TOKEN_LEVEL` 或
   `TOKEN_LEVEL_FROM/TARGET`，并在 `live0/live1` 之间切换 profile 路径。
3. 兼容色格：手动 token/Claude 可在终端固定位置输出单格近黑色 ANSI 背景色。

HLSL 按上述顺序选择有效输入。Codex marker 不依赖会话内容是否填满窗口，也不会写入
底部 TUI 输入区。supervisor 识别 Codex 的 `CSI ?2026h` / `CSI ?2026l` 同步绘制边界，
在 `CSI ?2026l` 前把 marker 提交进完整帧，并在控制序列完整的输出块后再次恢复；窗口
缩放后按真实 TTY 尺寸重新定位。多格 packet 协议已移除。

### Codex 单进程控制

`bh codex` 不使用 `level-glider`。每个标签页只有一个 `codex-beacon`：

1. 每 `500ms` 读取 Codex 子进程实际打开的 rollout；文件大小和修改时间不变时复用
   解析缓存，rollout 无有效等级时才查询 SQLite thread 状态。
2. 将目标等级量化到 `1/250`；目标不变时不写 shader 或 JSON，只按固定周期刷新同一 marker。
3. 目标变化时，以当前 position 和 velocity 为新起点。默认曲线由 `bounce=0.0` 的解析式
   临界阻尼核心、`timeWarp=5.0` 的时间重映射和 `vectorBlend=0.55` 的短尾矢量轨迹组成；
   大跳变最长约 `6.0s`，小跳变至少 `1.6s`，全程单调、0 回弹、无超调。继承速度可能
   穿越新目标时提高临界频率下限。
4. 目标变化后先用 `480ms` smootherstep 将闭环移动权重降到 0，再执行大小/形态过渡；
   结束后用 `2400ms` 将移动权重升回 1。两类动画不重叠，避免大小结束后快速追赶路径。
5. 过渡与稳态都默认每 `10ms` 生成 marker 数据；大小阶段使用 11-bit 高精度等级，
   普通阶段使用 8-bit 等级和 5-bit 移动权重。supervisor 在同步帧提交前写入 marker，
   并在控制序列完整的输出块后再次恢复。单格采用不推进光标的 `ECH`。
6. Windows Terminal 根配置 `experimental.rendering.forceFullRepaint=true` 持续推进
   shader `Time`；marker 传递等级和移动权重，不承担全屏重绘脉冲。

这条链路避免旧实现的 shader 编译停顿、底部色格与 Codex TUI 输入冲突、高频 runtime
文件写入，以及 beacon 与 TUI 并发写终端造成的滚动丢格和瞬时等级回落。目标在上一段
过渡结束前再次变化时，新过渡从当时的连续值开始。marker 位于当前标签页自己的终端
缓冲区，所以多个 `bh codex` 会话各自运行 beacon，不使用共享
`blackhole-live-owner.json` 互斥。

PTY 代理依赖 WSL 的 util-linux `script` 命令。缺失该命令或显式设置
`CODEX_BLACKHOLE_DISABLE_PTY_PROXY=1` 时会退回旧的直连模式；Codex 仍可运行，但滚动
期间 marker 可能再次被 TUI 覆盖，该模式只用于排障。

### 手动 token 与 Claude

`bh token` 和 Claude 仍走 `publishLevel()` 兼容链路：目标写入
`blackhole-level-target.json`，单例 `level-glider` 启动同一套 shader 过渡，并更新
`blackhole-level-current.json` 和隐藏色格。创建 glider 前先用
`blackhole-level-glider.lock` 做独占抢占，持锁后再次检查现有 PID；父进程随后登记
真实子进程 PID，避免多个 statusLine/hook 同时创建写入者。

`bh token` 标签页运行 `level-watch`，读取当前等级并在本窗口转发隐藏色格，便于从另一个
窗口执行 `level-test`。watcher 不回写 current 文件，并绑定启动时的 token owner；切换
到 Codex、Claude 或其它模式后会自行退出。Claude 的 statusLine/hook 在实际会话窗口中
输出兼容色格。

`demo`、`pomodoro` 等静态模式也会写入 `blackhole_winterminal_<mode>_live0/1.hlsl`
并交替切换 profile 路径，目的不是传递 token，而是强制 Windows Terminal 重新加载
shader，避免同一路径的旧编译缓存继续生效。

由于 Windows Terminal `Blackhole` profile 只有一个全局 shader 路径，手动 token 和
Claude 仍通过 `blackhole-live-owner.json` 限制共享 runtime shader 写入者。Codex beacon
不写 shader，只修改自身标签页的顶部 marker，因此不参与 owner 互斥，也不清理其它
Codex 会话。

## 编码格式

手动 token 和 Claude 的兼容等级范围为 `0.0..1.0`，编码到 `0..250`：

```text
fill = round(level * 250)
hi = fill / 16
lo = fill % 16
chk = hi ^ lo ^ 0x5
RGB = (chk, hi, lo)
```

旧橙色高位签名仍被 shader 兼容；当前 beacon 默认输出近黑色，正常使用时不可见。

Codex 顶部单格同时兼容两种 packet：

- 稳态和移动阶段沿用 8-bit 等级、5-bit 移动权重、原校验位和签名位，确保已运行的
  旧 beacon 在全局 shader 更新后仍可继续显示。
- 大小/形态过渡阶段使用 11-bit 等级、固定 magic、反向校验位和签名位；移动权重固定
  为 0。等级分辨率从 `1/250` 提升到 `1/2047`，减少过渡后段的量化停顿。

HLSL 先验证旧格式，只有旧校验不成立且 magic 匹配时才按高精度格式解码。不要改成
裸模式位，否则正在运行的旧 packet 可能被误判为高精度数据并造成大小闪烁。

## Codex 集成

`bh codex` 流程：

1. 安装 token shader。
2. 打开 Windows Terminal `Blackhole` 标签页。
3. 通过 WSL 启动项目内 `bh __run_codex`；内部 `prepare-codex` 再次确认 runtime
   shader 以 `0.02` 可见地板启动，避免手动 token 的 `-1` 状态覆盖启动画面。
4. `codex-blackhole-supervisor.js` 通过 `script(1)` PTY 启动真实 Codex，把 PTY 进程 PID
   传给 beacon，并串行转发 Codex 输出。
5. beacon 扫描该 Codex 进程树打开的 rollout 文件，再用该 rollout 计算上下文比例。
   如果 `new` 后新会话还没有生成 rollout，则用同 supervisor 的 shell snapshot
   thread-id 识别会话已切换，并临时输出最小等级。
6. beacon 每 `500ms` 采样，并默认每 `10ms` 向 supervisor 发送阻尼弹簧和短尾矢量曲线
   混合后的中间等级；大小阶段使用 11-bit 高精度 packet。supervisor 在 Codex 同步
   绘制帧提交前写入 marker，并在安全输出块后补写。该过程不重载 shader，也不触碰
   底部输入行。

这样新开的同目录 Codex 不会继承旧会话的高上下文比例。
如果在 Codex 内用 `resume` 切到旧 thread，Codex 会打开该 thread 对应 rollout，
beacon 会直接跟随这个实际打开的文件。普通后台 token 更新不会让新窗口误继承其他
活跃会话。
如果 supervisor 已退出，beacon 会自行退出，避免窗口关闭后留下孤儿进程。

## Claude Code 集成

`bh claude` 流程：

1. 安装 token shader。
2. 把 `blackhole-statusline.js`、`claude-blackhole-statusline.cmd`、
   `claude-blackhole-statusline.sh` 复制到 Windows `~/.claude`。
3. 自动合并 Claude Code `statusLine`、`SessionStart`、`SessionEnd` 配置。
4. 打开 Windows Terminal `Blackhole` 标签页并启动 Windows Claude Code。
5. Claude statusLine/hook 通过 bash bridge 调用 Node helper。

默认不显示 Claude 文本状态栏，只输出近黑色兼容色块；真实驱动由 runtime shader
参数完成。
Claude 读取 `context_window`、消息 usage 或 transcript usage。读取 transcript 前会校验
`session_id` 和 transcript 文件名是否一致；如果 `new` 后 Claude 暂时仍传旧 transcript，
会按空新会话输出最小等级，避免继承旧会话大小。

## 本地视觉调优

为适配 Windows Terminal 视觉效果，以下常量允许偏离上游：

- `TOKEN_AREA_MIN = 0.0030`：初始黑洞更小。
- `TOKEN_LOOP_SEC = 240.0000`：token 移动路径每 4 分钟严格闭环，中心位移速度为上一版的 2 倍。
- `TOKEN_CALM_TURNS = 1.0000`：最低等级每周期运行 1 圈。
- `TOKEN_RUSH_TURNS = 4.0000`：最高等级每周期运行 4 圈。
- `TOKEN_WOBBLE_X_TURNS = 15.0000` / `TOKEN_WOBBLE_Y_TURNS = 19.0000`：
  微幅移动与主路径一起在 4 分钟周期首尾闭合。
- `BLACKHOLE_TOKEN_GLIDE_MIN_SEC` / `BLACKHOLE_TOKEN_GLIDE_MAX_SEC` /
  `BLACKHOLE_TOKEN_GLIDE_RATE`：宿主侧过渡时长参数；默认按
  `TOKEN_GLIDE_MIN/MAX/RATE` 的 0.3 秒、1.5 秒、10.0 计算，只服务手动 token/Claude。
- `CODEX_BLACKHOLE_SPRING_BOUNCE/MIN_SEC/MAX_SEC/RATE`：Codex 弹簧基础参数，默认
  `0.0`、`1.6`、`6.0`、`8.0`；retarget 时继承 position 和 velocity。
- `CODEX_BLACKHOLE_SPRING_TIME_WARP/VECTOR_BLEND`：过渡加速感与短尾矢量曲线混合，
  默认 `5.0` / `0.55`；保持单调、无超调。
- `CODEX_BLACKHOLE_MOTION_XFADE_MS`：大小变化前闭环移动淡出时长，默认 `480` 毫秒。
- `CODEX_BLACKHOLE_MOTION_FADE_IN_MS`：大小变化完成后闭环移动恢复时长，默认
  `2400` 毫秒，避免结束后位置快速追赶。
- `DEMO_XFADE = 0.7200`：demo 形态插值宽度扩大到上游 4 倍，使形态转换速度
  降到四分之一。
- `DEMO_LEVEL_FLOOR = 0.0350`：demo 回落时保留最小可见等级，避免 Windows
  Terminal 长时间运行后若停在 reset 低点导致黑洞不可见。

token 的低速和高速路径都由统一相位及整数圈数组成；任意固定等级是两条路径的线性
插值，所以周期起点和终点的位置、一阶速度一致。Windows Terminal 的 `Time` 从每次
shader 启用时重新计时，宿主会把墙钟周期相位写入 `TOKEN_MOTION_TIME_OFFSET`，保证
live0/live1 切换后继续沿原路径运行。`TOKEN_GLIDE_START` 固定为 shader 本地时间 `0`，
不再混用 Windows Terminal 进程启动时间。

token 大小、强度、活动范围和路径混合都使用同一个等级 `g`；`tokenLook(g)` 按上游
`demoTour(1) -> 2 -> 3 -> 4 -> 5 -> 6 -> 0` 贯穿全部 7 个唯一可见形态，每段线性插值
全部 14 个 `DiskLook` 字段，不叠加第二条 easing，因此形态变化与大小严格同步。
240 秒周期只作用于中心 wander/wobble，`DRIFT_SPEED`、demo 相位和吸积盘内部动画时间不变。

Demo 模式不使用这组 token 速度缩放；它保留独立演示节奏，但 HLSL 侧额外让 demo
等级和 wander 在 42 秒边界闭合，避免循环边界突变。Demo 的黑洞形态、路径相位和
吸积盘内部动画时间都绑定到同一个 demo 前进进度，避免形态只按时间变化而与大小脱节；
回落阶段只缩小到 `DEMO_LEVEL_FLOOR`，其余形态保持末次状态，避免回落时快速倒放形态。

`verify-blackhole-port.js` 仍校验主体公式和其他模型常量。
