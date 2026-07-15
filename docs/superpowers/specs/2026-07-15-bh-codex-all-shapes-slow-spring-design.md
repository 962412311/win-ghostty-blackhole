# bh codex 全形态联动与慢速弹簧设计

日期：2026-07-15

## 目标

在不改变 `bh codex` 顶部单格 marker 架构的前提下，解决两个已确认的视觉问题：

- 当前 `demoTour(1)` 到 `demoTour(0)` 的关键几何参数差异较小，大小变化明显时，
  形态变化仍不易观察；
- 当前大跨度弹簧约 3 秒稳定，用户确认需要整体放慢到原来的二分之一速度。

本次只调整 Codex token 模式。`bh demo`、手动 `bh token`、Claude、番茄钟、中心移动
周期和吸积盘内部动画速度保持不变。

## 根因

当前源码和 Windows 已部署的 token live shader 均正确执行：

```hlsl
L = tokenLook(g);
rhT = lerp(rhMin, rhMax, g) * (HOLE_RADIUS / 0.08);
```

因此形态和大小的数据链路没有断开。实际问题是 `tokenLook(g)` 只在
`demoTour(1)` Gargantua 与 `demoTour(0)` Inferno 之间插值。两个预设虽然有 14 个字段
参与计算，但倾角、内外盘半径等关键轮廓参数接近，视觉上容易被尺寸变化掩盖。

## 全形态映射

### 可见形态集合

上游 `demoTour()` 有 8 个索引，其中 `demoTour(7)` 与 `demoTour(0)` 参数完全相同，
用于演示周期闭环。因此实际共有 7 种独立可见形态。

token 上下文等级按以下顺序遍历全部独立形态：

```text
demoTour(1) -> demoTour(2) -> demoTour(3) -> demoTour(4)
            -> demoTour(5) -> demoTour(6) -> demoTour(0/7)
```

这样保留当前端点语义：

- `g = 0`：Gargantua，即 `demoTour(1)`；
- `g = 1`：Inferno，即 `demoTour(0)`，同时等价于闭环项 `demoTour(7)`；
- 中间等级覆盖其余全部上游可见形态，包括吸积盘消失、星空增强的特殊形态。

### 连续插值

增加只服务 token 模式的 `tokenTour(i)` 索引映射。`tokenLook(g)` 将 `g` 线性映射到
6 个相邻区间，每个区间继续使用现有 `mixLook()` 对全部 14 个 `DiskLook` 字段插值：

```hlsl
float u = clamp(g, 0.0, 1.0) * 6.0;
int i = int(min(u, 5.999));
float f = u - float(i);
return mixLook(tokenTour(i), tokenTour(i + 1), f);
```

形态映射不读取 `Time`，也不增加独立 easing。大小、强度、形态、活动范围和 calm/rush
路径混合继续读取同一个弹簧等级 `g`。形态参数在区间边界保持数值连续；不同字段允许按
上游预设呈现非单调变化，这是遍历全部原版形态的预期结果。

默认弹簧采用临界阻尼，`g` 单调逼近目标，不反向、不超调；形态沿同一个 `g` 连续
变化，不允许形态单独跳到另一个时间相位。

## 最终平滑曲线

Codex 专用弹簧默认参数整体放慢 2 倍：

```text
CODEX_BLACKHOLE_SPRING_BOUNCE  = 0.0   （临界阻尼，0 回弹）
CODEX_BLACKHOLE_SPRING_MIN_SEC = 1.6   （原 0.8）
CODEX_BLACKHOLE_SPRING_MAX_SEC = 6.0   （原 3.0）
CODEX_BLACKHOLE_SPRING_RATE    = 8.0   （原 4.0）
```

稳定时间仍按以下公式计算：

```text
clamp(abs(target - position) * 8.0, 1.6, 6.0)
```

解析式临界阻尼仍使用 `epsilon=0.001`，并与短尾矢量曲线混合。默认
`CODEX_BLACKHOLE_SPRING_TIME_WARP=5.0`、
`CODEX_BLACKHOLE_SPRING_VECTOR_BLEND=0.55`，提高前段加速感并缩短接近目标时的拖尾；
混合曲线保持单调、0 回弹、无超调。retarget 继续继承位置和速度。

手动 `bh token` 和 Claude 使用的 `BLACKHOLE_TOKEN_GLIDE_*` 参数保持原值。

## 数据通道与兼容边界

- `codex-beacon` 仍每 500ms 采样上下文；过渡与稳态都每 10ms 向 supervisor 发送
  marker 数据。稳态沿用 8-bit 等级、5-bit 移动权重和旧校验；大小阶段使用 11-bit
  等级、固定 magic 和反向校验，兼容已经运行的旧 beacon。
- 上下文目标变化时先用 480ms smootherstep 淡出闭环移动，再执行大小/形态弹簧；
  弹簧结束后才用 2400ms 淡入移动。
- supervisor 通过 `script(1)` PTY 串行转发 Codex 输出；控制序列完整时允许 marker
  刷新进入同步帧，在 `CSI ?2026l` 提交前写入，并在安全输出块后补写。写格使用不推进
  光标的 `ECH`。
- 不重载 shader，不启动 Codex `level-glider`，不触碰底部输入行。
- `TOKEN_LOOP_SEC=240`、整数 turns、`DRIFT_SPEED` 和 demo 时间保持不变。
- 所有 `demoTour()` 参数继续使用上游原值，不新增或放大形态参数。
- 已存在的 `CODEX_BLACKHOLE_SPRING_*` 环境变量仍可覆盖新默认值。

## 验证

自动验证必须覆盖：

1. Codex 默认弹簧参数为 `0.0 / 1.6 / 6.0 / 8.0`。
2. 大跨度 6 秒结束前的位置和速度误差小于高精度 marker 的 `1/2047` 分辨率。
3. 临界阻尼样本单调逼近目标，不反向、不超调。
4. 高速向上、向下 retarget 到近目标时仍继承 position 和 velocity，所有采样值均位于
   起点和目标之间；目标重合但速度非零时不会立即停止。
5. `tokenTour()` 顺序严格为 `1, 2, 3, 4, 5, 6, 0`。
6. `g = 0, 1/6, 2/6, ..., 1` 分别命中上述原版形态，区间两侧数值连续。
7. `tokenLook()` 不读取 `Time`，全部 14 个字段仍通过 `mixLook()` 插值。
8. 新旧 marker 的等级/移动权重编解码、三段互斥状态锚点和同步帧内安全刷新通过。
9. Node/bash 语法、公式 verifier、DXC、`git diff --check` 和复现包校验通过。

真实 Windows Terminal 由用户确认：

- 上下文变化时可清楚看到完整形态序列随大小共同变化；
- 大跨度变化约 6 秒稳定，速度明显为上一版的一半；
- 形态没有跳变、独立快进或与大小脱节；
- 过渡无回弹、无末帧吸附，输入、滚动、缩放和关闭行为正常。
