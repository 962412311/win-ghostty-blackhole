# 复现安装指南

本文用于在另一台 Windows + WSL 电脑上复现 Windows Terminal 黑洞效果。文档日期：
2026-07-15。

## 目标效果

- `bh demo`：打开 Windows Terminal `Blackhole` 标签页，显示动态黑洞演示。
- `bh pomodoro` / `bh clock`：打开按本地墙钟运行的 55/5 番茄钟模式。
- `bh codex`：在 `Blackhole` 标签页启动 WSL Codex，黑洞按 Codex 上下文比例线性变化。
- Codex `resume` 会跟随实际打开的 rollout；`new` 会回到最小比例。
- `bh claude`：在 `Blackhole` 标签页启动 Windows Claude Code，黑洞按 Claude Code 上下文比例变化。
- Claude Code `new` 不会继承旧 transcript 的黑洞大小。
- 用户向上滚动会话或会话内容未填满窗口时，Codex 仍通过逐标签页顶部单格 marker
  保持显示；supervisor 在每个 Codex 同步绘制帧提交前写入 marker，手动 token/Claude
  使用 shader fallback。
- `bh codex` 目标变化由 beacon 的阻尼弹簧与短尾矢量混合曲线平滑过渡，默认回弹
  强度 `0.0`，全程单调、无超调，大跨度约 `6.0` 秒收敛；中途改变目标会继承当时的
  位置和速度。大小阶段使用 11-bit 高精度等级，不重载 shader、不触碰底部输入行。
  闭环移动先用 `480ms` 淡出，大小/形态过渡完成后再用 `2400ms` 淡入，两类动画不
  重叠。大小与形态共用同一个等级，并依次贯穿全部 7 个唯一可见上游预设。黑洞中心
  移动路径每 `240` 秒严格闭环，吸积盘内部动画速度不变。
- 手动 `bh token` 与 Claude 使用带独占 lock 的单例 `level-glider` 兼容链路，不会并发
  创建多个写入者；旧 watcher 在模式 owner 变化后自行退出。

## 前置条件

- Windows Terminal 已安装，且支持 `experimental.pixelShaderPath`。
- Windows 安装 Node.js，并能在 `cmd.exe` 中运行 `node --version`。
- WSL 发行版可用，默认名称为 `Ubuntu`；如不同，设置 `BLACKHOLE_WSL_DISTRO`。
- WSL 中安装 Node.js，并能运行 `node --version`。
- WSL 中存在 util-linux `script` 命令，并能运行 `command -v script`；它用于给 Codex
  分配 PTY 并消除 TUI 重绘与 marker 的并发写入。
- WSL 中安装 Codex，并且 `command -v codex` 能找到默认入口。
- Windows 中安装 Claude Code，并且 `cmd.exe` 中 `where claude` 能找到入口。
- Claude Code hook 需要 bash 执行器；Windows 自带 WSL bash 或 Git/MSYS bash 均可。

## 获取项目

推荐使用 GitHub 仓库中的复现归档包：

```text
dist/win-ghostty-blackhole-repro-2026-07-01.tar.gz
dist/win-ghostty-blackhole-repro-2026-07-01.sha256
```

归档包包含 `ghostty-blackhole-src/`，可以直接运行严格 shader 公式校验。

如果从公开 GitHub 仓库克隆源码：

```cmd
git clone https://github.com/962412311/win-ghostty-blackhole.git C:\Tools\win-ghostty-blackhole
cd /d C:\Tools\win-ghostty-blackhole
```

Git 源码不跟踪 `ghostty-blackhole-src/`。如果不使用 `dist/` 归档包、但需要运行严格
公式校验或重新打包，再补齐上游参考源码：

```cmd
git clone https://github.com/s0xDk/ghostty-blackhole.git ghostty-blackhole-src
```

`ghostty-blackhole-src/` 只用于对比上游 shader 公式和生成复现包；日常运行
`bh demo`、`bh codex`、`bh claude` 不依赖该目录。

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
// settings.json 根节点
"experimental.rendering.forceFullRepaint": true,

// profiles.list 中的对象
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

运行 `bh demo`、`bh token`、`bh pomodoro`、`bh codex` 或 `bh claude` 后，脚本可能会把
`experimental.pixelShaderPath` 自动切到 `blackhole_winterminal*_live0/1.hlsl`。
这是正常行为，用于初次安装、手动 token/Claude 兼容更新，或强制 Windows Terminal
重新加载静态模式 shader。`bh codex` 的运行中目标变化只通过当前标签页顶部的单格
marker 传递，不再切换路径。

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
bh pomodoro
bh clock
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
- `BLACKHOLE_TOKEN_GLIDE_MIN_SEC` / `BLACKHOLE_TOKEN_GLIDE_MAX_SEC` /
  `BLACKHOLE_TOKEN_GLIDE_RATE`：仅用于手动 token/Claude 兼容链路的等级平滑过渡参数，
  默认 `0.3`、`1.5`、`10.0`，不影响 `bh codex`。
