#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const modes = new Map([
  ['demo', 'MODE_DEMO'],
  ['token', 'MODE_TOKENS'],
  ['tokens', 'MODE_TOKENS'],
  ['pomodoro', 'MODE_POMODORO'],
  ['clock', 'MODE_POMODORO'],
  ['timer', 'MODE_POMODORO'],
]);

const toolDir = __dirname;
const sourceShader = path.join(toolDir, 'blackhole_winterminal.hlsl');
const wtProfileName = process.env.BLACKHOLE_WT_PROFILE || 'Blackhole';
const defaultWindowsUser = 'YOUR_USER';

function windowsUser() {
  if (process.env.BLACKHOLE_WINDOWS_USER) return process.env.BLACKHOLE_WINDOWS_USER;
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || `C:\\Users\\${defaultWindowsUser}`;
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
  return defaultWindowsUser;
}

function defaultRuntimeShader() {
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || `C:\\Users\\${defaultWindowsUser}`;
    return path.join(userProfile, 'terminal-shaders', 'blackhole_winterminal.hlsl');
  }
  return `/mnt/c/Users/${windowsUser()}/terminal-shaders/blackhole_winterminal.hlsl`;
}

function defaultSettingsPath() {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
      || path.join(process.env.USERPROFILE || `C:\\Users\\${defaultWindowsUser}`, 'AppData', 'Local');
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

function defaultClaudeDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.USERPROFILE || `C:\\Users\\${defaultWindowsUser}`, '.claude');
  }
  return `/mnt/c/Users/${windowsUser()}/.claude`;
}

const runtimeShader = process.env.BLACKHOLE_SHADER_PATH || defaultRuntimeShader();
const wtSettingsPath = process.env.BLACKHOLE_WT_SETTINGS || defaultSettingsPath();
const statePath = path.join(path.dirname(runtimeShader), 'blackhole-live-mode.txt');
const ownerPath = path.join(path.dirname(runtimeShader), 'blackhole-live-owner.json');
const claudeDir = process.env.BLACKHOLE_CLAUDE_DIR || defaultClaudeDir();
const claudeSettingsPath = process.env.BLACKHOLE_CLAUDE_SETTINGS || path.join(claudeDir, 'settings.json');
const distro = process.env.BLACKHOLE_WSL_DISTRO || 'Ubuntu';

function usage(exitCode) {
  const out = exitCode === 0 ? console.log : console.error;
  out('Usage: bh <demo|token|pomodoro|mode>');
  process.exit(exitCode);
}

function canonicalMode(mode) {
  if (mode === 'tokens') return 'token';
  if (mode === 'clock' || mode === 'timer') return 'pomodoro';
  return mode;
}

function currentMode(text) {
  const match = text.match(/#define\s+SIZE_MODE\s+(MODE_[A-Z]+)/);
  if (!match) return 'unknown';
  for (const [name, define] of modes.entries()) {
    if (define === match[1]) return canonicalMode(name);
  }
  return match[1];
}

function toWindowsPath(filePath) {
  if (process.platform === 'win32') return filePath;
  const match = String(filePath).match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) return filePath;
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
}

function toWindowsSlashPath(filePath) {
  return toWindowsPath(filePath).replace(/\\/g, '/');
}

