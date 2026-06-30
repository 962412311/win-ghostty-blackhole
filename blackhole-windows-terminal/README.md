# Windows Terminal 黑洞效果

这是 Ghostty 黑洞 shader 的 Windows Terminal HLSL 移植版本，包含演示模式、
token 驱动模式，以及面向 WSL Codex 的启动脚本。

## 文件说明

- `blackhole_winterminal.hlsl`：Windows Terminal 像素着色器。
- `bh-mode.js`：安装 shader 模式，并打开 Windows Terminal 标签页。
- `bh.cmd`：Windows `cmd` 入口。
- `bh`：WSL 入口。
- `blackhole-statusline.js`：Codex 上下文 beacon 和 token 编码器。
- `codex-blackhole-supervisor.js`：同时运行真实 Codex 和 beacon 进程。
- `verify-blackhole-port.js`：对比 `ghostty-blackhole-src/blackhole.glsl`，
  校验 shader 常量和公式锚点。
- `settings-snippet.jsonc`：Windows Terminal 配置片段。
- `claude-settings-snippet.jsonc`：Claude Code 禁用说明。

## 支持的命令

Windows `cmd`：

```cmd
bh demo
bh token
bh pomodoro
bh
bh codex
bh mode
```

WSL：

```bash
bh demo
bh token
bh codex
bh mode
```

命令含义：

- `bh demo`：安装 demo shader，并打开 `Blackhole demo` 标签页。
- `bh token`：安装 token shader，并打开 `Blackhole token` 标签页。
- `bh pomodoro`：安装 pomodoro shader，并打开 `Blackhole pomodoro` 标签页。
- `bh` / `bh codex`：安装 token shader，并在 `Blackhole` 标签页中启动
  WSL Codex。
- `bh mode`：输出请求模式、实际安装的 shader 模式和运行时 shader 路径。
- `bh claude`：已禁用。Windows Claude Code 请直接正常运行，不要通过 `bh` 启动。

## Windows Terminal 配置

需要一个名为 `Blackhole` 的 Windows Terminal profile：

- profile 名称：`Blackhole`
- pixel shader 路径：
  `C:\Users\ChenZiLiang\terminal-shaders\blackhole_winterminal.hlsl`
- shell：`cmd.exe`
- `blackhole-windows-terminal` 目录需要加入 `PATH`，确保 `bh` 能被找到。

`bh-mode.js` 会把运行时 shader 写入上述路径，并在需要时更新 `Blackhole`
profile 的 `experimental.pixelShaderPath`。

## Token Beacon 原理

Windows Terminal shader 不能直接接收任意运行时参数。因此 Codex 集成会向当前
终端写入一个很小的 ANSI 背景色块。shader 从固定位置采样这个色块，并把颜色解码为
`0.0..1.0` 的上下文等级。

每个 `bh codex` 窗口都会给 beacon 传入自己的启动时间。beacon 查询 Codex
`state_5.sqlite` 时只接受该时间之后创建的同目录 thread；启动初期没有 thread
时输出最小等级。这样新开的同目录 Codex 窗口不会继承旧会话的高上下文比例。

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

Windows 原生 Claude Code 黑洞模式已禁用。Claude Code 2.1.196 在 Windows `cmd`
下会把 `statusLine` JSON 泄漏到命令行提示符中，不能稳定作为 shader 数据通道。
Claude Code 请保持普通 UI 路径运行。

## 手动视觉测试

先打开 token 模式：

```cmd
bh token
```

然后在同一个 `Blackhole` 标签页中写入固定等级：

```cmd
node blackhole-windows-terminal\blackhole-statusline.js beacon-test 0.5
```

常用测试等级：`0.05`、`0.2`、`0.5`、`0.8`、`1.0`。

不要在 `bh codex` 窗口里做手动 probe，因为 Codex beacon 会周期性覆盖手动写入值。

## 验证命令

在仓库根目录运行：

```bash
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/blackhole-statusline.js
bash -n blackhole-windows-terminal/bh
node blackhole-windows-terminal/verify-blackhole-port.js
```

可选的 Windows shader 编译检查：

```bash
/mnt/c/Users/ChenZiLiang/AppData/Local/Microsoft/WinGet/Packages/Microsoft.DirectX.ShaderCompiler_Microsoft.Winget.Source_8wekyb3d8bbwe/bin/x64/dxc.exe \
  -T ps_6_0 -E main 'C:\Users\ChenZiLiang\terminal-shaders\blackhole_winterminal.hlsl' -Fo NUL
```
