'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ESC = '\x1b';
const DEFAULT_CODEX_STATE = path.join(os.homedir(), '.codex', 'state_5.sqlite');
const DEFAULT_CODEX_TOKEN_MAX = 25000000;
const DEFAULT_CLAUDE_TOKEN_MAX = 200000;
const DEFAULT_WINDOWS_USER = 'YOUR_USER';
const WT_PROFILE_NAME = process.env.BLACKHOLE_WT_PROFILE || 'Blackhole';

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

function levelFromUsageParts(parts, limit) {
  const total = parts.reduce((sum, value) => {
    const n = asNumber(value);
    return n === null ? sum : sum + n;
  }, 0);
  return levelFromUsage(total, limit);
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

function normalizeLocalPath(filePath) {
  if (!filePath) return '';
  const text = String(filePath);
  if (fs.existsSync(text)) return text;
  if (process.platform !== 'win32') {
    const match = text.match(/^([a-zA-Z]):[\\/](.*)$/);
    if (match) return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
  }
  return text;
}

function windowsUser() {
  if (process.env.BLACKHOLE_WINDOWS_USER) return process.env.BLACKHOLE_WINDOWS_USER;
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || `C:\\Users\\${DEFAULT_WINDOWS_USER}`;
    return path.basename(userProfile);
  }
  try {
    const user = childProcess.execFileSync(
      'cmd.exe',
      ['/d', '/c', 'echo %USERNAME%'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 },
    ).trim();
    if (user) return user;
  } catch {}
  return DEFAULT_WINDOWS_USER;
}

function defaultRuntimeShader() {
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || `C:\\Users\\${DEFAULT_WINDOWS_USER}`;
    return path.join(userProfile, 'terminal-shaders', 'blackhole_winterminal.hlsl');
  }
  return `/mnt/c/Users/${windowsUser()}/terminal-shaders/blackhole_winterminal.hlsl`;
}

function defaultWtSettingsPath() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
      || path.join(process.env.USERPROFILE || `C:\\Users\\${DEFAULT_WINDOWS_USER}`, 'AppData', 'Local');
    return path.join(
      localAppData,
      'Packages',
      'Microsoft.WindowsTerminal_8wekyb3d8bbwe',
      'LocalState',
      'settings.json',
    );
  }
  return `/mnt/c/Users/${windowsUser()}/AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`;
}

function toWindowsPath(filePath) {
  if (process.platform === 'win32') return filePath;
  const match = String(filePath).match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) return filePath;
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
}

function loadWtSettings() {
  const settingsPath = process.env.BLACKHOLE_WT_SETTINGS || defaultWtSettingsPath();
  if (!fs.existsSync(settingsPath)) return null;
  try {
    return {
      path: settingsPath,
      settings: JSON.parse(fs.readFileSync(settingsPath, 'utf8')),
    };
  } catch {
    return null;
  }
}

function findBlackholeProfile(settings) {
  const list = settings?.profiles?.list;
  if (!Array.isArray(list)) return null;
  return list.find((profile) => profile.name === WT_PROFILE_NAME) || null;
}

function canonicalShaderPath(filePath) {
  return String(filePath).replace(/_live[01](\.hlsl)$/i, '$1');
}

function liveShaderPath(basePath, slot) {
  return String(basePath).replace(/(\.hlsl)$/i, `_live${slot}$1`);
}

function shaderLevelText(level) {
  if (level < 0.0) return '-1';
  return (Math.round(clamp(level, 0.0, 1.0) * 100.0) / 100.0).toFixed(4);
}

