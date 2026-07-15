#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const toolDir = __dirname;
const targetCwd = process.env.BLACKHOLE_TARGET_CWD || process.cwd();
const beaconJs = path.join(toolDir, 'blackhole-statusline.js');
const fallbackCodex = path.join(os.homedir(), '.codex', 'npm-global', 'bin', 'codex');
const SYNC_BEGIN = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';

class TerminalOutputState {
  constructor() {
    this.state = 'ground';
    this.control = '';
    this.utf8Remaining = 0;
    this.syncActive = false;
  }

  isControlSafe() {
    return this.state === 'ground' && this.utf8Remaining === 0;
  }

  isSafe() {
    return this.isControlSafe() && !this.syncActive;
  }

  finishControl() {
    const sequence = this.control;
    this.control = '';
    this.state = 'ground';
    if (sequence === SYNC_BEGIN) {
      this.syncActive = true;
      return false;
    }
    if (sequence === SYNC_END) {
      this.syncActive = false;
      return true;
    }
    return false;
  }

  feed(input) {
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    let syncEnded = false;
    for (const byte of data) {
      if (this.state === 'ground') {
        if (this.utf8Remaining > 0) {
          if ((byte & 0xc0) === 0x80) {
            this.utf8Remaining -= 1;
            continue;
          }
          this.utf8Remaining = 0;
        }
        if (byte === 0x1b) {
          this.state = 'escape';
          this.control = '\x1b';
        } else if (byte >= 0xc2 && byte <= 0xdf) {
          this.utf8Remaining = 1;
        } else if (byte >= 0xe0 && byte <= 0xef) {
          this.utf8Remaining = 2;
        } else if (byte >= 0xf0 && byte <= 0xf4) {
          this.utf8Remaining = 3;
        }
        continue;
      }

      if (this.state === 'escape') {
        this.control += String.fromCharCode(byte);
        if (byte === 0x5b) {
          this.state = 'csi';
        } else if (byte === 0x5d) {
          this.state = 'osc';
        } else if (byte === 0x50 || byte === 0x58 || byte === 0x5e || byte === 0x5f) {
          this.state = 'string';
        } else {
          this.control = '';
          this.state = 'ground';
        }
        continue;
      }

      if (this.state === 'csi') {
        this.control += String.fromCharCode(byte);
        if (byte >= 0x40 && byte <= 0x7e) {
          syncEnded = this.finishControl() || syncEnded;
        }
        continue;
      }

      if (this.state === 'osc' || this.state === 'string') {
        if (byte === 0x07 && this.state === 'osc') {
          this.control = '';
          this.state = 'ground';
        } else if (byte === 0x1b) {
          this.state = this.state === 'osc' ? 'osc-escape' : 'string-escape';
        }
        continue;
      }

      if (this.state === 'osc-escape' || this.state === 'string-escape') {
        if (byte === 0x5c) {
          this.control = '';
          this.state = 'ground';
        } else if (byte !== 0x1b) {
          this.state = this.state === 'osc-escape' ? 'osc' : 'string';
        }
      }
    }
    return { syncEnded, safe: this.isSafe() };
  }
}

class MarkerFrameDecoder {
  constructor() {
    this.pending = '';
  }

  feed(input) {
    this.pending += Buffer.isBuffer(input) ? input.toString('ascii') : String(input);
    const lines = this.pending.split('\n');
    this.pending = lines.pop() || '';
    const frames = [];
    for (const line of lines) {
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Array.isArray(frame) || frame.length !== 5 ||
          !frame.every(Number.isFinite) ||
          frame.slice(0, 3).some((value) => value < 0 || value > 31) ||
          frame.slice(3).some((value) => value < 0.0 || value > 1.0)) continue;
      frames.push(frame);
    }
    return frames;
  }
}

