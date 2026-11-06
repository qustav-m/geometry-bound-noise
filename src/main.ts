import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import vertexSource from './vertex.glsl?raw';
import fragmentSource from './fragment.glsl?raw';
import fullscreenVertexSource from './fullscreen-vertex.glsl?raw';
import spiralBlurFragmentSource from './spiral-blur.glsl?raw';
import finalBlurFragmentSource from './final-blur.glsl?raw';

// No MSAA, so what you see is the shader's own filtering.
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);//resolution is set explicitly via renderWidth/renderHeight
document.body.appendChild(renderer.domElement);

const canvas = renderer.domElement;
canvas.style.position = 'absolute';
canvas.style.imageRendering = 'pixelated';//show each rendered pixel as a sharp square

//Render resolution in pixels --> starts at the native resolution of the window
let renderWidth = Math.round(window.innerWidth * window.devicePixelRatio);
let renderHeight = Math.round(window.innerHeight * window.devicePixelRatio);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(60, renderWidth / renderHeight, 0.01, 1000);
camera.position.set(0, 2, 6);

//Second pass: the scene is rendered into this off-screen image first, then the blur shader reads from it
//--> nearest filtering, so the blur reads exact pixel values
function createPixelTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
}

//Pass chain: scene --> sceneTarget --spiral blur--> spiralBlurTarget --final blur--> canvas
const sceneTarget = createPixelTarget();
const spiralBlurTarget = createPixelTarget();

function createBlurMaterial(fragmentShader: string, input: THREE.WebGLRenderTarget): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: fullscreenVertexSource,
    fragmentShader,
    uniforms: {
      tInput: { value: input.texture },
      uTexelSize: { value: new THREE.Vector2(1 / renderWidth, 1 / renderHeight) },
      uRadius: { value: 0 },
    },
  });
}

const spiralBlurMaterial = createBlurMaterial(spiralBlurFragmentSource, sceneTarget);
const finalBlurMaterial = createBlurMaterial(finalBlurFragmentSource, spiralBlurTarget);

//Rectangle over the whole image --> shared by all fullscreen passes, only its material changes per pass
const fullscreenScene = new THREE.Scene();
const fullscreenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), spiralBlurMaterial);
fullscreenQuad.frustumCulled = false;//positions are already in clip space, the camera is not used
fullscreenScene.add(fullscreenQuad);
const fullscreenCamera = new THREE.Camera();

//Scale the canvas to fill the window with its aspect ratio preserved --> black bars where it doesn't match
function fitCanvasToWindow(): void {
  const scale = Math.min(window.innerWidth / renderWidth, window.innerHeight / renderHeight);
  const cssWidth = renderWidth * scale;
  const cssHeight = renderHeight * scale;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.style.left = `${(window.innerWidth - cssWidth) / 2}px`;
  canvas.style.top = `${(window.innerHeight - cssHeight) / 2}px`;
}

function applyRenderResolution(): void {
  renderer.setSize(renderWidth, renderHeight, false);//false --> only the pixel size, CSS size is set in fitCanvasToWindow
  sceneTarget.setSize(renderWidth, renderHeight);
  spiralBlurTarget.setSize(renderWidth, renderHeight);
  spiralBlurMaterial.uniforms.uTexelSize.value.set(1 / renderWidth, 1 / renderHeight);
  finalBlurMaterial.uniforms.uTexelSize.value.set(1 / renderWidth, 1 / renderHeight);
  camera.aspect = renderWidth / renderHeight;
  camera.updateProjectionMatrix();
  fitCanvasToWindow();
}

applyRenderResolution();

//Resolution slider at the top left --> scale relative to the native resolution of the window
//--> logarithmic: slider value is log2(scale), -8..0 = 1/256 .. 1, so equal steps are equal factors
const resolutionPanel = document.createElement('div');
resolutionPanel.style.cssText =
  'position:fixed;top:8px;left:8px;display:flex;gap:8px;align-items:center;padding:4px 8px;font:12px monospace;color:#fff;background:rgba(0,0,0,0.6)';
document.body.appendChild(resolutionPanel);

const resolutionSlider = document.createElement('input');
resolutionSlider.type = 'range';
resolutionSlider.min = '-8';
resolutionSlider.max = '0';
resolutionSlider.step = '0.01';
resolutionSlider.style.width = '200px';

