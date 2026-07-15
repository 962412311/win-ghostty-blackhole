'use strict';

const childProcess = require('child_process');
const fs = require('fs');

const GLSL = 'ghostty-blackhole-src/blackhole.glsl';
const HLSL = 'blackhole-windows-terminal/blackhole_winterminal.hlsl';
const STATUSLINE = 'blackhole-windows-terminal/blackhole-statusline.js';
const BH_MODE = 'blackhole-windows-terminal/bh-mode.js';
const BH_CMD = 'blackhole-windows-terminal/bh.cmd';
const SUPERVISOR = 'blackhole-windows-terminal/codex-blackhole-supervisor.js';

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
  'DEMO_SEC', 'DEMO_GROW_SEC', 'DEMO_N',
  'WORK_PERIOD_MIN', 'BREAK_MIN', 'IDLE_FADE_SEC', 'TIME_SCALE', 'B_CRIT',
];

const LOCAL_TUNING_CONSTANTS = new Map([
  ['TOKEN_AREA_MIN', '0.0030'],
  ['TOKEN_LOOP_SEC', '240.0000'],
  ['TOKEN_CALM_TURNS', '1.0000'],
  ['TOKEN_RUSH_TURNS', '4.0000'],
  ['TOKEN_WOBBLE_X_TURNS', '15.0000'],
  ['TOKEN_WOBBLE_Y_TURNS', '19.0000'],
  ['DEMO_LEVEL_FLOOR', '0.0350'],
  ['DEMO_XFADE', '0.7200'],
]);

