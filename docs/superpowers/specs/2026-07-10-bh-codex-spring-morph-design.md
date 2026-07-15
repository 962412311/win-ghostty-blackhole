# bh codex 强回弹与形态联动设计

> **历史设计：** 本文记录早期 `bounce=0.5` 强回弹方案，仅用于追溯，不得作为当前
> 实施依据。当前契约见
> [全形态联动与慢速弹簧设计](2026-07-15-bh-codex-all-shapes-slow-spring-design.md)：
> 默认 `bounce=0.0`，采用 0 回弹、无超调的临界阻尼。

日期：2026-07-10

## 目标

在不破坏当前顶部单格 marker 通道的前提下，优化 `bh codex` 的上下文等级过渡：

- 大小变化使用强烈但可控的果冻回弹；
- 大幅等级变化约 3 秒稳定，小变化也保持平滑；
- 黑洞全部形态参数与可见大小使用同一个连续等级；
- 过渡中收到新目标时保持位置和速度连续；
- 黑洞中心闭环位移速度提高到当前的 2 倍；
- 吸积盘旋转和内部形态动画速度不变。

## 现状与根因

`codex-beacon` 当前使用 `smootherstep` 在 `from` 和 `target` 之间插值，最大过渡时间
只有 1.5 秒。曲线没有超调，目标中途改变时只继承当前位置、不继承速度，因此大幅变化
仍偏快，也缺少果冻回弹的惯性。

HLSL 虽然调用 `tokenLook(g)`，但当前函数只小范围改变温度、倾角、roll 和对比度，
其余 10 个 `DiskLook` 参数固定。尺寸变化明显时，形态差异仍很弱，视觉上接近只缩放。

中心位移的所有 token 相位都来自 `TOKEN_LOOP_SEC = 480` 秒。吸积盘内部动画使用
`Time * DRIFT_SPEED`，与该闭环相位相互独立。

## Apple Spring 语义

设计参考 Apple 公开的 SwiftUI `Spring` 和 `Animation.spring` 语义：

- 用持续时间和 bounce 表达弹簧观感；
- `bounce = 0` 表示临界阻尼，正值表示更强回弹；
- 新弹簧替换旧弹簧时保留当前速度；
- `settlingDuration` 表示系统进入给定误差范围的时间。

参考：

- <https://developer.apple.com/documentation/swiftui/spring/>
- <https://developer.apple.com/documentation/swiftui/animation/spring%28duration%3Abounce%3Ablendduration%3A%29>

本项目复刻上述公开物理语义，不声称复制 Apple 未公开的内部预设实现。

## 弹簧模型

### 参数

- `bounce = 0.5`：强回弹。
- `dampingRatio = 1 - bounce = 0.5`。
- `epsilon = 0.001`：稳定误差阈值，小于 marker 的 `1/250` 编码步长。
- 大跳变稳定时间：`3.0s`。
- 小跳变稳定时间下限：`0.8s`。
- 距离倍率：`4.0s / level`，最终稳定时间为
  `clamp(abs(target - position) * 4.0, 0.8, 3.0)`。

Codex 使用独立环境变量，避免改变手动 `bh token` 和 Claude 的兼容 glider：

- `CODEX_BLACKHOLE_SPRING_BOUNCE`，默认 `0.5`；
- `CODEX_BLACKHOLE_SPRING_MIN_SEC`，默认 `0.8`；
- `CODEX_BLACKHOLE_SPRING_MAX_SEC`，默认 `3.0`；
- `CODEX_BLACKHOLE_SPRING_RATE`，默认 `4.0`。

Windows `bh.cmd` 必须通过 `WSLENV` 透传这些变量。

参数读取沿用现有 `envNumber()`：`bounce` 限制为 `0..0.95`，时长限制为
`0.1..30.0s`，并保证 `min <= max`，rate 限制为 `0..60`。目标差小于 `0.0005`
时不重建弹簧；任何非有限计算结果立即回落到目标值并清零速度，避免 marker 输出 NaN。

### 解析式

对目标值 `target`，令初始位移 `x0 = position - target`、初始速度为 `v0`：

