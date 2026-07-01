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
- `MODE_POMODORO`：番茄钟模式。

`bh demo`、`bh token`、`bh pomodoro` 会重写运行时 shader 的 `SIZE_MODE`，并更新
Windows Terminal profile。

## Token 数据通道

Windows Terminal shader 无法直接读取进程内变量，因此项目使用双通道：

1. 主通道：`blackhole-statusline.js` 把上下文比例写入运行时 shader 的
   `#define TOKEN_LEVEL <level>`，并在 `blackhole_winterminal_live0.hlsl` 和
   `blackhole_winterminal_live1.hlsl` 之间切换 profile 路径，触发 Windows Terminal
   刷新 shader。
2. 兼容通道：向终端写入近黑色 ANSI 背景色块，shader 从固定位置采样并解码。

HLSL 中 token 模式优先使用 `TOKEN_LEVEL`。只有 `TOKEN_LEVEL == -1` 时才读取可见色块。
这解决了会话未填满窗口、滚动 scrollback 后采不到色块的问题。

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
4. `codex-blackhole-supervisor.js` 同时启动真实 Codex 和 beacon。
5. beacon 查询 `~/.codex/state_5.sqlite`，只接受本窗口启动时间之后创建的 thread。
6. beacon 周期性写入 `TOKEN_LEVEL`，黑洞线性变化。

这样新开的同目录 Codex 不会继承旧会话的高上下文比例。

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

## 本地视觉调优

为适配 Windows Terminal 视觉效果，以下常量允许偏离上游：

- `TOKEN_AREA_MIN = 0.0030`：初始黑洞更小。
- `TOKEN_CALM = 0.0200`：低上下文等级移动更慢。
- `TOKEN_RUSH = 0.5500`：高上下文等级移动更慢。

`verify-blackhole-port.js` 仍校验主体公式和其他模型常量。

