# 复现归档清单

文档日期：2026-07-01。

归档包目标：把当前可复用内容打包，便于另一台 Windows + WSL 电脑快速复现。

## 归档包应包含

- `README.md`
- `AGENTS.md`
- `docs/`
- `scripts/`
- `blackhole-windows-terminal/`
- `ghostty-blackhole-src/`
- `.gitignore`

## 归档包应排除

- `.git/`
- `dist/`
- `blackhole-windows-terminal/__pycache__/`
- `*.pyc`
- Windows Terminal 运行时生成的 `blackhole_winterminal_live0/1.hlsl`
- Windows Terminal 运行时生成的 `blackhole-live-level.txt`

## 生成命令

```bash
bash scripts/package-repro.sh
```

生成后检查：

```bash
ls -lh dist/
cd dist
sha256sum -c win-ghostty-blackhole-repro-2026-07-01.sha256
tar -tzf win-ghostty-blackhole-repro-2026-07-01.tar.gz | rg '(^\./\.git/|/\.git/|^\./dist/|__pycache__|\.pyc$)' || true
```

最后一条命令不应输出任何条目。
