import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { GrassSystem } from './GrassSystem.js';
import { HandInput } from './HandInput.js';

let camera, scene, renderer;
let grassSystem, handInput;
let clock;

init();
animate();

function init() {
    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    scene.fog = new THREE.Fog(0x111111, 2, 10);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);
    camera.position.set(0, 1.6, 2);

    // 2. Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2.0);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(3, 10, 5);
    scene.add(dirLight);

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true; // Enable WebXR
    document.body.appendChild(renderer.domElement);

    // 4. VR Button
    document.body.appendChild(VRButton.createButton(renderer));

    // 5. Floor (Reference)
    const floorGeo = new THREE.CircleGeometry(4, 32);
    const floorMat = new THREE.MeshStandardMaterial({ 
        color: 0x0a1a0a, roughness: 1.0 
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // 6. Systems
    handInput = new HandInput(renderer, scene);
    grassSystem = new GrassSystem(renderer, scene, handInput);

    clock = new THREE.Clock();

    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    const delta = Math.min(clock.getDelta(), 0.1); // Cap delta to prevent explosion on lag spikes
    const time = clock.getElapsedTime();

    handInput.update();
    grassSystem.update(time, delta);

    renderer.render(scene, camera);
}

