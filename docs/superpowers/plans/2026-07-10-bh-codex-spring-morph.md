# bh codex 强回弹与形态联动实施计划

> **历史计划：** 本文已完成并被 2026-07-15 当前规格替代，仅供追溯，不得继续执行
> 本文任务或工具指令。当前默认值为 `bounce=0.0 / min=1.6 / max=6.0 / rate=8.0`，
> 采用阻尼弹簧与短尾矢量混合曲线、11-bit 过渡等级和 2400ms 移动恢复。

> 当前实施依据见
> [全形态联动与慢速弹簧设计](../specs/2026-07-15-bh-codex-all-shapes-slow-spring-design.md)。

**历史目标：** 为 `bh codex` 增加 3 秒强回弹、速度连续的物理弹簧，使大小与全部形态参数严格联动，并把 token 中心闭环移动速度提高到 2 倍。

**历史架构：** `codex-beacon` 在现有顶部单格 marker 前维护解析式阻尼弹簧，目标改变时继承当前位置和速度；HLSL 只消费 marker 中的同一个等级，并在 Gargantua 与 Inferno 两个上游预设之间连续混合全部 `DiskLook` 字段。中心移动仍使用整数圈闭环，但周期从 480 秒缩短为 240 秒；demo 和吸积盘内部时间不变。

**技术栈：** Node.js、Windows Terminal HLSL、Windows `cmd`/WSL、项目静态 verifier、DirectX Shader Compiler。

## 历史约束

- `bounce = 0.5`，对应阻尼比 `0.5`。
- 大跳变稳定时间 `3.0s`，小跳变稳定时间下限 `0.8s`，距离倍率 `4.0s / level`。
- 稳定误差 `epsilon = 0.001`，目标差小于 `0.0005` 时不重建弹簧。
- 新目标到达时必须继承解析出的 position 和 velocity。
- 大小、`tokenLook`、活动范围和 calm/rush 路径混合必须使用同一个等级 `g`。
- `tokenLook(g)` 只在上游 `demoTour(1)` Gargantua 与 `demoTour(0)` Inferno 之间连续插值。
- `TOKEN_LOOP_SEC = 240.0000`；整数 turns 不变，demo 和 `DRIFT_SPEED` 不变。
- 继续使用一个顶部 marker、10ms 过渡计算和 50ms 稳态刷新；不增加字符格、不重载 shader、不启动 Codex glider。
- 手动 `bh token` 和 Claude glider 不改。
- 所有面向用户的文档保持中文。
- 当前工作区已有未提交修改；本计划不执行 `git commit` 或 `git push`。

---

### Task 1: 建立弹簧、形态和 240 秒闭环回归契约

**Files:**
- Modify: `blackhole-windows-terminal/verify-blackhole-port.js`
- Test: `blackhole-windows-terminal/verify-blackhole-port.js`

**Interfaces:**
- Consumes: 当前 HLSL、statusline、`bh-mode.js` 和 `bh.cmd` 源文本。
- Produces: `codex-spring-sample-test` 数值协议、弹簧常量锚点、统一形态锚点和 240 秒闭环约束。

- [x] **Step 1: 把本地闭环周期预期改为 240 秒**

在 `LOCAL_TUNING_CONSTANTS` 中替换：

```js
['TOKEN_LOOP_SEC', '240.0000'],
```

保留 `TOKEN_CALM_TURNS = 1`、`TOKEN_RUSH_TURNS = 4`、
`TOKEN_WOBBLE_X_TURNS = 15`、`TOKEN_WOBBLE_Y_TURNS = 19`，继续对五个等级执行周期首尾
位置和速度数值检查。

- [x] **Step 2: 增加运行时弹簧契约**

在 `STATUSLINE_ANCHORS` 中加入：

```js
['codex spring bounce default', 'DEFAULT_CODEX_SPRING_BOUNCE = 0.5'],
['codex spring min default', 'DEFAULT_CODEX_SPRING_MIN_SEC = 0.8'],
['codex spring max default', 'DEFAULT_CODEX_SPRING_MAX_SEC = 3.0'],
['codex spring rate default', 'DEFAULT_CODEX_SPRING_RATE = 4.0'],
['codex spring epsilon', 'DEFAULT_CODEX_SPRING_EPSILON = 0.001'],
['codex spring evaluator', 'function codexSpringStateAt(state, nowMs = Date.now())'],
['codex spring initial velocity', 'initialVelocity: sample.velocity'],
['codex spring test command', "mode === 'codex-spring-sample-test'"],
```

