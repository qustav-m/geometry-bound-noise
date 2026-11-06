import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
const DEFAULT_RENDER_WIDTH = 960;//half of 1920 (Full HD) --> 960 x 540 at 16:9
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

/*
Inside corner of a cube: three of its six sides --> bottom, back and left
--> the cube has the edge length CUBE_SIZE (4 times the object height of 2, so the object fits nicely)
--> it spans x and z from -CUBE_SIZE/2 to +CUBE_SIZE/2 and y from 0 to CUBE_SIZE
--> every side faces into the cube, so they are only visible from the inside
*/
const CUBE_SIZE = 8;
const cubeCorner = new THREE.Group();
scene.add(cubeCorner);

function addCubeSide(seed: number): THREE.Mesh {
  const side = new THREE.Mesh(new THREE.PlaneGeometry(CUBE_SIZE, CUBE_SIZE), createNoiseMaterial(seed));
  cubeCorner.add(side);
  return side;
}

const cubeBottom = addCubeSide(1);
cubeBottom.rotation.x = -Math.PI / 2;//faces +y, up

const cubeBack = addCubeSide(3);
cubeBack.position.set(0, CUBE_SIZE / 2, -CUBE_SIZE / 2);//faces +z, towards the camera

const cubeLeft = addCubeSide(4);
cubeLeft.rotation.y = Math.PI / 2;//faces +x, to the right
cubeLeft.position.set(-CUBE_SIZE / 2, CUBE_SIZE / 2, 0);

// Sphere: shows the UV seam and the poles.
const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), createNoiseMaterial(2));
sphere.position.set(0, 1, 0);
scene.add(sphere);

//glTF upload --> the loaded model replaces the sphere (or the previously loaded model)
//--> .glb works fully, .gltf only if buffers and textures are embedded (a single file can't load separate .bin/images)
const SPHERE_HEIGHT = 2;
const gltfLoader = new GLTFLoader();
let currentModel: THREE.Object3D = sphere;

const modelInput = document.createElement('input');
modelInput.type = 'file';
modelInput.accept = '.glb,.gltf';
modelInput.style.cssText = 'font:12px monospace;color:#fff';

const modelStatus = document.createElement('span');

resolutionPanel.appendChild(modelInput);
resolutionPanel.appendChild(modelStatus);

//Every mesh gets the noise material with its own seed --> the model's own materials and textures are ignored
//--> returns false if a mesh has no uv attribute, the noise can't work there
function applyNoiseMaterials(model: THREE.Object3D): boolean {
  let seed = 10;
  let allHaveUvs = true;
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.getAttribute('uv')) allHaveUvs = false;
    mesh.material = createNoiseMaterial(seed);
    seed++;
  });
  return allHaveUvs;
}

//Scale the model so the height of its bounding box is `targetHeight`, then stand it on the ground in the middle
function fitModelToHeight(model: THREE.Object3D, targetHeight: number): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const largestSide = Math.max(size.x, size.y, size.z);
  const height = size.y > 0 ? size.y : largestSide;//flat model --> use its largest side instead
  if (height > 0) model.scale.multiplyScalar(targetHeight / height);

  model.updateMatrixWorld(true);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;//bottom of the model --> on the ground (y = 0)
}

//Free GPU memory of the replaced model --> not for the sphere, it stays reusable
function disposeModel(model: THREE.Object3D): void {
  if (model === sphere) return;
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
}

//Show a loaded model instead of the current one --> noise materials, scaled to the sphere height, on the ground
function showModel(model: THREE.Object3D, name: string): void {
  const allHaveUvs = applyNoiseMaterials(model);
  fitModelToHeight(model, SPHERE_HEIGHT);

  scene.remove(currentModel);
  disposeModel(currentModel);
  scene.add(model);
  currentModel = model;

  modelStatus.textContent = allHaveUvs ? name : `${name} (warning: mesh without UVs)`;
}

function showLoadError(name: string, error: unknown): void {
  modelStatus.textContent = `could not load ${name}`;
  console.error(error);
}

modelInput.addEventListener('change', async () => {
  const file = modelInput.files?.[0];
  if (!file) return;
  modelStatus.textContent = 'loading…';

  const buffer = await file.arrayBuffer();
  gltfLoader.parse(
    buffer,
    '',
    (gltf) => showModel(gltf.scene, file.name),
    (error) => showLoadError(file.name, error),
  );
});

//Default model, loaded at start from public/ --> the sphere stays visible while it loads and if loading fails
const DEFAULT_MODEL = 'wooden_elephant.glb';
modelStatus.textContent = `loading ${DEFAULT_MODEL}…`;
gltfLoader.load(
  `${import.meta.env.BASE_URL}${DEFAULT_MODEL}`,
  (gltf) => {
    if (currentModel !== sphere) return;//a model was uploaded meanwhile --> keep that one
    showModel(gltf.scene, DEFAULT_MODEL);
  },
  undefined,
  (error) => showLoadError(DEFAULT_MODEL, error),
);

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
