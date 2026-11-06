//Final blur: last pass, kernel filter over the spiral blurred image
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

void main() {
    vec4 sum = vec4(0.0);
    float weightSum = 0.0;

    for (int y = -uRadius; y <= uRadius; y++) {
        for (int x = -uRadius; x <= uRadius; x++) {
            ivec2 offset = ivec2(x, y);
            float weight = kernelWeight(offset);
            sum += weight * texture(tInput, vScreenUv + vec2(offset) * uTexelSize);
            weightSum += weight;
        }
    }

    //divide by the weight sum --> brightness stays the same for any kernel
    gl_FragColor = sum / weightSum;
}
