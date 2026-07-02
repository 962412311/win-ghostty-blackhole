// blackhole_winterminal.hlsl
// Windows Terminal HLSL port of ghostty-blackhole.
// Host adaptation is limited to uniforms/texture sampling:
//   iResolution -> Resolution, iTime -> Time, iChannel0 -> shaderTexture.

Texture2D shaderTexture;
SamplerState samplerState;

cbuffer PixelShaderSettings
{
    float Time;
    float Scale;
    float2 Resolution;
    float4 Background;
};

#define B_CRIT 2.5980762
#define N_STEPS 48

#define MODE_POMODORO 0
#define MODE_TOKENS   1
#define MODE_DEMO     2
#define SIZE_MODE MODE_TOKENS
#define DEBUG_PASSTHROUGH 0
#define DEBUG_TOKEN_SAMPLE_POINT 0
#define TOKEN_LEVEL -1

#if DEBUG_PASSTHROUGH
float4 main(float4 pos : SV_POSITION, float2 tex : TEXCOORD) : SV_TARGET
{
    return shaderTexture.Sample(samplerState, tex);
}
#else

// ---------------------------------------------------------------- tunables --
static const float HOLE_RADIUS   = 0.0200;
static const float LENS_DEPTH    = 13.0000;
static const float STAR_GAIN     = 0.0000;
static const float DISK_INNER    = 1.8000;
static const float DISK_OUTER    = 8.0000;
static const float DISK_INCL     = 1.5000;
static const float DISK_ROLL     = 0.3500;
static const float DISK_GAIN     = 2.2000;
static const float DISK_OPACITY  = 0.9000;
static const float DISK_TEMP     = 5500.0000;
static const float DOPPLER_MIX   = 0.6000;
static const float DISK_BEAM     = 2.5000;
static const float DISK_SPEED    = 5.0000;
static const float DISK_WIND     = 7.0000;
static const float DISK_CONTRAST = 1.6000;
static const float EXPOSURE      = 1.4000;
static const float DRIFT_SPEED   = 1.0000;
static const float WORK_AREA     = 0.3300;
static const float DILATION_MIN  = 0.2000;
static const float TOKEN_AREA_MIN = 0.0030;
static const float TOKEN_AREA_MAX = 0.5000;
static const float TOKEN_HOME_X  = 0.9600;
static const float TOKEN_HOME_Y  = 0.0400;
static const float TOKEN_EASE    = 1.0000;
static const float TOKEN_REACH   = 1.0000;
static const float TOKEN_CALM    = 0.0050;
static const float TOKEN_RUSH    = 0.1375;

static const float DEMO_SEC      = 42.0000;
static const float DEMO_GROW_SEC = 40.0000;
static const float DEMO_XFADE    = 0.1800;
static const float DEMO_LEVEL_FLOOR = 0.0350;
static const int DEMO_N = 8;

static const float TOKEN_GLIDE_MIN  = 0.3000;
static const float TOKEN_GLIDE_MAX  = 1.5000;
static const float TOKEN_GLIDE_RATE = 10.0000;
static const float WORK_PERIOD_MIN  = 55.0000;
static const float BREAK_MIN        = 5.0000;
static const float IDLE_FADE_SEC    = 90.0000;
static const float TIME_SCALE       = 1.0000;
static const float POMODORO_WALL_OFFSET = 0.0000;
static const float2 TOKEN_DATA_UV_TOP = float2(0.0060, 0.0180);
static const float2 TOKEN_DATA_UV_BOTTOM = float2(0.0060, 0.9970);
static const float TOKEN_DATA_X_STEP = 0.0040;
static const float TOKEN_DATA_Y_STEP = 0.0120;

struct DiskLook
{
    float temp;
    float incl;
    float roll;
    float inner;
    float outer;
    float opac;
    float dopp;
    float beam;
    float gain;
    float contr;
    float wind;
    float speed;
    float expo;
    float star;
};

