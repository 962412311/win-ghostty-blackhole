# Windows Terminal 黑洞效果

这是 Ghostty 黑洞 shader 的 Windows Terminal HLSL 移植版本，包含演示模式、
token 驱动模式，以及面向 WSL Codex 和 Windows Claude Code 的启动脚本。

## 文件说明

- `blackhole_winterminal.hlsl`：Windows Terminal 像素着色器。
- `bh-mode.js`：安装 shader 模式，并打开 Windows Terminal 标签页。
- `bh.cmd`：Windows `cmd` 入口。
- `bh`：WSL 入口。
- `blackhole-statusline.js`：Codex/Claude Code 上下文 beacon 和 token 编码器。
- `codex-blackhole-supervisor.js`：通过 `script(1)` PTY 运行真实 Codex，并把 TUI 输出与
  beacon marker 串行写入终端。
- `verify-blackhole-port.js`：对比 `ghostty-blackhole-src/blackhole.glsl`，
  校验 shader 常量和公式锚点。
- `settings-snippet.jsonc`：Windows Terminal 配置片段。
- `claude-settings-snippet.jsonc`：Claude Code statusLine/hooks 配置示例。

## 支持的命令

Windows `cmd`：

```cmd
bh demo
bh token
bh pomodoro
bh clock
bh
bh codex
bh claude
bh mode
```

WSL：

```bash
bh demo
bh token
bh pomodoro
bh clock
bh codex
bh claude
bh mode
```

命令含义：

- `bh demo`：安装 demo shader，并打开带隐藏 keepalive 的 `Blackhole demo` 标签页。
- `bh token`：安装 token shader，并打开 `Blackhole token` 标签页。
- `bh pomodoro` / `bh clock`：安装 pomodoro shader，并打开 `Blackhole pomodoro`
  标签页。
- `bh` / `bh codex`：安装 token shader，并在 `Blackhole` 标签页中启动
  WSL Codex。
- `bh claude`：安装 token shader，安装 Claude Code bridge，并在 `Blackhole`
  标签页中启动 Windows Claude Code。
- `bh mode`：输出请求模式、实际安装的 shader 模式和运行时 shader 路径。

`bh codex` 启动真实 Codex 时会优先使用 WSL `PATH` 上的 `codex` 命令，因此会
继承你手动运行 `codex` 时的默认模型、推理强度和 wrapper 行为。需要强制指定
其他 Codex 可执行文件时，可以设置 `CODEX_BLACKHOLE_CODEX_BIN`。

`bh claude` 会把 `blackhole-statusline.js`、`claude-blackhole-statusline.cmd`
和 `claude-blackhole-statusline.sh` 复制到 `C:\Users\YOUR_USER\.claude`，
并自动合并 Claude Code 的 `statusLine`、`SessionStart`、`SessionEnd` 配置。
settings 中的命令会先尝试 `/mnt/c/.../claude-blackhole-statusline.sh`，再尝试
`/c/.../claude-blackhole-statusline.sh`，兼容 WSL bash 和 Windows Git/MSYS bash。
helper 借鉴原始 Ghostty 仓库的接入方式：默认不显示调试文本，目标等级通过单例
glider 写入 runtime shader 过渡参数，近黑色状态栏色块保留为兼容和重绘通道。

`bh pomodoro` 是按本地墙钟运行的 55/5 番茄钟模式；`bh clock` 是同一模式的别名。
Windows Terminal 没有 Ghostty 的 cursor idle uniform，因此该模式不做终端空闲淡出。
需要快速验证时可临时运行 `BLACKHOLE_POMODORO_TIME_SCALE=100 bh pomodoro`。

`bh demo` 会在 demo 标签页中运行 `demo-keepalive`，周期性执行近黑色全屏清屏以触发
Windows Terminal 整个 viewport 重绘。这样 demo 的 `Time` 动画不会因为终端内容静止而停住。
默认间隔为 `250ms`，可用 `BLACKHOLE_DEMO_KEEPALIVE_MS` 调整。

## Windows Terminal 配置

