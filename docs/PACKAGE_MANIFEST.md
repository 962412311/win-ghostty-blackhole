# 复现归档清单

文档日期：2026-07-15。

归档包目标：把当前可复用内容打包，便于另一台 Windows + WSL 电脑快速复现。

Git 仓库跟踪最新复现包：

- `dist/win-ghostty-blackhole-repro-2026-07-01.tar.gz`
- `dist/win-ghostty-blackhole-repro-2026-07-01.sha256`

## 归档包应包含

- `README.md`
- `AGENTS.md`
- `docs/`
  - `docs/demo.gif`
- `scripts/`
- `blackhole-windows-terminal/`
- `ghostty-blackhole-src/`
- `.gitignore`

`ghostty-blackhole-src/` 在 Git 仓库中被忽略，但复现归档包必须包含它，用于
离线运行 `blackhole-windows-terminal/verify-blackhole-port.js`。

## 归档包应排除

- `.git/`
- `dist/`
- `blackhole-windows-terminal/__pycache__/`
- `*.pyc`
- Windows Terminal 运行时生成的 `blackhole_winterminal*_live0/1.hlsl`
- Windows Terminal 运行时生成的 `blackhole-live-level.txt`
- Windows Terminal 运行时生成的 `blackhole-live-owner.json`
- Windows Terminal 运行时生成的 `blackhole-level-*.json` 和
  `blackhole-level-glider.lock`、`blackhole-level-command.txt`

## 生成命令

```bash
bash scripts/package-repro.sh
```

重新生成后需要把最新 `dist/win-ghostty-blackhole-repro-2026-07-01.*` 一并提交，
确保 GitHub 上的复现包和源码一致。

生成后检查：

```bash
ls -lh dist/
cd dist
sha256sum -c win-ghostty-blackhole-repro-2026-07-01.sha256
tar -tzf win-ghostty-blackhole-repro-2026-07-01.tar.gz | rg '(^\./\.git/|/\.git/|^\./dist/|__pycache__|\.pyc$|blackhole_winterminal.*_live[01]\.hlsl|blackhole-live-(level|owner)|blackhole-level-(target|current|glider|command))' || true
```

最后一条命令不应输出任何条目。

如果从 GitHub clone 的源码生成归档包，先补齐上游参考源码：

```bash
git clone https://github.com/s0xDk/ghostty-blackhole.git ghostty-blackhole-src
```
