import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import vertexSource from './vertex.glsl?raw';
import fragmentSource from './fragment.glsl?raw';

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
resolutionSlider.value = '0';
resolutionSlider.style.width = '200px';

const resolutionLabel = document.createElement('span');

resolutionPanel.appendChild(resolutionSlider);
resolutionPanel.appendChild(resolutionLabel);

function updateRenderResolution(): void {
  const scale = Math.pow(2, Number(resolutionSlider.value));
  renderWidth = Math.max(1, Math.round(window.innerWidth * window.devicePixelRatio * scale));
  renderHeight = Math.max(1, Math.round(window.innerHeight * window.devicePixelRatio * scale));
  applyRenderResolution();
  resolutionLabel.textContent = `${renderWidth} × ${renderHeight} (${(scale * 100).toFixed(1)} %)`;
}

resolutionSlider.addEventListener('input', updateRenderResolution);
updateRenderResolution();

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
  renderer.render(scene, camera);
});
