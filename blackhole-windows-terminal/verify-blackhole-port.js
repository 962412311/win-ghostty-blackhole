'use strict';

const fs = require('fs');

const GLSL = 'ghostty-blackhole-src/blackhole.glsl';
const HLSL = 'blackhole-windows-terminal/blackhole_winterminal.hlsl';

const MODEL_CONSTANTS = [
  'HOLE_RADIUS', 'LENS_DEPTH', 'STAR_GAIN',
  'DISK_INNER', 'DISK_OUTER', 'DISK_INCL', 'DISK_ROLL',
  'DISK_GAIN', 'DISK_OPACITY', 'DISK_TEMP', 'DOPPLER_MIX',
  'DISK_BEAM', 'DISK_SPEED', 'DISK_WIND', 'DISK_CONTRAST',
  'EXPOSURE', 'DRIFT_SPEED', 'WORK_AREA', 'DILATION_MIN',
  'TOKEN_AREA_MAX', 'TOKEN_HOME_X', 'TOKEN_HOME_Y',
  'TOKEN_EASE', 'TOKEN_REACH',
  'N_STEPS', 'MODE_POMODORO', 'MODE_TOKENS', 'MODE_DEMO', 'SIZE_MODE',
  'TOKEN_LEVEL', 'TOKEN_GLIDE_MIN', 'TOKEN_GLIDE_MAX', 'TOKEN_GLIDE_RATE',
  'DEMO_SEC', 'DEMO_GROW_SEC', 'DEMO_XFADE', 'DEMO_N',
  'WORK_PERIOD_MIN', 'BREAK_MIN', 'IDLE_FADE_SEC', 'TIME_SCALE', 'B_CRIT',
];

const LOCAL_TUNING_CONSTANTS = new Map([
  ['TOKEN_AREA_MIN', '0.0030'],
  ['TOKEN_CALM', '0.0050'],
  ['TOKEN_RUSH', '0.1375'],
  ['DEMO_LEVEL_FLOOR', '0.0350'],
]);

const HLSL_ONLY_CONSTANTS = new Set([
  'DEBUG_PASSTHROUGH',
  'DEBUG_TOKEN_SAMPLE_POINT',
  'TOKEN_DATA_UV_TOP',
  'TOKEN_DATA_UV_BOTTOM',
  'TOKEN_DATA_X_STEP',
  'TOKEN_DATA_Y_STEP',
  'POMODORO_WALL_OFFSET',
]);

