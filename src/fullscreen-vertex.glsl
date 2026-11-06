//Fullscreen pass: a 2x2 plane covers the whole screen directly in clip space
//--> no camera or matrices needed

varying vec2 vScreenUv;

void main() {
    vScreenUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