需要一个名为 `Blackhole` 的 Windows Terminal profile：

- profile 名称：`Blackhole`
- pixel shader 路径：
  `C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal.hlsl`
- shell：`cmd.exe`
- `blackhole-windows-terminal` 目录需要加入 `PATH`，确保 `bh` 能被找到。
- settings 根节点：`"experimental.rendering.forceFullRepaint": true`。

`bh-mode.js` 会把运行时 shader 写入上述路径，并在需要时更新 `Blackhole`
profile 的 `experimental.pixelShaderPath`。`demo`、`pomodoro` 这类静态模式会交替写入
`blackhole_winterminal_<mode>_live0/1.hlsl`，用于强制 Windows Terminal 重新加载
shader，避免继续使用旧编译缓存。

## Token 数据通道

Windows Terminal shader 不能直接读取进程内变量。`bh codex` 使用逐标签页顶部单格
通道：单个 `codex-beacon` 每 `500ms` 读取当前 Codex 进程实际打开的 rollout，目标变化时
在进程内计算 0 回弹、无超调的解析阻尼与短尾矢量混合曲线；大跳变最长约 `6.0s`，
小跳变至少 `1.6s`，retarget 继承 position 和 velocity。普通 marker 保留 8-bit 等级、
5-bit 移动权重和旧协议校验；大小阶段使用反校验加固定 magic 的 11-bit 高精度等级包，
因此旧 beacon 与新 HLSL 可以并存。单格 RGB 各通道不超过 `31`，仍保持近黑。
beacon 把颜色和 UV 数据发送给 supervisor；supervisor 根据真实
TTY 的 `columns/rows` 把一个标记格定位到 HLSL 固定采样点 `TOKEN_DATA_UV_TOP`，窗口
缩放或高度超过 2000 像素时也会重新对齐。

闭环移动先用默认 `480ms` smootherstep 淡出，权重归零后才执行大小/形态过渡；结束后
再用 `2400ms` 淡入移动。过渡与稳态都默认每 `10ms` 生成标记数据。supervisor 识别
Codex 的同步绘制边界，在 `CSI ?2026l` 前把 marker 提交进完整帧，并在控制序列完整的
输出块后使用不推进光标的 `ECH` 再次恢复。
该格位于顶部安全区，不触碰底部输入行，不重载 shader，也不启动 `level-glider`。
`experimental.rendering.forceFullRepaint=true` 保证稳态下 shader `Time` 动画继续推进。

runtime shader 中的 `TOKEN_LEVEL` / `TOKEN_LEVEL_FROM/TARGET` 和旧单格近黑色 ANSI
探针继续服务手动 token/Claude 兼容链路。HLSL 的优先级为 Codex 顶部 marker、runtime
fallback、旧兼容探针；Codex 滚动期间由 supervisor 在同步帧提交前写入 marker，并在
控制安全的输出块后补写。

PTY 代理依赖 WSL util-linux 的 `script` 命令。`command -v script` 应返回可执行路径；
缺失时会退回直连 Codex，基本功能可用，但滚动保持不再保证。

手动 `bh token` 和 Claude 仍使用兼容链路：`publishLevel()` 写入
`blackhole-level-target.json`，单例 `level-glider` 通过独占 lock 启动同一套 shader 过渡，
并更新 `blackhole-level-current.json` 和隐藏色块。`bh token` 标签页中的 `level-watch`
只读取中间等级；owner 变化后自动退出，不会持续回写旧状态。

每个 `bh codex` 窗口都会给 beacon 传入真实 Codex 子进程 PID。beacon 扫描该进程树
实际打开的 rollout 文件，并按这个文件计算上下文比例；启动初期还没有活动 rollout 时
输出最小等级。这样新开的同目录 Codex 窗口不会继承未触碰旧会话的高上下文比例，同时
`resume` 切换到旧会话后能立即跟随该会话上下文比例。`new` 切到空会话且新 rollout
尚未生成时，beacon 会通过 shell snapshot 的 thread-id 识别切换并回到最小等级。
marker 写入当前标签页自己的终端缓冲区，因此多个 `bh codex` 窗口各自运行一个 beacon，
不使用共享 shader owner 互斥，也不会互相覆盖上下文等级。

