# Windows Terminal 黑洞效果

这是 Ghostty 黑洞 shader 的 Windows Terminal HLSL 移植版本，包含演示模式、
token 驱动模式，以及面向 WSL Codex 和 Windows Claude Code 的启动脚本。

## 文件说明

- `blackhole_winterminal.hlsl`：Windows Terminal 像素着色器。
- `bh-mode.js`：安装 shader 模式，并打开 Windows Terminal 标签页。
- `bh.cmd`：Windows `cmd` 入口。
- `bh`：WSL 入口。
- `blackhole-statusline.js`：Codex/Claude Code 上下文 beacon 和 token 编码器。
- `codex-blackhole-supervisor.js`：同时运行真实 Codex 和 beacon 进程。
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

- `bh demo`：安装 demo shader，并打开 `Blackhole demo` 标签页。
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
helper 借鉴原始 Ghostty 仓库的接入方式：默认不显示调试文本，真实等级写入
运行时 shader 的 `TOKEN_LEVEL` fallback，近黑色状态栏色块只作为兼容通道。

`bh pomodoro` 是按本地墙钟运行的 55/5 番茄钟模式；`bh clock` 是同一模式的别名。
Windows Terminal 没有 Ghostty 的 cursor idle uniform，因此该模式不做终端空闲淡出。
需要快速验证时可临时运行 `BLACKHOLE_POMODORO_TIME_SCALE=100 bh pomodoro`。

## Windows Terminal 配置

需要一个名为 `Blackhole` 的 Windows Terminal profile：

- profile 名称：`Blackhole`
- pixel shader 路径：
  `C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal.hlsl`
- shell：`cmd.exe`
- `blackhole-windows-terminal` 目录需要加入 `PATH`，确保 `bh` 能被找到。

`bh-mode.js` 会把运行时 shader 写入上述路径，并在需要时更新 `Blackhole`
profile 的 `experimental.pixelShaderPath`。`demo`、`pomodoro` 这类静态模式会交替写入
`blackhole_winterminal_<mode>_live0/1.hlsl`，用于强制 Windows Terminal 重新加载
shader，避免继续使用旧编译缓存。

## Token Beacon 原理

Windows Terminal shader 不能直接接收任意运行时参数。因此 token 集成同时使用
两条通道：后台 beacon 会把当前等级写入运行时 shader 的 `TOKEN_LEVEL` fallback，
并切换 `blackhole_winterminal_live0/1.hlsl` 触发 Windows Terminal 刷新；同时保留
近黑色 ANSI 色块作为兼容通道。shader 优先使用 `TOKEN_LEVEL`，只有 fallback 为
`-1` 时才读取可见色块。

这样即使会话内容没有填满窗口，或者用户向上滚动到 scrollback，黑洞也不再依赖
当前可见文本中是否刚好有标识色块。

每个 `bh codex` 窗口都会给 beacon 传入真实 Codex 子进程 PID。beacon 扫描该进程树
实际打开的 rollout 文件，并按这个文件计算上下文比例；启动初期还没有活动 rollout 时
输出最小等级。这样新开的同目录 Codex 窗口不会继承未触碰旧会话的高上下文比例，同时
`resume` 切换到旧会话后能立即跟随该会话上下文比例。`new` 切到空会话且新 rollout
尚未生成时，beacon 会通过 shell snapshot 的 thread-id 识别切换并回到最小等级。

Claude Code 走同一个隐藏 beacon 协议。`statusLine` 根据 Claude 提供的
`context_window`、消息 usage 或 transcript 计算上下文占用；`SessionStart`
写入 `0.0`，`SessionEnd` 清除采样位置，让黑洞隐藏。
读取 transcript 前会校验 `session_id` 和 transcript 文件名是否一致；`new` 后如果
Claude 暂时还传旧 transcript，会按空会话输出最小等级。

## 大小映射调试

默认映射保持线性：Codex 上下文等级 `0.0..1.0` 会按同样的比例驱动
shader 中的黑洞尺寸。新窗口没有上下文记录时输出 `0.0`，也就是最小比例。

自动 `bh codex` 的起始地板由 `CODEX_BLACKHOLE_MIN_LEVEL` 控制，默认是 `0`：

```bash
CODEX_BLACKHOLE_MIN_LEVEL=0.03 bh codex
```

Windows `cmd` 中可以先设置环境变量再启动：

```cmd
set CODEX_BLACKHOLE_MIN_LEVEL=0.03
bh codex
```

Windows 启动器会通过 `WSLENV` 把这个变量传给 WSL 内的 beacon。

这个值只影响自动 Codex beacon；手动视觉测试仍然以 `level-test` 参数为准。

shader 自身的尺寸常量在 `blackhole_winterminal.hlsl`：

- `TOKEN_AREA_MIN`：最小显示比例；本地默认 `0.0030`，比上游更小。
- `TOKEN_AREA_MAX`：最大显示比例。
- `TOKEN_EASE`：等级到尺寸的曲线；`1.0` 是线性。
- `TOKEN_CALM`：低上下文等级时的移动速度；本地默认 `0.0050`。
- `TOKEN_RUSH`：高上下文等级时的移动速度；本地默认 `0.1375`。
- `DEMO_LEVEL_FLOOR`：demo 回落时的最小等级；本地默认 `0.0350`，避免长时间
  运行后停在不可见状态。

改 HLSL 后需要重新运行 `bh demo`、`bh token`、`bh codex` 或 `bh claude` 让运行时 shader
生效。`verify-blackhole-port.js` 仍严格校验原版公式和主体常量，但允许
`TOKEN_AREA_MIN`、`TOKEN_CALM`、`TOKEN_RUSH`、`DEMO_LEVEL_FLOOR`
作为 Windows 本地视觉调优常量偏离上游。

当前协议使用近黑色编码：

```text
R = 校验位
G = 高 4 位
B = 低 4 位
校验位 = G ^ B ^ 0x5
```

shader 仍兼容旧的橙色协议，但新的 beacon 只写近黑色，正常使用时不会看到左下角
橙色矩形。

## Claude Code 状态

Windows 原生 Claude Code token 模式已恢复。Claude 的 `statusLine` 默认只输出
近黑色隐藏色块，不显示文本；真实驱动等级会同步写入运行时 shader 的
`TOKEN_LEVEL` fallback，因此滚动会话窗口时黑洞不会因为采不到 statusLine 色块而消失。
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
它会同时更新隐藏色块和 shader `TOKEN_LEVEL` fallback。

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
