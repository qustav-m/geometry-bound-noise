import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import vertexSource from './vertex.glsl?raw';
import fragmentSource from './fragment.glsl?raw';
import fullscreenVertexSource from './fullscreen-vertex.glsl?raw';
import spiralBlurFragmentSource from './spiral-blur.glsl?raw';
import finalBlurFragmentSource from './final-blur.glsl?raw';
import combineOctavesFragmentSource from './combine-octaves.glsl?raw';
import compositeFragmentSource from './composite.glsl?raw';

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

//Off-screen image --> nearest filtering for images the blurs read (exact pixel values),
//linear filtering for the octave results the combine shader scales up bilinearly
function createTarget(filter: THREE.MagnificationTextureFilter): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { minFilter: filter, magFilter: filter });
}

function createBlurMaterial(fragmentShader: string, input: THREE.WebGLRenderTarget): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: fullscreenVertexSource,
    fragmentShader,
    uniforms: {
      tInput: { value: input.texture },
      uTexelSize: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 0 },
    },
  });
}

/*
Octaves: the whole pipeline runs once per octave at its own resolution
--> octave k has 1/2^k of the render resolution, so the mip selection picks 2^k times larger noise cells
--> chain per octave: scene --> sceneTarget --spiral blur--> spiralBlurTarget --final blur--> resultTarget
--> afterwards the combine shader averages all result images on the canvas
*/
const MAX_OCTAVES = 5;

interface Octave {
  sceneTarget: THREE.WebGLRenderTarget;
  spiralBlurTarget: THREE.WebGLRenderTarget;
  resultTarget: THREE.WebGLRenderTarget;
  spiralBlurMaterial: THREE.ShaderMaterial;
  finalBlurMaterial: THREE.ShaderMaterial;
}

function createOctave(): Octave {
  const sceneTarget = createTarget(THREE.NearestFilter);
  const spiralBlurTarget = createTarget(THREE.NearestFilter);
  const resultTarget = createTarget(THREE.LinearFilter);
  return {
    sceneTarget,
    spiralBlurTarget,
    resultTarget,
    spiralBlurMaterial: createBlurMaterial(spiralBlurFragmentSource, sceneTarget),
    finalBlurMaterial: createBlurMaterial(finalBlurFragmentSource, spiralBlurTarget),
  };
}

const octaves: Octave[] = [];
for (let k = 0; k < MAX_OCTAVES; k++) octaves.push(createOctave());

let octaveCount = 3;

const combineMaterial = new THREE.ShaderMaterial({
  vertexShader: fullscreenVertexSource,
  fragmentShader: combineOctavesFragmentSource,
  uniforms: {
    tOctave0: { value: octaves[0].resultTarget.texture },
    tOctave1: { value: octaves[1].resultTarget.texture },
    tOctave2: { value: octaves[2].resultTarget.texture },
    tOctave3: { value: octaves[3].resultTarget.texture },
    tOctave4: { value: octaves[4].resultTarget.texture },
    uOctaveCount: { value: octaveCount },
  },
});

/*
Composite: the noise image and the PBR image are rendered into their own images, composite.glsl combines them
--> noiseTarget: result of the octave combination (grey value)
--> pbrTarget: the scene with PBR materials, half float so the linear HDR colors keep their precision
*/
const noiseTarget = createTarget(THREE.NearestFilter);
const pbrTarget = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  type: THREE.HalfFloatType,
});

const COMPOSITE_MODES = ['noise', 'PBR', 'combined'];//index = uMode in composite.glsl

const compositeMaterial = new THREE.ShaderMaterial({
  vertexShader: fullscreenVertexSource,
  fragmentShader: compositeFragmentSource,
  uniforms: {
    tPbr: { value: pbrTarget.texture },
    tNoise: { value: noiseTarget.texture },
    uMode: { value: 2 },//starts in the combined mode
    uTexelSize: { value: new THREE.Vector2(1, 1) },
    uSearchRadius: { value: 6 },
  },
});

