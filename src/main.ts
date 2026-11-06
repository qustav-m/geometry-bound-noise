import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import vertexSource from './vertex.glsl?raw';
import fragmentSource from './fragment.glsl?raw';

// No MSAA, so what you see is the shader's own filtering.
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
camera.position.set(0, 2, 6);

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

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();//needed every frame for damping
  renderer.render(scene, camera);
});
