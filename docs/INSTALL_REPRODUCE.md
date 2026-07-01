# 复现安装指南

本文用于在另一台 Windows + WSL 电脑上复现 Windows Terminal 黑洞效果。文档日期：
2026-07-01。

## 目标效果

- `bh demo`：打开 Windows Terminal `Blackhole` 标签页，显示动态黑洞演示。
- `bh codex`：在 `Blackhole` 标签页启动 WSL Codex，黑洞按 Codex 上下文比例线性变化。
- `bh claude`：在 `Blackhole` 标签页启动 Windows Claude Code，黑洞按 Claude Code 上下文比例变化。
- 用户向上滚动会话或会话内容未填满窗口时，黑洞仍通过 shader `TOKEN_LEVEL`
  fallback 保持显示。

## 前置条件

- Windows Terminal 已安装，且支持 `experimental.pixelShaderPath`。
- Windows 安装 Node.js，并能在 `cmd.exe` 中运行 `node --version`。
- WSL 发行版可用，默认名称为 `Ubuntu`；如不同，设置 `BLACKHOLE_WSL_DISTRO`。
- WSL 中安装 Node.js，并能运行 `node --version`。
- WSL 中安装 Codex，并且 `command -v codex` 能找到默认入口。
- Windows 中安装 Claude Code，并且 `cmd.exe` 中 `where claude` 能找到入口。
- Claude Code hook 需要 bash 执行器；Windows 自带 WSL bash 或 Git/MSYS bash 均可。

## 解包位置

建议把归档包解到一个不会频繁改名的位置，例如：

```text
C:\Tools\win-ghostty-blackhole
```

如果从 WSL 访问同一目录，路径通常是：

```bash
/mnt/c/Tools/win-ghostty-blackhole
```

脚本已经按自身目录自定位，不再依赖固定仓库路径。

从归档包开始复现时，先校验并解包：

```cmd
if not exist C:\Tools\win-ghostty-blackhole mkdir C:\Tools\win-ghostty-blackhole
cd /d C:\Tools\win-ghostty-blackhole
tar -xzf C:\path\to\win-ghostty-blackhole-repro-2026-07-01.tar.gz
```

如果同时拿到了 `.sha256` 文件，在归档包所在目录校验：

```bash
sha256sum -c win-ghostty-blackhole-repro-2026-07-01.sha256
```

## Windows Terminal Profile

创建一个名为 `Blackhole` 的 Windows Terminal profile。最小配置示例：

```jsonc
{
  "name": "Blackhole",
  "commandline": "cmd.exe",
  "experimental.pixelShaderPath": "C:\\Users\\YOUR_USER\\terminal-shaders\\blackhole_winterminal.hlsl"
}
```

如果 profile 名称不是 `Blackhole`，设置：

```cmd
set BLACKHOLE_WT_PROFILE=你的Profile名称
```

## 安装命令入口

### Windows cmd

在仓库根目录运行：

```cmd
scripts\install-windows.cmd
```

该脚本会：

- 检查 Windows Node.js。
- 安装 token shader 到 `C:\Users\YOUR_USER\terminal-shaders`。
- 生成 `%USERPROFILE%\bin\bh.cmd` 包装入口。

如果 `%USERPROFILE%\bin` 不在 PATH，把它加入用户 PATH 后重新打开 Windows Terminal。

### WSL

在仓库根目录运行：

```bash
bash scripts/install-wsl.sh
```

该脚本会：

- 检查 WSL Node.js。
- 创建 `~/.local/bin/bh` 符号链接到项目内的 WSL 入口。
- 提示确认 `~/.local/bin` 是否在 PATH。

## 使用

Windows `cmd` 或 WSL 中都可以运行：

```cmd
bh demo
bh token
bh codex
bh claude
bh mode
```

手动测试固定等级：

```cmd
bh token
node blackhole-windows-terminal\blackhole-statusline.js level-test 0.5
```

常用等级：`0.05`、`0.2`、`0.5`、`0.8`、`1.0`。

## 可调环境变量

- `BLACKHOLE_WINDOWS_USER`：无法自动探测 Windows 用户名时手动指定。
- `BLACKHOLE_WSL_DISTRO`：WSL 发行版名，默认 `Ubuntu`。
- `BLACKHOLE_WT_PROFILE`：Windows Terminal profile 名，默认 `Blackhole`。
- `BLACKHOLE_SHADER_PATH`：运行时 shader 路径。
- `BLACKHOLE_WT_SETTINGS`：Windows Terminal `settings.json` 路径。
- `BLACKHOLE_CLAUDE_DIR`：Claude 配置目录。
- `BLACKHOLE_CLAUDE_SETTINGS`：Claude `settings.json` 路径。
- `CODEX_BLACKHOLE_CODEX_BIN`：强制指定 Codex 可执行文件。
- `CODEX_BLACKHOLE_MIN_LEVEL`：Codex 初始显示地板，默认 `0`。
- `CODEX_BLACKHOLE_TOKEN_MAX`：Codex token 上限估算，默认 `25000000`。
- `CODEX_BLACKHOLE_INTERVAL_MS`：Codex beacon 刷新间隔，默认 `1000`。
- `CLAUDE_BLACKHOLE_MIN_LEVEL`：Claude 初始显示地板，默认 `0`。
- `CLAUDE_BLACKHOLE_SHOW_STATUSLINE=1`：显示 Claude 调试文本状态栏。

## 归档包复现验证

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/codex-blackhole-supervisor.js
bash -n blackhole-windows-terminal/bh
bash -n blackhole-windows-terminal/claude-blackhole-statusline.sh
node blackhole-windows-terminal/verify-blackhole-port.js
```

Windows 侧入口验证：

```cmd
blackhole-windows-terminal\bh.cmd __run_claude --version
```

如果是在 Git 工作区中开发源码，再额外运行：

```bash
git diff --check
```