提取 `codexBeacon()` 后确认其中不再出现 `currentGlideLevel(` 或
`smootherstep01(`，但必须出现 `codexSpringStateAt(`。

- [x] **Step 3: 增加弹簧数值样本检查**

新增 helper，通过 CLI 调用实际 statusline 实现：

```js
function codexSpringSample(from, target, velocity, settlingSec, timeSec, bounce = 0.5) {
  const output = childProcess.execFileSync(
    process.execPath,
    [STATUSLINE, 'codex-spring-sample-test', String(from), String(target),
      String(velocity), String(settlingSec), String(timeSec), String(bounce)],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(output);
}
```

验证以下条件：

```js
const zeta = 0.5;
const epsilon = 0.001;
const omega0 = -Math.log(epsilon) / (zeta * 3.0);
const peakTime = Math.PI / (omega0 * Math.sqrt(1.0 - zeta * zeta));
const peak = codexSpringSample(0.0, 1.0, 0.0, 3.0, peakTime);
if (Math.abs(peak.position - 1.1630335348) > 1e-3) fail('strong spring overshoot mismatch');

const nearSettle = codexSpringSample(0.0, 1.0, 0.0, 3.0, 2.999);
if (Math.abs(nearSettle.position - 1.0) >= 1.0 / 250.0) fail('spring position did not settle');
if (Math.abs(nearSettle.velocity) >= 1.0 / 250.0) fail('spring velocity did not settle');

const oldState = codexSpringSample(0.02, 0.95, 0.0, 3.0, 0.7);
const retargetStart = codexSpringSample(oldState.position, 0.20, oldState.velocity, 3.0, 0.0);
if (Math.abs(retargetStart.position - oldState.position) > 1e-9 ||
    Math.abs(retargetStart.velocity - oldState.velocity) > 1e-9) {
  fail('spring retarget must preserve position and velocity');
}

const movingAtTarget = codexSpringSample(0.5, 0.5, 1.0, 0.8, 0.0);
const movingAtTargetNearSettle = codexSpringSample(0.5, 0.5, 1.0, 0.8, 0.799);
// 位置重合但速度非零时仍执行最短弹簧阶段，并在结束前平滑耗散速度。
```

- [x] **Step 4: 增加形态统一约束**

提取 `tokenLook()` 函数体并检查：

```js
const tokenLookBody = hlsl.match(/DiskLook tokenLook\(float lvl\)[\s\S]*?\n\}/)?.[0] || '';
if (!tokenLookBody.includes('mixLook(demoTour(1), demoTour(0), f)')) {
  fail('tokenLook must morph all DiskLook fields from Gargantua to Inferno');
}
if (tokenLookBody.includes('smoothstep(')) {
  fail('tokenLook must not add a second easing curve');
}
```

继续保留 `L = tokenLook(g);`、尺寸 `lerp(rhMin, rhMax, g)` 和路径
`lerp(calmWander, rushWander, g)` 三个锚点，证明三类视觉共用 `g`。

- [x] **Step 5: 增加宿主周期与 Windows 参数透传约束**

为 statusline、`bh-mode.js` 和 `bh.cmd` 增加锚点：

```js
['statusline 240 second token loop', 'const TOKEN_LOOP_SEC = 240.0'],
['bh-mode 240 second token loop', 'const TOKEN_LOOP_SEC = 240.0'],
['windows launcher forwards spring bounce', 'CODEX_BLACKHOLE_SPRING_BOUNCE/u'],
['windows launcher forwards spring min', 'CODEX_BLACKHOLE_SPRING_MIN_SEC/u'],
['windows launcher forwards spring max', 'CODEX_BLACKHOLE_SPRING_MAX_SEC/u'],
['windows launcher forwards spring rate', 'CODEX_BLACKHOLE_SPRING_RATE/u'],
```

- [x] **Step 6: 运行 verifier 并确认新契约先失败**

Run:

```bash
node blackhole-windows-terminal/verify-blackhole-port.js
```

Expected: exit code `1`，至少报告 `TOKEN_LOOP_SEC` 仍为 `480.0000`、缺少
`codex-spring-sample-test`、缺少弹簧常量或 `tokenLook` 尚未使用两个完整预设。

---

### Task 2: 实现 Codex 解析式强回弹和速度继承

**Files:**
- Modify: `blackhole-windows-terminal/blackhole-statusline.js`
- Modify: `blackhole-windows-terminal/bh.cmd`
- Test: `blackhole-windows-terminal/verify-blackhole-port.js`