DiskLook makeLook(float temp, float incl, float roll, float inner, float outer,
                  float opac, float dopp, float beam, float gain, float contr,
                  float wind, float speed, float expo, float star)
{
    DiskLook L;
    L.temp = temp;
    L.incl = incl;
    L.roll = roll;
    L.inner = inner;
    L.outer = outer;
    L.opac = opac;
    L.dopp = dopp;
    L.beam = beam;
    L.gain = gain;
    L.contr = contr;
    L.wind = wind;
    L.speed = speed;
    L.expo = expo;
    L.star = star;
    return L;
}

DiskLook lookDefault()
{
    return makeLook(DISK_TEMP, DISK_INCL, DISK_ROLL, DISK_INNER, DISK_OUTER,
                    DISK_OPACITY, DOPPLER_MIX, DISK_BEAM, DISK_GAIN,
                    DISK_CONTRAST, DISK_WIND, DISK_SPEED, EXPOSURE, STAR_GAIN);
}

DiskLook demoTour(int i)
{
    if (i == 0) return makeLook( 5500.0, 1.50,  0.35, 1.8,  8.0, 0.90, 0.60, 2.5, 2.2, 1.6, 7.0, 5.0, 1.40, 0.0);
    if (i == 1) return makeLook( 4500.0, 1.52,  0.10, 2.2,  7.0, 0.85, 0.35, 2.0, 1.4, 0.5, 7.0, 5.0, 1.20, 0.0);
    if (i == 2) return makeLook( 3800.0, 0.55, -0.30, 2.2,  6.0, 0.45, 0.90, 3.5, 1.6, 0.4, 3.0, 2.5, 1.10, 0.0);
    if (i == 3) return makeLook( 6500.0, 0.30,  0.00, 3.0, 10.0, 0.50, 0.80, 2.5, 1.0, 1.1, 7.0, 5.0, 1.00, 0.0);
    if (i == 4) return makeLook(15000.0, 1.30,  0.35, 3.0, 14.0, 0.35, 1.00, 4.0, 1.2, 1.3, 8.0, 5.0, 0.80, 0.0);
    if (i == 5) return makeLook(18000.0, 1.05,  0.55, 3.0, 16.0, 0.30, 1.00, 5.0, 1.0, 1.5, 9.0, 6.0, 0.75, 0.0);
    if (i == 6) return makeLook( 5500.0, 1.50,  0.35, 1.8,  8.0, 0.00, 1.00, 2.5, 0.0, 1.6, 7.0, 5.0, 1.00, 0.6);
    return         makeLook( 5500.0, 1.50,  0.35, 1.8,  8.0, 0.90, 0.60, 2.5, 2.2, 1.6, 7.0, 5.0, 1.40, 0.0);
}

DiskLook mixLook(DiskLook a, DiskLook b, float f)
{
    return makeLook(
        lerp(a.temp,  b.temp,  f), lerp(a.incl,  b.incl,  f),
        lerp(a.roll,  b.roll,  f), lerp(a.inner, b.inner, f),
        lerp(a.outer, b.outer, f), lerp(a.opac,  b.opac,  f),
        lerp(a.dopp,  b.dopp,  f), lerp(a.beam,  b.beam,  f),
        lerp(a.gain,  b.gain,  f), lerp(a.contr, b.contr, f),
        lerp(a.wind,  b.wind,  f), lerp(a.speed, b.speed, f),
        lerp(a.expo,  b.expo,  f), lerp(a.star,  b.star,  f));
}

DiskLook demoLook(float lvl)
{
    float u = clamp(lvl, 0.0, 1.0) * (float(DEMO_N) - 1.0);
    int i = int(min(u, float(DEMO_N) - 1.001));
    float f = smoothstep(1.0 - DEMO_XFADE, 1.0, u - float(i));
    return mixLook(demoTour(i), demoTour(i + 1), f);
}

float demoForwardLevel()
{
    float u = fmod(Time, DEMO_SEC);
    return min(u / DEMO_GROW_SEC, 1.0);
}

float demoPhase()
{
    return demoForwardLevel() * 6.2831853;
}