//Rectangle over the whole image --> shared by all fullscreen passes, only its material changes per pass
const fullscreenScene = new THREE.Scene();
const fullscreenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), combineMaterial);
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
  noiseTarget.setSize(renderWidth, renderHeight);
  pbrTarget.setSize(renderWidth, renderHeight);
  compositeMaterial.uniforms.uTexelSize.value.set(1 / renderWidth, 1 / renderHeight);

  //octave k --> 1/2^k of the render resolution
  octaves.forEach((octave, k) => {
    const width = Math.max(1, Math.round(renderWidth / Math.pow(2, k)));
    const height = Math.max(1, Math.round(renderHeight / Math.pow(2, k)));
    octave.sceneTarget.setSize(width, height);
    octave.spiralBlurTarget.setSize(width, height);
    octave.resultTarget.setSize(width, height);
    octave.spiralBlurMaterial.uniforms.uTexelSize.value.set(1 / width, 1 / height);
    octave.finalBlurMaterial.uniforms.uTexelSize.value.set(1 / width, 1 / height);
  });

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
  for (const octave of octaves) octave.spiralBlurMaterial.uniforms.uRadius.value = Number(spiralBlurSlider.value);
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
  for (const octave of octaves) octave.finalBlurMaterial.uniforms.uRadius.value = Number(finalBlurSlider.value);
  finalBlurLabel.textContent = `final blur r = ${finalBlurSlider.value}`;
}

finalBlurSlider.addEventListener('input', updateFinalBlurRadius);
updateFinalBlurRadius();

//Octave count slider in the same panel --> 1 = only the full resolution, like without octaves
const octaveSlider = document.createElement('input');
octaveSlider.type = 'range';
octaveSlider.min = '1';
octaveSlider.max = String(MAX_OCTAVES);
octaveSlider.step = '1';
octaveSlider.value = String(octaveCount);
octaveSlider.style.width = '80px';

const octaveLabel = document.createElement('span');

resolutionPanel.appendChild(octaveSlider);
resolutionPanel.appendChild(octaveLabel);

function updateOctaveCount(): void {
  octaveCount = Number(octaveSlider.value);
  combineMaterial.uniforms.uOctaveCount.value = octaveCount;
  octaveLabel.textContent = `octaves = ${octaveCount}`;
}

octaveSlider.addEventListener('input', updateOctaveCount);
updateOctaveCount();
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

/*
PBR mode: every mesh keeps two materials in userData and switches between them
--> noiseMaterial: the noise shader, rendered through the octave and blur pipeline
--> pbrMaterial: a regular three.js PBR material, rendered directly to the canvas
*/
function rememberMaterials(mesh: THREE.Mesh, pbrMaterial: THREE.Material | THREE.Material[]): void {
  mesh.userData.noiseMaterial = mesh.material;
  mesh.userData.pbrMaterial = pbrMaterial;
}

//Plain grey PBR material for the cube sides and the sphere --> they have no material of their own
function createGreyPbrMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x8c8c8c, roughness: 0.9 });
}

function addCubeSide(seed: number): THREE.Mesh {
  const side = new THREE.Mesh(new THREE.PlaneGeometry(CUBE_SIZE, CUBE_SIZE), createNoiseMaterial(seed));
  rememberMaterials(side, createGreyPbrMaterial());
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
rememberMaterials(sphere, createGreyPbrMaterial());
//Pivot in the middle of the room --> the current model hangs in it, rotating the pivot spins the model around its center
const modelPivot = new THREE.Group();
scene.add(modelPivot);
modelPivot.add(sphere);

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

//Every mesh gets the noise material with its own seed --> the model's own material is kept for the PBR mode
//--> returns false if a mesh has no uv attribute, the noise can't work there
function applyNoiseMaterials(model: THREE.Object3D): boolean {
  let seed = 10;
  let allHaveUvs = true;
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.getAttribute('uv')) allHaveUvs = false;
    const originalMaterial = mesh.material;
    mesh.material = createNoiseMaterial(seed);
    rememberMaterials(mesh, originalMaterial);
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
    const materials = [mesh.userData.noiseMaterial, mesh.userData.pbrMaterial].flat() as THREE.Material[];
    for (const material of materials) material.dispose();
  });
}

//Show a loaded model instead of the current one --> noise materials, scaled to the sphere height, on the ground
function showModel(model: THREE.Object3D, name: string): void {
  const allHaveUvs = applyNoiseMaterials(model);
  fitModelToHeight(model, SPHERE_HEIGHT);

  modelPivot.remove(currentModel);
  disposeModel(currentModel);
  modelPivot.add(model);
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

//Rotate checkbox --> the current model spins around the up axis, one turn in ROTATION_PERIOD seconds
//--> time based, so the speed doesn't depend on the frame rate
const ROTATION_PERIOD = 10;//seconds per turn

const rotateLabel = document.createElement('label');
const rotateCheckbox = document.createElement('input');
rotateCheckbox.type = 'checkbox';
rotateCheckbox.checked = false;
rotateLabel.appendChild(rotateCheckbox);
rotateLabel.append(' rotate');
resolutionPanel.appendChild(rotateLabel);

let lastRotationTime = performance.now();

function updateModelRotation(): void {
  const now = performance.now();
  const seconds = (now - lastRotationTime) / 1000;
  lastRotationTime = now;
  if (rotateCheckbox.checked) modelPivot.rotation.y += (2 * Math.PI * seconds) / ROTATION_PERIOD;
}

//PBR lighting --> RoomEnvironment, a neutral built-in studio environment (no HDR file needed)
//--> tone mapping and sRGB conversion happen in composite.glsl, not in three.js
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

//Switch every mesh to its PBR or its noise material --> needed per render, because the combined mode renders both
function useMaterials(usePbr: boolean): void {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.userData.pbrMaterial) return;
    mesh.material = usePbr ? mesh.userData.pbrMaterial : mesh.userData.noiseMaterial;
  });
}

