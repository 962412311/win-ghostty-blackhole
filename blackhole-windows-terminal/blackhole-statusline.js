'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ESC = '\x1b';
const DEFAULT_CODEX_STATE = path.join(os.homedir(), '.codex', 'state_5.sqlite');
const DEFAULT_CODEX_SHELL_SNAPSHOTS = path.join(os.homedir(), '.codex', 'shell_snapshots');
const DEFAULT_CODEX_TOKEN_MAX = 25000000;
const DEFAULT_CLAUDE_TOKEN_MAX = 200000;
const DEFAULT_WINDOWS_USER = 'YOUR_USER';
const DEFAULT_TOKEN_GLIDE_MIN_SEC = 0.3;
const DEFAULT_TOKEN_GLIDE_MAX_SEC = 1.5;
const DEFAULT_TOKEN_GLIDE_RATE = 10.0;
const DEFAULT_TOKEN_GLIDE_INTERVAL_MS = 10;
const DEFAULT_TOKEN_GLIDE_IDLE_MS = 10000;
const DEFAULT_VISIBLE_TOKEN_MIN = 0.02;
const DEFAULT_CODEX_SAMPLE_INTERVAL_MS = 500;
const DEFAULT_CODEX_GLIDE_FRAME_MS = 10;
const DEFAULT_CODEX_MARKER_REFRESH_MS = 10;
const DEFAULT_CODEX_MOTION_XFADE_MS = 480;
const DEFAULT_CODEX_MOTION_FADE_IN_MS = 2400;
const DEFAULT_CODEX_SPRING_BOUNCE = 0.0;
const DEFAULT_CODEX_SPRING_MIN_SEC = 1.6;
const DEFAULT_CODEX_SPRING_MAX_SEC = 6.0;
const DEFAULT_CODEX_SPRING_RATE = 8.0;
const DEFAULT_CODEX_SPRING_TIME_WARP = 5.0;
const DEFAULT_CODEX_SPRING_VECTOR_BLEND = 0.55;
const CODEX_VECTOR_EASE_IN_POWER = 1.30;
const CODEX_VECTOR_EASE_OUT_POWER = 1.01;
const DEFAULT_CODEX_SPRING_EPSILON = 0.001;
const CODEX_MARKER_UV_X = 0.0060;
const CODEX_MARKER_UV_Y = 0.0180;
const TOKEN_LOOP_SEC = 240.0;
const WT_PROFILE_NAME = process.env.BLACKHOLE_WT_PROFILE || 'Blackhole';
const rolloutLevelCache = new Map();

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