Claude Code 走同一个隐藏 beacon 协议。`statusLine` 根据 Claude 提供的
`context_window`、消息 usage 或 transcript 计算上下文占用；`SessionStart`
写入默认最小等级 `0.02`，`SessionEnd` 清除采样位置，让黑洞隐藏。
读取 transcript 前会校验 `session_id` 和 transcript 文件名是否一致；`new` 后如果
Claude 暂时还传旧 transcript，会按空会话输出最小等级。

## 大小映射调试

默认映射保持线性：Codex 上下文等级 `0.0..1.0` 会按同样的比例驱动
shader 中的黑洞尺寸。新窗口没有上下文记录时使用 `0.02` 的可见地板。

自动 `bh codex` 的起始地板由 `CODEX_BLACKHOLE_MIN_LEVEL` 控制，默认是 `0.02`：

```bash
CODEX_BLACKHOLE_MIN_LEVEL=0.03 bh codex
```

Windows `cmd` 中可以先设置环境变量再启动：

```cmd
set CODEX_BLACKHOLE_MIN_LEVEL=0.03
bh codex
```

Windows 启动器会通过 `WSLENV` 把这个变量传给 WSL 内的 beacon。Codex 上下文采样、
过渡帧和稳态 marker 刷新可分别用 `CODEX_BLACKHOLE_INTERVAL_MS`、
`CODEX_BLACKHOLE_REDRAW_MS`、`CODEX_BLACKHOLE_MARKER_MS` 调整，默认值为
`500`、`10`、`10` 毫秒。移动淡出时长由 `CODEX_BLACKHOLE_MOTION_XFADE_MS` 控制，
默认 `480` 毫秒；大小结束后的移动恢复由 `CODEX_BLACKHOLE_MOTION_FADE_IN_MS` 控制，
默认 `2400` 毫秒。过渡曲线可用
`CODEX_BLACKHOLE_SPRING_BOUNCE`、
`CODEX_BLACKHOLE_SPRING_MIN_SEC`、`CODEX_BLACKHOLE_SPRING_MAX_SEC`、
`CODEX_BLACKHOLE_SPRING_RATE`、`CODEX_BLACKHOLE_SPRING_TIME_WARP`、
`CODEX_BLACKHOLE_SPRING_VECTOR_BLEND` 调整，默认 `0.0`、`1.6`、`6.0`、`8.0`、
`5.0`、`0.55`。
`CODEX_BLACKHOLE_DISABLE_PTY_PROXY=1` 可临时禁用 PTY 代理，仅用于排障。

这个值只影响自动 Codex beacon；手动视觉测试仍然以 `level-test` 参数为准。

shader 自身的尺寸常量在 `blackhole_winterminal.hlsl`：

- `TOKEN_AREA_MIN`：最小显示比例；本地默认 `0.0030`，比上游更小。
- `TOKEN_AREA_MAX`：最大显示比例。
- `TOKEN_EASE`：等级到尺寸的曲线；`1.0` 是线性。
- `TOKEN_LOOP_SEC`：完整闭环周期；本地默认 `240` 秒，中心位移速度为上一版的 2 倍。
- `TOKEN_CALM_TURNS`：最低等级每周期圈数；本地默认 `1`。
- `TOKEN_RUSH_TURNS`：最高等级每周期圈数；本地默认 `4`。
- `TOKEN_WOBBLE_X_TURNS` / `TOKEN_WOBBLE_Y_TURNS`：微幅移动闭环圈数；本地默认
  `15` / `19`，与主路径一起在 240 秒边界闭合。
- `BLACKHOLE_TOKEN_GLIDE_MIN_SEC`、`BLACKHOLE_TOKEN_GLIDE_MAX_SEC`、
  `BLACKHOLE_TOKEN_GLIDE_RATE`：token 等级过渡时长参数，默认 `0.3`、`1.5`、`10.0`；
  只服务手动 token/Claude glider，不控制 `bh codex` 弹簧。
