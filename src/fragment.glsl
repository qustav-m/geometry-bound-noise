// Anisotropic mipmapping — Jacobian / ellipse approach, square cells.
//
// The Jacobian J maps one screen pixel to a UV-space offset.
// Its two columns are the screen-space partial derivatives of (u,v):
//
//   px = (du/dx, dv/dx)   — UV shift per pixel rightward
//   py = (du/dy, dv/dy)   — UV shift per pixel upward
//
// The pixel footprint in UV space is the ellipse traced by J * d
// as d ranges over all unit screen-space directions.
// Its semi-axes are the singular values of J:
//
//   Lminor = min |d|=1  |J*d|   — smallest UV reach over all screen directions
//   Lmajor = max |d|=1  |J*d|   — largest  UV reach over all screen directions
//
//          major axis  ────────────────────────────▶  (Lmajor)
//          sample N times along it to cover the ellipse
//     ↑
//   minor axis  (Lminor)
//   choose mip so one cell spans this distance
//
// Mip: sized so one cell ≈ Lminor in UV space (one cell per pixel in the tightest direction).
// N taps along the major axis, trilinearly blended between two adjacent mip levels.

varying vec2 vMeshUv;      // the geometry's uv attribute, from the vertex shader
uniform float uSeed;       // per-object seed

uint hash(uint x) {
    x ^= x >> 17u;
    x *= 0xbf324c81u;
    x ^= x >> 11u;
    x *= 0x68bc4e25u;
    x ^= x >> 16u;
    return x;
}

float rand(uint seed) {
    return float(hash(seed)) / 4294967295.0;
}

// CDF of mix(A,B,t) when A and B are uniform [0,1].
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

// Adds one uniform [0,1] sample into a running uniform average.
float addToUniformAverage(float avg, float newVal, int newN) {
    return uniformizedMix(avg, newVal, 1.0 / float(newN));
}

//Side length of big square: every mip grid (2^mip cells per side, up to mip 15) fits into it exactly
const float SQUARE_SIDE = 32768.0;// 2^15

//Point p = (x*, y*) in [0,1]² --> one index on the big square --> like indices on 2d arrays stored inside 1d array
uint squareIndex(vec2 p) {
    uint X = uint(p.x * SQUARE_SIDE);
    uint Y = uint(p.y * SQUARE_SIDE);
    return X + Y * (uint(SQUARE_SIDE) + 1u);
}

/*
Round p down onto the grid of level `mip`
--> gives the bottom-left corner of the cell in which p is lying
--> since grid is split into cells with 4 corners respectively,
    the other cell-corners can be calculated by adding 1/2^mip in different combinations to the origin corner's components
Results are exact multiples of 1/2^mip, e.g. 1/2, 1/4, 3/4.
*/
vec2 cellOriginCorner(vec2 p, int mip) {
    float cellsPerSide = exp2(float(mip));
    return floor(p * cellsPerSide) / cellsPerSide;
}

//Index --> random value in [0,1].
float cornerValue(uint index, uint seed) {
    return rand(seed ^ hash(index));
}

//Seed per object and per UV tile (with 0..1 UVs this is just the object seed)
uint tileSeed(vec2 uv) {
    return hash(uint(round(uSeed)) * 1000003u
            //creates a new tile where uv goes slightly past 0 or 1 (e.g. edge samples)
              ^ uint(int(floor(uv.x))) * 2654435761u
              ^ uint(int(floor(uv.y))) * 805459861u);
}

//Bilinear sample of the noise at level `mip`
float sampleBilinear(vec2 uv, int mip) {
    vec2 p = fract(uv);                       //position inside the tile, 0..1
    vec2 t = fract(p * exp2(float(mip)));     //position inside the cell, 0..1

    //Seed needs to use uv in case uv goes outside of bounds of 0..1, e.g. edge samples
    uint seed = tileSeed(uv);

    vec2  corner = cellOriginCorner(p, mip);
    float cellWidth = exp2(-float(mip));//width of one cell: 1 / 2^mip

    float n00 = cornerValue(squareIndex(corner), seed);
    float n10 = cornerValue(squareIndex(corner + vec2(cellWidth, 0.0)), seed);
    float n01 = cornerValue(squareIndex(corner + vec2(0.0, cellWidth)), seed);
    float n11 = cornerValue(squareIndex(corner + vec2(cellWidth, cellWidth)), seed);

    float bottom = uniformizedMix(n00, n10, t.x);
    float top    = uniformizedMix(n01, n11, t.x);
    return uniformizedMix(bottom, top, t.y);
}