//Mode switch --> noise only, PBR only or both combined in composite.glsl
const modeSelect = document.createElement('select');
modeSelect.style.cssText = 'font:12px monospace';
COMPOSITE_MODES.forEach((mode, index) => modeSelect.add(new Option(mode, String(index))));
modeSelect.value = String(compositeMaterial.uniforms.uMode.value);//dropdown shows the start mode
resolutionPanel.appendChild(modeSelect);

modeSelect.addEventListener('change', () => {
  compositeMaterial.uniforms.uMode.value = Number(modeSelect.value);
});

//Search radius slider --> radius of the round kernel in which the combined mode looks for the noise max/min
const searchSlider = document.createElement('input');
searchSlider.type = 'range';
searchSlider.min = '0';
searchSlider.max = '10';
searchSlider.step = '1';
searchSlider.value = '6';
searchSlider.style.width = '80px';

const searchLabel = document.createElement('span');

resolutionPanel.appendChild(searchSlider);
resolutionPanel.appendChild(searchLabel);

function updateSearchRadius(): void {
  compositeMaterial.uniforms.uSearchRadius.value = Number(searchSlider.value);
  searchLabel.textContent = `search r = ${searchSlider.value}`;
}

searchSlider.addEventListener('input', updateSearchRadius);
updateSearchRadius();

//Noise pipeline: every octave at its own resolution, then the octave combination --> noiseTarget
function renderNoise(): void {
  useMaterials(false);

  for (let k = 0; k < octaveCount; k++) {
    const octave = octaves[k];

    //scene --> off-screen image
    renderer.setRenderTarget(octave.sceneTarget);
    renderer.render(scene, camera);

    //scene image --> spiral blur --> second off-screen image
    fullscreenQuad.material = octave.spiralBlurMaterial;
    renderer.setRenderTarget(octave.spiralBlurTarget);
    renderer.render(fullscreenScene, fullscreenCamera);

    //spiral blurred image --> final blur --> result image of this octave
    fullscreenQuad.material = octave.finalBlurMaterial;
    renderer.setRenderTarget(octave.resultTarget);
    renderer.render(fullscreenScene, fullscreenCamera);
  }

  //all octave results --> bilinear upscaling and combination --> noise image
  fullscreenQuad.material = combineMaterial;
  renderer.setRenderTarget(noiseTarget);
  renderer.render(fullscreenScene, fullscreenCamera);
}

//PBR: the scene with its PBR materials --> pbrTarget (linear colors)
function renderPbr(): void {
  useMaterials(true);
  renderer.setRenderTarget(pbrTarget);
  renderer.render(scene, camera);
}

//FPS display in the panel --> averaged over ~0.5 s, capped by the display's refresh rate (e.g. 60 or 120)
const fpsLabel = document.createElement('span');
resolutionPanel.appendChild(fpsLabel);

const FPS_UPDATE_INTERVAL = 500;//ms
let fpsFrameCount = 0;
let fpsIntervalStart = performance.now();

function updateFps(): void {
  fpsFrameCount++;
  const now = performance.now();
  const elapsed = now - fpsIntervalStart;
  if (elapsed < FPS_UPDATE_INTERVAL) return;

  const fps = (fpsFrameCount * 1000) / elapsed;
  fpsLabel.textContent = `${fps.toFixed(0)} fps (${(elapsed / fpsFrameCount).toFixed(1)} ms)`;
  fpsFrameCount = 0;
  fpsIntervalStart = now;
}

renderer.setAnimationLoop(() => {
  updateFps();
  updateModelRotation();
  controls.update();//needed every frame for damping

  //only render what the current mode needs --> 0 = noise, 1 = PBR, 2 = both
  const mode = Number(modeSelect.value);
  if (mode !== 1) renderNoise();
  if (mode !== 0) renderPbr();

  //noise image + PBR image --> composite.glsl --> canvas
  fullscreenQuad.material = compositeMaterial;
  renderer.setRenderTarget(null);
  renderer.render(fullscreenScene, fullscreenCamera);
});