function codexMarkerSequence(frame, columns = process.stdout.columns, rows = process.stdout.rows) {
  const [r, g, b, uvX, uvY] = frame;
  const width = Math.max(1, Math.floor(Number(columns) || Number(process.env.COLUMNS) || 1));
  const height = Math.max(1, Math.floor(Number(rows) || Number(process.env.LINES) || 1));
  const column = Math.min(width, Math.max(1, Math.floor(uvX * width) + 1));
  const row = Math.min(height, Math.max(1, Math.floor(uvY * height) + 1));
  return Buffer.from(`\x1b7\x1b[${row};${column}H\x1b[48;2;${r};${g};${b}m\x1b[1X\x1b[0m\x1b8`);
}

function injectMarkerBeforeSyncEnds(chunk, marker) {
  if (!marker) return chunk;
  const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const syncEnd = Buffer.from(SYNC_END);
  const parts = [];
  let offset = 0;
  let match = input.indexOf(syncEnd, offset);
  if (match < 0) return input;
  while (match >= 0) {
    parts.push(input.subarray(offset, match), marker, syncEnd);
    offset = match + syncEnd.length;
    match = input.indexOf(syncEnd, offset);
  }
  parts.push(input.subarray(offset));
  return Buffer.concat(parts);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runProxySelfTest() {
  if (shellQuote("a'b") !== "'a'\\''b'") throw new Error('shell argument quoting failed');
  const output = new TerminalOutputState();
  const first = output.feed(Buffer.from('text\x1b[?20'));
  if (first.safe || output.syncActive) throw new Error('split CSI prefix was treated as safe');
  const begin = output.feed(Buffer.from('26hframe'));
  if (begin.safe || !output.syncActive) throw new Error('synchronized frame did not start');
  if (!output.isControlSafe()) throw new Error('complete synchronized frame data stayed control-unsafe');
  output.feed(Buffer.from('\x1b[?202'));
  const end = output.feed(Buffer.from('6l'));
  if (!end.syncEnded || !end.safe || output.syncActive) throw new Error('synchronized frame did not end');

  const utf8 = new TerminalOutputState();
  if (utf8.feed(Buffer.from([0xe4])).safe) throw new Error('partial UTF-8 was treated as safe');
  if (!utf8.feed(Buffer.from([0xb8, 0xad])).safe) throw new Error('complete UTF-8 stayed unsafe');

  const decoder = new MarkerFrameDecoder();
  const marker = [31, 24, 5, 0.006, 0.018];
  const encoded = `${JSON.stringify(marker)}\n`;
  if (decoder.feed(encoded.slice(0, 4)).length !== 0) throw new Error('partial marker frame decoded');
  const frames = decoder.feed(encoded.slice(4));
  if (frames.length !== 1 || JSON.stringify(frames[0]) !== JSON.stringify(marker)) {
    throw new Error('marker frame decode failed');
  }
  const sequence = codexMarkerSequence(frames[0], 200, 100).toString();
  if (sequence !== '\x1b7\x1b[2;2H\x1b[48;2;31;24;5m\x1b[1X\x1b[0m\x1b8') {
    throw new Error('marker terminal layout failed');
  }
  const synchronized = injectMarkerBeforeSyncEnds(
    Buffer.from(`frame${SYNC_END}${SYNC_BEGIN}next${SYNC_END}`),
    Buffer.from('marker'),
  ).toString();
  if (synchronized !== `framemarker${SYNC_END}${SYNC_BEGIN}nextmarker${SYNC_END}`) {
    throw new Error('marker was not committed inside each synchronized frame');
  }
  process.stdout.write('OK: Codex PTY marker proxy parser verified.\n');
}

function commandPath(command) {
  try {
    return childProcess.execFileSync('sh', ['-lc', `command -v ${command}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }).trim();
  } catch {
    return '';
  }
}

if (process.argv[2] === '--proxy-self-test') {
  runProxySelfTest();
  process.exit(0);
}

const realCodex = process.env.CODEX_BLACKHOLE_CODEX_BIN ||
  commandPath('codex') ||
  fallbackCodex;
const scriptPath = commandPath('script');

function signalExitCode(signal) {
  const signals = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
  return 128 + (signals[signal] || 0);
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    childProcess.spawnSync('pkill', ['-TERM', '-P', String(pid)], { stdio: 'ignore' });
  } catch {}
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
}

if (!fs.existsSync(realCodex)) {
  console.error(`Codex binary not found: ${realCodex}`);
  process.exit(127);
}

process.chdir(targetCwd);

const startedAtMs = Date.now();
const childEnv = {
  ...process.env,
  BLACKHOLE_TARGET_CWD: targetCwd,
  CODEX_BLACKHOLE_STARTED_AT_MS: String(startedAtMs),
  CODEX_BLACKHOLE_SUPERVISOR_PID: String(process.pid),
};

const codexArgs = process.argv.slice(2);
const codexEnv = {
  ...childEnv,
  CODEX_BLACKHOLE_DISABLE: '1',
};
const proxyEnabled = Boolean(scriptPath && process.stdin.isTTY && process.stdout.isTTY &&
  process.env.CODEX_BLACKHOLE_DISABLE_PTY_PROXY !== '1');
const codex = proxyEnabled
  ? childProcess.spawn(scriptPath, [
    '-q',
    '-e',
    '-E',
    'never',
    '-c',
    [realCodex, ...codexArgs].map(shellQuote).join(' '),
    '/dev/null',
  ], {
    cwd: targetCwd,
    detached: false,
    env: codexEnv,
    stdio: ['inherit', 'pipe', 'inherit'],
  })
  : childProcess.spawn(realCodex, codexArgs, {
    cwd: targetCwd,
    detached: false,
    env: codexEnv,
    stdio: 'inherit',
  });

const terminalOutput = proxyEnabled ? new TerminalOutputState() : null;
const markerFrames = proxyEnabled ? new MarkerFrameDecoder() : null;
let latestMarker = null;

function flushMarkerAfterCodexOutput(allowSynchronized = false) {
  const safe = allowSynchronized ? terminalOutput?.isControlSafe() : terminalOutput?.isSafe();
  if (!proxyEnabled || !latestMarker || !safe) return false;
  process.stdout.write(latestMarker);
  return true;
}

if (proxyEnabled) {
  codex.stdout.on('data', (chunk) => {
    terminalOutput.feed(chunk);
    const output = injectMarkerBeforeSyncEnds(chunk, latestMarker);
    if (!process.stdout.write(output)) {
      codex.stdout.pause();
      process.stdout.once('drain', () => codex.stdout.resume());
    }
    if (terminalOutput.isControlSafe()) flushMarkerAfterCodexOutput(true);
  });
}

let beacon = null;
if (fs.existsSync(beaconJs)) {
  beacon = childProcess.spawn(process.execPath, [beaconJs, 'codex-beacon'], {
    cwd: targetCwd,
    detached: false,
    env: {
      ...childEnv,
      CODEX_BLACKHOLE_CODEX_PID: String(codex.pid),
      ...(proxyEnabled ? { CODEX_BLACKHOLE_MARKER_PIPE: '1' } : {}),
    },
    stdio: proxyEnabled ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'inherit', 'ignore'],
  });
  if (proxyEnabled) {
    beacon.stdout.on('data', (chunk) => {
      for (const frame of markerFrames.feed(chunk)) latestMarker = codexMarkerSequence(frame);
      flushMarkerAfterCodexOutput(true);
    });
  }
}

let exiting = false;

function cleanup() {
  if (beacon && !beacon.killed) {
    try { beacon.kill('SIGTERM'); } catch {}
  }
}

function stop(signal) {
  if (exiting) return;
  exiting = true;
  killProcessTree(codex.pid);
  cleanup();
  process.exit(signalExitCode(signal));
}

process.on('SIGHUP', () => stop('SIGHUP'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

codex.on('exit', (code, signal) => {
  cleanup();
  if (signal) process.exit(signalExitCode(signal));
  process.exit(code ?? 0);
});

codex.on('error', (err) => {
  cleanup();
  console.error(err.message);
  process.exit(127);
});
