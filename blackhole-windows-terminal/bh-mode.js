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
const claudeDir = process.env.BLACKHOLE_CLAUDE_DIR || defaultClaudeDir();
const claudeSettingsPath = process.env.BLACKHOLE_CLAUDE_SETTINGS || path.join(claudeDir, 'settings.json');
const distro = process.env.BLACKHOLE_WSL_DISTRO || 'Ubuntu';

function usage(exitCode) {
  const out = exitCode === 0 ? console.log : console.error;
  out('Usage: bh <demo|token|pomodoro|mode>');
  process.exit(exitCode);
}

function canonicalMode(mode) {
  return mode === 'tokens' ? 'token' : mode;
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

function renderShader(define) {
  const source = fs.readFileSync(sourceShader, 'utf8');
  const next = source.replace(/#define\s+SIZE_MODE\s+MODE_[A-Z]+/, `#define SIZE_MODE ${define}`);
  if (next === source && !source.includes(`#define SIZE_MODE ${define}`)) {
    console.error('Could not find SIZE_MODE define in shader source.');
    process.exit(1);
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

function readState() {
  try {
    return fs.readFileSync(statePath, 'utf8').trim();
  } catch {
    return currentMode(fs.readFileSync(runtimeShader, 'utf8'));
  }
}

function installMode(mode) {
  const define = modes.get(mode);
  fs.mkdirSync(path.dirname(runtimeShader), { recursive: true });
  fs.writeFileSync(runtimeShader, renderShader(define));
  updateWtProfile(runtimeShader);
  saveState(canonicalMode(mode));
}

function loadClaudeSettings() {
  if (!fs.existsSync(claudeSettingsPath)) return {};
  return JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
}

function quoteSh(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function claudeBridgeCommand(helperCmd) {
  const wslPath = windowsPathToWsl(helperCmd);
  const msysPath = wslPath.replace(/^\/mnt\/([a-zA-Z])\//, '/$1/');
  return `p=${quoteSh(wslPath)}; [ -f "$p" ] || p=${quoteSh(msysPath)}; [ -f "$p" ] && bash "$p" || true`;
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

function installClaudeBridge() {
  fs.mkdirSync(claudeDir, { recursive: true });
  const helperJs = path.join(claudeDir, 'blackhole-statusline.js');
  const helperCmd = path.join(claudeDir, 'claude-blackhole-statusline.cmd');
  const helperSh = path.join(claudeDir, 'claude-blackhole-statusline.sh');
  fs.copyFileSync(path.join(toolDir, 'blackhole-statusline.js'), helperJs);
  fs.copyFileSync(path.join(toolDir, 'claude-blackhole-statusline.cmd'), helperCmd);
  fs.copyFileSync(path.join(toolDir, 'claude-blackhole-statusline.sh'), helperSh);

  const command = claudeBridgeCommand(helperSh);
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
  installMode('token');
  installClaudeBridge();
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
  installMode('token');
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
  installMode('token');
  console.log(`Claude blackhole bridge: ${installClaudeBridge()}`);
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
installMode(mode);
if (shouldOpen) openBlackholeTab(mode);

console.log(`Blackhole shader mode: ${mode}`);
console.log(toWindowsPath(runtimeShader));
