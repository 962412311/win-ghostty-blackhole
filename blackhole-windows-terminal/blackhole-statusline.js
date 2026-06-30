'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ESC = '\x1b';
const DEFAULT_CODEX_STATE = path.join(os.homedir(), '.codex', 'state_5.sqlite');
const DEFAULT_CODEX_TOKEN_MAX = 25000000;

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function levelFromPercent(value) {
  const n = asNumber(value);
  if (n === null) return -1;
  return clamp(n > 1.0 ? n / 100.0 : n, 0.0, 1.0);
}

function levelFromUsage(used, limit) {
  const u = asNumber(used);
  const l = asNumber(limit);
  if (u === null || l === null || l <= 0) return -1;
  return clamp(u / l, 0.0, 1.0);
}

function safeJson(text) {
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readStdinIfPiped() {
  try {
    if (fs.fstatSync(0).isCharacterDevice()) return '';
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function basenameAny(input) {
  if (!input) return '';
  return String(input).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}

function encodeLevel(level) {
  const fill = clamp(Math.round(clamp(level, 0.0, 1.0) * 250), 0, 250);
  const hi = Math.floor(fill / 16);
  const lo = fill % 16;
  const chk = (hi ^ lo ^ 0x5) & 0xf;
  return {
    fill,
    r: 0xf0 + chk,
    g: 0xb0 + hi,
    b: lo,
  };
}

function ansiBlock(level) {
  const { r, g, b } = encodeLevel(level);
  return `${ESC}[48;2;${r};${g};${b}m          ${ESC}[0m`;
}

function bar(level, width) {
  const filled = clamp(Math.round(level * width), 0, width);
  return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}]`;
}

function extractCwd(input) {
  return input?.workspace?.current_dir ||
    input?.workspace?.cwd ||
    input?.cwd ||
    input?.current_dir ||
    '';
}

function extractModel(input, fallback) {
  const model = input?.model;
  if (typeof model === 'string') return model;
  return model?.display_name || model?.name || model?.id || fallback;
}

function extractLevelFromJson(input) {
  if (!input || typeof input !== 'object') return -1;

  const cw = input.context_window ||
    input.contextWindow ||
    input.status?.context_window ||
    input.status?.contextWindow;
  if (cw && typeof cw === 'object') {
    for (const key of ['used_percentage', 'used_percent', 'usage_percent', 'percentage', 'percent']) {
      const lvl = levelFromPercent(cw[key]);
      if (lvl >= 0.0) return lvl;
    }

    const used = cw.used_tokens ?? cw.tokens_used ?? cw.current_tokens ?? cw.input_tokens ?? cw.total_input_tokens;
    const limit = cw.max_tokens ?? cw.limit_tokens ?? cw.context_window_size ?? cw.context_window ?? cw.max_context_window;
    const lvl = levelFromUsage(used, limit);
    if (lvl >= 0.0) return lvl;
  }

  const info = input.payload?.info || input.info;
  if (info && typeof info === 'object') {
    const usage = info.last_token_usage || info.total_token_usage || {};
    const used = usage.input_tokens ?? usage.total_tokens;
    const limit = info.model_context_window || input.payload?.model_context_window || input.model_context_window;
    const lvl = levelFromUsage(used, limit);
    if (lvl >= 0.0) return lvl;
  }

  return -1;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqliteRows(sql) {
  const dbPath = process.env.CODEX_BLACKHOLE_STATE || DEFAULT_CODEX_STATE;
  if (!fs.existsSync(dbPath)) return [];
  try {
    const out = childProcess.execFileSync(
      'sqlite3',
      ['-readonly', '-json', dbPath, sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 },
    );
    return safeJson(out) || [];
  } catch {
    return [];
  }
}

function readTail(filePath, maxBytes) {
  let fd = null;
  try {
    const stat = fs.statSync(filePath);
    const len = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(len);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, len, stat.size - len);
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function rolloutLevel(rolloutPath) {
  if (!rolloutPath) return -1;
  const text = readTail(rolloutPath, 4 * 1024 * 1024);
  if (!text) return -1;

  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.includes('"token_count"')) continue;
    const event = safeJson(line);
    if (!event) continue;
    const lvl = extractLevelFromJson(event);
    if (lvl >= 0.0) return lvl;
  }
  return -1;
}

function latestThreadRowsForCwd(cwd) {
  const columns = 'rollout_path,cwd,tokens_used,model';
  if (cwd) {
    const rows = sqliteRows(
      `select ${columns} from threads ` +
      `where archived = 0 and lower(cwd) = lower(${sqlString(cwd)}) ` +
      'order by updated_at_ms desc, updated_at desc limit 1;',
    );
    if (rows.length > 0) return rows;
  }
  return sqliteRows(
    `select ${columns} from threads ` +
    'where archived = 0 order by updated_at_ms desc, updated_at desc limit 1;',
  );
}

function codexLevel(input) {
  const direct = extractLevelFromJson(input);
  if (direct >= 0.0) return direct;

  const cwd = extractCwd(input) || process.cwd();
  const rows = latestThreadRowsForCwd(cwd);
  for (const row of rows) {
    const fromRollout = rolloutLevel(row.rollout_path);
    if (fromRollout >= 0.0) return fromRollout;

    const max = asNumber(process.env.CODEX_BLACKHOLE_TOKEN_MAX) || DEFAULT_CODEX_TOKEN_MAX;
    const fallback = levelFromUsage(row.tokens_used, max);
    if (fallback >= 0.0) return fallback;
  }

  return 0.0;
}

function writeBeacon(level) {
  const seq = `${ESC}7${ESC}[999;1H${ansiBlock(level)}${ESC}8`;
  try {
    fs.writeFileSync('/dev/tty', seq);
    return;
  } catch {
    if (process.env.BLACKHOLE_DEBUG_STDOUT) process.stdout.write(seq);
  }
}

function claudeStatusline() {
  const input = safeJson(readStdinIfPiped()) || {};
  let level = extractLevelFromJson(input);
  if (level < 0.0) level = 0.0;

  const pct = Math.round(level * 100);
  const model = extractModel(input, 'Claude');
  const cwd = basenameAny(extractCwd(input));
  const suffix = cwd ? ` ${cwd}` : '';
  process.stdout.write(`${ansiBlock(level)} ${bar(level, 10)} ${pct}% ${model}${suffix}\n`);
}

function codexHook() {
  const input = safeJson(readStdinIfPiped()) || {};
  writeBeacon(codexLevel(input));
}

function codexBeacon() {
  const intervalMs = clamp(asNumber(process.env.CODEX_BLACKHOLE_INTERVAL_MS) || 1000, 250, 10000);
  const minLevel = clamp(asNumber(process.env.CODEX_BLACKHOLE_MIN_LEVEL) ?? 0.18, 0.0, 1.0);
  const paint = () => writeBeacon(Math.max(codexLevel({ cwd: process.cwd() }), minLevel));
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  paint();
  setInterval(paint, intervalMs);
}

const mode = process.argv[2] || 'claude-statusline';
if (mode === 'claude-statusline') {
  claudeStatusline();
} else if (mode === 'codex-hook') {
  codexHook();
} else if (mode === 'codex-beacon') {
  codexBeacon();
} else if (mode === 'encode-test') {
  const level = levelFromPercent(process.argv[3] ?? '0');
  process.stdout.write(`${ansiBlock(level >= 0.0 ? level : 0.0)}\n`);
} else {
  process.stderr.write(`unknown mode: ${mode}\n`);
  process.exit(2);
}
