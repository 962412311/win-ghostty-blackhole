# 运维与排障手册

文档日期：2026-07-15。

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
node blackhole-windows-terminal/codex-blackhole-supervisor.js --proxy-self-test
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
"experimental.rendering.forceFullRepaint": true,
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

这是正常行为。token live 文件用于初次安装和手动 token/Claude 兼容更新；`bh codex`
运行中只更新当前标签页顶部安全区的单格 marker，不再切换文件。`demo`、`pomodoro` 的 live 文件
用于强制 Windows Terminal 重新加载静态模式 shader。

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
- 如果发消息或输入命令后动画才恢复，说明 demo 标签页缺少重绘触发；重新运行 `bh demo`
  确认窗口中正在运行 `demo-keepalive`。
- 如果长时间运行后停在不可见状态，确认 HLSL 中 `DEMO_LEVEL_FLOOR` 仍为非零值，
  并重新运行 `bh demo` 强制刷新静态模式 shader。

### 新开的 Blackhole 标签页长时间黑屏

这通常不是色块宽度问题，而是 Windows Terminal 主进程尚未重新加载刚写入的
`settings.json`。`bh ... --open` 默认会等待 `2000ms` 后再打开新标签页；如果你的机器
仍偶发拿到旧 shader/profile，可以临时加大等待时间：

```bash
BLACKHOLE_WT_SETTINGS_RELOAD_MS=4000 bh token --open
```

Windows `cmd`：

```bat
set BLACKHOLE_WT_SETTINGS_RELOAD_MS=4000
bh token --open
set BLACKHOLE_WT_SETTINGS_RELOAD_MS=
```

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

每个 `bh codex` 标签页正常情况下只有一个 `codex-beacon`，不应持续启动
`level-glider`；多个标签页各自有一个 beacon 是正常现象：

```bash
ps -eo pid,ppid,etime,cmd | rg 'blackhole-statusline\.js (codex-beacon|level-glider)'
```

目标采样默认每 `500ms` 一次；目标变化时通过顶部单格近黑 marker 发送阻尼弹簧与
短尾矢量曲线混合后的中间等级，不切换 live shader。默认 `bounce=0.0`，全程单调、
无超调；大跳变约 `6.0s` 收敛，小跳变至少 `1.6s`。retarget 会继承 position 和
velocity。闭环移动先用 `480ms` 淡出，等级过渡完成后再用 `2400ms` 淡入，两类动画
不重叠。大小阶段使用 11-bit 高精度等级，稳态继续使用兼容旧窗口的 8-bit 等级和
5-bit 移动权重。marker 数据默认每 `10ms` 生成一次；supervisor 在 Codex 同步帧提交前
写入，并在控制安全的输出块后补写。

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

Codex 通过逐标签页顶部单格 marker 解决该问题；supervisor 通过 `script(1)` PTY 串行
转发 TUI 输出，并在 `CSI ?2026l` 提交前按当前终端 `columns/rows` 写入 marker，随后在
控制安全的输出块后补写。
手动 token/Claude 通过 `TOKEN_LEVEL` fallback 解决。
若仍消失：

```bash
command -v script
node blackhole-windows-terminal/codex-blackhole-supervisor.js --proxy-self-test
```

然后重新打开一个 `bh codex`，检查 Windows Terminal profile 是否切到
`blackhole_winterminal_token_live0/1.hlsl`，且活动 shader 包含
`tokenCodexMarkerData`。旧窗口的 supervisor 不会热加载 PTY 代理。Codex marker 只写
顶部安全区，不应出现在底部输入行。

### 黑洞反复变大变小

先检查同一个 supervisor 是否存在多个 beacon。Codex beacon 不写 runtime shader；
不同标签页各自存在一个 beacon 不会互相覆盖。手动 token/Claude 写入者仍由
`blackhole-live-owner.json` 互斥。

当前协议允许旧 beacon 与新 shader 共存：普通 packet 使用旧校验，高精度 packet 使用
固定 magic 和反向校验。如果只更新了部分文件，重新运行：

```bash
node blackhole-windows-terminal/bh-mode.js prepare-codex
```

该命令只准备 shader，不会启动新 Codex 标签页。

手动确认：

```bash
ps -eo pid,ppid,etime,cmd | rg 'blackhole-statusline\.js codex-beacon'
```

如果同一个 Codex supervisor 下出现多个 beacon，关闭该标签页并重新运行：

```bash
bh token
bh codex
```

### 初始大小或移动速度不合适

调整 `blackhole-windows-terminal/blackhole_winterminal.hlsl`：

