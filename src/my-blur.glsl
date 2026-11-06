//Second pass: kernel filter over the finished image of the first pass
//--> every output pixel is a weighted sum of its neighbours in a (2r+1) x (2r+1) square

varying vec2 vScreenUv;

uniform sampler2D tInput;//rendered image of the first pass
uniform vec2 uTexelSize;//size of one pixel in uv: 1 / resolution
uniform int uRadius;//kernel radius in pixels --> 0 = image passes through unchanged

//Weight of the pixel at `offset` from the center --> change this to change the kernel
//--> currently gaussian with sigma = radius / 2
float kernelWeight(ivec2 offset) {
    float sigma = max(float(uRadius) * 0.5, 0.0001);
    float distanceSquared = float(offset.x * offset.x + offset.y * offset.y);
    return exp(-distanceSquared / (2.0 * sigma * sigma));
}

// CDF of mix(A,B,t) when A and B are uniform [0,1] (copied from fragment.glsl, GLSL has no #include)
float uniformize(float z, float t) {
    float lo = min(t, 1.0 - t);
    float hi = max(t, 1.0 - t);
    if (lo < 0.001) return z;
    float ab2 = 2.0 * lo * hi;
    if (z < lo)      return z * z / ab2;
    else if (z < hi) return lo / (2.0 * hi) + (z - lo) / hi;
    else             return 1.0 - (1.0 - z) * (1.0 - z) / ab2;
}

float uniformizedMix(float a, float b, float t) {
    return uniformize(mix(a, b, t), t);
}

//Value of the pixel at `offset` from the center
float pixelValue(ivec2 offset) {
    return texture(tInput, vScreenUv + vec2(offset) * uTexelSize).r;
}

//Mix the next spiral sample into the result with 0.5 --> the very first sample starts the result
float addSample(float result, bool isFirst, ivec2 offset) {
    float value = pixelValue(offset);
    return isFirst ? value : uniformizedMix(result, value, 0.5);
}

void main() {
    //Spiral from the outside to the center, ring by ring:
    //top row (left --> right), right column (down), bottom row (right --> left), left column (up), then the next inner ring
    //--> the center is sampled last and has the biggest impact
    float result = 0.0;
    bool isFirst = true;

    for (int k = uRadius; k >= 1; k--) {
        for (int x = -k; x <= k; x++) {
            result = addSample(result, isFirst, ivec2(x, k));
            isFirst = false;
        }
        for (int y = k - 1; y >= -k; y--) {
            result = addSample(result, isFirst, ivec2(k, y));
        }
        for (int x = k - 1; x >= -k; x--) {
            result = addSample(result, isFirst, ivec2(x, -k));
        }
        for (int y = -k + 1; y <= k - 1; y++) {
            result = addSample(result, isFirst, ivec2(-k, y));
        }
    }
    result = addSample(result, isFirst, ivec2(0, 0));

    gl_FragColor = vec4(vec3(result), 1.0);
}