```text
zeta   = 1 - bounce
omega0 = -ln(epsilon) / (zeta * settlingDuration)
omegaD = omega0 * sqrt(1 - zeta^2)
B       = (v0 + zeta * omega0 * x0) / omegaD

x(t) = exp(-zeta * omega0 * t)
       * (x0 * cos(omegaD * t) + B * sin(omegaD * t))

level(t) = target + x(t)
```

速度使用上述表达式的解析导数计算。达到稳定时间后精确落到 `target` 并把速度置零；
此时理论残差低于 marker 的量化分辨率，因此不会产生可见末帧跳变。

### 目标中途改变

收到新目标时先用旧弹簧计算当前 `position` 和 `velocity`，再以这两个值初始化新弹簧。
不得把速度重置为零，也不得从旧 `from` 重新开始。这样连续消息、`resume` 和 `new`
不会形成折点或停顿。

物理值允许暂时超出 `0..1`；写 marker 时继续由现有编码器限制到协议范围。弹簧内部
仍按未裁剪状态演算，边界回弹不会改变最终上下文目标。

## 形态与大小统一

HLSL 只保留一个可见等级 `g`：

- `g` 驱动阴影半径、面积、强度和活动范围；
- `tokenLook(g)` 使用同一个 `g`，不再叠加另一条时间曲线；
- 路径 calm/rush 混合继续使用同一个 `g`。

`tokenLook()` 改为在上游已有的两个稳定预设之间对全部 14 个 `DiskLook` 参数线性插值：

- `g = 0`：Gargantua，即 `demoTour(1)`；
- `g = 1`：Inferno，即 `demoTour(0)`；
- 中间值：`mixLook(demoTour(1), demoTour(0), clamp(g, 0, 1))`。

不按时间遍历 demo 预设，不使用离散区间，也不额外调用 `smoothstep`。因此形态与大小
严格由同一个弹簧等级决定，变化速度相同，不会在预设边界快速跳变。

## 中心移动提速

将 token 模式的 `TOKEN_LOOP_SEC` 从 `480` 秒改为 `240` 秒，`TOKEN_CALM_TURNS`、
`TOKEN_RUSH_TURNS` 和 `TOKEN_WOBBLE_X/Y_TURNS` 保持整数不变。结果是中心大范围 wander
和微幅 wobble 同时提速 2 倍，且 240 秒周期首尾的位置和一阶速度仍闭合。

`demoPhase()`、`demoAnimTime()`、`DRIFT_SPEED` 和吸积盘内部 `Time` 不变，因此 demo、
吸积盘旋转、噪声流动和内部形态动画速度不受影响。

## 数据通道边界

- 继续使用一个顶部安全区近黑 marker；不增加字符格。
- 过渡计算仍按 `CODEX_BLACKHOLE_REDRAW_MS` 默认 10ms 执行。
- 稳态 marker 仍按 `CODEX_BLACKHOLE_MARKER_MS` 默认 50ms 刷新。
- 不重载 shader，不启动 Codex `level-glider`，不触碰底部输入行。
- 手动 `bh token` 和 Claude 的 glider 行为不在本次修改范围内。

## 验证

自动验证必须覆盖：

1. `bounce = 0.5` 对应阻尼比 `0.5`。
2. 零初速度大跳变首次超调约 16%，证明强回弹存在。
3. 3 秒时位置误差小于 marker 的 `1/250`，归一化速度绝对值小于
   `1/250 level/s`。
4. 中途切换目标前后的 position 和 velocity 连续。
5. `tokenLook(g)` 对全部 `DiskLook` 字段使用同一个 `g`，且只在 Gargantua 和
   Inferno 之间连续插值。
6. `TOKEN_LOOP_SEC = 240`，五个固定等级的周期首尾位置误差不超过 `1e-6`、速度误差
   不超过 `1e-5`。
7. Node/bash 语法检查、公式 verifier、DXC 编译、`git diff --check` 和复现包校验通过。

真实 Windows Terminal 由用户确认：

- 大小和形态在大跳变时共同缓慢变化；
- 有明显强回弹，但没有卡顿、瞬移或形态快速跳变；
- 连续目标更新时运动方向和速度不断裂；
- 中心位移约为当前速度的 2 倍，吸积盘内部动画速度未改变；
- 输入、窗口缩放和滚动行为保持正常。
