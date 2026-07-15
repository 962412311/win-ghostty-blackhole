# bh codex token 模式闭环实施计划

> **历史计划：** 本文记录第一阶段闭环实施过程。当前实现已由
> [全形态联动与慢速弹簧设计](../specs/2026-07-15-bh-codex-all-shapes-slow-spring-design.md)
> 替代；本文中的 `480` 秒周期和 `smootherstep` 状态机已经失效。保留正文仅用于追溯，
> 不得继续执行其中的任务或工具指令。

**目标：** 让 `bh codex` 的 token 黑洞使用严格闭环且跨 shader 重载连续的移动轨迹，并消除多 `level-glider`、重复 rollout 读取和高频 NTFS 写入。

**架构：** HLSL 使用 480 秒墙钟主相位和整数圈闭环路径；大范围路径为 1/4 圈，
微幅移动为 15/19 圈。`codex-beacon` 自己维护等级过渡状态，500ms 采样上下文、
10ms 检查中间等级，并写入当前标签页顶部安全区的单格近黑 marker；稳态每 50ms
重写同一格，不重载 shader、不触碰底部输入行。通用 glider 只服务 `bh token` 和 Claude。

**技术栈：** Windows Terminal HLSL、Node.js、Windows Terminal `settings.json`、WSL、Codex rollout JSONL、项目静态 verifier。

## 全局约束

- 只优先改变 `bh codex` 的运行链路；`bh token` 手动入口和 Claude 接入保持可用。
- 黑洞测地线、透镜和吸积盘主体公式继续与 `ghostty-blackhole-src/blackhole.glsl` 对齐。
- 保留手动 token/Claude 的 `blackhole-live-owner.json` owner 校验；Codex 顶部 marker
  按标签页独立，不参与共享 owner 互斥，也不终止其他 Codex beacon。
- token 大小、形态、活动范围和路径混合必须共用同一个平滑等级 `g`。
- Windows Terminal 视觉结果由用户在真实窗口中确认，不使用截图替代验收。
- 所有用户文档使用中文；代码、shader 或文档变化后运行 `bash scripts/package-repro.sh`。
- 当前工作区已有未提交改动；不自动提交或推送，等待用户明确授权。

---

### 任务 1：建立闭环和 Codex 单控制器回归检查

**文件：**
- 修改：`blackhole-windows-terminal/verify-blackhole-port.js`
- 测试：`blackhole-windows-terminal/verify-blackhole-port.js`

**接口：**
- 输入：当前 HLSL、statusline、bh-mode 和 supervisor 源文本。
- 输出：`TOKEN_LOOP_SEC`、整数圈数、相位偏移、Codex 无 glider 依赖和 glider 预占的静态/数值约束。

- [x] **步骤 1：把 Windows 本地轨迹参数改成新契约**

将 local tuning 更新为：

```js
['TOKEN_AREA_MIN', '0.0030'],
['TOKEN_LOOP_SEC', '480.0000'],
['TOKEN_CALM_TURNS', '1.0000'],
['TOKEN_RUSH_TURNS', '4.0000'],
['DEMO_LEVEL_FLOOR', '0.0350'],
['DEMO_XFADE', '0.7200'],
```

把 `TOKEN_MOTION_TIME_OFFSET` 加入 HLSL-only 常量，删除 packet-only 常量。

- [x] **步骤 2：增加轨迹数值闭环检查**

在 verifier 中用与 HLSL 相同的整数谐波公式实现 `tokenLoopWander()` 和导数，遍历
`g = [0, 0.25, 0.5, 0.75, 1]`，比较主周期首尾：

```js
const TOKEN_LOOP_EPSILON = 1e-6;
const TOKEN_VELOCITY_EPSILON = 1e-5;
```

位置误差超过 `1e-6` 或速度误差超过 `1e-5` 时调用 `fail()`。

- [x] **步骤 3：增加运行时结构约束**

新增锚点并检查：