- `DEMO_XFADE`：demo 形态插值宽度；本地默认 `0.7200`，比上游 `0.1800`
  慢 4 倍。
- `DEMO_LEVEL_FLOOR`：demo 回落时的最小等级；本地默认 `0.0350`，避免长时间
  运行后停在不可见状态。

改 HLSL 后需要重新运行 `bh demo`、`bh token`、`bh codex` 或 `bh claude` 让运行时 shader
生效。`verify-blackhole-port.js` 仍严格校验原版公式和主体常量，但允许
`TOKEN_AREA_MIN`、`TOKEN_LOOP_SEC`、`TOKEN_CALM_TURNS`、`TOKEN_RUSH_TURNS`、
`TOKEN_WOBBLE_X_TURNS`、`TOKEN_WOBBLE_Y_TURNS`、`DEMO_XFADE`、`DEMO_LEVEL_FLOOR`
作为 Windows 本地视觉调优常量偏离上游。

token 位移以 `TOKEN_LOOP_SEC` 为统一相位，低/高等级路径都使用整数圈数，任意固定
等级都是两条闭合路径的插值，因此周期首尾的位置和一阶速度一致。runtime shader
重载时会写入 `TOKEN_MOTION_TIME_OFFSET` 恢复墙钟相位，不会跳回路径起点。
微幅移动独立使用整数 `15/19` 圈，中心 wander 与 wobble 相比上一版整体提速 2 倍；
`DRIFT_SPEED` 和 demo 时间不变，因此吸积盘内部动画速度不变。

token 模式只使用一个可见等级 `g`。阴影大小、强度、活动范围、路径混合和
`tokenLook(g)` 都读取该值；`tokenLook` 按上游 `demoTour(1) -> 2 -> 3 -> 4 -> 5 -> 6 -> 0`
依次贯穿全部 7 个唯一可见预设，每段都线性插值全部 14 个 `DiskLook` 字段，不再叠加
第二条 easing 或按时间切换形态。

手动 token/Claude 兼容色格使用近黑色编码：

```text
R = 校验位
G = 高 4 位
B = 低 4 位
校验位 = G ^ B ^ 0x5
```

shader 仍兼容旧的橙色协议；Codex 顶部 marker 和手动 token/Claude beacon 默认都写
近黑色，正常使用时不会看到橙色矩形。

## Claude Code 状态

Windows 原生 Claude Code token 模式已恢复。Claude 的 `statusLine` 默认只输出
近黑色隐藏色块，不显示文本；真实驱动等级会同步写入 runtime shader 过渡参数，
因此滚动会话窗口时黑洞不会因为采不到 statusLine 色块而消失。
需要调试时可设置 `CLAUDE_BLACKHOLE_SHOW_STATUSLINE=1` 临时显示文本状态栏。
`bh claude` 会自动安装所需配置。

## 手动视觉测试

先打开 token 模式：

```cmd
bh token
```

然后在同一个 `Blackhole` 标签页中写入固定等级：

```cmd
node blackhole-windows-terminal\blackhole-statusline.js level-test 0.5
```

常用测试等级：`0.05`、`0.2`、`0.5`、`0.8`、`1.0`。

`beacon-test` 仍保留给低层 ANSI 色块采样调试；正常视觉测试使用 `level-test`，
它会通过单例 `level-glider` 启动 shader 平滑过渡，并同步隐藏色块和当前等级文件。

不要在 `bh codex` 窗口里做手动 probe，因为 Codex beacon 会周期性覆盖手动写入值。

## 验证命令

在仓库根目录运行：

```bash
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/blackhole-statusline.js
bash -n blackhole-windows-terminal/bh
node blackhole-windows-terminal/verify-blackhole-port.js
```

可选的 Windows shader 编译检查。先确认 `dxc.exe` 的实际安装路径，再运行：

```bash
/mnt/c/path/to/dxc.exe \
  -T ps_6_0 -E main 'C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal.hlsl' -Fo NUL
```
