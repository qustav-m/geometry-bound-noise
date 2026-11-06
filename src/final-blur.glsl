//Final blur: last pass, filter over the spiral blurred image
//--> currently the exact median of the neighbours inside a circle of radius r, found by binary search instead of sorting

varying vec2 vScreenUv;

uniform sampler2D tInput;//rendered image of the previous pass
uniform vec2 uTexelSize;//size of one pixel in uv: 1 / resolution
uniform int uRadius;//radius in pixels --> 0 = image passes through unchanged

//Weight of the pixel at `offset` from the center --> for a weighted kernel instead of the median
//--> gaussian with sigma = radius / 2, currently unused
float kernelWeight(ivec2 offset) {
    float sigma = max(float(uRadius) * 0.5, 0.0001);
    float distanceSquared = float(offset.x * offset.x + offset.y * offset.y);
    return exp(-distanceSquared / (2.0 * sigma * sigma));
}

//Value of the pixel at `offset` from the center
float pixelValue(ivec2 offset) {
    return texture(tInput, vScreenUv + vec2(offset) * uTexelSize).r;
}

//Only neighbours inside the circle of radius r take part
bool inCircle(int x, int y) {
    return x * x + y * y <= uRadius * uRadius;
}

//Number of neighbours inside the circle
int circleCount() {
    int count = 0;
    for (int y = -uRadius; y <= uRadius; y++) {
        for (int x = -uRadius; x <= uRadius; x++) {
            if (inCircle(x, y)) count++;
        }
    }
    return count;
}

//The input image stores 8 bits per channel --> every value is one of 256 levels k / 255
//Count how many neighbours inside the circle have a level <= `level`
int countAtOrBelow(int level) {
    int count = 0;
    for (int y = -uRadius; y <= uRadius; y++) {
        for (int x = -uRadius; x <= uRadius; x++) {
            if (!inCircle(x, y)) continue;
            int pixelLevel = int(round(pixelValue(ivec2(x, y)) * 255.0));
            if (pixelLevel <= level) count++;
        }
    }
    return count;
}

void main() {
    int needed = circleCount() / 2 + 1;//the median is the (n/2 + 1)-th smallest of the n values

    //binary search over the 256 levels: the smallest level with at least `needed` neighbours at or below it
    //--> that is exactly the median, found in 8 halvings
    int low = 0;
    int high = 255;
    while (low < high) {
        int middle = (low + high) / 2;
        if (countAtOrBelow(middle) >= needed) {
            high = middle;
        } else {
            low = middle + 1;
        }
    }

    gl_FragColor = vec4(vec3(float(low) / 255.0), 1.0);
}