```js
codexBeaconBody.includes('publishLevel(') === false
codexBeaconBody.includes('ensureLevelGlider(') === false
statusline.includes('DEFAULT_CODEX_REDRAW_INTERVAL_MS = 16')
statusline.includes('reserveLevelGlider(')
statusline.includes('TOKEN_PACKET_') === false
hlsl.includes('TOKEN_PACKET_') === false
```

- [x] **步骤 4：运行 verifier，确认先失败**

运行：

```bash
node blackhole-windows-terminal/verify-blackhole-port.js
```

预期：失败，至少报告缺少 `TOKEN_LOOP_SEC`、`TOKEN_MOTION_TIME_OFFSET` 或 Codex
beacon 仍调用 `publishLevel()`。

---

### 任务 2：实现 HLSL 闭环轨迹与跨重载相位

**文件：**
- 修改：`blackhole-windows-terminal/blackhole_winterminal.hlsl`
- 修改：`blackhole-windows-terminal/bh-mode.js`
- 测试：`blackhole-windows-terminal/verify-blackhole-port.js`

**接口：**
- 输入：`Time`、平滑等级 `g`、宿主写入的 `TOKEN_MOTION_TIME_OFFSET`。
- 输出：`tokenLoopPhase()`、`tokenLoopWander(float)` 和跨 live0/live1 连续的 token center。

- [x] **步骤 1：新增 token 主周期和相位 define**

HLSL 新增：

```hlsl
#define TOKEN_MOTION_TIME_OFFSET 0.0000
static const float TOKEN_LOOP_SEC = 480.0000;
static const float TOKEN_CALM_TURNS = 1.0000;
static const float TOKEN_RUSH_TURNS = 4.0000;
```

删除 `TOKEN_CALM`、`TOKEN_RUSH` 和三个 `TOKEN_PACKET_*` 常量。

- [x] **步骤 2：用整数谐波实现闭环函数**

实现：

```hlsl
float tokenLoopPhase()
{
    float seconds = fmod(TOKEN_MOTION_TIME_OFFSET + Time, TOKEN_LOOP_SEC);
    return seconds / TOKEN_LOOP_SEC * 6.2831853;
}

float2 tokenLoopWander(float a)
{
    return float2(0.75 * sin(a) + 0.25 * sin(2.0 * a + 1.0),
                  0.70 * sin(a + 2.1) + 0.30 * sin(3.0 * a));
}
```

token 分支分别计算 calm/rush wander 和圆形 wobble，再按 `g` 混合；demo 分支保持
现有 `demoLoopWander()`、`demoPhase()` 和回落冻结行为。

- [x] **步骤 3：删除 HLSL 多格 packet 解码**

删除 `screenTokenByteAt()`、`packetU16()`、`tokenPacketLevelAt()` 和
`tokenPacketLevel()`；`tokenLevel()` 只保留顶部/底部单格兼容采样。

- [x] **步骤 4：在 bh-mode 安装时写入墙钟周期偏移**

新增纯函数：

```js
function tokenMotionTimeOffset(nowMs = Date.now()) {
  const seconds = nowMs / 1000.0;
  return ((seconds % 480.0) + 480.0) % 480.0;
}
```

`renderShader()` 在 token 模式下替换 `TOKEN_MOTION_TIME_OFFSET`；其他模式不改。

- [x] **步骤 5：运行语法和 verifier，确认 HLSL 部分通过**

运行：

```bash
node --check blackhole-windows-terminal/bh-mode.js
node blackhole-windows-terminal/verify-blackhole-port.js
```

预期：Node 语法检查通过；verifier 不再报告闭环/HLSL 锚点，但仍可因 Codex runtime
尚未重构而失败。

---

### 任务 3：将 bh codex 改为单进程等级控制器

**文件：**
- 修改：`blackhole-windows-terminal/blackhole-statusline.js`
- 修改：`blackhole-windows-terminal/blackhole_winterminal.hlsl`
- 测试：`blackhole-windows-terminal/verify-blackhole-port.js`