float demoLevel()
{
    float u = fmod(Time, DEMO_SEC);
    float grow = demoForwardLevel();
    float reset = 1.0 - smoothstep(DEMO_GROW_SEC, DEMO_SEC, u);
    return max(grow * reset, DEMO_LEVEL_FLOOR);
}

float demoLookLevel()
{
    return demoForwardLevel();
}

float demoAnimTime()
{
    return demoForwardLevel() * DEMO_GROW_SEC;
}

float2 demoLoopWander()
{
    float a = demoPhase();
    return float2(0.75 * sin(a) + 0.25 * sin(2.0 * a + 1.0),
                  0.70 * sin(a + 2.1) + 0.30 * sin(3.0 * a));
}

// ------------------------------------------------------------------- noise --
float hash21(float2 p)
{
    p = frac(p * float2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return frac(p.x * p.y);
}

float vnoiseWrapY(float2 p, float perY)
{
    float2 i = floor(p);
    float2 f = frac(p);
    f = f * f * (3.0 - 2.0 * f);
    float y0 = i.y - floor(i.y / perY) * perY;
    float y1 = (i.y + 1.0) - floor((i.y + 1.0) / perY) * perY;
    return lerp(lerp(hash21(float2(i.x, y0)),       hash21(float2(i.x + 1.0, y0)), f.x),
                lerp(hash21(float2(i.x, y1)),       hash21(float2(i.x + 1.0, y1)), f.x),
                f.y);
}

float2 mirrorUV(float2 u)
{
    float2 m = u - floor(u / 2.0) * 2.0;
    return 1.0 - abs(1.0 - m);
}

float2 rot(float2 v, float a)
{
    float c = cos(a);
    float s = sin(a);
    return float2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float2 lissa(float t)
{
    return float2(0.75 * sin(t * 0.37) + 0.25 * sin(t * 0.83 + 1.0),
                  0.70 * sin(t * 0.54 + 2.1) + 0.30 * sin(t * 1.07));
}

float3 blackbody(float T)
{
    float t = clamp(T, 1500.0, 40000.0) / 100.0;
    float r = t <= 66.0 ? 1.0
                        : clamp(1.292936 * pow(t - 60.0, -0.1332047), 0.0, 1.0);
    float g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0)
                        : clamp(1.1298909 * pow(t - 60.0, -0.0755148), 0.0, 1.0);
    float b = t >= 66.0 ? 1.0
                        : (t <= 19.0 ? 0.0
                                     : clamp(0.5432068 * log(t - 10.0) - 1.1962540, 0.0, 1.0));
    return float3(r, g, b);
}

float3 stars(float3 d)
{
    float2 sph = float2(atan2(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0)));
    float2 g = sph * 40.0;
    float2 id = floor(g);
    float h = hash21(id);
    if (h < 0.92) return float3(0.0, 0.0, 0.0);
    float2 f = frac(g) - 0.5;
    float2 off = (float2(hash21(id + 17.3), hash21(id + 31.7)) - 0.5) * 0.7;
    float spark = smoothstep(0.10, 0.0, length(f - off));
    float tw = 0.7 + 0.3 * sin(Time * (0.5 + 2.0 * hash21(id + 5.1)) + 40.0 * h);
    float3 tint = lerp(float3(1.0, 0.82, 0.60), float3(0.75, 0.85, 1.0), hash21(id + 2.9));
    return tint * spark * tw * ((h - 0.92) / 0.08);
}

float2 screenToTex(float2 targetUv, float2 pixelUv, float2 pixelTex,
                   float2 texPerUvX, float2 texPerUvY)
{
    float2 d = targetUv - pixelUv;
    return pixelTex + texPerUvX * d.x + texPerUvY * d.y;
}

float3 sampleTerminal(float2 targetUv, float2 pixelUv, float2 pixelTex,
                      float2 texPerUvX, float2 texPerUvY)
{
    return shaderTexture.Sample(samplerState,
        screenToTex(targetUv, pixelUv, pixelTex, texPerUvX, texPerUvY)).rgb;
}