const FORMULA_ANCHORS = [
  ['time drift', 'iTime * DRIFT_SPEED', 'demoTime * DRIFT_SPEED'],
  ['demo look gate', 'if (SIZE_MODE == MODE_DEMO) L = demoLook();', 'if (SIZE_MODE == MODE_DEMO) L = demoLook(demoLookLvl);'],
  ['disk inner clamp', 'max(L.inner, 1.6)', 'max(L.inner, 1.6)'],
  ['disk outer clamp', 'max(L.outer, rin + 0.5)', 'max(L.outer, rin + 0.5)'],
  ['pomodoro work seconds', 'WORK_PERIOD_MIN * 60.0', 'WORK_PERIOD_MIN * 60.0'],
  ['pomodoro cycle seconds', 'workSec + BREAK_MIN * 60.0', 'workSec + BREAK_MIN * 60.0'],
  ['pomodoro phase', 'mod(wall, cycleSec)', 'fmod(wall, cycleSec)'],
  ['pomodoro collapse', 'min(60.0, workSec * 0.15)', 'min(60.0, workSec * 0.15)'],
  ['pomodoro growth clamp', 'clamp(phase / workSec, 0.0, 1.0)', 'clamp(phase / workSec, 0.0, 1.0)'],
  ['pomodoro collapse fade', '1.0 - smoothstep(workSec - collapse, workSec, phase)', '1.0 - smoothstep(workSec - collapse, workSec, phase)'],
  ['pomodoro intensity', 'I = mix(0.12, 1.0, grow)', 'I = lerp(0.12, 1.0, grow)'],
  ['pomodoro idle fade', '1.0 - smoothstep(IDLE_FADE_SEC, max(BREAK_MIN * 60.0, IDLE_FADE_SEC + 1.0), idle)', '1.0 - smoothstep(IDLE_FADE_SEC, max(BREAK_MIN * 60.0, IDLE_FADE_SEC + 1.0), idle)'],
  ['pomodoro size', 'sz = mix(0.22, 1.0, I)', 'sz = lerp(0.22, 1.0, I)'],
  ['pomodoro extent', '(rout / B_CRIT) * HOLE_RADIUS * sz', '(rout / B_CRIT) * HOLE_RADIUS * sz'],
  ['pomodoro y low', 'WORK_AREA + 0.12 + ext', 'WORK_AREA + 0.12 + ext'],
  ['pomodoro speed', 'mix(0.35, 1.0, I)', 'lerp(0.35, 1.0, I)'],
  ['demo level host smoothing', 'min(mod(iTime, DEMO_SEC) / DEMO_GROW_SEC, 1.0)', 'min(u / DEMO_GROW_SEC, 1.0)'],
  ['token ease', 'pow(clamp(lvl, 0.0, 1.0), TOKEN_EASE)', 'pow(clamp(lvl, 0.0, 1.0), TOKEN_EASE)'],
  ['token intensity', 'mix(0.10, 1.0, g)', 'lerp(0.10, 1.0, g)'],
  ['token rh min', 'sqrt(TOKEN_AREA_MIN * aspect / 3.1415927)', 'sqrt(TOKEN_AREA_MIN * aspect / 3.1415927)'],
  ['token rh max', 'sqrt(TOKEN_AREA_MAX * aspect / 3.1415927)', 'sqrt(TOKEN_AREA_MAX * aspect / 3.1415927)'],
  ['token radius scale', 'mix(rhMin, rhMax, g) * (HOLE_RADIUS / 0.08)', 'lerp(rhMin, rhMax, g) * (HOLE_RADIUS / 0.08)'],
  ['token size', 'rhT / max(HOLE_RADIUS, 1e-4)', 'rhT / max(HOLE_RADIUS, 1e-4)'],
  ['token margin', 'min(rhT * mix(1.45, 0.90, g), 0.5 * (1.0 - WORK_AREA - 0.03))', 'min(rhT * lerp(1.45, 0.90, g), 0.5 * (1.0 - WORK_AREA - 0.03))'],
  ['token reach', 'mix(0.06, max(TOKEN_REACH, 0.06), g)', 'lerp(0.06, max(TOKEN_REACH, 0.06), g)'],
  ['token wander', 'mix(lissa(t * TOKEN_CALM), lissa(t * TOKEN_RUSH), g)', 'lerp(lissa(t * TOKEN_CALM), lissa(t * TOKEN_RUSH), g)'],
  ['visibility', 'smoothstep(0.0, 0.10, I)', 'smoothstep(0.0, 0.10, I)'],
  ['rh', 'HOLE_RADIUS * sz', 'HOLE_RADIUS * sz'],
  ['dilation', 'mix(1.0, DILATION_MIN, I)', 'lerp(1.0, DILATION_MIN, I)'],
  ['shield', 'vis * smoothstep(WORK_AREA, WORK_AREA + 0.18, yUp)', 'vis * smoothstep(WORK_AREA, WORK_AREA + 0.18, yUp)'],
  ['world scale', 'B_CRIT / max(rh, 1e-4)', 'B_CRIT / max(rh, 1e-4)'],
  ['rolled world pos', 'rot(vec2(p.x, -p.y), L.roll) * W', 'rot(float2(p.x, -p.y), L.roll) * W'],
  ['window', 'exp(-pow(plen / (7.0 * rh), 2.0))', 'exp(-pow(plen / (7.0 * rh), 2.0))'],
  ['far deflection', '(2.0 / (W * W)) / max(plen, 1e-4)', '(2.0 / (W * W)) / max(plen, 1e-4)'],
  ['far fit', '(1.29 * u + 0.07) * max(LENS_DEPTH - 2.14 * u + 0.75, 0.0)', '(1.29 * u + 0.07) * max(LENS_DEPTH - 2.14 * u + 0.75, 0.0)'],
  ['chromatic aberration', '0.035 * smoothstep(1.0, 2.0, b / bmax)', '0.035 * smoothstep(1.0, 2.0, b / bmax)'],
  ['camera x', 'vec3(pr, Z0)', 'float3(pr, Z0)'],
  ['camera v', 'vec3(0.0, 0.0, -1.0)', 'float3(0.0, 0.0, -1.0)'],
  ['geodesic accel', '-1.5 * h2 * x / (r2 * r2 * r)', '-1.5 * h2 * x / (r2 * r2 * r)'],
  ['step size', 'clamp(0.16 * r, 0.03, 1.5)', 'clamp(0.16 * r, 0.03, 1.5)'],
  ['disk band', 'smoothstep(rin, rin * 1.25, rc)', 'smoothstep(rin, rin * 1.25, rc)'],
  ['disk band outer', '1.0 - smoothstep(rout * 0.70, rout, rc)', '1.0 - smoothstep(rout * 0.70, rout, rc)'],
  ['keplerian speed', 'pow(rin / rc, 1.5)', 'pow(rin / rc, 1.5)'],
  ['local time shift', 'sqrt(max(1.0 - 1.5 / rc, 0.02))', 'sqrt(max(1.0 - 1.5 / rc, 0.02))'],
  ['swirl', 'rc * L.wind * 0.12 - t * kep * spd * gloc * dil * sdir', 'rc * L.wind * 0.12 - t * kep * spd * gloc * dil * sdir'],
  ['streaks first', 'vnoiseWrapY(vec2(rc * 2.8, turns * 19.0 + swirl * 3.0), 19.0) * 0.65', 'vnoiseWrapY(float2(rc * 2.8, turns * 19.0 + swirl * 3.0), 19.0) * 0.65'],
  ['streaks second', 'vnoiseWrapY(vec2(rc * 1.0, turns * 9.0  + swirl * 1.5 + 7.0), 9.0) * 0.35', 'vnoiseWrapY(float2(rc * 1.0, turns * 9.0  + swirl * 1.5 + 7.0), 9.0) * 0.35'],
  ['doppler beta', 'inversesqrt(max(2.0 * (rc - 1.0), 0.2))', 'rsqrt(max(2.0 * (rc - 1.0), 0.2))'],
  ['doppler shift', 'gloc / max(1.0 + beta * dot(gasdir, normalize(v)), 0.05)', 'gloc / max(1.0 + beta * dot(gasdir, normalize(v)), 0.05)'],
  ['temperature profile', 'pow(rin / rc, 0.75) * pow(xpr, 0.25) / 0.488', 'pow(rin / rc, 0.75) * pow(xpr, 0.25) / 0.488'],
  ['disk emission', 'L.gain * 2.2 * density * tprof * tprof * boost', 'L.gain * 2.2 * density * tprof * tprof * boost'],
  ['capture budget', 'dot(x, x) < 4.0', 'dot(x, x) < 4.0'],
  ['sky plane', '(-LENS_DEPTH - x.z) / d.z', '(-LENS_DEPTH - x.z) / d.z'],
  ['toward fade', 'smoothstep(0.05, 0.35, -d.z)', 'smoothstep(0.05, 0.35, -d.z)'],
  ['tonemap', 'exp(-emitc * L.expo)', 'exp(-emitc * L.expo)'],
];