**Interfaces:**
- Consumes: `codexLevel()` 目标等级、10ms render timer、顶部 marker writer。
- Produces: `codexSpringOptions()`、`codexSpringDurationSec()`、
  `codexSpringStateAt()` 和 `codex-spring-sample-test`。

- [x] **Step 1: 增加 Codex 专用弹簧默认值**

在 statusline 顶部加入：

```js
const DEFAULT_CODEX_SPRING_BOUNCE = 0.5;
const DEFAULT_CODEX_SPRING_MIN_SEC = 0.8;
const DEFAULT_CODEX_SPRING_MAX_SEC = 3.0;
const DEFAULT_CODEX_SPRING_RATE = 4.0;
const DEFAULT_CODEX_SPRING_EPSILON = 0.001;
```

保留通用 `DEFAULT_TOKEN_GLIDE_*`，它们继续服务手动 token 和 Claude。

- [x] **Step 2: 实现参数读取和距离时长**

加入：

```js
function codexSpringOptions() {
  const bounce = clamp(
    envNumber('CODEX_BLACKHOLE_SPRING_BOUNCE', DEFAULT_CODEX_SPRING_BOUNCE),
    0.0,
    0.95,
  );
  const minSec = clamp(
    envNumber('CODEX_BLACKHOLE_SPRING_MIN_SEC', DEFAULT_CODEX_SPRING_MIN_SEC),
    0.1,
    30.0,
  );
  const maxSec = clamp(
    envNumber('CODEX_BLACKHOLE_SPRING_MAX_SEC', DEFAULT_CODEX_SPRING_MAX_SEC),
    minSec,
    30.0,
  );
  const rate = clamp(
    envNumber('CODEX_BLACKHOLE_SPRING_RATE', DEFAULT_CODEX_SPRING_RATE),
    0.0,
    60.0,
  );
  return { bounce, minSec, maxSec, rate, epsilon: DEFAULT_CODEX_SPRING_EPSILON };
}

function codexSpringDurationSec(from, to, options) {
  return clamp(Math.abs(to - from) * options.rate, options.minSec, options.maxSec);
}
```

- [x] **Step 3: 实现解析式位置和速度**

加入 `codexSpringStateAt(state, nowMs = Date.now())`。`state` 的字段固定为：

```js
{
  from: number,
  target: number,
  initialVelocity: number,
  startMs: number,
  settlingMs: number,
  bounce: number,
  epsilon: number,
}
```

欠阻尼分支使用设计规格中的解析式；临界阻尼 `bounce === 0` 使用：

```js
const x0 = state.from - state.target;
const b = state.initialVelocity + omega0 * x0;
const decay = Math.exp(-omega0 * elapsedSec);
const displacement = decay * (x0 + b * elapsedSec);
const velocity = decay * (state.initialVelocity - omega0 * b * elapsedSec);
```

欠阻尼速度导数必须直接计算：

```js
const wave = x0 * cos + b * sin;
const waveVelocity = -x0 * omegaD * sin + b * omegaD * cos;
const displacement = decay * wave;
const velocity = decay * (waveVelocity - dampingRatio * omega0 * wave);
```

`elapsedMs >= settlingMs` 时返回目标和零速度。任何 position/velocity 非有限时也返回：

```js
{ position: state.target, velocity: 0.0, settled: true }
```

- [x] **Step 4: 将 codexBeacon 状态机改为弹簧**

初始化：

```js
const springOptions = codexSpringOptions();
const state = {
  from: minLevel,
  target: minLevel,
  initialVelocity: 0.0,
  startMs: Date.now(),
  settlingMs: 0,
  bounce: springOptions.bounce,
  epsilon: springOptions.epsilon,
};
```

`renderTransition()` 每帧调用 `codexSpringStateAt()`；settled 后把 state 收敛到 target。
`applyTarget()` 先采样旧弹簧，再写入：

```js
const sample = codexSpringStateAt(state, now);
state.from = sample.position;
state.target = next;
state.initialVelocity = sample.velocity;
state.startMs = now;
const atRest = Math.abs(next - sample.position) <= 0.0005 &&
  Math.abs(sample.velocity) <= springOptions.epsilon;
state.settlingMs = atRest
  ? 0
  : Math.round(codexSpringDurationSec(sample.position, next, springOptions) * 1000.0);
```

marker 编码继续使用 `encodeCodexMarkerLevel(current)`，由现有编码器限制到 `0..1`。
不要修改 10ms render timer、50ms refresh deadline 或单格序列。

- [x] **Step 5: 增加数值测试 CLI**

增加 mode：

