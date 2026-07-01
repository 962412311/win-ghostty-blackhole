# 架构说明

本文记录 Windows Terminal 黑洞效果的当前实现。文档日期：2026-07-01。

## 模块

- `blackhole_winterminal.hlsl`：Windows Terminal pixel shader。主体公式移植自
  `ghostty-blackhole-src/blackhole.glsl`。
- `bh-mode.js`：安装 shader 模式、更新 Windows Terminal profile、打开 `wt.exe`
  标签页、安装 Claude Code bridge。
- `blackhole-statusline.js`：上下文比例解析、token 编码、`TOKEN_LEVEL` fallback
  写入、Codex/Claude beacon。
- `codex-blackhole-supervisor.js`：在真实 Codex 旁边运行 beacon 进程。
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
- 给每个 Windows Terminal 标签页提供完全独立的 shader 参数状态；profile 的
  `experimental.pixelShaderPath` 是全局配置，项目通过 runtime shader 文件和路径切换刷新。

## Token 数据通道

Windows Terminal shader 无法直接读取进程内变量，因此项目使用双通道：

1. 主通道：`blackhole-statusline.js` 把上下文比例写入运行时 shader 的
   `#define TOKEN_LEVEL <level>`，并在 `blackhole_winterminal_live0.hlsl` 和
   `blackhole_winterminal_live1.hlsl` 之间切换 profile 路径，触发 Windows Terminal
   刷新 shader。
2. 兼容通道：向终端写入近黑色 ANSI 背景色块，shader 从固定位置采样并解码。

HLSL 中 token 模式优先使用 `TOKEN_LEVEL`。只有 `TOKEN_LEVEL == -1` 时才读取可见色块。
这解决了会话未填满窗口、滚动 scrollback 后采不到色块的问题。

由于 Windows Terminal `Blackhole` profile 只有一个全局 shader 路径，多个旧
beacon 不能同时写 `TOKEN_LEVEL`。启动 `bh demo`、`bh token`、`bh codex` 或
`bh claude` 时会写入 `blackhole-live-owner.json`，新的 beacon/statusLine 只有
owner 匹配时才允许更新 runtime shader；同时启动器会清理旧的 Codex beacon，避免
黑洞在新旧上下文等级之间反复变大变小。

## 编码格式

上下文等级范围为 `0.0..1.0`，编码到 `0..250`：

```text
fill = round(level * 250)
hi = fill / 16
lo = fill % 16
chk = hi ^ lo ^ 0x5
RGB = (chk, hi, lo)
```

旧橙色高位签名仍被 shader 兼容；当前 beacon 默认输出近黑色，正常使用时不可见。

## Codex 集成

`bh codex` 流程：

1. 安装 token shader。
2. 打开 Windows Terminal `Blackhole` 标签页。
3. 通过 WSL 启动项目内 `bh __run_codex`。
4. `codex-blackhole-supervisor.js` 启动真实 Codex，并把 Codex 子进程 PID 传给
   beacon。
5. beacon 扫描该 Codex 进程树打开的 rollout 文件，再用该 rollout 计算上下文比例。
   如果 `new` 后新会话还没有生成 rollout，则用同 supervisor 的 shell snapshot
   thread-id 识别会话已切换，并临时输出最小等级。
6. beacon 周期性写入 `TOKEN_LEVEL`，黑洞线性变化。

这样新开的同目录 Codex 不会继承旧会话的高上下文比例。
如果在 Codex 内用 `resume` 切到旧 thread，Codex 会打开该 thread 对应 rollout，
beacon 会直接跟随这个实际打开的文件。普通后台 token 更新不会让新窗口误继承其他
活跃会话。
如果 supervisor 已退出，beacon 会自行退出，避免窗口关闭后留下孤儿写入者。

## Claude Code 集成

`bh claude` 流程：

1. 安装 token shader。
2. 把 `blackhole-statusline.js`、`claude-blackhole-statusline.cmd`、
   `claude-blackhole-statusline.sh` 复制到 Windows `~/.claude`。
3. 自动合并 Claude Code `statusLine`、`SessionStart`、`SessionEnd` 配置。
4. 打开 Windows Terminal `Blackhole` 标签页并启动 Windows Claude Code。
5. Claude statusLine/hook 通过 bash bridge 调用 Node helper。

默认不显示 Claude 文本状态栏，只输出近黑色兼容色块；真实驱动由 `TOKEN_LEVEL`
fallback 完成。
Claude 读取 `context_window`、消息 usage 或 transcript usage。读取 transcript 前会校验
`session_id` 和 transcript 文件名是否一致；如果 `new` 后 Claude 暂时仍传旧 transcript，
会按空新会话输出最小等级，避免继承旧会话大小。

## 本地视觉调优

为适配 Windows Terminal 视觉效果，以下常量允许偏离上游：

- `TOKEN_AREA_MIN = 0.0030`：初始黑洞更小。
- `TOKEN_CALM = 0.0200`：低上下文等级移动更慢。
- `TOKEN_RUSH = 0.5500`：高上下文等级移动更慢。

`verify-blackhole-port.js` 仍校验主体公式和其他模型常量。