function updateShaderLevel(level) {
  if (process.env.BLACKHOLE_DISABLE_SHADER_LEVEL === '1') return false;

  const baseShader = normalizeLocalPath(process.env.BLACKHOLE_SHADER_PATH || defaultRuntimeShader());
  const wt = loadWtSettings();
  const profile = wt ? findBlackholeProfile(wt.settings) : null;
  const profileShader = normalizeLocalPath(profile?.['experimental.pixelShaderPath'] || '');
  const currentShader = profileShader || baseShader;
  const basePath = canonicalShaderPath(currentShader || baseShader);
  if (!basePath) return false;

  const token = shaderLevelText(level);
  const statePath = path.join(path.dirname(basePath), 'blackhole-live-level.txt');
  const stateKey = `${token}|${basePath}`;
  try {
    if (fs.readFileSync(statePath, 'utf8').trim() === stateKey &&
        /_live[01]\.hlsl$/i.test(currentShader) &&
        fs.existsSync(currentShader)) {
      return false;
    }
  } catch {}

  const sourcePath = fs.existsSync(currentShader)
    ? currentShader
    : (fs.existsSync(basePath) ? basePath : baseShader);
  if (!fs.existsSync(sourcePath)) return false;

  let text;
  try {
    text = fs.readFileSync(sourcePath, 'utf8');
  } catch {
    return false;
  }

  const nextText = text.replace(/#define\s+TOKEN_LEVEL\s+-?\d+(?:\.\d+)?/, `#define TOKEN_LEVEL ${token}`);
  if (nextText === text && !text.includes(`#define TOKEN_LEVEL ${token}`)) return false;

  const slot = /_live0\.hlsl$/i.test(currentShader) ? 1 : 0;
  const targetPath = liveShaderPath(basePath, slot);
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tmpShader = `${targetPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpShader, nextText);
    fs.renameSync(tmpShader, targetPath);

    if (profile && wt) {
      const nextProfilePath = toWindowsPath(targetPath);
      if (profile['experimental.pixelShaderPath'] !== nextProfilePath) {
        profile['experimental.pixelShaderPath'] = nextProfilePath;
        const tmpSettings = `${wt.path}.tmp-${process.pid}`;
        fs.writeFileSync(tmpSettings, `${JSON.stringify(wt.settings, null, 4)}${os.EOL}`);
        fs.renameSync(tmpSettings, wt.path);
      }
    }
    fs.writeFileSync(statePath, `${stateKey}${os.EOL}`);
    return true;
  } catch {
    return false;
  }
}

function encodeLevel(level) {
  const fill = clamp(Math.round(clamp(level, 0.0, 1.0) * 250), 0, 250);
  const hi = Math.floor(fill / 16);
  const lo = fill % 16;
  const chk = (hi ^ lo ^ 0x5) & 0xf;
  return {
    fill,
    r: chk,
    g: hi,
    b: lo,
  };
}

function ansiBlock(level) {
  const { r, g, b } = encodeLevel(level);
  return `${ESC}[48;2;${r};${g};${b}m          ${ESC}[0m`;
}

function beaconSequence(level) {
  return `${ESC}7${ESC}[999;1H${ansiBlock(level)}${ESC}8`;
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

function extractClaudeUsageLevel(input) {
  const usage = input?.message?.usage || input?.usage;
  if (!usage || typeof usage !== 'object') return -1;

  const explicitTotal = usage.total_tokens ?? usage.totalTokens;
  const used = explicitTotal ?? [
    usage.input_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens,
    usage.output_tokens,
  ];
  const limit = input?.model_context_window ||
    input?.context_window?.max_tokens ||
    input?.context_window?.context_window_size ||
    process.env.CLAUDE_BLACKHOLE_TOKEN_MAX ||
    DEFAULT_CLAUDE_TOKEN_MAX;

  return Array.isArray(used)
    ? levelFromUsageParts(used, limit)
    : levelFromUsage(used, limit);
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

function threadStartClause() {
  const startedAtMs = asNumber(process.env.CODEX_BLACKHOLE_STARTED_AT_MS);
  if (startedAtMs === null) return '';
  const threshold = Math.max(0, Math.floor(startedAtMs - 5000));
  return ` and coalesce(created_at_ms, created_at * 1000) >= ${threshold} `;
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

function transcriptLevel(transcriptPath) {
  const localPath = normalizeLocalPath(transcriptPath);
  if (!localPath) return -1;
  const text = readTail(localPath, 4 * 1024 * 1024);
  if (!text) return -1;

  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.includes('"usage"')) continue;
    const event = safeJson(line);
    if (!event) continue;
    const lvl = extractClaudeUsageLevel(event);
    if (lvl >= 0.0) return lvl;
  }
  return -1;
}

function claudeLevel(input) {
  const direct = extractLevelFromJson(input);
  if (direct >= 0.0) return direct;

  const fromUsage = extractClaudeUsageLevel(input);
  if (fromUsage >= 0.0) return fromUsage;

  const fromTranscript = transcriptLevel(input?.transcript_path || input?.transcriptPath);
  if (fromTranscript >= 0.0) return fromTranscript;

  return 0.0;
}

function latestThreadRowsForCwd(cwd) {
  const columns = 'rollout_path,cwd,tokens_used,model';
  const startedAfter = threadStartClause();
  if (cwd) {
    const rows = sqliteRows(
      `select ${columns} from threads ` +
      `where archived = 0 and lower(cwd) = lower(${sqlString(cwd)}) ` +
      startedAfter +
      'order by updated_at_ms desc, updated_at desc limit 1;',
    );
    if (rows.length > 0) return rows;
  }
  return sqliteRows(
    `select ${columns} from threads ` +
    `where archived = 0 ${startedAfter} ` +
    'order by updated_at_ms desc, updated_at desc limit 1;',
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

function writeTerminal(seq) {
  const targets = process.platform === 'win32'
    ? ['\\\\.\\CONOUT$']
    : ['/dev/tty'];
  for (const target of targets) {
    try {
      fs.writeFileSync(target, seq);
      return true;
    } catch {}
  }
  if (process.env.BLACKHOLE_DEBUG_STDOUT) process.stdout.write(seq);
  return false;
}

function writeBeacon(level) {
  return writeTerminal(beaconSequence(level));
}

function clearBeacon() {
  return writeTerminal(`${ESC}7${ESC}[999;1H${ESC}[0m          ${ESC}8`);
}

function publishLevel(level) {
  writeBeacon(level);
  updateShaderLevel(level);
}

function hideLevel() {
  clearBeacon();
  updateShaderLevel(-1.0);
}

function claudeStatusline() {
  const input = safeJson(readStdinIfPiped()) || {};
  const event = input.hook_event_name || input.hookEventName;
  if (event === 'SessionEnd') {
    hideLevel();
    return;
  }
  if (event === 'SessionStart') {
    publishLevel(0.0);
    return;
  }

  let level = claudeLevel(input);
  if (level < 0.0) level = 0.0;
  level = Math.round(level * 100.0) / 100.0;
  const minLevel = clamp(asNumber(process.env.CLAUDE_BLACKHOLE_MIN_LEVEL) ?? 0.0, 0.0, 1.0);
  const outputLevel = Math.max(level, minLevel);
  publishLevel(outputLevel);

  if (process.env.CLAUDE_BLACKHOLE_SHOW_STATUSLINE !== '1') {
    process.stdout.write(`${ansiBlock(outputLevel)}\n`);
    return;
  }

  const pct = Math.round(level * 100);
  const model = extractModel(input, 'Claude');
  const cwd = basenameAny(extractCwd(input));
  const suffix = cwd ? ` ${cwd}` : '';
  process.stdout.write(`${bar(level, 10)} ${pct}% ${model}${suffix}\n`);
}

function codexHook() {
  const input = safeJson(readStdinIfPiped()) || {};
  publishLevel(codexLevel(input));
}

function codexBeacon() {
  const intervalMs = clamp(asNumber(process.env.CODEX_BLACKHOLE_INTERVAL_MS) || 1000, 250, 10000);
  const minLevel = clamp(asNumber(process.env.CODEX_BLACKHOLE_MIN_LEVEL) ?? 0.0, 0.0, 1.0);
  const paint = () => publishLevel(Math.max(codexLevel({ cwd: process.cwd() }), minLevel));
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
} else if (mode === 'beacon-test') {
  const level = levelFromPercent(process.argv[3] ?? '0');
  process.stdout.write(beaconSequence(level >= 0.0 ? level : 0.0));
} else if (mode === 'level-test') {
  const level = levelFromPercent(process.argv[3] ?? '0');
  publishLevel(level >= 0.0 ? level : 0.0);
} else {
  process.stderr.write(`unknown mode: ${mode}\n`);
  process.exit(2);
}
