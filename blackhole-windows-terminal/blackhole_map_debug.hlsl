Texture2D shaderTexture;
SamplerState samplerState;

cbuffer PixelShaderSettings
{
    float Time;
    float Scale;
    float2 Resolution;
    float4 Background;
};

float2 screenToTex(float2 targetUv, float2 pixelUv, float2 pixelTex,
                   float2 texPerUvX, float2 texPerUvY)
{
    float2 d = targetUv - pixelUv;
    return pixelTex + texPerUvX * d.x + texPerUvY * d.y;
}

float4 main(float4 pos : SV_POSITION, float2 tex : TEXCOORD) : SV_TARGET
{
    float2 res = max(Resolution, float2(1.0, 1.0));
    float2 uv = pos.xy / res;
    float2 texPerUvX = ddx(tex) / max(abs(ddx(uv).x), 1e-6);
    float2 texPerUvY = ddy(tex) / max(abs(ddy(uv).y), 1e-6);
    float2 mapped = screenToTex(uv, uv, tex, texPerUvX, texPerUvY);

    if (uv.x < 0.3333)
        return float4(shaderTexture.Sample(samplerState, tex).rgb, 1.0);
    if (uv.x < 0.6666)
        return float4(shaderTexture.Sample(samplerState, mapped).rgb, 1.0);
    return float4(frac(mapped.x), frac(mapped.y), 0.0, 1.0);
}
