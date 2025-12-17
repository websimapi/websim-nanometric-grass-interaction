import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { velocityShader, positionShader, grassVertexShader, grassFragmentShader } from './Shaders.js';

export class GrassSystem {
    constructor(renderer, scene, handInput) {
        this.renderer = renderer;
        this.scene = scene;
        this.handInput = handInput;

        // Configuration
        this.WIDTH = 256; // Texture width (Square root of instance count)
        this.COUNT = this.WIDTH * this.WIDTH; // 65,536 blades
        
        this.initGPGPU();
        this.initMesh();
    }

    initGPGPU() {
        this.gpuCompute = new GPUComputationRenderer(this.WIDTH, this.WIDTH, this.renderer);

        // create initial state
        const dtPosition = this.gpuCompute.createTexture();
        const dtVelocity = this.gpuCompute.createTexture();
        this.fillInitialTexture(dtPosition, dtVelocity);

        // Add variables
        this.velocityVariable = this.gpuCompute.addVariable("textureVel", velocityShader, dtVelocity);
        this.positionVariable = this.gpuCompute.addVariable("texturePos", positionShader, dtPosition);

        // Dependencies
        this.gpuCompute.setVariableDependencies(this.velocityVariable, [this.positionVariable, this.velocityVariable]);
        this.gpuCompute.setVariableDependencies(this.positionVariable, [this.positionVariable, this.velocityVariable]);

        // Uniforms for Physics
        const velUniforms = this.velocityVariable.material.uniforms;
        velUniforms.time = { value: 0.0 };
        velUniforms.delta = { value: 0.0 };
        velUniforms.handJoints = { value: new Array(10).fill(new THREE.Vector3()) };
        velUniforms.handRadii = { value: new Array(10).fill(0.0) };
        velUniforms.pinchStrength = { value: [0, 0] };
        velUniforms.pinchPosition = { value: [new THREE.Vector3(), new THREE.Vector3()] };

        const posUniforms = this.positionVariable.material.uniforms;
        posUniforms.delta = { value: 0.0 };

        const error = this.gpuCompute.init();
        if (error !== null) {
            console.error(error);
        }
    }

    fillInitialTexture(texturePos, textureVel) {
        const posArray = texturePos.image.data;
        const velArray = textureVel.image.data;

        for (let k = 0, kl = posArray.length; k < kl; k += 4) {
            // Position: RGB = bendX, bendY, Height. A = Stiffness
            posArray[k + 0] = 0; // Bend X
            posArray[k + 1] = 0; // Bend Z
            posArray[k + 2] = Math.random() * 0.2 + 0.3; // Height (0.3 to 0.5m)
            posArray[k + 3] = Math.random() * 0.5 + 0.5; // Stiffness

            // Velocity: RGB = velX, velZ, unused. A = unused
            velArray[k + 0] = 0;
            velArray[k + 1] = 0;
            velArray[k + 2] = 0;
            velArray[k + 3] = 0;
        }
    }

    initMesh() {
        // Blade Geometry: Simple plane, pointed at top
        // High fidelity interactions require multiple segments, but we manipulate vertices in shader.
        // We define a base shape 0.02m wide, 0.5m tall
        const geometry = new THREE.PlaneGeometry(0.02, 0.5, 1, 4); 
        geometry.translate(0, 0.25, 0); // Pivot at bottom

        // Material
        this.material = new THREE.ShaderMaterial({
            vertexShader: grassVertexShader,
            fragmentShader: grassFragmentShader,
            uniforms: {
                texturePos: { value: null },
                time: { value: 0 },
                colorBase: { value: new THREE.Color(0x004400) }, // Slightly brighter Green
                colorTip: { value: new THREE.Color(0x66bb00) },   // Vivid Lime Green
                sunPosition: { value: new THREE.Vector3(3, 10, 5) }
            },
            side: THREE.DoubleSide
        });

        this.mesh = new THREE.InstancedMesh(geometry, this.material, this.COUNT);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // Static usually, but we might move patch

        const dummy = new THREE.Object3D();
        const colorAttribute = new Float32Array(this.COUNT * 3); // Hijacking color for UV mapping

        for (let i = 0; i < this.COUNT; i++) {
            // Distribute in a 4x4m area
            const x = (i % this.WIDTH) / this.WIDTH;
            const y = Math.floor(i / this.WIDTH) / this.WIDTH;
            
            // World Position
            dummy.position.set(
                (x - 0.5) * 4.0 + (Math.random() - 0.5) * 0.1, 
                0, 
                (y - 0.5) * 4.0 + (Math.random() - 0.5) * 0.1
            );
            
            dummy.rotation.y = Math.random() * Math.PI;
            
            // Vary scale slightly for variety
            const s = 1.0 + (Math.random() - 0.5) * 0.2;
            dummy.scale.set(s, s, s);

            dummy.updateMatrix();
            this.mesh.setMatrixAt(i, dummy.matrix);

            // Pass UV coordinates for GPGPU lookup via InstanceColor
            colorAttribute[i*3+0] = x;
            colorAttribute[i*3+1] = y;
            colorAttribute[i*3+2] = 0;
        }

        this.mesh.instanceMatrix.needsUpdate = true;
        
        // Add attribute manually since Three.js helper does it for Color
        this.mesh.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorAttribute, 3));

        this.scene.add(this.mesh);
    }

    update(time, delta) {
        // Update GPGPU Uniforms with Hand Data
        const handData = this.handInput.getUniforms();
        const velUniforms = this.velocityVariable.material.uniforms;

        velUniforms.time.value = time;
        velUniforms.delta.value = delta; // Clamp delta to avoid explosion?
        
        // Update arrays manually for uniforms
        // Note: Three.js Uniforms for arrays of Vectors need to be populated carefully
        for(let i=0; i<10; i++) {
            velUniforms.handJoints.value[i].set(
                handData.handJoints[i*3],
                handData.handJoints[i*3+1],
                handData.handJoints[i*3+2]
            );
            velUniforms.handRadii.value[i] = handData.handRadii[i];
        }

        velUniforms.pinchStrength.value = handData.pinchStrength;
        velUniforms.pinchPosition.value = handData.pinchPosition;

        // Position Shader update
        this.positionVariable.material.uniforms.delta.value = delta;

        // Execute Compute
        this.gpuCompute.compute();

        // Update Visual Material
        this.material.uniforms.texturePos.value = this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture;
        this.material.uniforms.time.value = time;
    }
}

