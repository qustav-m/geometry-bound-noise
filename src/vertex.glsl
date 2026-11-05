// Pass the mesh's uv attribute through to the fragment shader.
// position, uv, projectionMatrix and modelViewMatrix are provided by three.js.

varying vec2 vMeshUv;

void main() {
    vMeshUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
