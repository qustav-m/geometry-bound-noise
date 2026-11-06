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

//RGB --> HSV (hue, saturation, value), all in 0..1
vec3 rgbToHsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

//HSV --> RGB, inverse of rgbToHsv
vec3 hsvToRgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

//Strength of the brightness shift --> 0 = off
const float BRIGHTNESS_STRENGTH = 0.05;

/*
Brightness shift on the result of combine()
--> changes the value (HSV V) by (noise - 0.5) * BRIGHTNESS_STRENGTH
--> high noise --> brighter, low noise --> darker, hue and saturation stay the same
*/
vec3 brightnessShift(vec3 color, float noise) {
    vec3 hsv = rgbToHsv(color);
    hsv.z = clamp(hsv.z + (noise - 0.5) * BRIGHTNESS_STRENGTH, 0.0, 1.0);
    return hsvToRgb(hsv);
}

void main() {
    float noise = texture(tNoise, vScreenUv).r;

    vec3 color;
    if (uMode == 0) color = vec3(noise);
    else if (uMode == 1) color = pbrAt(vScreenUv);
    else color = brightnessShift(combine(vScreenUv, noise), noise);

    gl_FragColor = vec4(color, 1.0);
}