function readJsonFile(filePath) {
  try {
    return safeJson(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}${os.EOL}`);
  fs.renameSync(tmp, filePath);
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

function portablePathKey(filePath) {
  const text = String(filePath || '').trim();
  const wsl = text.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (wsl) return `${wsl[1].toLowerCase()}:/${wsl[2]}`.replace(/\\/g, '/').toLowerCase();
  return text.replace(/\\/g, '/').toLowerCase();
}

function sameRuntimePath(a, b) {
  return portablePathKey(a) === portablePathKey(b);
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

function liveOwnerPath(basePath) {
  return path.join(path.dirname(basePath), 'blackhole-live-owner.json');
}

function levelTargetPath(basePath) {
  return path.join(path.dirname(basePath), 'blackhole-level-target.json');
}

function levelGliderPath(basePath) {
  return path.join(path.dirname(basePath), 'blackhole-level-glider.json');
}

function levelGliderLockPath(basePath) {
  return path.join(path.dirname(basePath), 'blackhole-level-glider.lock');
}

function levelCurrentPath(basePath) {
  return path.join(path.dirname(basePath), 'blackhole-level-current.json');
}

function runtimeBaseShaderPath() {
  return canonicalShaderPath(normalizeLocalPath(process.env.BLACKHOLE_SHADER_PATH || defaultRuntimeShader()));
}

function readLiveOwner(basePath) {
  try {
    const text = fs.readFileSync(liveOwnerPath(basePath), 'utf8').trim();
    if (!text) return '';
    const parsed = safeJson(text);
    return parsed?.id || text;
  } catch {
    return '';
  }
}

function hasLiveOwnerAccess(basePath, options = {}) {
  if (options.bypassOwner || process.env.BLACKHOLE_BYPASS_OWNER === '1') return true;
  const currentOwner = readLiveOwner(basePath);
  if (!currentOwner) return true;
  const processOwner = process.env.BLACKHOLE_LIVE_OWNER || '';
  return processOwner !== '' && processOwner === currentOwner;
}

function claimLiveOwner(label) {
  const basePath = runtimeBaseShaderPath();
  const id = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const owner = {
    id,
    label: label || 'blackhole',
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(basePath), { recursive: true });
  fs.writeFileSync(liveOwnerPath(basePath), `${JSON.stringify(owner, null, 2)}${os.EOL}`);
  return id;
}

function shaderLevelText(level) {
  if (level < 0.0) return '-1';
  return (Math.round(clamp(level, 0.0, 1.0) * 100.0) / 100.0).toFixed(4);
}

function shaderFloatText(value) {
  return Number(value).toFixed(4);
}

function tokenMotionTimeOffset(nowMs = Date.now()) {
  const seconds = nowMs / 1000.0;
  return ((seconds % TOKEN_LOOP_SEC) + TOKEN_LOOP_SEC) % TOKEN_LOOP_SEC;
}

function updateShaderLevel(level, options = {}) {
  if (process.env.BLACKHOLE_DISABLE_SHADER_LEVEL === '1') return false;

  const baseShader = normalizeLocalPath(process.env.BLACKHOLE_SHADER_PATH || defaultRuntimeShader());
  const wt = loadWtSettings();
  const profile = wt ? findBlackholeProfile(wt.settings) : null;
  const profileShader = normalizeLocalPath(profile?.['experimental.pixelShaderPath'] || '');
  const currentShader = profileShader || baseShader;
  const basePath = canonicalShaderPath(currentShader || baseShader);
  if (!basePath) return false;
  if (!hasLiveOwnerAccess(basePath, options)) return false;

  const token = shaderLevelText(level);
  const fromToken = options.transitionFrom === undefined
    ? '-1'
    : shaderLevelText(options.transitionFrom);
  const targetToken = options.transitionDurationSec === undefined
    ? '-1'
    : token;
  const startToken = '0.0000';
  const durationToken = shaderFloatText(options.transitionDurationSec || 0.0);
  const motionToken = shaderFloatText(tokenMotionTimeOffset());
  const statePath = path.join(path.dirname(basePath), 'blackhole-live-level.txt');
  const stateKey = `${token}|${fromToken}|${targetToken}|${durationToken}|${basePath}`;
  try {
    if (fs.readFileSync(statePath, 'utf8').trim() === stateKey &&
        /_live[01]\.hlsl$/i.test(currentShader) &&
        shaderLevelDefinesMatch(currentShader, token, fromToken, targetToken, startToken, durationToken, null)) {
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

  let nextText = text
    .replace(/#define\s+TOKEN_LEVEL\s+-?\d+(?:\.\d+)?/, `#define TOKEN_LEVEL ${token}`)
    .replace(/#define\s+TOKEN_LEVEL_FROM\s+-?\d+(?:\.\d+)?/, `#define TOKEN_LEVEL_FROM ${fromToken}`)
    .replace(/#define\s+TOKEN_LEVEL_TARGET\s+-?\d+(?:\.\d+)?/, `#define TOKEN_LEVEL_TARGET ${targetToken}`)
    .replace(/#define\s+TOKEN_GLIDE_START\s+-?\d+(?:\.\d+)?/, `#define TOKEN_GLIDE_START ${startToken}`)
    .replace(/#define\s+TOKEN_GLIDE_DURATION\s+-?\d+(?:\.\d+)?/, `#define TOKEN_GLIDE_DURATION ${durationToken}`)
    .replace(/#define\s+TOKEN_MOTION_TIME_OFFSET\s+[-+]?\d+(?:\.\d+)?/,
      `#define TOKEN_MOTION_TIME_OFFSET ${motionToken}`);
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

function shaderLevelDefinesMatch(filePath, token, fromToken, targetToken, startToken, durationToken, motionToken) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.includes(`#define TOKEN_LEVEL ${token}`) &&
      text.includes(`#define TOKEN_LEVEL_FROM ${fromToken}`) &&
      text.includes(`#define TOKEN_LEVEL_TARGET ${targetToken}`) &&
      text.includes(`#define TOKEN_GLIDE_START ${startToken}`) &&
      text.includes(`#define TOKEN_GLIDE_DURATION ${durationToken}`) &&
      (motionToken === null || text.includes(`#define TOKEN_MOTION_TIME_OFFSET ${motionToken}`));
  } catch {
    return false;
  }
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function smootherstep01(x) {
  const t = clamp(x, 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

function shortTailVectorEase(x) {
  const t = clamp(x, 0.0, 1.0);
  if (t <= 0.0) return { value: 0.0, derivative: 0.0 };
  if (t >= 1.0) return { value: 1.0, derivative: 0.0 };
  const left = Math.pow(t, CODEX_VECTOR_EASE_IN_POWER);
  const right = Math.pow(1.0 - t, CODEX_VECTOR_EASE_OUT_POWER);
  const leftDerivative = CODEX_VECTOR_EASE_IN_POWER * Math.pow(t, CODEX_VECTOR_EASE_IN_POWER - 1.0);
  const rightDerivative = -CODEX_VECTOR_EASE_OUT_POWER *
    Math.pow(1.0 - t, CODEX_VECTOR_EASE_OUT_POWER - 1.0);
  const denominator = left + right;
  return {
    value: left / denominator,
    derivative: (leftDerivative * right - left * rightDerivative) / (denominator * denominator),
  };
}

function glideDurationMs(from, to, options = {}) {
  const minSec = clamp(
    asNumber(options.minSec) ?? envNumber('BLACKHOLE_TOKEN_GLIDE_MIN_SEC', DEFAULT_TOKEN_GLIDE_MIN_SEC),
    0.0,
    30.0,
  );
  const maxSec = clamp(
    asNumber(options.maxSec) ?? envNumber('BLACKHOLE_TOKEN_GLIDE_MAX_SEC', DEFAULT_TOKEN_GLIDE_MAX_SEC),
    minSec,
    30.0,
  );
  const rate = clamp(
    asNumber(options.rate) ?? envNumber('BLACKHOLE_TOKEN_GLIDE_RATE', DEFAULT_TOKEN_GLIDE_RATE),
    0.0,
    60.0,
  );
  return Math.round(clamp(Math.abs(to - from) * rate, minSec, maxSec) * 1000.0);
}

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
  const timeWarp = clamp(
    envNumber('CODEX_BLACKHOLE_SPRING_TIME_WARP', DEFAULT_CODEX_SPRING_TIME_WARP),
    1.0,
    6.0,
  );
  const vectorBlend = clamp(
    envNumber('CODEX_BLACKHOLE_SPRING_VECTOR_BLEND', DEFAULT_CODEX_SPRING_VECTOR_BLEND),
    0.0,
    0.8,
  );
  return { bounce, minSec, maxSec, rate, timeWarp, vectorBlend, epsilon: DEFAULT_CODEX_SPRING_EPSILON };
}

function codexSpringDurationSec(from, to, options) {
  return clamp(Math.abs(to - from) * options.rate, options.minSec, options.maxSec);
}

function criticalSpringOmega(settlingSec, epsilon) {
  const duration = Math.max(settlingSec, 1e-6);
  let lo = 0.0;
  let hi = 64.0;
  for (let i = 0; i < 32; i += 1) {
    const y = (lo + hi) * 0.5;
    const decay = Math.exp(-y);
    const positionError = (1.0 + y) * decay;
    const velocityError = (y * y / duration) * decay;
    if (Math.max(positionError, velocityError) > epsilon) lo = y;
    else hi = y;
  }
  return hi / duration;
}

function criticalSpringOmegaForState(settlingSec, epsilon, displacement, initialVelocity) {
  const baseOmega = criticalSpringOmega(settlingSec, epsilon);
  if (Math.abs(displacement) <= 1e-12 || displacement * initialVelocity >= 0.0) {
    return baseOmega;
  }

  // Preserve the inherited velocity while keeping the critical response on the
  // starting side of the target: x(t) = exp(-omega*t) * (x0 + b*t), b*x0 >= 0.
  return Math.max(baseOmega, -initialVelocity / displacement);
}

function codexSpringStateAt(state, nowMs = Date.now()) {
  const target = Number.isFinite(state.target) ? state.target : 0.0;
  const settlingMs = Number.isFinite(state.settlingMs) ? Math.max(state.settlingMs, 0.0) : 0.0;
  const startMs = Number.isFinite(state.startMs) ? state.startMs : nowMs;
  const elapsedMs = Math.max(nowMs - startMs, 0.0);
  if (settlingMs <= 0.0 || elapsedMs >= settlingMs) {
    return { position: target, velocity: 0.0, settled: true };
  }

  const from = Number.isFinite(state.from) ? state.from : target;
  const initialVelocity = Number.isFinite(state.initialVelocity) ? state.initialVelocity : 0.0;
  const bounce = clamp(
    Number.isFinite(state.bounce) ? state.bounce : DEFAULT_CODEX_SPRING_BOUNCE,
    0.0,
    0.95,
  );
  const epsilon = clamp(
    Number.isFinite(state.epsilon) ? state.epsilon : DEFAULT_CODEX_SPRING_EPSILON,
    1e-9,
    0.1,
  );
  const timeWarp = clamp(
    Number.isFinite(state.timeWarp) ? state.timeWarp : DEFAULT_CODEX_SPRING_TIME_WARP,
    1.0,
    6.0,
  );
  const vectorBlend = clamp(
    Number.isFinite(state.vectorBlend) ? state.vectorBlend : DEFAULT_CODEX_SPRING_VECTOR_BLEND,
    0.0,
    0.8,
  );
  const springWeight = 1.0 - vectorBlend;
  const dampingRatio = 1.0 - bounce;
  const settlingSec = settlingMs / 1000.0;
  const progress = clamp(elapsedMs / settlingMs, 0.0, 1.0);
  const remaining = 1.0 - progress;
  const elapsedSec = settlingSec * (1.0 - Math.pow(remaining, timeWarp));
  const timeScale = timeWarp * Math.pow(remaining, timeWarp - 1.0);
  const x0 = from - target;
  const internalInitialVelocity = initialVelocity / (timeWarp * springWeight);
  const omega0 = dampingRatio >= 1.0 - 1e-9
    ? criticalSpringOmegaForState(settlingSec, epsilon, x0, internalInitialVelocity)
    : -Math.log(epsilon) / (dampingRatio * settlingSec);
  const evaluateSpring = (timeSec) => {
    if (dampingRatio >= 1.0 - 1e-9) {
      const b = internalInitialVelocity + omega0 * x0;
      const decay = Math.exp(-omega0 * timeSec);
      return {
        displacement: decay * (x0 + b * timeSec),
        velocity: decay * (internalInitialVelocity - omega0 * b * timeSec),
      };
    }

    const omegaD = omega0 * Math.sqrt(1.0 - dampingRatio * dampingRatio);
    const b = (internalInitialVelocity + dampingRatio * omega0 * x0) / omegaD;
    const decay = Math.exp(-dampingRatio * omega0 * timeSec);
    const cos = Math.cos(omegaD * timeSec);
    const sin = Math.sin(omegaD * timeSec);
    const wave = x0 * cos + b * sin;
    const waveVelocity = -x0 * omegaD * sin + b * omegaD * cos;
    return {
      displacement: decay * wave,
      velocity: decay * (waveVelocity - dampingRatio * omega0 * wave),
    };
  };

  const sample = evaluateSpring(elapsedSec);
  const endpoint = evaluateSpring(settlingSec);
  const endpointBlend = smootherstep01(progress);
  const endpointBlendRate = 30.0 * progress * progress * remaining * remaining / settlingSec;
  const springDisplacement = sample.displacement - endpoint.displacement * endpointBlend;
  const springVelocity = sample.velocity * timeScale - endpoint.displacement * endpointBlendRate;
  const vectorEase = shortTailVectorEase(progress);
  const vectorDisplacement = x0 * (1.0 - vectorEase.value);
  const vectorVelocity = -x0 * vectorEase.derivative / settlingSec;
  const displacement = springWeight * springDisplacement + vectorBlend * vectorDisplacement;
  const velocity = springWeight * springVelocity + vectorBlend * vectorVelocity;
  const position = target + displacement;
  if (!Number.isFinite(position) || !Number.isFinite(velocity)) {
    return { position: target, velocity: 0.0, settled: true };
  }
  return { position, velocity, settled: false };
}

function isProcessAlive(pid) {
  const n = asNumber(pid);
  if (n === null || n <= 0 || n === process.pid) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function parseShaderTokenLevel(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return -1;
  try {
    const match = fs.readFileSync(filePath, 'utf8').match(/#define\s+TOKEN_LEVEL\s+(-?\d+(?:\.\d+)?)/);
    const level = match ? asNumber(match[1]) : null;
    if (level === null) return -1;
    return level < 0.0 ? -1.0 : clamp(level, 0.0, 1.0);
  } catch {
    return -1;
  }
}

function currentShaderLevel(basePath) {
  const wt = loadWtSettings();
  const profile = wt ? findBlackholeProfile(wt.settings) : null;
  const profileShader = normalizeLocalPath(profile?.['experimental.pixelShaderPath'] || '');
  const currentShader = profileShader || basePath;
  return parseShaderTokenLevel(currentShader);
}

function storedCurrentLevel(basePath) {
  const active = currentShaderLevel(basePath);
  if (active >= 0.0) return active;

  const current = readJsonFile(levelCurrentPath(basePath));
  const currentLevel = levelFromPercent(current?.level);
  if (currentLevel >= 0.0 && sameRuntimePath(current?.basePath, basePath)) return currentLevel;

  return 0.0;
}

function writeCurrentLevel(basePath, level, target) {
  try {
    writeJsonFile(levelCurrentPath(basePath), {
      basePath,
      level: clamp(level, 0.0, 1.0),
      target: clamp(target, 0.0, 1.0),
      updatedAtMs: Date.now(),
      pid: process.pid,
    });
  } catch {}
}

function writeLevelTarget(level) {
  const basePath = runtimeBaseShaderPath();
  const target = clamp(level, 0.0, 1.0);
  writeJsonFile(levelTargetPath(basePath), {
    basePath,
    target,
    glideMinSec: envNumber('BLACKHOLE_TOKEN_GLIDE_MIN_SEC', DEFAULT_TOKEN_GLIDE_MIN_SEC),
    glideMaxSec: envNumber('BLACKHOLE_TOKEN_GLIDE_MAX_SEC', DEFAULT_TOKEN_GLIDE_MAX_SEC),
    glideRate: envNumber('BLACKHOLE_TOKEN_GLIDE_RATE', DEFAULT_TOKEN_GLIDE_RATE),
    updatedAtMs: Date.now(),
    owner: process.env.BLACKHOLE_LIVE_OWNER || '',
    pid: process.pid,
  });
  return basePath;
}

function reserveLevelGlider(basePath, pid, owner) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    writeJsonFile(levelGliderPath(basePath), {
      basePath,
      pid,
      owner,
      reservedAtMs: Date.now(),
      starting: true,
    });
    return true;
  } catch {
    return false;
  }
}

function acquireLevelGliderLock(basePath) {
  const lockPath = levelGliderLockPath(basePath);
  const tryCreate = () => {
    let fd = null;
    try {
      fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, `${process.pid}${os.EOL}`);
      return true;
    } catch {
      return false;
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
    }
  };

  if (tryCreate()) return true;
  try {
    if (Date.now() - fs.statSync(lockPath).mtimeMs <= 30000) return false;
    fs.unlinkSync(lockPath);
  } catch {
    return false;
  }
  return tryCreate();
}

function releaseLevelGliderLock(basePath) {
  try { fs.unlinkSync(levelGliderLockPath(basePath)); } catch {}
}

function ensureLevelGlider(basePath, options = {}) {
  if (process.env.BLACKHOLE_DISABLE_LEVEL_GLIDE === '1') return false;

  const owner = process.env.BLACKHOLE_LIVE_OWNER || '';
  const canReuse = (existing) => {
    const ownerMatches = options.bypassOwner ||
      (owner ? existing?.owner === owner : !existing?.owner);
    return sameRuntimePath(existing?.basePath, basePath) &&
      isProcessAlive(existing.pid) && ownerMatches;
  };
  if (canReuse(readJsonFile(levelGliderPath(basePath)))) return true;
  if (!acquireLevelGliderLock(basePath)) return true;

  try {
    if (canReuse(readJsonFile(levelGliderPath(basePath)))) return true;
    const env = { ...process.env };
    if (options.bypassOwner) env.BLACKHOLE_BYPASS_OWNER = '1';
    const child = childProcess.spawn(process.execPath, [__filename, 'level-glider'], {
      detached: true,
      stdio: 'ignore',
      env,
    });
    reserveLevelGlider(basePath, child.pid, owner);
    child.unref();
    return true;
  } catch {
    return false;
  } finally {
    releaseLevelGliderLock(basePath);
  }
}

function stopLevelGlider(basePath) {
  try { fs.unlinkSync(levelTargetPath(basePath)); } catch {}
  releaseLevelGliderLock(basePath);
  const info = readJsonFile(levelGliderPath(basePath));
  const owner = process.env.BLACKHOLE_LIVE_OWNER || '';
  const canStop = process.env.BLACKHOLE_BYPASS_OWNER === '1' ||
    (owner ? info?.owner === owner : !info?.owner);
  if (sameRuntimePath(info?.basePath, basePath) && canStop && isProcessAlive(info.pid)) {
    try { process.kill(asNumber(info.pid), 'SIGTERM'); } catch {}
  }
  if (canStop) {
    try { fs.unlinkSync(levelGliderPath(basePath)); } catch {}
  }
}

function runLevelGlider() {
  const basePath = runtimeBaseShaderPath();
  const intervalMs = clamp(
    Math.round(envNumber('BLACKHOLE_TOKEN_GLIDE_INTERVAL_MS', DEFAULT_TOKEN_GLIDE_INTERVAL_MS)),
    10,
    1000,
  );
  const idleMs = clamp(
    Math.round(envNumber('BLACKHOLE_TOKEN_GLIDE_IDLE_MS', DEFAULT_TOKEN_GLIDE_IDLE_MS)),
    1000,
    60000,
  );
  let current = storedCurrentLevel(basePath);
  let from = current;
  let target = current;
  let startMs = Date.now();
  let durationMs = 0;
  let heartbeat = 0;
  let seenTargetKey = '';
  let lastTargetMs = Date.now();
  let shaderFallbackReady = currentShaderLevel(basePath) >= 0.0;

  try {
    writeJsonFile(levelGliderPath(basePath), {
      basePath,
      pid: process.pid,
      owner: process.env.BLACKHOLE_LIVE_OWNER || '',
      startedAtMs: Date.now(),
    });
  } catch {}

  const finish = () => {
    const info = readJsonFile(levelGliderPath(basePath));
    if (info?.pid === process.pid) {
      try { fs.unlinkSync(levelGliderPath(basePath)); } catch {}
    }
  };
  process.on('exit', finish);
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  writeTerminal(clearLegacyBeaconSequence());

  const readTarget = () => {
    const info = readJsonFile(levelTargetPath(basePath));
    const next = levelFromPercent(info?.target);
    if (!sameRuntimePath(info?.basePath, basePath) || next < 0.0) return null;
    return {
      level: next,
      minSec: info.glideMinSec,
      maxSec: info.glideMaxSec,
      rate: info.glideRate,
      key: `${info.updatedAtMs || 0}|${next}`,
    };
  };

  const tick = () => {
    if (!hasLiveOwnerAccess(basePath)) process.exit(0);

    const nextTarget = readTarget();
    if (!nextTarget) {
      if (Date.now() - lastTargetMs >= idleMs) process.exit(0);
      return;
    }

    const now = Date.now();
    if (nextTarget.key !== seenTargetKey) {
      seenTargetKey = nextTarget.key;
      lastTargetMs = now;
      const targetChanged = Math.abs(nextTarget.level - target) > 0.0005;
      if (targetChanged || !shaderFallbackReady) {
        const p = durationMs <= 0 ? 1.0 : clamp((now - startMs) / durationMs, 0.0, 1.0);
        current = from + (target - from) * smootherstep01(p);
        from = current;
        target = nextTarget.level;
        startMs = now;
        durationMs = targetChanged ? glideDurationMs(from, target, nextTarget) : 0;
        updateShaderLevel(target, {
          transitionFrom: from,
          transitionDurationSec: durationMs / 1000.0,
        });
        shaderFallbackReady = true;
      }
    }

    const p = durationMs <= 0 ? 1.0 : clamp((now - startMs) / durationMs, 0.0, 1.0);
    current = from + (target - from) * smootherstep01(p);
    writeBeacon(current, heartbeat++);
    writeCurrentLevel(basePath, current, target);

    if (p >= 1.0 && now - lastTargetMs >= idleMs) process.exit(0);
  };

  tick();
  setInterval(tick, intervalMs);
}

function levelWatch() {
  const basePath = runtimeBaseShaderPath();
  const intervalMs = clamp(
    Math.round(envNumber('BLACKHOLE_TOKEN_GLIDE_INTERVAL_MS', DEFAULT_TOKEN_GLIDE_INTERVAL_MS)),
    10,
    1000,
  );
  let current = storedCurrentLevel(basePath);
  let heartbeat = 0;
  const ownerInfo = readJsonFile(liveOwnerPath(basePath));
  const ownerId = ownerInfo?.id || readLiveOwner(basePath);
  if (ownerInfo?.label && ownerInfo.label !== 'token') return;

  const paint = () => {
    if (ownerId && readLiveOwner(basePath) !== ownerId) process.exit(0);
    const state = readJsonFile(levelCurrentPath(basePath));
    const next = levelFromPercent(state?.level);
    if (next >= 0.0 && sameRuntimePath(state?.basePath, basePath)) {
      current = next;
    }
    process.stdout.write(beaconSequence(current, heartbeat++));
  };
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  process.stdout.write(clearLegacyBeaconSequence());
  paint();
  setInterval(paint, intervalMs);
}

function glideDemo() {
  const from = levelFromPercent(process.argv[3] ?? '0.02');
  const to = levelFromPercent(process.argv[4] ?? '0.95');
  const durationMs = Math.max(500, Math.round((asNumber(process.argv[5]) || 4.0) * 1000));
  const startMs = Date.now();
  const startLevel = from >= 0.0 ? from : 0.02;
  const targetLevel = to >= 0.0 ? to : 0.95;
  let heartbeat = 0;
  const paint = () => {
    const p = clamp((Date.now() - startMs) / durationMs, 0.0, 1.0);
    const level = startLevel + (targetLevel - startLevel) * smootherstep01(p);
    process.stdout.write(beaconSequence(level, heartbeat++));
    if (p >= 1.0) {
      writeCurrentLevel(runtimeBaseShaderPath(), level, targetLevel);
      return;
    }
    setTimeout(paint, DEFAULT_TOKEN_GLIDE_INTERVAL_MS);
  };
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  process.stdout.write(clearLegacyBeaconSequence());
  paint();
}

function shaderGlideTest() {
  const level = levelFromPercent(process.argv[3] ?? '0');
  const target = level >= 0.0 ? level : 0.0;
  const durationSec = clamp(asNumber(process.argv[4]) ?? 8.0, 0.0, 30.0);
  const basePath = runtimeBaseShaderPath();
  const from = storedCurrentLevel(basePath);
  updateShaderLevel(target, {
    bypassOwner: true,
    transitionFrom: from,
    transitionDurationSec: durationSec,
  });
}

function encodeLevel(level) {
  const fill = clamp(Math.round(clamp(level, 0.0, 1.0) * 250), 0, 250);
  const hi = Math.floor(fill / 16);
  const lo = fill % 16;
  const chk = (hi ^ lo ^ 0x5) & 0xf;
  const sig = process.env.BLACKHOLE_LEGACY_NEAR_BLACK === '1' ? 0x00 : 0x10;
  return {
    fill,
    r: sig | chk,
    g: sig | hi,
    b: sig | lo,
  };
}

function codexMarkerChecksum(fill, motion) {
  return (fill ^ (fill >> 4) ^ motion ^ 0x1) & 0x1;
}

function encodeCodexMarkerLevel(level, motionWeight = 1.0, highPrecision = false) {
  if (highPrecision) {
    const precise = clamp(Math.round(clamp(level, 0.0, 1.0) * 2047), 0, 2047);
    const payload = precise | (0x2 << 11);
    const fill = payload & 0xff;
    const motion = (payload >> 8) & 0x1f;
    const checksum = codexMarkerChecksum(fill, motion) ^ 0x1;
    const packed = payload | (checksum << 13) | (1 << 14);
    return {
      fill: clamp(Math.round(clamp(level, 0.0, 1.0) * 250), 0, 250),
      precise,
      motion: 0,
      packed,
      r: (packed >> 10) & 0x1f,
      g: (packed >> 5) & 0x1f,
      b: packed & 0x1f,
    };
  }
  const fill = clamp(Math.round(clamp(level, 0.0, 1.0) * 250), 0, 250);
  const motion = clamp(Math.round(clamp(motionWeight, 0.0, 1.0) * 31), 0, 31);
  const packed = fill | (motion << 8) |
    (codexMarkerChecksum(fill, motion) << 13) | (1 << 14);
  return {
    fill,
    motion,
    packed,
    r: (packed >> 10) & 0x1f,
    g: (packed >> 5) & 0x1f,
    b: packed & 0x1f,
  };
}

function hexByte(value) {
  return value.toString(16).padStart(2, '0');
}

function codexMarkerPosition() {
  const columns = Math.max(1, Math.floor(
    asNumber(process.stdout.columns) ?? asNumber(process.env.COLUMNS) ?? 1,
  ));
  const rows = Math.max(1, Math.floor(
    asNumber(process.stdout.rows) ?? asNumber(process.env.LINES) ?? 1,
  ));
  const column = clamp(Math.floor(CODEX_MARKER_UV_X * columns) + 1, 1, columns);
  const row = clamp(Math.floor(CODEX_MARKER_UV_Y * rows) + 1, 1, rows);
  return { row, column };
}

function codexMarkerSequence(level, motionWeight = 1.0, highPrecision = false) {
  const { r, g, b } = encodeCodexMarkerLevel(level, motionWeight, highPrecision);
  const { row, column } = codexMarkerPosition();
  return `${ESC}7${ESC}[${row};${column}H${ESC}[48;2;${r};${g};${b}m${ESC}[1X${ESC}[0m${ESC}8`;
}

function ansiBlock(level) {
  const { r, g, b } = encodeLevel(level);
  return `${ESC}[48;2;${r};${g};${b}m ${ESC}[0m`;
}

function beaconSequence(level, heartbeat = 0) {
  const pulse = `${ESC}[48;2;0;0;${heartbeat % 2}m ${ESC}[0m`;
  const block = ansiBlock(level);
  return `${ESC}7${ESC}[1;1H${block}${ESC}[999;1H${block}${pulse}${ESC}8`;
}

function clearLegacyBeaconSequence() {
  const clear = `${ESC}[0m  `;
  return `${ESC}7${ESC}[1;1H${clear}${ESC}[999;1H${clear}${ESC}8`;
}

function viewportBeaconSequence(level) {
  const { r, g, b } = encodeLevel(level);
  return `${ESC}[?25l${ESC}[48;2;${r};${g};${b}m${ESC}[2J${ESC}[H${ESC}[0m`;
}

function demoKeepaliveSequence(tick) {
  const v = tick % 2;
  return `${ESC}[?25l${ESC}[48;2;0;0;${v}m${ESC}[2J${ESC}[H${ESC}[0m`;
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

function threadActivityClause() {
  const startedAtMs = asNumber(process.env.CODEX_BLACKHOLE_STARTED_AT_MS);
  if (startedAtMs === null) return '';
  const threshold = Math.max(0, Math.floor(startedAtMs - 5000));
  return ' and max(' +
    'coalesce(created_at_ms, created_at * 1000, 0),' +
    'coalesce(recency_at_ms, recency_at * 1000, 0)' +
    `) >= ${threshold} `;
}

function processTreePids(rootPid) {
  const root = Math.trunc(asNumber(rootPid) ?? -1);
  if (root <= 0) return [];
  try {
    const out = childProcess.execFileSync(
      'ps',
      ['-eo', 'pid=,ppid='],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 },
    );
    const children = new Map();
    for (const line of out.split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const ppid = Number(match[2]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(pid);
    }

    const found = [];
    const seen = new Set();
    const queue = [root];
    while (queue.length > 0 && found.length < 256) {
      const pid = queue.shift();
      if (seen.has(pid)) continue;
      seen.add(pid);
      found.push(pid);
      for (const child of children.get(pid) || []) queue.push(child);
    }
    return found;
  } catch {
    return [root];
  }
}

function isCodexRolloutPath(filePath) {
  return /[\\/]\.codex[\\/]sessions[\\/].*[\\/]rollout-[^\\/]+\.jsonl$/.test(String(filePath));
}

function processOpenRolloutPath(rootPid) {
  const candidates = [];
  for (const pid of processTreePids(rootPid)) {
    const fdDir = `/proc/${pid}/fd`;
    let entries;
    try {
      entries = fs.readdirSync(fdDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      let target;
      try {
        target = fs.readlinkSync(path.join(fdDir, entry)).replace(/ \\(deleted\\)$/, '');
      } catch {
        continue;
      }
      if (!isCodexRolloutPath(target) || !fs.existsSync(target)) continue;
      try {
        candidates.push({ path: target, mtimeMs: fs.statSync(target).mtimeMs });
      } catch {}
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  return candidates[0]?.path || '';
}

function rolloutThreadId(rolloutPath) {
  const match = basenameAny(rolloutPath).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : '';
}

function shellSnapshotThreadId(filePath) {
  const match = basenameAny(filePath).match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\./i);
  return match ? match[1] : '';
}

function latestShellSnapshotForSupervisor(supervisorPid) {
  const pid = Math.trunc(asNumber(supervisorPid) ?? -1);
  if (pid <= 0) return null;
  const dir = process.env.CODEX_BLACKHOLE_SHELL_SNAPSHOTS || DEFAULT_CODEX_SHELL_SNAPSHOTS;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sh')) continue;
    const threadId = shellSnapshotThreadId(entry.name);
    if (!threadId) continue;
    const filePath = path.join(dir, entry.name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    candidates.push({ filePath, threadId, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const needle = `CODEX_BLACKHOLE_SUPERVISOR_PID=${pid}`;
  for (const candidate of candidates.slice(0, 200)) {
    const text = readTail(candidate.filePath, 16 * 1024);
    if (text.includes(needle)) return candidate;
  }
  return null;
}

function rolloutMtimeMs(rolloutPath) {
  try {
    return fs.statSync(rolloutPath).mtimeMs;
  } catch {
    return 0;
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
  let stat;
  try {
    stat = fs.statSync(rolloutPath);
  } catch {
    rolloutLevelCache.delete(rolloutPath);
    return -1;
  }

  const key = `${stat.size}|${stat.mtimeMs}`;
  const cached = rolloutLevelCache.get(rolloutPath);
  if (cached?.key === key) return cached.level;

  const text = readTail(rolloutPath, 4 * 1024 * 1024);
  let level = -1;
  if (text) {
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (!line.includes('"token_count"')) continue;
      const event = safeJson(line);
      if (!event) continue;
      const next = extractLevelFromJson(event);
      if (next < 0.0) continue;
      level = next;
      break;
    }
  }

  rolloutLevelCache.set(rolloutPath, { key, level });
  if (rolloutLevelCache.size > 32) {
    rolloutLevelCache.delete(rolloutLevelCache.keys().next().value);
  }
  return level;
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

function extractSessionId(input) {
  return input?.session_id || input?.sessionId || input?.session?.id || '';
}

function transcriptSessionId(transcriptPath) {
  const localPath = normalizeLocalPath(transcriptPath);
  const name = basenameAny(localPath);
  const match = name.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? match[1] : '';
}

function transcriptMatchesSession(input, transcriptPath) {
  const sessionId = extractSessionId(input);
  const transcriptId = transcriptSessionId(transcriptPath);
  return !sessionId || !transcriptId || sessionId.toLowerCase() === transcriptId.toLowerCase();
}

function claudeLevel(input) {
  const direct = extractLevelFromJson(input);
  if (direct >= 0.0) return direct;

  const fromUsage = extractClaudeUsageLevel(input);
  if (fromUsage >= 0.0) return fromUsage;

  const transcriptPath = input?.transcript_path || input?.transcriptPath;
  if (!transcriptMatchesSession(input, transcriptPath)) return 0.0;

  const fromTranscript = transcriptLevel(transcriptPath);
  if (fromTranscript >= 0.0) return fromTranscript;

  return 0.0;
}

function latestThreadRowsForCwd(cwd) {
  const columns = 'rollout_path,cwd,tokens_used,model';
  const activeAfterLaunch = threadActivityClause();
  if (cwd) {
    const rows = sqliteRows(
      `select ${columns} from threads ` +
      `where archived = 0 and lower(cwd) = lower(${sqlString(cwd)}) ` +
      activeAfterLaunch +
      'order by updated_at_ms desc, updated_at desc limit 1;',
    );
    if (rows.length > 0) return rows;
  }
  return sqliteRows(
    `select ${columns} from threads ` +
    `where archived = 0 ${activeAfterLaunch} ` +
    'order by updated_at_ms desc, updated_at desc limit 1;',
  );
}

function threadRowsForRollout(rolloutPath) {
  if (!rolloutPath) return [];
  return sqliteRows(
    'select rollout_path,cwd,tokens_used,model from threads ' +
    `where rollout_path = ${sqlString(rolloutPath)} limit 1;`,
  );
}

function levelFromThreadRow(row) {
  if (!row) return -1;
  const fromRollout = rolloutLevel(row.rollout_path);
  if (fromRollout >= 0.0) return fromRollout;

  const max = asNumber(process.env.CODEX_BLACKHOLE_TOKEN_MAX) || DEFAULT_CODEX_TOKEN_MAX;
  return levelFromUsage(row.tokens_used, max);
}

function codexLevel(input) {
  const direct = extractLevelFromJson(input);
  if (direct >= 0.0) return direct;

  const codexPid = asNumber(process.env.CODEX_BLACKHOLE_CODEX_PID);
  if (codexPid !== null) {
    const rolloutPath = processOpenRolloutPath(codexPid);
    if (!rolloutPath) return 0.0;

    const supervisorPid = asNumber(process.env.CODEX_BLACKHOLE_SUPERVISOR_PID);
    const snapshot = latestShellSnapshotForSupervisor(supervisorPid);
    const activeThreadId = rolloutThreadId(rolloutPath);
    if (snapshot &&
        activeThreadId &&
        snapshot.threadId !== activeThreadId &&
        snapshot.mtimeMs >= rolloutMtimeMs(rolloutPath)) {
      return 0.0;
    }

    const fromRollout = rolloutLevel(rolloutPath);
    if (fromRollout >= 0.0) return fromRollout;

    const row = threadRowsForRollout(rolloutPath)[0];
    const fallback = levelFromThreadRow(row);
    return fallback >= 0.0 ? fallback : 0.0;
  }

  const cwd = extractCwd(input) || process.cwd();
  const rows = latestThreadRowsForCwd(cwd);
  for (const row of rows) {
    const fallback = levelFromThreadRow(row);
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

function writeBeacon(level, heartbeat = 0) {
  return writeTerminal(beaconSequence(level, heartbeat));
}

function writeCodexMarker(level, motionWeight = 1.0, highPrecision = false) {
  if (process.env.CODEX_BLACKHOLE_MARKER_PIPE === '1') {
    const { r, g, b } = encodeCodexMarkerLevel(level, motionWeight, highPrecision);
    process.stdout.write(`${JSON.stringify([r, g, b, CODEX_MARKER_UV_X, CODEX_MARKER_UV_Y])}\n`);
    return true;
  }
  return writeTerminal(codexMarkerSequence(level, motionWeight, highPrecision));
}

function clearBeacon() {
  return writeTerminal(`${ESC}7${ESC}[999;1H${ESC}[0m          ${ESC}8`);
}

function publishLevel(level, options = {}) {
  const next = clamp(level, 0.0, 1.0);
  if (options.immediate || process.env.BLACKHOLE_DISABLE_LEVEL_GLIDE === '1') {
    writeBeacon(next);
    return updateShaderLevel(next, options);
  }

  try {
    const basePath = writeLevelTarget(next);
    if (ensureLevelGlider(basePath, options)) return true;
  } catch {}

  writeBeacon(next);
  return updateShaderLevel(next, options);
}

function hideLevel(options = {}) {
  stopLevelGlider(runtimeBaseShaderPath());
  clearBeacon();
  return updateShaderLevel(-1.0, options);
}

function claudeStatusline() {
  const input = safeJson(readStdinIfPiped()) || {};
  const event = input.hook_event_name || input.hookEventName;
  if (event === 'SessionEnd') {
    hideLevel();
    return;
  }
  if (event === 'SessionStart') {
    publishLevel(DEFAULT_VISIBLE_TOKEN_MIN);
    return;
  }

  let level = claudeLevel(input);
  if (level < 0.0) level = 0.0;
  level = Math.round(level * 100.0) / 100.0;
  const minLevel = clamp(asNumber(process.env.CLAUDE_BLACKHOLE_MIN_LEVEL) ?? DEFAULT_VISIBLE_TOKEN_MIN, 0.0, 1.0);
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
  publishLevel(Math.max(codexLevel(input), DEFAULT_VISIBLE_TOKEN_MIN));
}

function quantizedShaderLevel(level) {
  return Math.round(clamp(level, 0.0, 1.0) * 250.0) / 250.0;
}

function codexBeacon() {
  const sampleIntervalMs = clamp(
    asNumber(process.env.CODEX_BLACKHOLE_INTERVAL_MS) || DEFAULT_CODEX_SAMPLE_INTERVAL_MS,
    100,
    10000,
  );
  const glideFrameMs = clamp(
    asNumber(process.env.CODEX_BLACKHOLE_REDRAW_MS) || DEFAULT_CODEX_GLIDE_FRAME_MS,
    10,
    1000,
  );
  const markerRefreshMs = clamp(
    asNumber(process.env.CODEX_BLACKHOLE_MARKER_MS) || DEFAULT_CODEX_MARKER_REFRESH_MS,
    10,
    1000,
  );
  const motionXfadeMs = clamp(
    asNumber(process.env.CODEX_BLACKHOLE_MOTION_XFADE_MS) || DEFAULT_CODEX_MOTION_XFADE_MS,
    100,
    5000,
  );
  const motionFadeInMs = clamp(
    asNumber(process.env.CODEX_BLACKHOLE_MOTION_FADE_IN_MS) || DEFAULT_CODEX_MOTION_FADE_IN_MS,
    100,
    12000,
  );
  const minLevel = clamp(asNumber(process.env.CODEX_BLACKHOLE_MIN_LEVEL) ?? DEFAULT_VISIBLE_TOKEN_MIN, 0.0, 1.0);
  const springOptions = codexSpringOptions();
  const tracePath = process.env.CODEX_BLACKHOLE_TRACE_FILE || '';
  const trace = (event, details = {}) => {
    if (!tracePath) return;
    try {
      fs.appendFileSync(tracePath, `${JSON.stringify({ atMs: Date.now(), event, ...details })}\n`);
    } catch {}
  };
  const supervisorPid = asNumber(process.env.CODEX_BLACKHOLE_SUPERVISOR_PID);
  const supervisorAlive = () => {
    if (supervisorPid === null) return true;
    try {
      process.kill(supervisorPid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const now = Date.now();
  const state = {
    from: minLevel,
    target: minLevel,
    initialVelocity: 0.0,
    startMs: now,
    settlingMs: 0,
    bounce: springOptions.bounce,
    timeWarp: springOptions.timeWarp,
    vectorBlend: springOptions.vectorBlend,
    epsilon: springOptions.epsilon,
  };
  const motionState = {
    from: 1.0,
    target: 1.0,
    startMs: now,
    durationMs: 0,
  };
  let phase = 'steady';
  let pendingTarget = minLevel;
  let lastMarkerKey = '';
  let lastWriteMs = 0;
  let lastRenderMs = now;
  trace('start', { minLevel, motionXfadeMs, motionFadeInMs, springOptions });

  const motionStateAt = (atMs) => {
    const elapsedMs = Math.max(atMs - motionState.startMs, 0.0);
    if (motionState.durationMs <= 0 || elapsedMs >= motionState.durationMs) {
      return { value: motionState.target, settled: true };
    }
    const p = smootherstep01(elapsedMs / motionState.durationMs);
    return {
      value: motionState.from + (motionState.target - motionState.from) * p,
      settled: false,
    };
  };

  const settleMotion = (value, atMs) => {
    Object.assign(motionState, {
      from: value,
      target: value,
      startMs: atMs,
      durationMs: 0,
    });
  };

  const setMotionTarget = (target, atMs, baseDurationMs) => {
    const current = motionStateAt(atMs).value;
    const durationMs = Math.round(baseDurationMs * Math.abs(target - current));
    Object.assign(motionState, {
      from: current,
      target,
      startMs: atMs,
      durationMs,
    });
  };

  const startSizeTransition = (next, atMs) => {
    const sample = codexSpringStateAt(state, atMs);
    const atRest = Math.abs(next - sample.position) <= 0.0005 &&
      Math.abs(sample.velocity) <= springOptions.epsilon;
    Object.assign(state, {
      from: sample.position,
      target: next,
      initialVelocity: sample.velocity,
      startMs: atMs,
      settlingMs: atRest
        ? 0
        : Math.round(codexSpringDurationSec(sample.position, next, springOptions) * 1000.0),
    });
    phase = 'size';
    trace('size-start', {
      from: sample.position,
      target: next,
      velocity: sample.velocity,
      settlingMs: state.settlingMs,
    });
  };

  const renderTransition = (force = false) => {
    const atMs = Date.now();
    const renderGapMs = atMs - lastRenderMs;
    lastRenderMs = atMs;
    if (renderGapMs >= 80) trace('render-gap', { phase, renderGapMs });
    let sample = codexSpringStateAt(state, atMs);
    let motion = motionStateAt(atMs);

    if (phase === 'motion-out' && motion.settled) {
      trace('motion-out-end', { durationMs: atMs - motionState.startMs });
      settleMotion(0.0, atMs);
      startSizeTransition(pendingTarget, atMs);
      sample = codexSpringStateAt(state, atMs);
      motion = motionStateAt(atMs);
    }

    if (phase === 'size' && sample.settled) {
      trace('size-end', {
        elapsedMs: atMs - state.startMs,
        position: sample.position,
        target: state.target,
        velocity: sample.velocity,
      });
      state.from = state.target;
      state.initialVelocity = 0.0;
      state.startMs = atMs;
      state.settlingMs = 0;
      phase = 'motion-in';
      setMotionTarget(1.0, atMs, motionFadeInMs);
      motion = motionStateAt(atMs);
    } else if (phase === 'motion-in' && motion.settled) {
      trace('motion-in-end', { durationMs: atMs - motionState.startMs });
      settleMotion(1.0, atMs);
      phase = 'steady';
      motion = motionStateAt(atMs);
    }

    const current = sample.position;
    const highPrecision = phase === 'size';
    const encoded = encodeCodexMarkerLevel(current, motion.value, highPrecision);
    const markerKey = String(encoded.packed);
    const refreshDue = atMs - lastWriteMs >= markerRefreshMs;
    if (!force && markerKey === lastMarkerKey && !refreshDue) return false;
    if (!writeCodexMarker(current, motion.value, highPrecision)) return false;
    lastMarkerKey = markerKey;
    lastWriteMs = atMs;
    return true;
  };

  const applyTarget = (level) => {
    const next = quantizedShaderLevel(Math.max(level, minLevel));
    if (Math.abs(next - pendingTarget) <= 0.0005) return false;
    trace('target', { from: pendingTarget, to: next, phase });
    pendingTarget = next;

    const atMs = Date.now();
    if (phase === 'size') {
      startSizeTransition(next, atMs);
      return true;
    }
    if (phase === 'motion-out') return true;

    const motion = motionStateAt(atMs);
    if (motion.value <= 1.0 / 31.0) {
      settleMotion(0.0, atMs);
      startSizeTransition(next, atMs);
      return true;
    }
    phase = 'motion-out';
    setMotionTarget(0.0, atMs, motionXfadeMs);
    return true;
  };

  const sample = () => {
    if (!supervisorAlive()) process.exit(0);
    const level = Math.max(codexLevel({ cwd: process.cwd() }), minLevel);
    applyTarget(level);
  };

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
  renderTransition(true);
  sample();
  setInterval(sample, sampleIntervalMs);
  setInterval(renderTransition, glideFrameMs);
}

function demoKeepalive() {
  const intervalMs = clamp(asNumber(process.env.BLACKHOLE_DEMO_KEEPALIVE_MS) || 250, 100, 5000);
  let tick = 0;
  const paint = () => process.stdout.write(demoKeepaliveSequence(tick++));
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
} else if (mode === 'demo-keepalive') {
  demoKeepalive();
} else if (mode === 'level-glider') {
  runLevelGlider();
} else if (mode === 'level-watch') {
  levelWatch();
} else if (mode === 'glide-demo') {
  glideDemo();
} else if (mode === 'shader-glide-test') {
  shaderGlideTest();
} else if (mode === 'encode-test') {
  const level = levelFromPercent(process.argv[3] ?? '0');
  process.stdout.write(`${ansiBlock(level >= 0.0 ? level : 0.0)}\n`);
} else if (mode === 'codex-marker-encode-test') {
  const level = levelFromPercent(process.argv[3] ?? '0');
  const motion = clamp(asNumber(process.argv[4]) ?? 1.0, 0.0, 1.0);
  const highPrecision = process.argv[5] === 'high';
  const { r, g, b } = encodeCodexMarkerLevel(level >= 0.0 ? level : 0.0, motion, highPrecision);
  process.stdout.write(`#${hexByte(r)}${hexByte(g)}${hexByte(b)}\n`);
} else if (mode === 'codex-marker-sequence-test') {
  const level = levelFromPercent(process.argv[3] ?? '0');
  const motion = clamp(asNumber(process.argv[4]) ?? 1.0, 0.0, 1.0);
  const highPrecision = process.argv[5] === 'high';
  process.stdout.write(codexMarkerSequence(level >= 0.0 ? level : 0.0, motion, highPrecision));
} else if (mode === 'codex-marker-frame-test') {
  const level = levelFromPercent(process.argv[3] ?? '0');
  const motion = clamp(asNumber(process.argv[4]) ?? 1.0, 0.0, 1.0);
  const highPrecision = process.argv[5] === 'high';
  writeCodexMarker(level >= 0.0 ? level : 0.0, motion, highPrecision);
} else if (mode === 'codex-spring-sample-test') {
  const from = asNumber(process.argv[3]) ?? 0.0;
  const target = asNumber(process.argv[4]) ?? 1.0;
  const initialVelocity = asNumber(process.argv[5]) ?? 0.0;
  const settlingSec = Math.max(asNumber(process.argv[6]) ?? 3.0, 0.0);
  const timeSec = Math.max(asNumber(process.argv[7]) ?? 0.0, 0.0);
  const bounce = clamp(asNumber(process.argv[8]) ?? DEFAULT_CODEX_SPRING_BOUNCE, 0.0, 0.95);
  const timeWarp = clamp(asNumber(process.argv[9]) ?? DEFAULT_CODEX_SPRING_TIME_WARP, 1.0, 6.0);
  const vectorBlend = clamp(asNumber(process.argv[10]) ?? DEFAULT_CODEX_SPRING_VECTOR_BLEND, 0.0, 0.8);
  const sample = codexSpringStateAt({
    from,
    target,
    initialVelocity,
    startMs: 0,
    settlingMs: settlingSec * 1000.0,
    bounce,
    timeWarp,
    vectorBlend,
    epsilon: DEFAULT_CODEX_SPRING_EPSILON,
  }, timeSec * 1000.0);
  process.stdout.write(`${JSON.stringify(sample)}\n`);
} else if (mode === 'codex-spring-marker-metrics-test') {
  const from = asNumber(process.argv[3]) ?? 0.0;
  const target = asNumber(process.argv[4]) ?? 1.0;
  const settlingMs = Math.max(asNumber(process.argv[5]) ?? 6000.0, 0.0);
  const stepMs = clamp(asNumber(process.argv[6]) ?? 10.0, 1.0, 100.0);
  const state = {
    from,
    target,
    initialVelocity: 0.0,
    startMs: 0,
    settlingMs,
    bounce: DEFAULT_CODEX_SPRING_BOUNCE,
    timeWarp: DEFAULT_CODEX_SPRING_TIME_WARP,
    vectorBlend: DEFAULT_CODEX_SPRING_VECTOR_BLEND,
    epsilon: DEFAULT_CODEX_SPRING_EPSILON,
  };
  let previousFill = null;
  let previousChangeMs = 0.0;
  let lastChangeMs = 0.0;
  let maxGapMs = 0.0;
  let changes = 0;
  for (let atMs = 0.0; atMs <= settlingMs; atMs += stepMs) {
    const fill = encodeCodexMarkerLevel(
      codexSpringStateAt(state, atMs).position,
      0.0,
      true,
    ).precise;
    if (fill === previousFill) continue;
    if (changes > 0) maxGapMs = Math.max(maxGapMs, atMs - previousChangeMs);
    previousFill = fill;
    previousChangeMs = atMs;
    lastChangeMs = atMs;
    changes += 1;
  }
  process.stdout.write(`${JSON.stringify({ changes, maxGapMs, lastChangeMs })}\n`);
} else if (mode === 'beacon-test') {
  const level = levelFromPercent(process.argv[3] ?? '0');
  process.stdout.write(beaconSequence(level >= 0.0 ? level : 0.0));
} else if (mode === 'level-test') {
  const level = levelFromPercent(process.argv[3] ?? '0');
  publishLevel(level >= 0.0 ? level : 0.0, { bypassOwner: true });
} else if (mode === 'claim-owner') {
  process.stdout.write(`${claimLiveOwner(process.argv[3] || 'manual')}\n`);
} else {
  process.stderr.write(`unknown mode: ${mode}\n`);
  process.exit(2);
}