```js
} else if (mode === 'codex-spring-sample-test') {
  const from = asNumber(process.argv[3]) ?? 0.0;
  const target = asNumber(process.argv[4]) ?? 1.0;
  const initialVelocity = asNumber(process.argv[5]) ?? 0.0;
  const settlingSec = Math.max(asNumber(process.argv[6]) ?? 3.0, 0.0);
  const timeSec = Math.max(asNumber(process.argv[7]) ?? 0.0, 0.0);
  const bounce = clamp(asNumber(process.argv[8]) ?? DEFAULT_CODEX_SPRING_BOUNCE, 0.0, 0.95);
  const sample = codexSpringStateAt({
    from,
    target,
    initialVelocity,
    startMs: 0,
    settlingMs: settlingSec * 1000.0,
    bounce,
    epsilon: DEFAULT_CODEX_SPRING_EPSILON,
  }, timeSec * 1000.0);
  process.stdout.write(`${JSON.stringify(sample)}\n`);
```

- [x] **Step 6: 透传 Windows 环境变量**

在 `bh.cmd` 的 `BH_WSLENV` 中加入：

```text
CODEX_BLACKHOLE_SPRING_BOUNCE/u
CODEX_BLACKHOLE_SPRING_MIN_SEC/u
CODEX_BLACKHOLE_SPRING_MAX_SEC/u
CODEX_BLACKHOLE_SPRING_RATE/u
```

- [x] **Step 7: 运行 JS 和 verifier**