const HOST_ADAPTATION_ANCHORS = [
  ['ghostty screen uv source', 'fragCoord / res', null],
  ['windows terminal screen uv source', null, 'float2 uv = pos.xy / res;'],
  ['windows terminal passthrough sampling', null, 'shaderTexture.Sample(samplerState, tex)'],
  ['windows terminal demo closed level', null, 'float reset = 1.0 - smoothstep(DEMO_GROW_SEC, DEMO_SEC, u);'],
  ['windows terminal demo look holds on reset', null, 'float demoLookLvl = (SIZE_MODE == MODE_DEMO) ? demoLookLevel() : -1.0;'],
  ['windows terminal demo look follows size', null, 'DiskLook demoLook(float lvl)'],
  ['windows terminal demo animation holds on reset', null, 'float demoTime = (SIZE_MODE == MODE_DEMO) ? demoAnimTime() : Time;'],
  ['windows terminal demo phase closes before reset', null, 'return demoForwardLevel() * 6.2831853;'],
  ['windows terminal demo never reaches invisible zero', null, 'return max(grow * reset, DEMO_LEVEL_FLOOR);'],
  ['windows terminal demo closed wander', null, 'float2 demoLoopWander()'],
  ['ghostty pomodoro wall clock', 'float wall     = iDate.w + iTime * (TIME_SCALE - 1.0);', null],
  ['windows terminal pomodoro wall offset', null, 'float wall = POMODORO_WALL_OFFSET + Time * TIME_SCALE;'],
  ['ghostty pomodoro cursor idle', 'float idle = max(0.0, iTime - iTimeCursorChange);', null],
  ['windows terminal no cursor idle uniform', null, 'float idle = 0.0;'],
];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function extractConstants(text) {
  const out = new Map();
  const re = /(?:const|static\s+const)\s+(?:float|int)\s+([A-Z0-9_]+)\s*=\s*([^;]+);|#define\s+([A-Z0-9_]+)\s+([^\n/]+)/g;
  for (const m of text.matchAll(re)) {
    const name = m[1] || m[3];
    const value = (m[2] || m[4]).trim();
    out.set(name, value);
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const glsl = read(GLSL);
const hlsl = read(HLSL);
const glslConstants = extractConstants(glsl);
const hlslConstants = extractConstants(hlsl);

for (const name of MODEL_CONSTANTS) {
  const a = glslConstants.get(name);
  const b = hlslConstants.get(name);
  if (a === undefined) fail(`missing in GLSL: ${name}`);
  else if (b === undefined) fail(`missing in HLSL: ${name}`);
  else if (a !== b) fail(`constant mismatch ${name}: GLSL=${a} HLSL=${b}`);
}

for (const name of hlslConstants.keys()) {
  if (!glslConstants.has(name) && !HLSL_ONLY_CONSTANTS.has(name) && !LOCAL_TUNING_CONSTANTS.has(name)) {
    fail(`unexpected HLSL constant: ${name}`);
  }
}

for (const [name, expected] of LOCAL_TUNING_CONSTANTS) {
  const actual = hlslConstants.get(name);
  if (actual !== expected) fail(`local tuning mismatch ${name}: expected=${expected} HLSL=${actual}`);
}

for (const [label, glslNeedle, hlslNeedle] of FORMULA_ANCHORS) {
  if (!glsl.includes(glslNeedle)) fail(`missing GLSL formula anchor: ${label}`);
  if (!hlsl.includes(hlslNeedle)) fail(`missing HLSL formula anchor: ${label}`);
}

for (const [label, glslNeedle, hlslNeedle] of HOST_ADAPTATION_ANCHORS) {
  if (glslNeedle && !glsl.includes(glslNeedle)) fail(`missing GLSL host anchor: ${label}`);
  if (hlslNeedle && !hlsl.includes(hlslNeedle)) fail(`missing HLSL host anchor: ${label}`);
}

if (!process.exitCode) {
  console.log(`OK: ${MODEL_CONSTANTS.length} model constants, ${LOCAL_TUNING_CONSTANTS.size} local tuning constants, ${FORMULA_ANCHORS.length} formula anchors, and ${HOST_ADAPTATION_ANCHORS.length} host-adaptation anchors verified.`);
}