//Start at a render width of 480 px --> scale relative to the native width, height follows the window's aspect ratio
const DEFAULT_RENDER_WIDTH = 480;
const nativeWidth = window.innerWidth * window.devicePixelRatio;
let resolutionScale = Math.min(1, Math.max(Math.pow(2, -8), DEFAULT_RENDER_WIDTH / nativeWidth));
resolutionSlider.value = String(Math.log2(resolutionScale));

const resolutionLabel = document.createElement('span');

resolutionPanel.appendChild(resolutionSlider);
resolutionPanel.appendChild(resolutionLabel);

function updateRenderResolution(): void {
  renderWidth = Math.max(1, Math.round(window.innerWidth * window.devicePixelRatio * resolutionScale));
  renderHeight = Math.max(1, Math.round(window.innerHeight * window.devicePixelRatio * resolutionScale));
  applyRenderResolution();
  resolutionLabel.textContent = `${renderWidth} × ${renderHeight} (${(resolutionScale * 100).toFixed(1)} %)`;
}

resolutionSlider.addEventListener('input', () => {
  resolutionScale = Math.pow(2, Number(resolutionSlider.value));
  updateRenderResolution();
});
updateRenderResolution();

//Spiral blur radius slider in the same panel --> 0 = no blur
const spiralBlurSlider = document.createElement('input');
spiralBlurSlider.type = 'range';
spiralBlurSlider.min = '0';
spiralBlurSlider.max = '50';//cost grows with (2r+1)^2 --> large radii are best combined with a low resolution
spiralBlurSlider.step = '1';
spiralBlurSlider.value = '3';
spiralBlurSlider.style.width = '100px';

const spiralBlurLabel = document.createElement('span');

resolutionPanel.appendChild(spiralBlurSlider);
resolutionPanel.appendChild(spiralBlurLabel);

function updateSpiralBlurRadius(): void {
  spiralBlurMaterial.uniforms.uRadius.value = Number(spiralBlurSlider.value);
  spiralBlurLabel.textContent = `spiral blur r = ${spiralBlurSlider.value}`;
}

spiralBlurSlider.addEventListener('input', updateSpiralBlurRadius);
updateSpiralBlurRadius();

//Final blur radius slider in the same panel --> 0 = no blur, independent of the spiral blur radius
const finalBlurSlider = document.createElement('input');
finalBlurSlider.type = 'range';
finalBlurSlider.min = '0';
finalBlurSlider.max = '10';//median by binary search: 8 * (2r+1)^2 reads per pixel
finalBlurSlider.step = '1';
finalBlurSlider.value = '3';
finalBlurSlider.style.width = '100px';

const finalBlurLabel = document.createElement('span');

resolutionPanel.appendChild(finalBlurSlider);
resolutionPanel.appendChild(finalBlurLabel);

function updateFinalBlurRadius(): void {
  finalBlurMaterial.uniforms.uRadius.value = Number(finalBlurSlider.value);
  finalBlurLabel.textContent = `final blur r = ${finalBlurSlider.value}`;
}

finalBlurSlider.addEventListener('input', updateFinalBlurRadius);
updateFinalBlurRadius();

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;//lower = longer ease-out

// Same shader code for every object; only the seed differs.
function createNoiseMaterial(seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertexSource,
    fragmentShader: fragmentSource,
    uniforms: {
      uSeed: { value: seed },
    },
  });
}

// Large ground plane: shows grazing angles toward the horizon.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), createNoiseMaterial(1));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Sphere: shows the UV seam and the poles.
const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), createNoiseMaterial(2));
sphere.position.set(0, 1, 0);
scene.add(sphere);

//Window resize --> resolution follows the window, the slider scale stays the same
window.addEventListener('resize', updateRenderResolution);

renderer.setAnimationLoop(() => {
  controls.update();//needed every frame for damping

  //pass 1: scene --> off-screen image
  renderer.setRenderTarget(sceneTarget);
  renderer.render(scene, camera);

  //pass 2: scene image --> spiral blur --> second off-screen image
  fullscreenQuad.material = spiralBlurMaterial;
  renderer.setRenderTarget(spiralBlurTarget);
  renderer.render(fullscreenScene, fullscreenCamera);

  //pass 3: spiral blurred image --> final blur --> canvas
  fullscreenQuad.material = finalBlurMaterial;
  renderer.setRenderTarget(null);
  renderer.render(fullscreenScene, fullscreenCamera);
});
