# my_ghostty_blackhole

这是一个 Windows Terminal 黑洞像素着色器实验项目，基于
`ghostty-blackhole-src/` 中的 Ghostty 原始黑洞 shader 源码移植。

当前稳定支持的入口：

- `bh demo`：打开独立演示模式的 `Blackhole` 终端标签页。
- `bh token`：打开 token 驱动模式，便于手动测试不同上下文等级。
- `bh codex` 或 `bh`：在 `Blackhole` 终端标签页中启动 WSL Codex，并用
  Codex 真实上下文占用驱动黑洞效果。

Windows 原生 Claude Code 黑洞模式已禁用。Claude Code 2.1.196 在
Windows/cmd 下会把 `statusLine` JSON 泄漏到命令行提示符中，因此
`bh claude` 会主动拒绝启动。Claude Code 请按普通方式运行。

## 目录结构

- `blackhole-windows-terminal/`：Windows Terminal HLSL shader、启动脚本、
  token 信号桥和校验脚本。
- `ghostty-blackhole-src/`：上游参考源码检出目录，用于对比 shader 常量和
  公式锚点。该目录被顶层 Git 忽略，不作为本仓库内容提交。

## 快速使用

在 Windows `cmd` 或 WSL 中运行：

```cmd
bh demo
bh codex
bh mode
```

手动测试不同黑洞强度时，先打开 token 模式：

```cmd
bh token
```

然后在同一个 `Blackhole` 标签页中写入指定上下文等级：

```cmd
node blackhole-windows-terminal\blackhole-statusline.js beacon-test 0.5
```

常用测试等级：`0.05`、`0.2`、`0.5`、`0.8`、`1.0`。

## 原理简述

WSL Codex wrapper 会在真实 Codex 旁边启动一个轻量 beacon 进程。beacon
定期向当前终端写入一小块近黑色 ANSI 背景色。Windows Terminal 会把这个色块
渲染进终端纹理，`blackhole_winterminal.hlsl` 再从固定位置采样、校验并解码出
`0.0..1.0` 的上下文等级，用这个值驱动黑洞大小、强度和文字吸引效果。

beacon 只读取当前 `bh codex` 窗口启动之后创建的 Codex 会话，避免同目录旧会话的
高 token 记录污染新窗口。新会话刚启动时会回到最小显示比例。

这个色块是给 shader 传参用的，不是给用户看的。当前编码已经改成近黑色，shader
仍可识别，但正常使用时不会再看到左下角橙色矩形。

## 验证

在仓库根目录运行：

```bash
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/blackhole-statusline.js
bash -n blackhole-windows-terminal/bh
node blackhole-windows-terminal/verify-blackhole-port.js
```

`verify-blackhole-port.js` 会对比 Ghostty 原始 shader，检查关键常量和公式锚点
是否保持一致。

更多命令和配置细节见 `blackhole-windows-terminal/README.md`。
