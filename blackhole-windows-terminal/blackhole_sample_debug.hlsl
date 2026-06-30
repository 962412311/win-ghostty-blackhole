Texture2D shaderTexture;
SamplerState samplerState;

cbuffer PixelShaderSettings
{
    float Time;
    float Scale;
    float2 Resolution;
    float4 Background;
};

float4 main(float4 pos : SV_POSITION, float2 tex : TEXCOORD) : SV_TARGET
{
    float2 res = max(Resolution, float2(1.0, 1.0));
    float2 uv = pos.xy / res;
    if (uv.x < 0.3333)
        return float4(shaderTexture.Sample(samplerState, tex).rgb, 1.0);
    if (uv.x < 0.6666)
        return float4(shaderTexture.Sample(samplerState, uv).rgb, 1.0);
    return float4(frac(uv.x), frac(uv.y), tex.x, 1.0);
}
