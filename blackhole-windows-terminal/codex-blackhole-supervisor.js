#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const toolRepo = '/mnt/i/QtWorkData/MyTools/my_ghostty_blackhole';
const targetCwd = process.env.BLACKHOLE_TARGET_CWD || process.cwd();
const beaconJs = path.join(toolRepo, 'blackhole-windows-terminal', 'blackhole-statusline.js');
const realCodex = process.env.CODEX_BLACKHOLE_CODEX_BIN ||
  path.join(os.homedir(), '.codex', 'npm-global', 'bin', 'codex');

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

let beacon = null;
if (fs.existsSync(beaconJs)) {
  beacon = childProcess.spawn(process.execPath, [beaconJs, 'codex-beacon'], {
    cwd: targetCwd,
    detached: false,
    stdio: 'ignore',
  });
}

const codex = childProcess.spawn(realCodex, process.argv.slice(2), {
  cwd: targetCwd,
  detached: false,
  env: process.env,
  stdio: 'inherit',
});

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