float tokenFromRgb(float3 c)
{
    int3 v = int3(floor(saturate(c) * 255.0 + 0.5));
    int3 hi = v / 16;
    int3 lo = v - hi * 16;

    if (hi.x == 0x0 && hi.y == 0x0 && hi.z == 0x0)
    {
        if (lo.x != (lo.y ^ lo.z ^ 0x5)) return -1.0;
        int hiddenFill = lo.y * 16 + lo.z;
        return hiddenFill > 250 ? -1.0 : float(hiddenFill) / 250.0;
    }

    if (hi.x != 0xF || hi.y != 0xB || hi.z != 0x0) return -1.0;
    if (lo.x != (lo.y ^ lo.z ^ 0x5)) return -1.0;
    int fill = lo.y * 16 + lo.z;
    return fill > 250 ? -1.0 : float(fill) / 250.0;
}

float tokenDecode(float3 c)
{
    float lvl = tokenFromRgb(c);
    if (lvl >= 0.0) return lvl;

    float3 s = lerp(c * 12.92,
                    1.055 * pow(max(c, 1e-6), float3(1.0 / 2.4, 1.0 / 2.4, 1.0 / 2.4)) - 0.055,
                    step(float3(0.0031308, 0.0031308, 0.0031308), c));
    return tokenFromRgb(s);
}

float screenTokenAt(float2 base, float yDir, float2 pixelUv, float2 pixelTex,
                    float2 texPerUvX, float2 texPerUvY)
{
    float yHalf = TOKEN_DATA_Y_STEP * 0.5 * yDir;
    float yFull = TOKEN_DATA_Y_STEP * yDir;
    float x1 = TOKEN_DATA_X_STEP * 1.5;
    float x2 = TOKEN_DATA_X_STEP * 3.0;
    float2 probes[15] = {
        base,
        base + float2(x1, 0.0),
        base + float2(x2, 0.0),
        base + float2(0.0, yHalf),
        base + float2(x1, yHalf),
        base + float2(x2, yHalf),
        base + float2(0.0, yFull),
        base + float2(x1, yFull),
        base + float2(x2, yFull),
        base + float2(0.0, yFull * 2.0),
        base + float2(x1, yFull * 2.0),
        base + float2(x2, yFull * 2.0),
        base + float2(0.0, yFull * 4.0),
        base + float2(x1, yFull * 4.0),
        base + float2(x2, yFull * 4.0)
    };

    [unroll]
    for (int i = 0; i < 15; i++)
    {
        float lvl = tokenDecode(shaderTexture.Sample(samplerState,
            screenToTex(saturate(probes[i]), pixelUv, pixelTex, texPerUvX, texPerUvY)).rgb);
        if (lvl >= 0.0) return lvl;
    }
    return -1.0;
}

float tokenLevel(float2 pixelUv, float2 pixelTex, float2 texPerUvX, float2 texPerUvY)
{
    float bottom = screenTokenAt(TOKEN_DATA_UV_BOTTOM, -1.0, pixelUv, pixelTex, texPerUvX, texPerUvY);
    if (bottom >= 0.0) return bottom;
    return screenTokenAt(TOKEN_DATA_UV_TOP, 1.0, pixelUv, pixelTex, texPerUvX, texPerUvY);
}

