# 运维与排障手册

文档日期：2026-07-02。

## 基础健康检查

`blackhole-windows-terminal/verify-blackhole-port.js` 需要
`ghostty-blackhole-src/blackhole.glsl`。归档包已经包含该目录；如果是从 GitHub
仓库克隆源码，先运行：

```bash
git clone https://github.com/s0xDk/ghostty-blackhole.git ghostty-blackhole-src
```

归档包环境：

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/codex-blackhole-supervisor.js
bash -n blackhole-windows-terminal/bh
bash -n blackhole-windows-terminal/claude-blackhole-statusline.sh
node blackhole-windows-terminal/verify-blackhole-port.js
```

Git 源码工作区额外检查：

```bash
git diff --check
```

Windows 侧检查：

```cmd
where node
node --version
where claude
blackhole-windows-terminal\bh.cmd __run_claude --version
```

WSL 侧检查：

```bash
command -v node
node --version
command -v codex
command -v sqlite3
```

## Windows Terminal profile 检查

`Blackhole` profile 必须存在，并含有：

```jsonc
"experimental.pixelShaderPath": "C:\\Users\\YOUR_USER\\terminal-shaders\\blackhole_winterminal.hlsl"
```

运行时可能会自动切换到：

```text
blackhole_winterminal_live0.hlsl
blackhole_winterminal_live1.hlsl
blackhole_winterminal_demo_live0.hlsl
blackhole_winterminal_demo_live1.hlsl
blackhole_winterminal_pomodoro_live0.hlsl
blackhole_winterminal_pomodoro_live1.hlsl
```

这是正常行为。`blackhole_winterminal_live0/1.hlsl` 用于刷新 `TOKEN_LEVEL`；
`demo`、`pomodoro` 的 live 文件用于强制 Windows Terminal 重新加载静态模式 shader。

## 常见问题

### `bh` 找不到命令

Windows：

- 运行 `scripts\install-windows.cmd`。
- 确认 `%USERPROFILE%\bin` 已加入 PATH。
- 重新打开 Windows Terminal。

WSL：

- 运行 `bash scripts/install-wsl.sh`。
- 确认 `~/.local/bin` 已加入 PATH。

### `bh demo` 没有黑洞

- 确认 Windows Terminal profile 名称是 `Blackhole`，或设置 `BLACKHOLE_WT_PROFILE`。
- 运行 `bh mode`，确认输出路径是 Windows 侧 `terminal-shaders`。
- 重新打开一个 `Blackhole` 标签页。

### 快速验证番茄钟模式

正常模式按本地墙钟执行 55/5 周期：

```bash
bh pomodoro
```

如果不想等待完整周期，可临时加速 runtime shader：

```bash
BLACKHOLE_POMODORO_TIME_SCALE=100 bh pomodoro
```

Windows `cmd`：

```cmd
set BLACKHOLE_POMODORO_TIME_SCALE=100
bh pomodoro
set BLACKHOLE_POMODORO_TIME_SCALE=
```

确认后重新运行 `bh pomodoro` 恢复真实速度。

该模式的 Windows Terminal 兼容边界：

- 可以验证 55/5 墙钟周期和黑洞视觉变化。
- 不能验证终端输入空闲淡出；Windows Terminal 没有 Ghostty 的 `iTimeCursorChange`。
- 不能触发响铃、通知、弹窗或休息提醒；如需这些行为，需要额外的宿主脚本或应用层逻辑。

### `bh codex` 模型和手动 Codex 不一致

`codex-blackhole-supervisor.js` 会优先使用 WSL `PATH` 上的 `codex`。如果仍不一致：

```bash
command -v codex
CODEX_BLACKHOLE_CODEX_BIN=/path/to/codex bh codex
```

### Codex `resume` 后黑洞不随上下文变化

当前版本优先绑定 `bh codex` 启动的 Codex 进程树实际打开的 rollout 文件。若 `resume`
后仍不变化：

```bash
ps -eo pid,ppid,etime,cmd | rg 'codex|blackhole'
ls -l /proc/<codex-pid>/fd | rg 'rollout-.*\.jsonl'
ls -lt ~/.codex/shell_snapshots | sed -n '1,20p'
```

确认 `bh codex` 子进程已经打开目标会话的 rollout 文件；beacon 会优先读取这个文件，
不会按同目录其它活跃会话猜测。`new` 后如果暂时没有新 rollout，确认最新 shell
snapshot 里带有同一个 `CODEX_BLACKHOLE_SUPERVISOR_PID`，beacon 会据此回到最小等级。

### Claude Code hook 报 `/mnt/c/... No such file`

- 重新运行 `bh claude`，它会重装 bridge。
- 如果 Windows 用户名无法自动识别，设置 `BLACKHOLE_WINDOWS_USER`。
- 确认 `C:\Users\YOUR_USER\.claude\claude-blackhole-statusline.sh` 存在。

### Claude 只显示色块或文本状态栏

- 默认状态栏只输出近黑色兼容色块，不应该显示 `[..........]` 文本。
- 如果看到文本，检查是否设置了 `CLAUDE_BLACKHOLE_SHOW_STATUSLINE=1`。
- 重新运行 `bh claude` 以刷新 helper。

### Claude `new` 后没有回到最小比例

当前版本读取 transcript 前会校验 `session_id` 和 transcript 文件名是否一致。若仍继承
旧会话大小：

```bash
cmp -s blackhole-windows-terminal/blackhole-statusline.js \
  /mnt/c/Users/YOUR_USER/.claude/blackhole-statusline.js && echo helper-in-sync
find /mnt/c/Users/YOUR_USER/.claude/projects -type f -name '*.jsonl' -mmin -60
```

如果 helper 不一致，重新运行 `bh claude`；它会重装 `C:\Users\YOUR_USER\.claude`
下的 bridge 和 Node helper。

### 滚动会话后黑洞消失

当前版本通过 `TOKEN_LEVEL` fallback 解决该问题。若仍消失：

```bash
node blackhole-windows-terminal/blackhole-statusline.js level-test 0.5
```

然后检查 Windows Terminal profile 是否切到 `blackhole_winterminal_live0/1.hlsl`。

### 黑洞反复变大变小

通常是旧 Codex beacon 还在写全局 runtime shader。当前版本启动新模式时会自动清理
旧 beacon，并用 `blackhole-live-owner.json` 阻止旧写入者覆盖当前窗口。

手动确认：

```bash
ps -eo pid,ppid,etime,cmd | rg 'blackhole-statusline\.js codex-beacon'
```

如果仍能看到旧进程，重新运行任一模式入口即可触发清理：

```bash
bh token
bh codex
```

### 初始大小或移动速度不合适

调整 `blackhole-windows-terminal/blackhole_winterminal.hlsl`：

- `TOKEN_AREA_MIN`：初始大小。
- `TOKEN_CALM`：低上下文移动速度。
- `TOKEN_RUSH`：高上下文移动速度。

改完运行：

```bash
node blackhole-windows-terminal/verify-blackhole-port.js
bh token
node blackhole-windows-terminal/blackhole-statusline.js level-test 0.2
```

## 清理运行时文件

可删除以下运行时生成物，之后重新运行对应 `bh` 命令会再生成：

```text
C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal_live0.hlsl
C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal_live1.hlsl
C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal_demo_live0.hlsl
C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal_demo_live1.hlsl
C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal_pomodoro_live0.hlsl
C:\Users\YOUR_USER\terminal-shaders\blackhole_winterminal_pomodoro_live1.hlsl
C:\Users\YOUR_USER\terminal-shaders\blackhole-live-level.txt
```