**接口：**
- 输入：`codexLevel()`、supervisor PID、现有 glide duration 参数。
- 输出：量化 target、连续 `from`、进程内 smootherstep 过渡、逐标签页顶部单格等级。

- [x] **步骤 1：修正 shader 本地时间和运动相位写入**

`updateShaderLevel()` 固定生成：

```js
const startToken = '0.0000';
const motionToken = shaderFloatText(tokenMotionTimeOffset());
```

写入 `TOKEN_MOTION_TIME_OFFSET`，并扩展 define 匹配检查。删除 WMIC 时间解析和
`windowsTerminalElapsedSeconds()`。

- [x] **步骤 2：删除未使用 packet 运行时代码**

删除 packet 常量、`packetU16()`、`tokenPacketBlocks()`、`packetBeaconSequence()`、
`writePacketBeacon()` 以及 glider/watch/demo 中未被输出的 `packet` 状态。

- [x] **步骤 3：关闭 glider 启动竞态**

在 `ensureLevelGlider()` 中先独占创建 `blackhole-level-glider.lock`，持锁后再次检查
现有 PID。确认无可复用进程后再 spawn，并调用：

```js
reserveLevelGlider(basePath, child.pid, owner);
```

状态 JSON 使用真实 child PID、base path 和 owner；后续发布者看到 lock 或存活 PID 时
直接复用，不再启动第二个 glider。

- [x] **步骤 4：缓存 rollout 尾部并跳过无意义 SQLite 查询**

`rolloutLevel()` 按 `path + size + mtimeMs` 缓存解析结果。PID 绑定路径先直接调用
`rolloutLevel(rolloutPath)`；只有返回负值时才执行 `threadRowsForRollout()`。

- [x] **步骤 5：实现 Codex 进程内过渡状态机**

增加默认值：

```js
const DEFAULT_CODEX_SAMPLE_INTERVAL_MS = 500;
const DEFAULT_CODEX_GLIDE_FRAME_MS = 10;
const DEFAULT_CODEX_MARKER_REFRESH_MS = 50;
```

`codexBeacon()` 保存 `from/target/startMs/durationMs`。采样定时器只在量化 target
变化时更新状态；过渡定时器用 `smootherstep01()` 求当前值，并调用：

```js
writeCodexMarker(current);
```

只有近黑编码值变化或 50ms 稳态刷新到期时才输出。marker 根据终端 `columns/rows`
动态定位到 `TOKEN_DATA_UV_TOP`，HLSL 固定只采样一次。Codex 路径不调用
`updateShaderLevel()`、`writeBeacon()`、`publishLevel()`、`writeLevelTarget()` 或
`ensureLevelGlider()`。

- [x] **步骤 6：运行 runtime 静态验证**