Run:

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node blackhole-windows-terminal/verify-blackhole-port.js
```

Expected: Node 语法通过；弹簧数值样本和 runtime 锚点通过，verifier 仍只因 HLSL
周期或 `tokenLook()` 旧实现失败。

---

### Task 3: 让完整形态跟随等级并把中心位移提速 2 倍

**Files:**
- Modify: `blackhole-windows-terminal/blackhole_winterminal.hlsl`
- Modify: `blackhole-windows-terminal/blackhole-statusline.js`
- Modify: `blackhole-windows-terminal/bh-mode.js`
- Test: `blackhole-windows-terminal/verify-blackhole-port.js`

**Interfaces:**
- Consumes: marker 解码出的单一 `g`、墙钟相位偏移。
- Produces: 240 秒 token 相位和完整 Gargantua-to-Inferno `DiskLook` 插值。

- [x] **Step 1: 把三处 token 周期改为 240 秒**

修改：

```hlsl
static const float TOKEN_LOOP_SEC = 240.0000;
```

以及两个宿主常量：

```js
const TOKEN_LOOP_SEC = 240.0;
```

不要改变 `TOKEN_CALM_TURNS`、`TOKEN_RUSH_TURNS`、`TOKEN_WOBBLE_X_TURNS`、
`TOKEN_WOBBLE_Y_TURNS` 或 `DRIFT_SPEED`。

- [x] **Step 2: 用完整预设替换 tokenLook**

替换函数为：

```hlsl
DiskLook tokenLook(float lvl)
{
    float f = clamp(lvl, 0.0, 1.0);
    return mixLook(demoTour(1), demoTour(0), f);
}
```

保持主函数中的 `L = tokenLook(g);`。尺寸、活动范围、wander 和 wobble 继续读取同一个
`g`，不得增加按 `Time` 变化的 token 形态参数。

- [x] **Step 3: 运行 verifier 和 HLSL 编译**

Run:

```bash
node blackhole-windows-terminal/verify-blackhole-port.js
cmd.exe /d /c "dxc.exe -T ps_6_0 -E main I:\\qtworkdata\\mytools\\my_ghostty_blackhole\\blackhole-windows-terminal\\blackhole_winterminal.hlsl -Fo NUL"
```

Expected: verifier exit `0`，DXC exit `0`。闭环输出仍包含五个 token-loop 数值样本，
弹簧输出包含首次约 16% 超调、3 秒收敛和 retarget 连续检查。

---

### Task 4: 同步中文文档、部署 shader 并重建复现包

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `blackhole-windows-terminal/README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/RUNBOOK.md`
- Modify: `docs/INSTALL_REPRODUCE.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/superpowers/specs/2026-07-10-bh-codex-token-closed-loop-design.md`
- Modify: `docs/superpowers/plans/2026-07-10-bh-codex-token-closed-loop.md`
- Modify: `dist/win-ghostty-blackhole-repro-2026-07-01.tar.gz`
- Modify: `dist/win-ghostty-blackhole-repro-2026-07-01.sha256`

**Interfaces:**
- Consumes: 最终弹簧参数、240 秒周期、形态映射和环境变量。
- Produces: 新电脑可直接复现的中文说明与离线归档。

- [x] **Step 1: 更新用户和维护文档**

所有当前状态说明统一写明：

```text
Codex 强回弹：bounce 0.5；大跳变约 3.0 秒稳定；小跳变至少 0.8 秒。
目标中途变化：继承当前 position 和 velocity。
形态映射：Gargantua 到 Inferno 的全部 14 个 DiskLook 参数与大小共用 g。
中心闭环周期：240 秒，较旧 480 秒速度提高 2 倍；内部动画速度不变。
```

在 RUNBOOK 和 INSTALL 中列出四个 `CODEX_BLACKHOLE_SPRING_*` 环境变量。旧闭环规格和
计划顶部增加“当前周期已由强回弹规格更新为 240 秒”的明确链接，避免历史参数被误用。

- [x] **Step 2: 更新 verifier 基线文本**

先运行 verifier，复制其完整 `OK:` 输出到 `docs/HANDOFF.md`，不得手工猜测 anchor 数量。

- [x] **Step 3: 部署到当前 Windows Terminal profile**

Run:

```bash
node blackhole-windows-terminal/bh-mode.js prepare-codex
```

Expected: 输出 `C:\Users\ChenZiLiang\terminal-shaders\blackhole_winterminal.hlsl`。
随后确认活动 `blackhole_winterminal_token_live0/1.hlsl` 包含：

```text
TOKEN_LOOP_SEC = 240.0000
mixLook(demoTour(1), demoTour(0), f)
```

- [x] **Step 4: 重建并校验复现包**

Run:

```bash
bash scripts/package-repro.sh
cd dist
sha256sum -c win-ghostty-blackhole-repro-2026-07-01.sha256
```

Expected: checksum 输出 `OK`。归档内的 statusline 必须包含
`DEFAULT_CODEX_SPRING_BOUNCE = 0.5`，HLSL 必须包含 `TOKEN_LOOP_SEC = 240.0000`。

---

### Task 5: 完整机器验证和真实窗口验收

**Files:**
- Verify only: 当前工作区、Windows runtime shader、复现包。

**Interfaces:**
- Consumes: Tasks 1-4 的最终产物。
- Produces: 可复核的机器证据和用户真实窗口结论。

- [x] **Step 1: 运行完整静态和编译验证**

Run:

```bash
node --check blackhole-windows-terminal/blackhole-statusline.js
node --check blackhole-windows-terminal/bh-mode.js
node --check blackhole-windows-terminal/codex-blackhole-supervisor.js
node --check blackhole-windows-terminal/verify-blackhole-port.js
bash -n blackhole-windows-terminal/bh
bash -n blackhole-windows-terminal/claude-blackhole-statusline.sh
node blackhole-windows-terminal/verify-blackhole-port.js
cmd.exe /d /c "dxc.exe -T ps_6_0 -E main I:\\qtworkdata\\mytools\\my_ghostty_blackhole\\blackhole-windows-terminal\\blackhole_winterminal.hlsl -Fo NUL"
BLACKHOLE_DRY_RUN=1 node blackhole-windows-terminal/bh-mode.js open-codex
cmd.exe /d /c "I:\\qtworkdata\\mytools\\my_ghostty_blackhole\\blackhole-windows-terminal\\bh.cmd help"
git diff --check
```

Expected: 全部 exit `0`；dry-run 仍使用 Windows Terminal、`cmd.exe`/WSL Ubuntu，
不出现 PowerShell 启动链路。

- [x] **Step 2: 检查归档和差异边界**

Run:

```bash
cd dist && sha256sum -c win-ghostty-blackhole-repro-2026-07-01.sha256
git status --short --untracked-files=all
git diff --stat
git diff --check
```

Expected: 归档校验通过；差异只包含当前会话已有修改及本计划涉及的 runtime、shader、
verifier、文档、规格、计划和 dist 文件。

- [ ] **Step 3: 请求用户在真实窗口验收**

用户新开一次 `bh codex`，依次确认：

1. 新会话最小黑洞正常移动，中心速度约为上一版 2 倍。
2. `resume` 到高上下文时，大小和形态共同缓慢变化，约 3 秒稳定。
3. 回弹强烈可见，但没有停顿、突变或形态快速跳变。
4. 过渡中继续发送消息时，动画方向和速度连续。
5. 吸积盘内部动画速度与上一版一致。
6. 输入、滚动、缩放和关闭仍正常。

未获得用户确认前，不宣称视觉验收完成。