float sampleAniso(vec2 uv, vec2 majorAxisVec, int mip, float Lmajor, float Lminor, int maxAniso) {
    int N = clamp(int(ceil(Lmajor / max(Lminor, 0.0001))), 1, maxAniso);

    vec2 stepVec = majorAxisVec / float(N);
    vec2 start   = uv - stepVec * float(N - 1) * 0.5;

    float color = sampleBilinear(start, mip);
    for (int i = 1; i < maxAniso; i++) {
        if (i >= N) break;
        color = addToUniformAverage(color, sampleBilinear(start + float(i) * stepVec, mip), i + 1);
    }
    return color;
}

void main() {
    vec2 vUv = vMeshUv;

    // --- Step 1: build the Jacobian columns ---
    vec2 px = vec2(dFdx(vUv.x), dFdx(vUv.y));
    vec2 py = vec2(dFdy(vUv.x), dFdy(vUv.y));

    // --- Step 2: singular values and major axis via J^T J ---
    // Lminor = min_{|d|=1} |J*d|  and  Lmajor = max_{|d|=1} |J*d|
    // are the square roots of the eigenvalues of the symmetric matrix J^T J:
    //   J^T J = | dot(px,px)  dot(px,py) |  = | a  b |
    //           | dot(py,px)  dot(py,py) |    | b  c |
    // Eigenvalues via the quadratic formula on det(J^T J - λI) = 0.
    // Note: min(|px|,|py|) would only equal Lminor when px⊥py. When both
    // columns point the same direction (grazing angle) the ellipse collapses
    // to a line (Lminor→0) but min(|px|,|py|) stays large — wrong mip.
    float a = dot(px, px);
    float b = dot(px, py);
    float c = dot(py, py);
    float disc      = sqrt(max(0.0, (a - c)*(a - c) + 4.0*b*b));
    float lambdaMax = 0.5 * ((a + c) + disc);
    float lambdaMin = 0.5 * ((a + c) - disc);
    float Lmajor = sqrt(max(0.0, lambdaMax));
    float Lminor = sqrt(max(0.0, lambdaMin));

    // The screen direction that maximises |J*d| is the eigenvector of J^T J
    // for λmax. Two equivalent expressions from the two rows of (J^T J - λmax I);
    // pick the longer one for numerical stability.
    vec2 ev1 = vec2(b, lambdaMax - a);
    vec2 ev2 = vec2(lambdaMax - c, b);
    vec2 best = length(ev1) >= length(ev2) ? ev1 : ev2;
    // Exact zero only when px⊥py and |px|=|py| (perfectly face-on). Any direction
    // works there since N=1, so fall back to (1,0) to avoid NaN from normalize.
    float lenBest = length(best);
    vec2 vScreen = lenBest > 0.0 ? best / lenBest : vec2(1.0, 0.0);
    // J * vScreen is the major-axis vector in UV space, with length = Lmajor.
    vec2 majorAxisVec = px * vScreen.x + py * vScreen.y;

    // --- Step 3: trilinear mip selection ---
    // Ideal continuous mip level: size = 1/Lminor cells per UV unit puts exactly
    // one cell per screen pixel in the minor direction → mip = log2(1/Lminor).
    // We sample two integer levels (coarse and fine) and blend between them
    // with the fractional part, giving smooth transitions as the camera moves.
    float mipOffset = 0.0; // slight bias toward finer mip reduces flicker
    float mip = clamp(log2(1.0 / max(Lminor, 0.000001)) + mipOffset, -0.999999, 14.0);

    int mipCoarse = int(ceil(mip));   // next integer above mip (fewer cells)
    int mipFine   = mipCoarse + 1;    // one level finer (more cells)

    // --- Step 4: sample both mip levels with up to maxAniso taps, then blend ---
    int maxAniso = 8;

    float colorCoarse = sampleAniso(vUv, majorAxisVec, mipCoarse, Lmajor, Lminor, maxAniso);
    float colorFine   = sampleAniso(vUv, majorAxisVec, mipFine,   Lmajor, Lminor, maxAniso);

    // fract(mip) blends from coarse (0) toward fine (1).
    float color = uniformizedMix(colorCoarse, colorFine, fract(mip));

    gl_FragColor = vec4(vec3(color), 1.0);
}