- `BLACKHOLE_TOKEN_GLIDE_INTERVAL_MS`：手动 token/Claude glider 刷新间隔，默认 `10`。
- `BLACKHOLE_WT_PROFILE`：Windows Terminal profile 名，默认 `Blackhole`。
- `BLACKHOLE_SHADER_PATH`：运行时 shader 路径。
- `BLACKHOLE_WT_SETTINGS`：Windows Terminal `settings.json` 路径。
- `BLACKHOLE_CLAUDE_DIR`：Claude 配置目录。
- `BLACKHOLE_CLAUDE_SETTINGS`：Claude `settings.json` 路径。
- `BLACKHOLE_POMODORO_TIME_SCALE`：番茄钟测试加速；默认 `1`，例如 `100` 可快速验证。
- `BLACKHOLE_POMODORO_WALL_OFFSET_SEC`：手动指定番茄钟当天秒数，通常不需要设置。
- `BLACKHOLE_DEMO_KEEPALIVE_MS`：demo 标签页隐藏重绘触发间隔，默认 `250`。
- `CODEX_BLACKHOLE_CODEX_BIN`：强制指定 Codex 可执行文件。
- `CODEX_BLACKHOLE_MIN_LEVEL`：Codex 初始显示地板，默认 `0.02`。
- `CODEX_BLACKHOLE_TOKEN_MAX`：Codex token 上限估算，默认 `25000000`。
- `CODEX_BLACKHOLE_INTERVAL_MS`：Codex 上下文采样间隔，默认 `500`。
- `CODEX_BLACKHOLE_REDRAW_MS`：Codex 过渡帧检查间隔，默认 `10`。
- `CODEX_BLACKHOLE_MARKER_MS`：Codex 稳态 marker 重写间隔，默认 `10`；用于抵抗
  TUI 重绘覆盖；beacon 发送数据后由 supervisor 按真实 TTY 行列定位到顶部安全区。
- `CODEX_BLACKHOLE_MOTION_XFADE_MS`：大小变化前闭环移动淡出时长，默认 `480` 毫秒。
- `CODEX_BLACKHOLE_MOTION_FADE_IN_MS`：大小变化完成后闭环移动恢复时长，默认
  `2400` 毫秒。
- `CODEX_BLACKHOLE_DISABLE_PTY_PROXY=1`：仅用于排障，禁用 `script(1)` PTY 代理并退回
  直接启动 Codex；该模式下滚动时 marker 可能再次被 TUI 覆盖。
- `CODEX_BLACKHOLE_SPRING_BOUNCE`：Codex 弹簧回弹强度，默认 `0.0`，即临界阻尼、
  无超调；设置大于 `0` 才会进入欠阻尼回弹。
- `CODEX_BLACKHOLE_SPRING_MIN_SEC` / `CODEX_BLACKHOLE_SPRING_MAX_SEC`：Codex 小跨度
  与大跨度目标变化的最短/最长收敛时间，默认 `1.6` / `6.0` 秒。
- `CODEX_BLACKHOLE_SPRING_RATE`：按目标差值计算收敛时间的倍率，默认 `8.0`。
- `CODEX_BLACKHOLE_SPRING_TIME_WARP`：弹簧时间重映射强度，默认 `5.0`。
- `CODEX_BLACKHOLE_SPRING_VECTOR_BLEND`：短尾矢量曲线混合比例，默认 `0.55`。
- `CODEX_BLACKHOLE_TRACE_FILE`：可选诊断轨迹文件；默认不写日志。
- `CODEX_BLACKHOLE_SHELL_SNAPSHOTS`：Codex `new` 空会话检测的 shell snapshot 目录。
- `CLAUDE_BLACKHOLE_MIN_LEVEL`：Claude 初始显示地板，默认 `0.02`。
- `CLAUDE_BLACKHOLE_SHOW_STATUSLINE=1`：显示 Claude 调试文本状态栏。

## 番茄钟/时钟模式边界

`bh pomodoro` / `bh clock` 在 Windows Terminal 中是视觉模式，不是完整计时器应用。

可复现：

- 55/5 周期按本地墙钟推进。
- 黑洞按工作段进度增长，并在休息窗口前收缩。
- `BLACKHOLE_POMODORO_TIME_SCALE=100` 可用于快速验证周期变化。

不可复现：

- Windows Terminal shader 不能直接读取真实系统时间，只能使用启动脚本写入的
  `POMODORO_WALL_OFFSET`。
- Windows Terminal shader 不能读取 Ghostty 的 `iTimeCursorChange`，因此不能按终端输入空闲淡出。
- shader 不能触发响铃、通知、弹窗或休息提醒。
- Windows Terminal profile 的 shader 路径是全局配置，不提供每个标签页完全独立的
  shader 参数状态。

## 归档包复现验证

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/codex-blackhole-supervisor.js
node blackhole-windows-terminal/codex-blackhole-supervisor.js --proxy-self-test
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