运行：

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node --check blackhole-windows-terminal/codex-blackhole-supervisor.js
node blackhole-windows-terminal/verify-blackhole-port.js
```

预期：全部退出码为 0，verifier 输出闭环数值检查和全部锚点通过。

- [x] **步骤 7：处理独立代码审查问题**

Codex marker 固定只做一次纹理采样，runtime fallback 和旧多探针链路按优先级惰性执行；
`level-watch` 改为只读 current 状态并在 owner 变化后退出；glider 使用独占 lock；
Codex 不再写底部色格；Windows `WSLENV` 补齐采样、过渡和 marker 刷新参数。

---

### 任务 4：同步中文文档和 Agent 维护边界

**文件：**
- 修改：`README.md`
- 修改：`AGENTS.md`
- 修改：`blackhole-windows-terminal/README.md`
- 修改：`docs/ARCHITECTURE.md`
- 修改：`docs/RUNBOOK.md`
- 修改：`docs/INSTALL_REPRODUCE.md`
- 修改：`docs/HANDOFF.md`

**接口：**
- 输入：最终实现中的常量、环境变量和进程模型。
- 输出：新电脑安装、调参、排障和后续 Agent 可复用的准确说明。

- [x] **步骤 1：更新用户入口和调参说明**

将旧 `TOKEN_CALM/TOKEN_RUSH` 说明替换为：

```text
TOKEN_LOOP_SEC：主闭环周期，默认 480 秒。
TOKEN_CALM_TURNS：低上下文在主周期内的重复圈数，默认 1。
TOKEN_RUSH_TURNS：高上下文在主周期内的重复圈数，默认 4。
```

记录 `CODEX_BLACKHOLE_INTERVAL_MS` 默认 500ms、`CODEX_BLACKHOLE_REDRAW_MS`
默认 10ms，以及 `CODEX_BLACKHOLE_MARKER_MS` 默认 50ms；三者分别控制上下文采样、
过渡检查和稳态 marker 刷新。

- [x] **步骤 2：更新架构和运行手册**

明确 `bh codex` 使用进程内 target 状态机和 shader fallback；`level-glider` 只服务
`bh token`/Claude。删除多格 packet、全局 WindowsTerminal 启动时间和 Codex 持续写
current JSON 的描述。

- [x] **步骤 3：更新安装、交接与 Agent 红线**

补充闭环轨迹、墙钟相位偏移、单 Codex controller、glider 预占和对应排障命令；保留
owner、demo keepalive、pomodoro 边界和真实窗口肉眼验收规则。

- [x] **步骤 4：运行文档一致性扫描**

运行：

```bash
rg -n "TOKEN_CALM|TOKEN_RUSH|1000ms|100ms|WindowsTerminalElapsed|多格|packet" README.md AGENTS.md blackhole-windows-terminal/README.md docs/*.md
rg -n "今天|昨天|刚刚|最近|上周|today|yesterday|recently" README.md AGENTS.md blackhole-windows-terminal/README.md docs/*.md
```

预期：第一条只允许出现在明确说明“旧实现已删除”的迁移文字中；第二条无相对时间输出。

---

### 任务 5：完整验证、复现归档和真实窗口验收

**文件：**
- 修改：`dist/win-ghostty-blackhole-repro-2026-07-01.tar.gz`
- 修改：`dist/win-ghostty-blackhole-repro-2026-07-01.sha256`

**接口：**
- 输入：完成后的源码、脚本和文档。
- 输出：可复现归档、机器验证结果和用户视觉验收入口。

- [x] **步骤 1：运行项目完整静态验证**

运行：

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/codex-blackhole-supervisor.js
bash -n blackhole-windows-terminal/bh
bash -n blackhole-windows-terminal/claude-blackhole-statusline.sh
node blackhole-windows-terminal/verify-blackhole-port.js
git diff --check
```

预期：所有命令退出码为 0。

- [x] **步骤 2：验证启动参数而不打开窗口**

运行：

```bash
BLACKHOLE_DRY_RUN=1 node blackhole-windows-terminal/bh-mode.js open-codex
```

预期：输出 `wt.exe`、`Blackhole` profile、WSL distro、`__run_codex`，无错误和
PowerShell 路径。

- [x] **步骤 3：重新生成并校验复现包**

运行：

```bash
bash scripts/package-repro.sh
cd dist && sha256sum -c win-ghostty-blackhole-repro-2026-07-01.sha256
```

预期：打包成功，sha256 输出 `OK`。

- [x] **步骤 4：检查最终差异边界**

运行：

```bash
git status --short --untracked-files=all
git diff --stat
git diff --check
```

预期：只包含当前工作区原有变更和本计划涉及的 shader、runtime、verifier、文档、
规格、计划及 dist 归档；无空白错误。

- [ ] **步骤 5：请求真实 Windows Terminal 验收**

让用户在已有环境执行 `bh codex`，确认：首次启动不黑屏/冻结、移动连续、上下文变化
平滑、`resume`/`new` 正确、关闭不影响旧标签页。未得到用户确认前，不宣称视觉问题已
完全解决。