- `TOKEN_AREA_MIN`：初始大小。
- `TOKEN_LOOP_SEC`：完整闭环周期，默认 `240` 秒，中心位移速度为上一版的 2 倍。
- `TOKEN_CALM_TURNS`：最低等级每周期圈数，默认 `1`。
- `TOKEN_RUSH_TURNS`：最高等级每周期圈数，默认 `4`。
- `TOKEN_WOBBLE_X_TURNS` / `TOKEN_WOBBLE_Y_TURNS`：微幅移动闭环圈数，默认
  `15` / `19`。
- `DEMO_XFADE`：demo 形态插值宽度，值越大转换越慢。
- `DEMO_LEVEL_FLOOR`：demo 回落时的最小可见等级。

`bh codex` 在 beacon 内执行阻尼弹簧与短尾矢量混合曲线，并通过顶部单格 marker
发送中间等级；大小、
全部形态参数、活动范围和路径混合共用同一个 `g`；形态按
`demoTour(1) -> 2 -> 3 -> 4 -> 5 -> 6 -> 0` 依次贯穿全部 7 个唯一可见预设。手动
token/Claude 仍由单例 `level-glider` 发起 HLSL 过渡。可通过环境变量临时调节：

- `BLACKHOLE_TOKEN_GLIDE_MIN_SEC`：最短过渡时间，默认 `0.3`。
- `BLACKHOLE_TOKEN_GLIDE_MAX_SEC`：最长过渡时间，默认 `1.5`。
- `BLACKHOLE_TOKEN_GLIDE_RATE`：按等级差计算过渡时长的倍率，默认 `10.0`。
- `CODEX_BLACKHOLE_INTERVAL_MS`：Codex 上下文采样间隔，默认 `500`。
- `CODEX_BLACKHOLE_REDRAW_MS`：Codex 过渡帧检查间隔，默认 `10`。
- `CODEX_BLACKHOLE_MARKER_MS`：Codex 稳态 marker 刷新间隔，默认 `10`。
- `CODEX_BLACKHOLE_MOTION_XFADE_MS`：大小过渡前闭环移动淡出时长，默认 `480`。
- `CODEX_BLACKHOLE_MOTION_FADE_IN_MS`：大小过渡结束后闭环移动恢复时长，默认
  `2400`。
- `CODEX_BLACKHOLE_DISABLE_PTY_PROXY=1`：禁用 Codex PTY 代理，仅用于排障；滚动保持
  不再保证。
- `CODEX_BLACKHOLE_SPRING_BOUNCE`：Codex 回弹强度，默认 `0.0`，即临界阻尼、
  无超调。
- `CODEX_BLACKHOLE_SPRING_MIN_SEC`：小跳变最短稳定时间，默认 `1.6`。
- `CODEX_BLACKHOLE_SPRING_MAX_SEC`：大跳变最长稳定时间，默认 `6.0`。
- `CODEX_BLACKHOLE_SPRING_RATE`：按等级距离计算稳定时间的倍率，默认 `8.0`。
- `CODEX_BLACKHOLE_SPRING_TIME_WARP`：时间重映射强度，默认 `5.0`。
- `CODEX_BLACKHOLE_SPRING_VECTOR_BLEND`：短尾矢量曲线混合比例，默认 `0.55`。
- `CODEX_BLACKHOLE_TRACE_FILE`：可选诊断轨迹文件；默认不写日志。
- `BLACKHOLE_DISABLE_LEVEL_GLIDE=1`：禁用手动 token/Claude 的 glider，仅用于排障；
  不影响 `bh codex` 的进程内弹簧。

闭环路径的静态校验包含 `0`、`0.25`、`0.5`、`0.75`、`1` 五个等级，比较周期首尾的
位置和速度。修改路径公式后必须运行 `verify-blackhole-port.js`，不能只靠目测。

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
C:\Users\YOUR_USER\terminal-shaders\blackhole-live-owner.json
C:\Users\YOUR_USER\terminal-shaders\blackhole-level-target.json
C:\Users\YOUR_USER\terminal-shaders\blackhole-level-current.json
C:\Users\YOUR_USER\terminal-shaders\blackhole-level-glider.json
C:\Users\YOUR_USER\terminal-shaders\blackhole-level-glider.lock
C:\Users\YOUR_USER\terminal-shaders\blackhole-level-command.txt
```

三个 level JSON 文件和 glider lock 主要供手动 `bh token` 与 Claude 兼容链路使用；
`blackhole-level-command.txt` 仅作为旧版本残留清理项。`bh codex` 不会按采样周期写这些文件。
