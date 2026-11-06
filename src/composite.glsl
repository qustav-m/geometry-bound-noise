//Composite: last pass, combines the PBR image and the noise image and writes to the canvas
//--> uMode 0 = noise only, 1 = PBR only, 2 = combined (see combine())

varying vec2 vScreenUv;

uniform sampler2D tPbr;//PBR render: linear colors, not tone mapped yet (half float)
uniform sampler2D tNoise;//noise pipeline result: grey value in .r, already ready for display
uniform int uMode;
uniform vec2 uTexelSize;//size of one pixel in uv: 1 / resolution
uniform int uSearchRadius;//radius of the round search kernel in pixels

//ACES filmic tone mapping (Narkowicz approximation) --> maps the linear HDR colors into 0..1
vec3 toneMapAces(vec3 color) {
    color *= 0.6;
    return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
}

//Linear --> sRGB, the color space of the screen
vec3 linearToSrgb(vec3 color) {
    vec3 low = color * 12.92;
    vec3 high = 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055;
    return mix(low, high, step(vec3(0.0031308), color));
}

//PBR color at `uv`, ready for display (tone mapped, sRGB)
vec3 pbrAt(vec2 uv) {
    return linearToSrgb(toneMapAces(texture(tPbr, uv).rgb));
}

/*
Combination of both images
--> noise > 0.5: search a round kernel around the pixel for the position with the highest noise value
--> noise <= 0.5: search it for the position with the lowest noise value
--> return the PBR color at that position
*/
vec3 combine(vec2 uv, float noise) {
    bool searchMax = noise > 0.5;
    float bestNoise = noise;
    vec2 bestUv = uv;//ties keep the pixel itself

    for (int y = -uSearchRadius; y <= uSearchRadius; y++) {
        for (int x = -uSearchRadius; x <= uSearchRadius; x++) {
            if (x * x + y * y > uSearchRadius * uSearchRadius) continue;//only inside the circle
            vec2 sampleUv = uv + vec2(x, y) * uTexelSize;
            float value = texture(tNoise, sampleUv).r;
            if (searchMax ? value > bestNoise : value < bestNoise) {
                bestNoise = value;
                bestUv = sampleUv;
            }
        }
    }

    return pbrAt(bestUv);
}

void main() {
    float noise = texture(tNoise, vScreenUv).r;

    vec3 color;
    if (uMode == 0) color = vec3(noise);
    else if (uMode == 1) color = pbrAt(vScreenUv);
    else color = combine(vScreenUv, noise);

    gl_FragColor = vec4(color, 1.0);
}
