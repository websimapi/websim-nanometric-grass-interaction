import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

export class HandInput {
    constructor(renderer, scene) {
        this.renderer = renderer;
        this.scene = scene;
        
        // Arrays to hold data for Shader Uniforms
        // 2 hands * 5 joints = 10 vectors
        this.jointPositions = new Float32Array(10 * 3); 
        this.jointRadii = new Float32Array(10);
        
        // Pinch Data
        this.pinchStrength = [0, 0]; // L, R
        this.pinchPositions = [new THREE.Vector3(), new THREE.Vector3()];

        this.hands = [];
        this.handFactory = new XRHandModelFactory();

        this.setupHands();
    }

    setupHands() {
        for (let i = 0; i < 2; i++) {
            const hand = this.renderer.xr.getHand(i);
            // We add the hand model to visualization so we can see it, 
            // but we mainly care about the joints for physics.
            hand.add(this.handFactory.createHandModel(hand, 'mesh'));
            this.scene.add(hand);
            this.hands.push(hand);
        }
    }

    update() {
        // Reset Arrays
        this.jointRadii.fill(0); // If hand not tracked, radius 0 means no collision
        
        // Define key joints we care about for physics interaction
        // index-finger-tip, index-finger-phalanx-proximal, thumb-tip, palm, pinky-tip
        const jointIndices = [
            'index-finger-tip', 
            'index-finger-phalanx-intermediate', 
            'thumb-tip', 
            'wrist', 
            'middle-finger-tip'
        ];

        this.hands.forEach((hand, handIndex) => {
            if (hand.joints && hand.inputState && hand.inputState.visible) {
                
                let arrayOffset = handIndex * 5;

                // 1. Update Physics Joints
                jointIndices.forEach((jointName, j) => {
                    const joint = hand.joints[jointName];
                    if (joint) {
                        const idx = arrayOffset + j;
                        
                        // Copy Position
                        this.jointPositions[idx * 3] = joint.position.x;
                        this.jointPositions[idx * 3 + 1] = joint.position.y;
                        this.jointPositions[idx * 3 + 2] = joint.position.z;

                        // Set Radius (Approximation based on anatomy)
                        // Tips are smaller, wrist/palm larger
                        if (jointName.includes('tip')) this.jointRadii[idx] = 0.012; // 12mm
                        else if (jointName === 'wrist') this.jointRadii[idx] = 0.04;
                        else this.jointRadii[idx] = 0.015;
                    }
                });

                // 2. Calculate Pinch
                const indexTip = hand.joints['index-finger-tip'];
                const thumbTip = hand.joints['thumb-tip'];

                if (indexTip && thumbTip) {
                    const dist = indexTip.position.distanceTo(thumbTip.position);
                    
                    // Pinch Threshold: 2cm
                    if (dist < 0.02) {
                        this.pinchStrength[handIndex] = 1.0; // Fully pinched
                        
                        // Midpoint
                        this.pinchPositions[handIndex].copy(indexTip.position)
                            .add(thumbTip.position).multiplyScalar(0.5);
                    } else if (dist < 0.05) {
                        // Progressive pinch strength
                        this.pinchStrength[handIndex] = 1.0 - ((dist - 0.02) / 0.03);
                         this.pinchPositions[handIndex].copy(indexTip.position)
                            .add(thumbTip.position).multiplyScalar(0.5);
                    } else {
                        this.pinchStrength[handIndex] = 0.0;
                    }
                }
            }
        });
    }

    getUniforms() {
        return {
            handJoints: this.jointPositions,
            handRadii: this.jointRadii,
            pinchStrength: this.pinchStrength,
            pinchPosition: this.pinchPositions
        };
    }
}