function toWslPath(filePath) {
  if (process.platform !== 'win32') return filePath;
  const match = String(filePath).match(/^([a-zA-Z]):\\(.*)$/);
  if (!match) return filePath;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function windowsPathToWsl(filePath) {
  const text = toWindowsPath(filePath);
  const match = String(text).match(/^([a-zA-Z]):\\(.*)$/);
  if (!match) return text;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function quoteCmd(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function shaderFloat(value) {
  return Number(value).toFixed(4);
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function localSecondsOfDay(date = new Date()) {
  return date.getHours() * 3600
    + date.getMinutes() * 60
    + date.getSeconds()
    + date.getMilliseconds() / 1000;
}

function renderShader(define, mode) {
  const source = fs.readFileSync(sourceShader, 'utf8');
  let next = source.replace(/#define\s+SIZE_MODE\s+MODE_[A-Z]+/, `#define SIZE_MODE ${define}`);
  if (next === source && !source.includes(`#define SIZE_MODE ${define}`)) {
    console.error('Could not find SIZE_MODE define in shader source.');
    process.exit(1);
  }

  if (canonicalMode(mode) === 'pomodoro') {
    const offset = envNumber('BLACKHOLE_POMODORO_WALL_OFFSET_SEC', localSecondsOfDay());
    const scale = envNumber('BLACKHOLE_POMODORO_TIME_SCALE', 1);
    next = next
      .replace(/static const float TIME_SCALE\s+=\s+[-+]?\d+(?:\.\d+)?;/,
        `static const float TIME_SCALE       = ${shaderFloat(scale)};`)
      .replace(/static const float POMODORO_WALL_OFFSET\s+=\s+[-+]?\d+(?:\.\d+)?;/,
        `static const float POMODORO_WALL_OFFSET = ${shaderFloat(offset)};`);
  }

  return next;
}

function loadWtSettings() {
  if (!fs.existsSync(wtSettingsPath)) return null;
  return JSON.parse(fs.readFileSync(wtSettingsPath, 'utf8'));
}

function findBlackholeProfile(settings) {
  const list = settings?.profiles?.list;
  if (!Array.isArray(list)) return null;
  return list.find((profile) => profile.name === wtProfileName) || null;
}

function updateWtProfile(shaderPath) {
  const settings = loadWtSettings();
  if (!settings) {
    console.warn(`Windows Terminal settings not found: ${wtSettingsPath}`);
    return false;
  }

  const profile = findBlackholeProfile(settings);
  if (!profile) {
    console.warn(`Windows Terminal profile not found: ${wtProfileName}`);
    return false;
  }

  const nextPath = toWindowsPath(shaderPath);
  if (profile['experimental.pixelShaderPath'] === nextPath) return false;

  profile['experimental.pixelShaderPath'] = nextPath;
  const tmp = `${wtSettingsPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 4)}${os.EOL}`);
  fs.renameSync(tmp, wtSettingsPath);
  return true;
}

function saveState(mode) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${mode}${os.EOL}`);
  } catch {}
}

function claimLiveOwner(label) {
  const id = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const owner = {
    id,
    label: label || 'blackhole',
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(ownerPath), { recursive: true });
    fs.writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}${os.EOL}`);
  } catch {}
  return id;
}

function readState() {
  try {
    return fs.readFileSync(statePath, 'utf8').trim();
  } catch {
    return currentMode(fs.readFileSync(runtimeShader, 'utf8'));
  }
}

function stopLocalCodexBeacons() {
  let out = '';
  try {
    out = childProcess.execFileSync('ps', ['-eo', 'pid=,args='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    });
  } catch {
    return;
  }

  for (const line of out.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = match[2];
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    if (!/blackhole-statusline\.js\s+codex-beacon/.test(args)) continue;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
}

function stopStaleCodexBeacons() {
  if (process.env.BLACKHOLE_KEEP_OLD_BEACONS === '1') return;
  if (process.platform !== 'win32') {
    stopLocalCodexBeacons();
    return;
  }
  try {
    childProcess.spawnSync(
      'C:\\Windows\\System32\\wsl.exe',
      [
        '-d', distro,
        '--exec',
        'sh',
        '-lc',
        "ps -eo pid=,args= | awk '/blackhole-statusline[.]js codex-beacon/ {print $1}' | xargs -r kill -TERM",
      ],
      { stdio: 'ignore', timeout: 1500 },
    );
  } catch {}
}

function installMode(mode, ownerLabel = mode) {
  stopStaleCodexBeacons();
  const ownerId = claimLiveOwner(ownerLabel);
  const define = modes.get(mode);
  fs.mkdirSync(path.dirname(runtimeShader), { recursive: true });
  fs.writeFileSync(runtimeShader, renderShader(define, mode));
  updateWtProfile(runtimeShader);
  saveState(canonicalMode(mode));
  return ownerId;
}

function loadClaudeSettings() {
  if (!fs.existsSync(claudeSettingsPath)) return {};
  return JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
}

function quoteSh(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function claudeBridgeCommand(helperCmd, ownerId) {
  const wslPath = windowsPathToWsl(helperCmd);
  const msysPath = wslPath.replace(/^\/mnt\/([a-zA-Z])\//, '/$1/');
  const ownerExport = ownerId
    ? `BLACKHOLE_LIVE_OWNER=${quoteSh(ownerId)}; export BLACKHOLE_LIVE_OWNER; `
    : '';
  return `${ownerExport}p=${quoteSh(wslPath)}; [ -f "$p" ] || p=${quoteSh(msysPath)}; [ -f "$p" ] && bash "$p" || true`;
}

function isBlackholeClaudeCommand(command) {
  return /(?:^|[\\/])(?:claude-)?blackhole-statusline\.(?:cmd|js|sh)\b/i.test(String(command));
}

function addClaudeHook(settings, event, command) {
  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  const entries = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  const kept = entries
    .map((entry) => ({
      ...entry,
      hooks: Array.isArray(entry?.hooks)
        ? entry.hooks.filter((hook) => !isBlackholeClaudeCommand(hook?.command))
        : entry?.hooks,
    }))
    .filter((entry) => !Array.isArray(entry?.hooks) || entry.hooks.length > 0);
  kept.push({ hooks: [{ type: 'command', command }] });
  settings.hooks[event] = kept;
}

function installClaudeBridge(ownerId) {
  fs.mkdirSync(claudeDir, { recursive: true });
  const helperJs = path.join(claudeDir, 'blackhole-statusline.js');
  const helperCmd = path.join(claudeDir, 'claude-blackhole-statusline.cmd');
  const helperSh = path.join(claudeDir, 'claude-blackhole-statusline.sh');
  fs.copyFileSync(path.join(toolDir, 'blackhole-statusline.js'), helperJs);
  fs.copyFileSync(path.join(toolDir, 'claude-blackhole-statusline.cmd'), helperCmd);
  fs.copyFileSync(path.join(toolDir, 'claude-blackhole-statusline.sh'), helperSh);

  const command = claudeBridgeCommand(helperSh, ownerId);
  const settings = loadClaudeSettings();
  settings.statusLine = { type: 'command', command };
  addClaudeHook(settings, 'SessionStart', command);
  addClaudeHook(settings, 'SessionEnd', command);

  fs.mkdirSync(path.dirname(claudeSettingsPath), { recursive: true });
  const tmp = `${claudeSettingsPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}${os.EOL}`);
  fs.renameSync(tmp, claudeSettingsPath);
  return command;
}

function wtExe() {
  if (process.platform === 'win32') return 'wt.exe';
  return `/mnt/c/Users/${windowsUser()}/AppData/Local/Microsoft/WindowsApps/wt.exe`;
}

function openWt(args) {
  if (process.env.BLACKHOLE_DRY_RUN === '1') {
    console.log([wtExe(), ...args].join('\n'));
    return;
  }

  const result = childProcess.spawnSync(wtExe(), args, {
    stdio: 'ignore',
    shell: false,
    windowsHide: false,
  });
  if (result.error) {
    console.warn(`Could not open Windows Terminal: ${result.error.message}`);
  } else if (result.status !== 0) {
    console.warn(`Windows Terminal returned exit code ${result.status}.`);
  }
}

function openBlackholeTab(mode) {
  openWt([
    '-w', '0',
    'new-tab',
    '-p', wtProfileName,
    '--title', `Blackhole ${mode}`,
  ]);
}

function windowsCwdToWsl(cwd) {
  if (process.platform !== 'win32') return cwd;
  const result = childProcess.spawnSync(
    'C:\\Windows\\System32\\wsl.exe',
    ['-d', distro, '--exec', 'wslpath', '-a', cwd],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    console.error(`Could not map current Windows directory to WSL: ${cwd}`);
    process.exit(result.status || 1);
  }
  return result.stdout.trim();
}

function openClaude(args) {
  const ownerId = installMode('token', 'claude');
  installClaudeBridge(ownerId);
  const bhCmd = toWindowsPath(path.join(toolDir, 'bh.cmd'));
  const cwd = toWindowsPath(process.cwd());
  const extra = args.map(quoteCmd).join(' ');
  openWt([
    '-w', '0',
    'new-tab',
    '-p', wtProfileName,
    '--title', 'Blackhole Claude',
    'cmd.exe', '/d', '/k',
    `cd /d ${quoteCmd(cwd)} && ${quoteCmd(bhCmd)} __run_claude${extra ? ` ${extra}` : ''}`,
  ]);
}

function openCodex(args) {
  installMode('token', 'codex-launch');
  const wslCwd = process.platform === 'win32'
    ? windowsCwdToWsl(process.cwd())
    : process.cwd();
  openWt([
    '-w', '0',
    'new-tab',
    '-p', wtProfileName,
    '--title', 'Blackhole Codex',
    'C:\\Windows\\System32\\wsl.exe',
    '-d', distro,
    '--cd', wslCwd,
    '--exec',
    toWslPath(path.join(toolDir, 'bh')),
    '__run_codex',
    ...args,
  ]);
}

const cmd = (process.argv[2] || '').toLowerCase();
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') usage(cmd ? 0 : 2);

if (cmd === 'mode' || cmd === 'status' || cmd === 'current') {
  const text = fs.readFileSync(runtimeShader, 'utf8');
  console.log(`Blackhole requested mode: ${readState()}`);
  console.log(`Blackhole shader mode: ${currentMode(text)}`);
  console.log(toWindowsPath(runtimeShader));
  process.exit(0);
}

if (cmd === 'open-claude') {
  openClaude(process.argv.slice(3));
  console.log('Blackhole tool: claude');
  console.log(toWindowsPath(runtimeShader));
  process.exit(0);
}

if (cmd === 'install-claude' || cmd === 'install-claude-bridge') {
  const ownerId = installMode('token', 'claude');
  console.log(`Claude blackhole bridge: ${installClaudeBridge(ownerId)}`);
  console.log(toWindowsPath(runtimeShader));
  process.exit(0);
}

if (cmd === 'open-codex') {
  openCodex(process.argv.slice(3));
  console.log('Blackhole tool: codex');
  console.log(toWindowsPath(runtimeShader));
  process.exit(0);
}

if (!modes.has(cmd)) usage(2);

const mode = canonicalMode(cmd);
const shouldOpen = process.argv.slice(3).includes('--open');
installMode(mode, mode);
if (shouldOpen) openBlackholeTab(mode);

console.log(`Blackhole shader mode: ${mode}`);
console.log(toWindowsPath(runtimeShader));