// ------------------------------------------------------------------- image --
float4 main(float4 pos : SV_POSITION, float2 tex : TEXCOORD) : SV_TARGET
{
    float2 res = max(Resolution, float2(1.0, 1.0));
    // Windows Terminal separates screen-space geometry from source texture sampling.
    // Use SV_POSITION for blackhole coordinates and TEXCOORD only for terminal sampling.
    float2 uv = pos.xy / res;
    float aspect = res.x / res.y;
    float2 texPerUvX = ddx(tex) / max(abs(ddx(uv).x), 1e-6);
    float2 texPerUvY = ddy(tex) / max(abs(ddy(uv).y), 1e-6);

#if DEBUG_TOKEN_SAMPLE_POINT
    float2 topMarker = abs(uv - TOKEN_DATA_UV_TOP);
    float2 bottomMarker = abs(uv - TOKEN_DATA_UV_BOTTOM);
    if ((topMarker.x < 0.010 && topMarker.y < 0.010) ||
        (bottomMarker.x < 0.010 && bottomMarker.y < 0.010))
        return float4(1.0, 0.0, 1.0, 1.0);
#endif

    float yUp = 1.0 - uv.y;
    float demoTime = (SIZE_MODE == MODE_DEMO) ? demoAnimTime() : Time;
    float t = demoTime * DRIFT_SPEED;

    float demoLvl = (SIZE_MODE == MODE_DEMO) ? demoLevel() : -1.0;
    float demoLookLvl = (SIZE_MODE == MODE_DEMO) ? demoLookLevel() : -1.0;
    DiskLook L = lookDefault();
    if (SIZE_MODE == MODE_DEMO) L = demoLook(demoLookLvl);

    float rin = max(L.inner, 1.6);
    float rout = max(L.outer, rin + 0.5);

    float I;
    float sz;
    float2 center;
    if (SIZE_MODE == MODE_POMODORO)
    {
        float workSec = WORK_PERIOD_MIN * 60.0;
        float cycleSec = workSec + BREAK_MIN * 60.0;
        float wall = POMODORO_WALL_OFFSET + Time * TIME_SCALE;
        float phase = fmod(wall, cycleSec);
        float collapse = min(60.0, workSec * 0.15);
        float grow = clamp(phase / workSec, 0.0, 1.0)
                   * (1.0 - smoothstep(workSec - collapse, workSec, phase));
        I = lerp(0.12, 1.0, grow);

        float idle = 0.0;
        I *= 1.0 - smoothstep(IDLE_FADE_SEC, max(BREAK_MIN * 60.0, IDLE_FADE_SEC + 1.0), idle);
        sz = lerp(0.22, 1.0, I);

        float ext = (rout / B_CRIT) * HOLE_RADIUS * sz;
        float yLo = WORK_AREA + 0.12 + ext;
        float yHi = max(yLo, 0.90 - ext);
        float spd = lerp(0.35, 1.0, I);
        center = float2(
            0.5 + (0.24 * sin(t * 0.21) + 0.05 * sin(t * 0.083)) * spd,
            1.0 - lerp(yLo, yHi, 0.5 + (0.42 * sin(t * 0.157 + 2.0) + 0.08 * sin(t * 0.117)) * spd));
        center += I * float2(0.040 * sin(t * 0.83) + 0.020 * sin(t * 1.31),
                             0.030 * sin(t * 1.03 + 1.0));
    }
    else
    {
        float live = -1.0;
        if (SIZE_MODE != MODE_DEMO && TOKEN_LEVEL < 0.0)
            live = tokenLevel(uv, tex, texPerUvX, texPerUvY);
        float lvl = (SIZE_MODE == MODE_DEMO)
                  ? demoLvl
                  : (TOKEN_LEVEL >= 0.0 ? TOKEN_LEVEL : live);
        if (lvl < 0.0)
            return float4(shaderTexture.Sample(samplerState, tex).rgb, 1.0);

        float g = pow(clamp(lvl, 0.0, 1.0), TOKEN_EASE);
        I = lerp(0.10, 1.0, g);
        float rhMin = sqrt(TOKEN_AREA_MIN * aspect / 3.1415927);
        float rhMax = sqrt(TOKEN_AREA_MAX * aspect / 3.1415927);
        float rhT = lerp(rhMin, rhMax, g) * (HOLE_RADIUS / 0.08);
        sz = rhT / max(HOLE_RADIUS, 1e-4);

        float marg = min(rhT * lerp(1.45, 0.90, g), 0.5 * (1.0 - WORK_AREA - 0.03));
        float xPad = marg / aspect;
        float2 fullLo = float2(min(xPad, 0.5), marg);
        float2 fullHi = float2(max(0.5, 1.0 - xPad),
                               max(marg, 1.0 - (WORK_AREA + 0.03 + marg)));
        float2 corner = clamp(float2(TOKEN_HOME_X, TOKEN_HOME_Y), fullLo, fullHi);
        float reach = lerp(0.06, max(TOKEN_REACH, 0.06), g);
        float2 lo = float2(lerp(corner.x, fullLo.x, reach), fullLo.y);
        float2 hi = float2(fullHi.x, lerp(corner.y, fullHi.y, reach));
        float2 room = max((hi - lo) * 0.5, float2(0.0, 0.0));
        float2 wobAmp = min(float2(0.010 + 0.030 * g, 0.010 + 0.030 * g),
                            max(room * 0.35, float2(0.006, 0.006)));
        float2 ampEff = max(room - wobAmp, float2(0.0, 0.0));
        float2 wander = lerp(lissa(t * TOKEN_CALM), lissa(t * TOKEN_RUSH), g);
        float2 wobble = float2(cos(t * 0.8), sin(t * 1.0));
        if (SIZE_MODE == MODE_DEMO)
        {
            float a = demoPhase();
            wander = demoLoopWander();
            wobble = float2(cos(a), sin(a));
        }
        center = (lo + hi) * 0.5 + wander * ampEff
               + wobAmp * wobble;
    }

    float vis = smoothstep(0.0, 0.10, I);
    if (vis <= 0.0)
        return float4(shaderTexture.Sample(samplerState, tex).rgb, 1.0);

    float rh = HOLE_RADIUS * sz;
    float dil = lerp(1.0, DILATION_MIN, I);
    float shield = vis * smoothstep(WORK_AREA, WORK_AREA + 0.18, yUp);

    float2 p = (uv - center) * float2(aspect, 1.0);
    float plen = length(p);

    float W = B_CRIT / max(rh, 1e-4);
    float2 pr = rot(float2(p.x, -p.y), L.roll) * W;
    float b = length(pr);

    float window = exp(-pow(plen / (7.0 * rh), 2.0));

    float bmax = rout + 3.0;
    float Z0 = max(14.0, rout + 5.0);

    if (b >= bmax)
    {
        float u = Z0 * rsqrt(Z0 * Z0 + b * b);
        float defl = (2.0 / (W * W)) / max(plen, 1e-4)
                   * (1.29 * u + 0.07) * max(LENS_DEPTH - 2.14 * u + 0.75, 0.0)
                   * window * shield;
        float2 dir = p / max(plen, 1e-5);
        float3 term;
        float ab = 0.035 * smoothstep(1.0, 2.0, b / bmax);

        float k0 = 1.0 - ab;
        float2 sp0 = p - dir * defl * k0;
        float2 suv0 = mirrorUV(center + sp0 / float2(aspect, 1.0));
        term.r = sampleTerminal(suv0, uv, tex, texPerUvX, texPerUvY).r;

        float k1 = 1.0;
        float2 sp1 = p - dir * defl * k1;
        float2 suv1 = mirrorUV(center + sp1 / float2(aspect, 1.0));
        term.g = sampleTerminal(suv1, uv, tex, texPerUvX, texPerUvY).g;

        float k2 = 1.0 + ab;
        float2 sp2 = p - dir * defl * k2;
        float2 suv2 = mirrorUV(center + sp2 / float2(aspect, 1.0));
        term.b = sampleTerminal(suv2, uv, tex, texPerUvX, texPerUvY).b;

        float3 d = normalize(float3(-(pr / b) * (2.0 / b), -1.0));
        return float4(term + stars(d) * L.star * window * shield, 1.0);
    }

    float3 x = float3(pr, Z0);
    float3 v = float3(0.0, 0.0, -1.0);
    float h2 = dot(pr, pr);

    float ci = cos(L.incl);
    float si = sin(L.incl);
    float3 n = float3(0.0, si, ci);
    float3 e2 = float3(0.0, ci, -si);
    float sdir = L.speed < 0.0 ? -1.0 : 1.0;
    float spd = abs(L.speed);

    float3 emitc = float3(0.0, 0.0, 0.0);
    float trans = 1.0;
    bool captured = false;
    float sPrev = dot(x, n);
    float3 xPrev = x;

    [loop]
    for (int step = 0; step < N_STEPS; step++)
    {
        float r2 = dot(x, x);
        if (r2 < 1.0) { captured = true; break; }
        if (x.z < -Z0 && v.z < 0.0) break;
        if (r2 > 4.0 * Z0 * Z0) break;
        float r = sqrt(r2);
        float dt = clamp(0.16 * r, 0.03, 1.5);
        float3 a = -1.5 * h2 * x / (r2 * r2 * r);
        v += a * (0.5 * dt);
        x += v * dt;
        r2 = dot(x, x);
        r = sqrt(r2);
        a = -1.5 * h2 * x / (r2 * r2 * r);
        v += a * (0.5 * dt);

        float s = dot(x, n);
        if (s * sPrev < 0.0 && trans > 0.02)
        {
            float tc = sPrev / (sPrev - s);
            float3 xc = lerp(xPrev, x, tc);
            float rc = length(xc);
            if (rc > rin && rc < rout)
            {
                float band = smoothstep(rin, rin * 1.25, rc)
                           * (1.0 - smoothstep(rout * 0.70, rout, rc));

                float phi = atan2(dot(xc, e2), xc.x);
                float turns = phi / 6.2831853;
                float kep = pow(rin / rc, 1.5);
                float gloc = sqrt(max(1.0 - 1.5 / rc, 0.02));
                float swirl = rc * L.wind * 0.12 - t * kep * spd * gloc * dil * sdir;
                float streaks = vnoiseWrapY(float2(rc * 2.8, turns * 19.0 + swirl * 3.0), 19.0) * 0.65 +
                                vnoiseWrapY(float2(rc * 1.0, turns * 9.0  + swirl * 1.5 + 7.0), 9.0) * 0.35;
                streaks = 0.35 + L.contr * streaks * streaks;

                float3 gasdir = normalize(cross(n, xc)) * sdir;
                float beta = clamp(rsqrt(max(2.0 * (rc - 1.0), 0.2)), 0.0, 0.99);
                float gshift = gloc / max(1.0 + beta * dot(gasdir, normalize(v)), 0.05);
                gshift = lerp(1.0, gshift, L.dopp);

                float xpr = max(1.0 - sqrt(rin / rc), 0.0);
                float tprof = pow(rin / rc, 0.75) * pow(xpr, 0.25) / 0.488;
                float3 cbb = blackbody(L.temp * tprof * gshift);
                float boost = pow(gshift, L.beam);

                float density = band * streaks;
                emitc += trans * cbb * (L.gain * 2.2 * density * tprof * tprof * boost);
                trans *= 1.0 - clamp(L.opac * density, 0.0, 1.0);
            }
        }
        sPrev = s;
        xPrev = x;
    }

    if (!captured && dot(x, x) < 4.0) captured = true;

    float3 bg = float3(0.0, 0.0, 0.0);
    if (!captured)
    {
        float3 d = normalize(v);
        bg += stars(d) * L.star * window * shield;
        if (d.z < -0.05)
        {
            float tpl = (-LENS_DEPTH - x.z) / d.z;
            float3 hp = x + d * tpl;
            float2 q = rot(hp.xy, -L.roll) / W;
            float2 sp = float2(q.x, -q.y);
            float2 suv = mirrorUV(center + (p + (sp - p) * window * shield) / float2(aspect, 1.0));
            float toward = smoothstep(0.05, 0.35, -d.z);
            bg += sampleTerminal(suv, uv, tex, texPerUvX, texPerUvY) * toward;
        }
    }

    float3 col = bg * trans + (float3(1.0, 1.0, 1.0) - exp(-emitc * L.expo));
    return float4(col, 1.0);
}
#endif