const HLSL_ONLY_CONSTANTS = new Set([
  'DEBUG_PASSTHROUGH',
  'DEBUG_TOKEN_SAMPLE_POINT',
  'TOKEN_LEVEL_FROM',
  'TOKEN_LEVEL_TARGET',
  'TOKEN_GLIDE_START',
  'TOKEN_GLIDE_DURATION',
  'TOKEN_MOTION_TIME_OFFSET',
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
  ['token wander', 'mix(lissa(t * TOKEN_CALM), lissa(t * TOKEN_RUSH), g)', 'wander = lerp(calmWander, rushWander, g);'],
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
  ['windows terminal token look follows size', null, 'if (SIZE_MODE == MODE_TOKENS)'],
  ['windows terminal token look traverses all upstream presets', null, 'DiskLook tokenTour(int i)'],
  ['windows terminal token look uses level', null, 'L = tokenLook(g);'],
  ['windows terminal demo animation holds on reset', null, 'float demoTime = (SIZE_MODE == MODE_DEMO) ? demoAnimTime() : Time;'],
  ['windows terminal demo phase closes before reset', null, 'return demoForwardLevel() * 6.2831853;'],
  ['windows terminal demo never reaches invisible zero', null, 'return max(grow * reset, DEMO_LEVEL_FLOOR);'],
  ['windows terminal demo closed wander', null, 'float2 demoLoopWander()'],
  ['windows terminal codex marker channel', null, 'float2 tokenCodexMarkerData(float2 pixelUv, float2 pixelTex,'],
  ['windows terminal codex marker fixed sample', null, 'screenToTex(TOKEN_DATA_UV_TOP, pixelUv, pixelTex, texPerUvX, texPerUvY)).rgb);'],
  ['windows terminal codex marker priority', null, 'float2 markerData = tokenCodexMarkerData(uv, tex, texPerUvX, texPerUvY);'],
  ['windows terminal token fallback after codex marker', null, 'lvl = fallback;'],
  ['windows terminal token live block is lazy', null, 'if (SIZE_MODE != MODE_DEMO && lvl < 0.0)'],
  ['windows terminal token top block fallback', null, 'return screenTokenAt(TOKEN_DATA_UV_TOP, 1.0, pixelUv, pixelTex, texPerUvX, texPerUvY);'],
  ['windows terminal token smootherstep helper', null, 'float smootherstep01(float x)'],
  ['windows terminal token fallback smootherstep', null, 'smootherstep01((Time - TOKEN_GLIDE_START) / TOKEN_GLIDE_DURATION)'],
  ['windows terminal token local glide start', null, '#define TOKEN_GLIDE_START 0.0000'],
  ['windows terminal token wall phase offset', null, '#define TOKEN_MOTION_TIME_OFFSET 0.0000'],
  ['windows terminal token loop phase', null, 'float tokenLoopPhase()'],
  ['windows terminal token closed wander', null, 'float2 tokenLoopWander(float a)'],
  ['windows terminal token closed wander x formula', null, '0.75 * sin(a) + 0.25 * sin(2.0 * a + 1.0)'],
  ['windows terminal token closed wander y formula', null, '0.70 * sin(a + 2.1) + 0.30 * sin(3.0 * a)'],
  ['windows terminal token closed wobble formula', null, 'return float2(cos(a * TOKEN_WOBBLE_X_TURNS),'],
  ['windows terminal token calm loop', null, 'tokenLoopWander(a * TOKEN_CALM_TURNS)'],
  ['windows terminal token rush loop', null, 'tokenLoopWander(a * TOKEN_RUSH_TURNS)'],
  ['windows terminal robust hidden token signature', null, 'hi.x == 0x1 && hi.y == 0x1 && hi.z == 0x1'],
  ['ghostty pomodoro wall clock', 'float wall     = iDate.w + iTime * (TIME_SCALE - 1.0);', null],
  ['windows terminal pomodoro wall offset', null, 'float wall = POMODORO_WALL_OFFSET + Time * TIME_SCALE;'],
  ['ghostty pomodoro cursor idle', 'float idle = max(0.0, iTime - iTimeCursorChange);', null],
  ['windows terminal no cursor idle uniform', null, 'float idle = 0.0;'],
];

const STATUSLINE_ANCHORS = [
  ['token glide smootherstep', 'function smootherstep01(x)'],
  ['token glide smootherstep formula', 't * t * t * (t * (t * 6.0 - 15.0) + 10.0)'],
  ['token glide target state', 'blackhole-level-target.json'],
  ['token glide current state', 'blackhole-level-current.json'],
  ['token glide pid state', 'blackhole-level-glider.json'],
  ['token glide command', "mode === 'level-glider'"],
  ['token watch command', "mode === 'level-watch'"],
  ['token shader glide test command', "mode === 'shader-glide-test'"],
  ['token watch cross host path compare', 'function sameRuntimePath(a, b)'],
  ['token watch reads glider current state', 'const state = readJsonFile(levelCurrentPath(basePath));'],
  ['token watch follows current level', 'current = next;'],
  ['token watch exits after owner change', 'readLiveOwner(basePath) !== ownerId'],
  ['token watch does not rewrite current state', 'function levelWatch()'],
  ['token robust hidden ansi signature', 'const sig = process.env.BLACKHOLE_LEGACY_NEAR_BLACK'],
  ['token one-cell hidden block', 'm ${ESC}[0m'],
  ['token glide 10ms floor', 'DEFAULT_TOKEN_GLIDE_INTERVAL_MS = 10'],
  ['token visible default floor', 'DEFAULT_VISIBLE_TOKEN_MIN = 0.02'],
  ['codex sample 500ms default', 'DEFAULT_CODEX_SAMPLE_INTERVAL_MS = 500'],
  ['codex glide frame 10ms default', 'DEFAULT_CODEX_GLIDE_FRAME_MS = 10'],
  ['codex marker refresh 10ms default', 'DEFAULT_CODEX_MARKER_REFRESH_MS = 10'],
  ['codex motion crossfade default', 'DEFAULT_CODEX_MOTION_XFADE_MS = 480'],
  ['codex motion fade-in default', 'DEFAULT_CODEX_MOTION_FADE_IN_MS = 2400'],
  ['codex marker refresh 10ms floor', 'DEFAULT_CODEX_MARKER_REFRESH_MS,\n    10,\n    1000,'],
  ['codex spring zero-bounce default', 'DEFAULT_CODEX_SPRING_BOUNCE = 0.0'],
  ['codex spring critical frequency solver', 'function criticalSpringOmega(settlingSec, epsilon)'],
  ['codex spring inherited velocity no-overshoot solver', 'function criticalSpringOmegaForState(settlingSec, epsilon, displacement, initialVelocity)'],
  ['codex spring min default', 'DEFAULT_CODEX_SPRING_MIN_SEC = 1.6'],
  ['codex spring max default', 'DEFAULT_CODEX_SPRING_MAX_SEC = 6.0'],
  ['codex spring rate default', 'DEFAULT_CODEX_SPRING_RATE = 8.0'],
  ['codex spring time-warp default', 'DEFAULT_CODEX_SPRING_TIME_WARP = 5.0'],
  ['codex spring vector-blend default', 'DEFAULT_CODEX_SPRING_VECTOR_BLEND = 0.55'],
  ['codex vector ease-in power', 'CODEX_VECTOR_EASE_IN_POWER = 1.30'],
  ['codex vector ease-out power', 'CODEX_VECTOR_EASE_OUT_POWER = 1.01'],
  ['codex spring epsilon', 'DEFAULT_CODEX_SPRING_EPSILON = 0.001'],
  ['statusline 240 second token loop', 'const TOKEN_LOOP_SEC = 240.0'],
  ['codex marker x uv', 'CODEX_MARKER_UV_X = 0.0060'],
  ['codex marker y uv', 'CODEX_MARKER_UV_Y = 0.0180'],
  ['token level heartbeat output', 'function beaconSequence(level, heartbeat = 0)'],
  ['token level heartbeat pulse', 'const pulse = `${ESC}[48;2;0;0;${heartbeat % 2}m ${ESC}[0m`;'],
  ['token level top and bottom beacons', '${ESC}[1;1H${block}${ESC}[999;1H${block}${pulse}'],
  ['token level heartbeat visible', '${block}${pulse}'],
  ['token cleanup only touches beacon cells', '${ESC}7${ESC}[1;1H${clear}${ESC}[999;1H${clear}${ESC}8'],
  ['token level smooth write path', 'writeBeacon(current, heartbeat++)'],
  ['codex marker near-black encoder', 'function encodeCodexMarkerLevel(level, motionWeight = 1.0, highPrecision = false)'],
  ['codex marker level and motion checksum', 'function codexMarkerChecksum(fill, motion)'],
  ['codex marker high-precision level', '* 2047'],
  ['codex marker high-precision magic', 'const payload = precise | (0x2 << 11)'],
  ['codex marker high-precision inverse checksum', 'codexMarkerChecksum(fill, motion) ^ 0x1'],
  ['codex marker dynamic position', 'function codexMarkerPosition()'],
  ['codex marker column mapping', 'Math.floor(CODEX_MARKER_UV_X * columns) + 1'],
  ['codex marker row mapping', 'Math.floor(CODEX_MARKER_UV_Y * rows) + 1'],
  ['codex marker single-cell sequence', 'function codexMarkerSequence(level, motionWeight = 1.0, highPrecision = false)'],
  ['codex marker non-advancing erase', '${ESC}[1X'],
  ['codex marker encode test command', "mode === 'codex-marker-encode-test'"],
  ['codex marker sequence test command', "mode === 'codex-marker-sequence-test'"],
  ['codex marker frame test command', "mode === 'codex-marker-frame-test'"],
  ['codex marker transition output', 'writeCodexMarker(current, motion.value, highPrecision)'],
  ['codex marker framed pipe output', "CODEX_BLACKHOLE_MARKER_PIPE === '1'"],
  ['codex marker steady refresh deadline', 'atMs - lastWriteMs >= markerRefreshMs'],
  ['codex motion fades out before size', "phase === 'motion-out'"],
  ['codex size completes before motion fades in', "phase = 'motion-in'"],
  ['codex motion uses slower fade-in', 'setMotionTarget(1.0, atMs, motionFadeInMs)'],
  ['codex motion keeps fast fade-out', 'setMotionTarget(0.0, atMs, motionXfadeMs)'],
  ['codex motion weight uses smootherstep', 'const p = smootherstep01(elapsedMs / motionState.durationMs)'],
  ['codex sample timer', 'setInterval(sample, sampleIntervalMs)'],
  ['codex glide frame timer', 'setInterval(renderTransition, glideFrameMs)'],
  ['codex spring evaluator', 'function codexSpringStateAt(state, nowMs = Date.now())'],
  ['codex spring wall-time reparameterization', 'const elapsedSec = settlingSec * (1.0 - Math.pow(remaining, timeWarp))'],
  ['codex spring exact endpoint correction', 'sample.displacement - endpoint.displacement * endpointBlend'],
  ['codex spring full-duration vector blend', 'vectorBlend * vectorDisplacement'],
  ['codex spring short-tail vector ease', 'function shortTailVectorEase(x)'],
  ['codex marker-grid target quantization', 'Math.round(clamp(level, 0.0, 1.0) * 250.0) / 250.0'],
  ['codex high-precision size settlement', "if (phase === 'size' && sample.settled)"],
  ['codex spring initial velocity', 'initialVelocity: sample.velocity'],
  ['codex spring test command', "mode === 'codex-spring-sample-test'"],
  ['codex spring marker metrics command', "mode === 'codex-spring-marker-metrics-test'"],
  ['token disabled fallback stays negative', 'return level < 0.0 ? -1.0 : clamp(level, 0.0, 1.0);'],
  ['token glider syncs shader fallback', 'transitionDurationSec: durationMs / 1000.0'],
  ['token shader local time start', "const startToken = '0.0000';"],
  ['token wall phase helper', 'function tokenMotionTimeOffset(nowMs = Date.now())'],
  ['token wall phase shader write', '.replace(/#define\\s+TOKEN_MOTION_TIME_OFFSET'],
  ['token glide publish path', 'ensureLevelGlider(basePath, options)'],
  ['token glider start reservation', 'function reserveLevelGlider(basePath, pid, owner)'],
  ['token glider atomic startup lock', 'function acquireLevelGliderLock(basePath)'],
  ['token glider exclusive lock create', "fs.openSync(lockPath, 'wx')"],
  ['token glider lock recheck', 'if (canReuse(readJsonFile(levelGliderPath(basePath)))) return true;'],
  ['token glide disable switch', "BLACKHOLE_DISABLE_LEVEL_GLIDE === '1'"],
  ['token rollout parse cache', 'const rolloutLevelCache = new Map();'],
  ['token process rollout before sqlite', 'const fromRollout = rolloutLevel(rolloutPath);'],
  ['token live level cache verifies active shader', 'shaderLevelDefinesMatch(currentShader, token, fromToken, targetToken, startToken, durationToken, null)'],
  ['token live level cache define check', 'function shaderLevelDefinesMatch(filePath, token, fromToken, targetToken, startToken, durationToken, motionToken)'],
];

const BH_MODE_ANCHORS = [
  ['windows terminal settings reload wait env', "BLACKHOLE_WT_SETTINGS_RELOAD_MS"],
  ['windows terminal settings reload wait function', 'function waitForWtSettingsReload()'],
  ['windows terminal settings reload before open', 'waitForWtSettingsReload();'],
  ['token client seed fallback', 'function seedTokenFallback(text)'],
  ['token client seed excludes watcher tab', "canonicalMode(mode) === 'token' && ownerLabel !== 'token'"],
  ['token codex session keeps visible seed', "cmd === 'prepare-codex'"],
  ['token install wall phase helper', 'function tokenMotionTimeOffset(nowMs = Date.now())'],
  ['bh-mode 240 second token loop', 'const TOKEN_LOOP_SEC = 240.0'],
  ['token install wall phase write', '/#define\\s+TOKEN_MOTION_TIME_OFFSET'],
  ['windows terminal continuous shader repaint', "settings['experimental.rendering.forceFullRepaint'] = true"],
  ['launcher does not kill existing codex beacons', 'function stopRuntimeHelpers()'],
];

const BH_CMD_ANCHORS = [
  ['windows launcher forwards Codex marker interval', 'CODEX_BLACKHOLE_MARKER_MS/u'],
  ['windows launcher forwards Codex motion crossfade', 'CODEX_BLACKHOLE_MOTION_XFADE_MS/u'],
  ['windows launcher forwards Codex motion fade-in', 'CODEX_BLACKHOLE_MOTION_FADE_IN_MS/u'],
  ['windows launcher forwards spring bounce', 'CODEX_BLACKHOLE_SPRING_BOUNCE/u'],
  ['windows launcher forwards spring min', 'CODEX_BLACKHOLE_SPRING_MIN_SEC/u'],
  ['windows launcher forwards spring max', 'CODEX_BLACKHOLE_SPRING_MAX_SEC/u'],
  ['windows launcher forwards spring rate', 'CODEX_BLACKHOLE_SPRING_RATE/u'],
  ['windows launcher forwards spring time warp', 'CODEX_BLACKHOLE_SPRING_TIME_WARP/u'],
  ['windows launcher forwards spring vector blend', 'CODEX_BLACKHOLE_SPRING_VECTOR_BLEND/u'],
];

const SUPERVISOR_ANCHORS = [
  ['codex PTY command', "commandPath('script')"],
  ['codex synchronized frame parser', 'class TerminalOutputState'],
  ['codex synchronized frame begin', "const SYNC_BEGIN = '\\x1b[?2026h'"],
  ['codex synchronized frame end', "const SYNC_END = '\\x1b[?2026l'"],
  ['codex synchronized frame control-safe marker', 'flushMarkerAfterCodexOutput(true)'],
  ['codex control-safe output chunk marker', 'if (terminalOutput.isControlSafe()) flushMarkerAfterCodexOutput(true)'],
  ['codex marker committed inside synchronized frame', 'injectMarkerBeforeSyncEnds(chunk, latestMarker)'],
  ['codex marker framed pipe', "CODEX_BLACKHOLE_MARKER_PIPE: '1'"],
  ['codex beacon stdout pipe', "stdio: ['ignore', 'pipe', 'ignore']"],
  ['codex marker after output frame', 'flushMarkerAfterCodexOutput'],
  ['codex proxy self test', "process.argv[2] === '--proxy-self-test'"],
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

function parseLookArgs(args, label) {
  const values = String(args).split(',').map((value) => Number(value.trim()));
  if (values.length !== 14 || values.some((value) => !Number.isFinite(value))) {
    fail(`invalid ${label} DiskLook preset`);
    return [];
  }
  return values;
}

function extractGlslDemoTour(text) {
  const start = text.indexOf('const DiskLook DEMO_TOUR');
  const end = start < 0 ? -1 : text.indexOf('DiskLook mixLook', start);
  const body = start >= 0 && end > start ? text.slice(start, end) : '';
  return [...body.matchAll(/DiskLook\(([^)]*)\)/g)]
    .map((match, index) => parseLookArgs(match[1], `GLSL demoTour(${index})`));
}

function extractHlslDemoTour(text) {
  const body = text.match(/DiskLook demoTour\(int i\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const indexed = new Map();
  for (const match of body.matchAll(/if \(i == (\d+)\) return makeLook\(([^)]*)\);/g)) {
    indexed.set(Number(match[1]), parseLookArgs(match[2], `HLSL demoTour(${match[1]})`));
  }
  const fallback = body.match(/\n\s*return\s+makeLook\(([^)]*)\);/)?.[1] || '';
  const looks = [];
  for (let i = 0; i < 7; i += 1) looks.push(indexed.get(i) || []);
  looks.push(parseLookArgs(fallback, 'HLSL demoTour(7)'));
  return looks;
}

function mixVector(a, b, t) {
  return a.map((value, index) => value + (b[index] - value) * t);
}

function maxVectorError(a, b) {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  return Math.max(...a.map((value, index) => Math.abs(value - b[index])));
}

function mix2(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function tokenLoopWander(a) {
  return [
    0.75 * Math.sin(a) + 0.25 * Math.sin(2.0 * a + 1.0),
    0.70 * Math.sin(a + 2.1) + 0.30 * Math.sin(3.0 * a),
  ];
}

function tokenLoopWanderVelocity(a, turns) {
  return [
    turns * (0.75 * Math.cos(a) + 0.50 * Math.cos(2.0 * a + 1.0)),
    turns * (0.70 * Math.cos(a + 2.1) + 0.90 * Math.cos(3.0 * a)),
  ];
}

function tokenLoopWobble(a, xTurns, yTurns) {
  return [Math.cos(a * xTurns), Math.sin(a * yTurns)];
}

function tokenLoopWobbleVelocity(a, xTurns, yTurns) {
  return [
    -xTurns * Math.sin(a * xTurns),
    yTurns * Math.cos(a * yTurns),
  ];
}

function tokenClosedPath(phase, level, calmTurns, rushTurns, wobbleXTurns, wobbleYTurns) {
  const calmPhase = phase * calmTurns;
  const rushPhase = phase * rushTurns;
  const wander = mix2(tokenLoopWander(calmPhase), tokenLoopWander(rushPhase), level);
  const wobble = tokenLoopWobble(phase, wobbleXTurns, wobbleYTurns);
  return [wander[0] + 0.1 * wobble[0], wander[1] + 0.1 * wobble[1]];
}

function tokenClosedVelocity(phase, level, calmTurns, rushTurns, wobbleXTurns, wobbleYTurns) {
  const calmPhase = phase * calmTurns;
  const rushPhase = phase * rushTurns;
  const wander = mix2(
    tokenLoopWanderVelocity(calmPhase, calmTurns),
    tokenLoopWanderVelocity(rushPhase, rushTurns),
    level,
  );
  const wobble = tokenLoopWobbleVelocity(phase, wobbleXTurns, wobbleYTurns);
  return [wander[0] + 0.1 * wobble[0], wander[1] + 0.1 * wobble[1]];
}

function vectorError(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function codexSpringSample(
  from, target, velocity, settlingSec, timeSec, bounce = 0.0, timeWarp = 5.0, vectorBlend = 0.55,
) {
  try {
    const output = childProcess.execFileSync(
      process.execPath,
      [STATUSLINE, 'codex-spring-sample-test', String(from), String(target),
        String(velocity), String(settlingSec), String(timeSec), String(bounce), String(timeWarp),
        String(vectorBlend)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(output);
  } catch (error) {
    fail(`Codex spring sample command failed: ${error.message}`);
    return { position: Number.NaN, velocity: Number.NaN, settled: false };
  }
}

function codexSpringMarkerMetrics(from, target, settlingMs = 6000, stepMs = 10) {
  try {
    const output = childProcess.execFileSync(
      process.execPath,
      [STATUSLINE, 'codex-spring-marker-metrics-test', String(from), String(target),
        String(settlingMs), String(stepMs)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(output);
  } catch (error) {
    fail(`Codex spring marker metrics command failed: ${error.message}`);
    return { changes: 0, maxGapMs: Number.POSITIVE_INFINITY, lastChangeMs: 0 };
  }
}

const glsl = read(GLSL);
const hlsl = read(HLSL);
const statusline = read(STATUSLINE);
const bhMode = read(BH_MODE);
const bhCmd = read(BH_CMD);
const supervisor = read(SUPERVISOR);
const glslConstants = extractConstants(glsl);
const hlslConstants = extractConstants(hlsl);
let supervisorProxySamples = 0;
try {
  const output = childProcess.execFileSync(
    process.execPath,
    [SUPERVISOR, '--proxy-self-test'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (output.trim() !== 'OK: Codex PTY marker proxy parser verified.') {
    fail(`Codex supervisor proxy self-test mismatch: ${JSON.stringify(output)}`);
  } else {
    supervisorProxySamples = 1;
  }
} catch (error) {
  fail(`Codex supervisor proxy self-test failed: ${error.message}`);
}

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

const glslDemoLooks = extractGlslDemoTour(glsl);
const hlslDemoLooks = extractHlslDemoTour(hlsl);
if (glslDemoLooks.length !== 8 || hlslDemoLooks.length !== 8) {
  fail(`demo tour preset count mismatch: GLSL=${glslDemoLooks.length} HLSL=${hlslDemoLooks.length}`);
} else {
  for (let i = 0; i < glslDemoLooks.length; i += 1) {
    const error = maxVectorError(glslDemoLooks[i], hlslDemoLooks[i]);
    if (!Number.isFinite(error) || error > 1e-9) {
      fail(`demoTour(${i}) differs from upstream: error=${error}`);
    }
  }
}

const codexMarkerCodecLevels = [0.0, 0.02, 0.5, 1.0];
const codexMarkerMotionWeights = [0.0, 0.5, 1.0];
let codexMarkerCodecSamples = 0;
for (const level of codexMarkerCodecLevels) {
  for (const motionWeight of codexMarkerMotionWeights) {
    let encoded = '';
    try {
      encoded = childProcess.execFileSync(
        process.execPath,
        [STATUSLINE, 'codex-marker-encode-test', String(level), String(motionWeight)],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
    } catch (error) {
      fail(`codex marker codec command failed at level ${level}, motion ${motionWeight}: ${error.message}`);
      continue;
    }

    const match = encoded.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!match) {
      fail(`invalid codex marker codec output at level ${level}, motion ${motionWeight}: ${encoded}`);
      continue;
    }
    const [r, g, b] = match.slice(1).map((value) => Number.parseInt(value, 16));
    const packed = (r << 10) | (g << 5) | b;
    const fill = packed & 0xff;
    const motion = (packed >> 8) & 0x1f;
    const checksum = (packed >> 13) & 0x1;
    const expectedFill = Math.round(level * 250);
    const expectedMotion = Math.round(motionWeight * 31);
    const expectedChecksum = (fill ^ (fill >> 4) ^ motion ^ 0x1) & 0x1;
    if ((packed >> 14) !== 1 || Math.max(r, g, b) > 0x1f || r < 0x10 ||
        checksum !== expectedChecksum || fill !== expectedFill || motion !== expectedMotion) {
      fail(`codex marker codec mismatch at level ${level}, motion ${motionWeight}: ${encoded}`);
    }
    if (Math.abs(fill / 250.0 - level) > 1.0 / 250.0 ||
        Math.abs(motion / 31.0 - motionWeight) > 1.0 / 31.0) {
      fail(`codex marker codec round-trip error at level ${level}, motion ${motionWeight}: ${encoded}`);
    }
    codexMarkerCodecSamples += 1;
  }
}

for (const level of codexMarkerCodecLevels) {
  const encoded = childProcess.execFileSync(
    process.execPath,
    [STATUSLINE, 'codex-marker-encode-test', String(level), '0', 'high'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  const match = encoded.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) {
    fail(`invalid high-precision Codex marker output at level ${level}: ${encoded}`);
    continue;
  }
  const [r, g, b] = match.slice(1).map((value) => Number.parseInt(value, 16));
  const packed = (r << 10) | (g << 5) | b;
  const payload = packed & 0x1fff;
  const precise = payload & 0x7ff;
  const fill = payload & 0xff;
  const motion = (payload >> 8) & 0x1f;
  const checksum = (packed >> 13) & 0x1;
  const expectedChecksum = ((fill ^ (fill >> 4) ^ motion ^ 0x1) & 0x1) ^ 0x1;
  if ((packed >> 14) !== 1 || ((payload >> 11) & 0x3) !== 0x2 ||
      checksum !== expectedChecksum || precise !== Math.round(level * 2047) ||
      Math.max(r, g, b) > 0x1f || r < 0x14) {
    fail(`high-precision Codex marker mismatch at level ${level}: ${encoded}`);
  }
  if (Math.abs(precise / 2047.0 - level) > 1.0 / 2047.0) {
    fail(`high-precision Codex marker round-trip error at level ${level}: ${encoded}`);
  }
  codexMarkerCodecSamples += 1;
}

try {
  const markerSequence = childProcess.execFileSync(
    process.execPath,
    [STATUSLINE, 'codex-marker-sequence-test', '0.02'],
    {
      encoding: 'utf8',
      env: { ...process.env, COLUMNS: '200', LINES: '100' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const expectedMarkerSequence = '\x1b7\x1b[2;2H\x1b[48;2;31;24;5m\x1b[1X\x1b[0m\x1b8';
  if (markerSequence !== expectedMarkerSequence) {
    fail(`Codex marker sequence mismatch: ${JSON.stringify(markerSequence)}`);
  }
} catch (error) {
  fail(`Codex marker sequence command failed: ${error.message}`);
}

try {
  const markerFrame = childProcess.execFileSync(
    process.execPath,
    [STATUSLINE, 'codex-marker-frame-test', '0.02'],
    {
      encoding: 'utf8',
      env: { ...process.env, CODEX_BLACKHOLE_MARKER_PIPE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (markerFrame !== '[31,24,5,0.006,0.018]\n') {
    fail(`Codex marker frame mismatch: ${JSON.stringify(markerFrame)}`);
  }
} catch (error) {
  fail(`Codex marker frame command failed: ${error.message}`);
}

const springEpsilon = 0.001;
const springSettlingSec = 6.0;
const criticalSpringTimes = [0.0, 0.6, 1.5, 3.0, 4.5, 5.999];
let previousCriticalPosition = -Infinity;
for (const timeSec of criticalSpringTimes) {
  const sample = codexSpringSample(0.0, 1.0, 0.0, springSettlingSec, timeSec, 0.0);
  if (sample.position < previousCriticalPosition - 1e-9 ||
      sample.position < -1e-9 || sample.position > 1.0 + 1e-9 ||
      sample.velocity < -1e-9) {
    fail(`zero-bounce spring must be monotonic at ${timeSec}s: ${JSON.stringify(sample)}`);
  }
  previousCriticalPosition = sample.position;
}

const springNearSettle = codexSpringSample(0.0, 1.0, 0.0, springSettlingSec, 5.999, 0.0);
if (Math.abs(springNearSettle.position - 1.0) >= 1.0 / 500.0) {
  fail(`spring position did not settle: ${springNearSettle.position}`);
}
const springExactEnd = codexSpringSample(0.0, 1.0, 0.0, springSettlingSec, springSettlingSec, 0.0);
if (!springExactEnd.settled || springExactEnd.position !== 1.0 || springExactEnd.velocity !== 0.0) {
  fail(`spring endpoint must be exact and stationary: ${JSON.stringify(springExactEnd)}`);
}
const springPreviousCurveEarly = codexSpringSample(
  0.0, 1.0, 0.0, springSettlingSec, 0.25, 0.0, 1.6, 0.0,
);
const springStrongWarpEarly = codexSpringSample(
  0.0, 1.0, 0.0, springSettlingSec, 0.25, 0.0, 5.0, 0.55,
);
if (springStrongWarpEarly.position <= springPreviousCurveEarly.position + 0.04 ||
    springStrongWarpEarly.velocity <= springPreviousCurveEarly.velocity + 0.05) {
  fail('spring time warp must strengthen early acceleration without shortening the transition');
}
const springVisibleTail = codexSpringSample(0.02, 0.952, 0.0, springSettlingSec, 5.0);
const springVisibleTailFill = Math.round(springVisibleTail.position * 250.0);
if (springVisibleTailFill === Math.round(0.952 * 250.0)) {
  fail('spring vector blend must retain an encoded size step near the end of a long transition');
}
const springMarkerMetrics = codexSpringMarkerMetrics(0.02, 0.952);
if (springMarkerMetrics.maxGapMs > 20 || springMarkerMetrics.lastChangeMs < 5990) {
  fail(`spring marker tail is not visually continuous: ${JSON.stringify(springMarkerMetrics)}`);
}

const springOldState = codexSpringSample(0.02, 0.95, 0.0, springSettlingSec, 1.4);
const springRetargetStart = codexSpringSample(
  springOldState.position,
  0.20,
  springOldState.velocity,
  springSettlingSec,
  0.0,
);
if (Math.abs(springRetargetStart.position - springOldState.position) > 1e-9 ||
    Math.abs(springRetargetStart.velocity - springOldState.velocity) > 1e-9) {
  fail('spring retarget must preserve position and velocity');
}
const springMovingAtTarget = codexSpringSample(0.5, 0.5, 1.0, 1.6, 0.0);
const springMovingAtTargetNearSettle = codexSpringSample(0.5, 0.5, 1.0, 1.6, 1.599);
if (Math.abs(springMovingAtTarget.velocity - 1.0) > 1e-9 ||
    Math.abs(springMovingAtTargetNearSettle.position - 0.5) >= 1.0 / 250.0 ||
    Math.abs(springMovingAtTargetNearSettle.velocity) >= 1.0 / 250.0) {
  fail('spring must preserve and smoothly damp velocity when retargeted at its current position');
}

const noOvershootRetargetTimes = [0.0, 0.05, 0.1, 0.2, 0.4, 1.599];
let previousRetargetUp = 0.5;
let previousRetargetDown = 0.5;
for (const timeSec of noOvershootRetargetTimes) {
  const up = codexSpringSample(0.5, 0.55, 1.0, 1.6, timeSec, 0.0);
  const down = codexSpringSample(0.5, 0.45, -1.0, 1.6, timeSec, 0.0);
  if (up.position < previousRetargetUp - 1e-9 || up.position > 0.55 + 1e-9 ||
      up.velocity < -1e-9) {
    fail(`zero-bounce upward retarget crossed its target at ${timeSec}s: ${JSON.stringify(up)}`);
  }
  if (down.position > previousRetargetDown + 1e-9 || down.position < 0.45 - 1e-9 ||
      down.velocity > 1e-9) {
    fail(`zero-bounce downward retarget crossed its target at ${timeSec}s: ${JSON.stringify(down)}`);
  }
  previousRetargetUp = up.position;
  previousRetargetDown = down.position;
}
const codexSpringVerificationSamples = criticalSpringTimes.length + 10 +
  noOvershootRetargetTimes.length * 2;

const tokenLoopLevels = [0.0, 0.25, 0.5, 0.75, 1.0];
const calmTurns = Number(hlslConstants.get('TOKEN_CALM_TURNS'));
const rushTurns = Number(hlslConstants.get('TOKEN_RUSH_TURNS'));
const wobbleXTurns = Number(hlslConstants.get('TOKEN_WOBBLE_X_TURNS'));
const wobbleYTurns = Number(hlslConstants.get('TOKEN_WOBBLE_Y_TURNS'));
for (const level of tokenLoopLevels) {
  const p0 = tokenClosedPath(0.0, level, calmTurns, rushTurns, wobbleXTurns, wobbleYTurns);
  const p1 = tokenClosedPath(Math.PI * 2.0, level, calmTurns, rushTurns, wobbleXTurns, wobbleYTurns);
  const v0 = tokenClosedVelocity(0.0, level, calmTurns, rushTurns, wobbleXTurns, wobbleYTurns);
  const v1 = tokenClosedVelocity(Math.PI * 2.0, level, calmTurns, rushTurns, wobbleXTurns, wobbleYTurns);
  const positionError = vectorError(p0, p1);
  const velocityError = vectorError(v0, v1);
  if (!Number.isFinite(positionError) || positionError > 1e-6) {
    fail(`token loop position does not close at level ${level}: error=${positionError}`);
  }
  if (!Number.isFinite(velocityError) || velocityError > 1e-5) {
    fail(`token loop velocity does not close at level ${level}: error=${velocityError}`);
  }
}

for (const [label, glslNeedle, hlslNeedle] of FORMULA_ANCHORS) {
  if (!glsl.includes(glslNeedle)) fail(`missing GLSL formula anchor: ${label}`);
  if (!hlsl.includes(hlslNeedle)) fail(`missing HLSL formula anchor: ${label}`);
}

for (const [label, glslNeedle, hlslNeedle] of HOST_ADAPTATION_ANCHORS) {
  if (glslNeedle && !glsl.includes(glslNeedle)) fail(`missing GLSL host anchor: ${label}`);
  if (hlslNeedle && !hlsl.includes(hlslNeedle)) fail(`missing HLSL host anchor: ${label}`);
}

for (const [label, needle] of STATUSLINE_ANCHORS) {
  if (!statusline.includes(needle)) fail(`missing statusline anchor: ${label}`);
}
const tokenTourBody = hlsl.match(/DiskLook tokenTour\(int i\)[\s\S]*?\n\}/)?.[0] || '';
const tokenTourOrder = [...tokenTourBody.matchAll(/if \(i == \d+\) return demoTour\((\d+)\);/g)]
  .map((match) => Number(match[1]));
const tokenTourFallback = tokenTourBody.match(/\n\s*return demoTour\((\d+)\);/)?.[1];
if (tokenTourFallback !== undefined) tokenTourOrder.push(Number(tokenTourFallback));
const expectedTokenTourOrder = [1, 2, 3, 4, 5, 6, 0];
if (tokenTourOrder.length !== expectedTokenTourOrder.length ||
    tokenTourOrder.some((value, index) => value !== expectedTokenTourOrder[index])) {
  fail(`tokenTour order mismatch: expected=${expectedTokenTourOrder.join(',')} actual=${tokenTourOrder.join(',')}`);
}

const tokenLookBody = hlsl.match(/DiskLook tokenLook\(float lvl\)[\s\S]*?\n\}/)?.[0] || '';
if (!tokenLookBody.includes('float u = clamp(lvl, 0.0, 1.0) * 6.0;') ||
    !tokenLookBody.includes('float f = u - float(i);') ||
    !tokenLookBody.includes('mixLook(tokenTour(i), tokenTour(i + 1), f)')) {
  fail('tokenLook must linearly traverse every unique upstream demo preset');
}
if (tokenLookBody.includes('smoothstep(') || tokenLookBody.includes('Time')) {
  fail('tokenLook must not add an independent easing or time source');
}

const tokenLookKnotLevels = expectedTokenTourOrder.map(
  (_, index) => index / (expectedTokenTourOrder.length - 1),
);
if (glslDemoLooks.length === 8 && tokenTourOrder.length === expectedTokenTourOrder.length) {
  const tokenLookSample = (level) => {
    const u = Math.min(1.0, Math.max(0.0, level)) * (tokenTourOrder.length - 1);
    const i = Math.min(Math.floor(u), tokenTourOrder.length - 2);
    return mixVector(
      glslDemoLooks[tokenTourOrder[i]],
      glslDemoLooks[tokenTourOrder[i + 1]],
      u - i,
    );
  };
  for (let i = 0; i < tokenLookKnotLevels.length; i += 1) {
    const error = maxVectorError(
      tokenLookSample(tokenLookKnotLevels[i]),
      glslDemoLooks[expectedTokenTourOrder[i]],
    );
    if (!Number.isFinite(error) || error > 1e-9) {
      fail(`tokenLook knot ${i} does not match demoTour(${expectedTokenTourOrder[i]}): error=${error}`);
    }
  }
  for (let i = 1; i < tokenTourOrder.length - 1; i += 1) {
    const left = mixVector(glslDemoLooks[tokenTourOrder[i - 1]], glslDemoLooks[tokenTourOrder[i]], 1.0);
    const right = mixVector(glslDemoLooks[tokenTourOrder[i]], glslDemoLooks[tokenTourOrder[i + 1]], 0.0);
    const error = maxVectorError(left, right);
    if (!Number.isFinite(error) || error > 1e-9) {
      fail(`tokenLook is discontinuous at knot ${i}: error=${error}`);
    }
  }
}
const codexMarkerHlslBody = hlsl.match(/float2 tokenCodexMarkerData\([^)]*\)[\s\S]*?\n\}/)?.[0] || '';
const codexMarkerSampleCount = (codexMarkerHlslBody.match(/shaderTexture\.Sample/g) || []).length;
if (codexMarkerSampleCount !== 1) {
  fail(`tokenCodexMarkerData must use exactly one shader texture sample, found ${codexMarkerSampleCount}`);
}
if (!hlsl.includes('float2 codexMarkerFromRgb(float3 c)') ||
    !hlsl.includes('int codexMarkerChecksum(int fill, int motion)') ||
    !hlsl.includes('int highPrecisionMagic = (payload >> 11) & 0x3;') ||
    !hlsl.includes('float(precise) / 2047.0') ||
    !hlsl.includes('float motionBlend = smootherstep01(motionWeight);') ||
    !hlsl.includes('center = (lo + hi) * 0.5 + pathOffset * motionBlend;')) {
  fail('Codex marker must decode motion weight and gate the closed-loop path');
}
if (hlsl.includes('tokenBackgroundLevel(') || hlsl.includes('tokenBackgroundTextureLevel(')) {
  fail('the rejected OSC background token channel must not remain in HLSL');
}

const topUv = hlsl.match(/TOKEN_DATA_UV_TOP\s*=\s*float2\(([-+\d.]+),\s*([-+\d.]+)\)/);
const markerUvX = statusline.match(/CODEX_MARKER_UV_X\s*=\s*([-+\d.]+)/);
const markerUvY = statusline.match(/CODEX_MARKER_UV_Y\s*=\s*([-+\d.]+)/);
if (!topUv || !markerUvX || !markerUvY ||
    Math.abs(Number(topUv[1]) - Number(markerUvX[1])) > 1e-9 ||
    Math.abs(Number(topUv[2]) - Number(markerUvY[1])) > 1e-9) {
  fail('Codex marker terminal position must match TOKEN_DATA_UV_TOP');
}

const codexMarkerSequenceBody = statusline.match(/function codexMarkerSequence\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || '';
const markerBlockCount = (codexMarkerSequenceBody.match(/\[48;2;/g) || []).length;
if (markerBlockCount !== 1 || codexMarkerSequenceBody.includes('[999;') ||
    codexMarkerSequenceBody.includes('pulse') || !codexMarkerSequenceBody.includes('${ESC}[1X')) {
  fail('codexMarkerSequence must erase exactly one dynamically positioned cell without advancing the cursor');
}
if (statusline.includes('backgroundLevelSequence(') || statusline.includes('writeBackgroundLevel(')) {
  fail('the rejected OSC 11 background channel must not remain in the statusline runtime');
}

const codexBeaconBody = statusline.match(/function codexBeacon\(\) \{[\s\S]*?\n\}/)?.[0] || '';
if (!codexBeaconBody.includes('writeCodexMarker(')) {
  fail('codexBeacon must publish levels through the per-terminal Codex marker');
}
if (!codexBeaconBody.includes('codexSpringStateAt(')) {
  fail('codexBeacon must evaluate the persistent Codex spring');
}
if (!codexBeaconBody.includes('Math.abs(sample.velocity) <= springOptions.epsilon')) {
  fail('codexBeacon must only stop a retargeted spring when both position and velocity are settled');
}
if (codexBeaconBody.includes('currentGlideLevel(')) {
  fail('codexBeacon must not fall back to the legacy positional glide');
}
if (codexBeaconBody.includes('writeBeacon(') ||
    codexBeaconBody.includes('writeRedrawPulse(') ||
    codexBeaconBody.includes('writeBackgroundLevel(')) {
  fail('codexBeacon must only use the top safe-zone single-cell writer');
}
if (codexBeaconBody.includes('publishLevel(') ||
    codexBeaconBody.includes('ensureLevelGlider(') ||
    codexBeaconBody.includes('writeLevelTarget(') ||
    codexBeaconBody.includes('updateShaderLevel(')) {
  fail('codexBeacon must own transitions without level-glider or shader reloads');
}
if (codexBeaconBody.includes('claimLiveOwner(') || codexBeaconBody.includes('hasLiveOwnerAccess(')) {
  fail('codexBeacon marker output is per terminal and must not use the shared shader owner');
}
if (statusline.includes('TOKEN_PACKET_') || hlsl.includes('TOKEN_PACKET_')) {
  fail('unused multi-cell token packet protocol must be removed');
}
const levelWatchBody = statusline.match(/function levelWatch\(\) \{[\s\S]*?\n\}/)?.[0] || '';
if (levelWatchBody.includes('writeCurrentLevel(') ||
    levelWatchBody.includes('levelCommandPath(')) {
  fail('levelWatch must only forward glider current state');
}

for (const [label, needle] of BH_MODE_ANCHORS) {
  if (!bhMode.includes(needle)) fail(`missing bh-mode anchor: ${label}`);
}
if (bhMode.includes("blackhole-statusline[.]js codex-beacon") ||
    bhMode.includes("xargs -r kill -TERM")) {
  fail('bh-mode must not kill existing codex-beacon processes');
}

for (const [label, needle] of BH_CMD_ANCHORS) {
  if (!bhCmd.includes(needle)) fail(`missing bh.cmd anchor: ${label}`);
}

for (const [label, needle] of SUPERVISOR_ANCHORS) {
  if (!supervisor.includes(needle)) fail(`missing supervisor anchor: ${label}`);
}

if (!process.exitCode) {
  console.log(`OK: ${MODEL_CONSTANTS.length} model constants, ${LOCAL_TUNING_CONSTANTS.size} local tuning constants, ${FORMULA_ANCHORS.length} formula anchors, ${HOST_ADAPTATION_ANCHORS.length} host-adaptation anchors, ${STATUSLINE_ANCHORS.length} statusline anchors, ${BH_MODE_ANCHORS.length} bh-mode anchors, ${BH_CMD_ANCHORS.length} bh.cmd anchors, ${SUPERVISOR_ANCHORS.length} supervisor anchors, ${supervisorProxySamples} supervisor-proxy samples, ${glslDemoLooks.length} demo-tour presets, ${tokenLookKnotLevels.length} token-look knots, ${codexMarkerCodecSamples} Codex-marker codec samples, 1 Codex-marker layout sample, ${codexSpringVerificationSamples} Codex-spring samples, and ${tokenLoopLevels.length} token-loop samples verified.`);
}
