// SIMULATION SHADER: Calculates physics (Spring, Damping, Collision)
export const grassComputeShader = `
    uniform float time;
    uniform float delta;
    uniform sampler2D texturePos; // Current positions (r,g = bend x,z, b = height, a = stiffness)
    uniform sampler2D textureVel; // Current velocities (r,g = vel x,z)
    
    // Hand Data
    uniform vec3 handJoints[10]; // 5 joints per hand (Index Tip, Index Knuckle, Thumb Tip, Palm, etc.)
    uniform float handRadii[10];
    uniform float pinchStrength[2]; // 0 = Left, 1 = Right
    uniform vec3 pinchPosition[2];

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 posData = texture2D(texturePos, uv);
        vec4 velData = texture2D(textureVel, uv);

        vec2 currentBend = posData.rg;
        float height = posData.b;
        float stiffness = posData.a;
        vec2 velocity = velData.rg;

        // Base world position of this blade (derived from UV for simplicity in this demo, 
        // normally passed via attribute, but here we assume grid distribution based on uv)
        vec2 worldPos2D = (uv - 0.5) * 20.0; // 20x20 meter patch
        vec3 bladeBase = vec3(worldPos2D.x, 0.0, worldPos2D.y);
        
        // Calculate blade tip position
        vec3 bladeTip = bladeBase + vec3(currentBend.x, height, currentBend.y);

        // Forces
        vec2 force = vec2(0.0);

        // 1. Spring Force (Hooke's Law) - Restore to vertical
        // Add some procedural wind noise
        float wind = sin(time * 2.0 + worldPos2D.x * 0.5) * 0.1 + cos(time * 1.5 + worldPos2D.y * 0.5) * 0.05;
        vec2 targetBend = vec2(wind, wind * 0.5); 
        force += (targetBend - currentBend) * stiffness * 40.0;

        // 2. Hand Collision
        for(int i = 0; i < 10; i++) {
            vec3 joint = handJoints[i];
            float r = handRadii[i];
            
            // Check distance to blade tip/mid
            // Use a capsule check conceptually, here simplified to spheres against the flexible blade
            vec3 diff = bladeTip - joint;
            float dist = length(diff);
            
            // Interaction Radius
            float influence = 0.15; // 15cm influence
            if (dist < influence + r) {
                // Repulsion
                vec3 pushDir = normalize(diff);
                float strength = (1.0 - (dist / (influence + r)));
                strength = pow(strength, 2.0); // Exponential falloff
                
                // Add force to bend away on XZ plane
                force += pushDir.xz * strength * 300.0;
            }
        }

        // 3. Pinching Mechanics (Magnetic lock)
        // Check Left Hand (Index 0) and Right Hand (Index 1)
        for(int i = 0; i < 2; i++) {
            if(pinchStrength[i] > 0.8) {
                vec3 pPos = pinchPosition[i];
                float distToPinch = length(bladeBase - pPos); // Distance from base to pinch point
                
                // If blade base is close enough to pinch location
                if(distToPinch < 0.2) {
                    vec3 pinchTarget = pPos - bladeBase; // Local vector
                    
                    // Attract tip to pinch position
                    vec2 pinchForce = (pinchTarget.xz - currentBend) * 150.0;
                    force += pinchForce;
                }
            }
        }

        // Integration (Verlet/Euler)
        velocity += force * delta;
        
        // Damping (Air resistance + internal friction)
        velocity *= 0.90; 

        // Apply
        currentBend += velocity * delta;

        // Constraint: Limit Max Bend to prevent geometric explosion
        float bendLen = length(currentBend);
        if(bendLen > height * 1.2) {
            currentBend = normalize(currentBend) * height * 1.2;
            velocity *= 0.5; // Dampen heavily on limit hit
        }

        gl_FragColor = vec4(currentBend, height, stiffness);
        // We write position to gl_FragColor. Velocity needs to be written to a second target or encoded.
        // For standard GPUComputationRenderer in Three.js, we usually do multi-pass or single pass if logic permits.
        // To keep it simple and robust, we will output Position in this shader, but we actually need
        // to return BOTH. 
        // NOTE: In the main code, we will use two shaders: one for Pos, one for Vel.
    }
`;

// VELOCITY SHADER (Updates Velocity texture)
export const velocityShader = `
    uniform float time;
    uniform float delta;
    uniform sampler2D texturePos;
    uniform sampler2D textureVel;
    
    uniform vec3 handJoints[10];
    uniform float handRadii[10];
    uniform float pinchStrength[2];
    uniform vec3 pinchPosition[2];

    // Pseudo-random
    float rand(vec2 co){
        return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 posData = texture2D(texturePos, uv);
        vec4 velData = texture2D(textureVel, uv);
        
        vec2 currentBend = posData.rg;
        float height = posData.b;
        float stiffness = posData.a;
        vec2 velocity = velData.rg;

        // Grid Position
        vec2 worldPos2D = (uv - 0.5) * 4.0; // 4x4 meter active zone
        vec3 bladeBase = vec3(worldPos2D.x, 0.0, worldPos2D.y);
        vec3 bladeTip = bladeBase + vec3(currentBend.x, height * 0.8, currentBend.y); // Approx tip

        vec2 force = vec2(0.0);

        // --- PHYSICS ---
        // 1. Recovery Force (Stiffness)
        // Wind Sway
        float sway = sin(time * 1.5 + worldPos2D.x * 2.0) * 0.05 + sin(time * 2.3 + worldPos2D.y) * 0.02;
        vec2 restPos = vec2(sway, sway*0.5);
        force += (restPos - currentBend) * (stiffness * 80.0);

        // 2. Interaction
        for(int i=0; i<10; i++) {
            if(handRadii[i] > 0.0) {
                vec3 joint = handJoints[i];
                // Distance to the "segment" of the grass. simplified to tip check + bias
                float d = distance(bladeTip, joint);
                float radius = handRadii[i] + 0.05; // 5cm grass aura
                
                if(d < radius) {
                    vec3 dir = normalize(bladeTip - joint);
                    float pen = radius - d;
                    // Impulse
                    force += dir.xz * (pen * 1500.0); 
                }
            }
        }

        // 3. Pinching
        for(int i=0; i<2; i++) {
             if(pinchStrength[i] > 0.5) {
                float d = distance(bladeBase, pinchPosition[i]);
                if(d < 0.15) { // Within 15cm of pinch
                    // Calculate vector to hold point
                    vec3 localHold = pinchPosition[i] - bladeBase;
                    // Spring to pinch point
                    force += (localHold.xz - currentBend) * 500.0;
                    velocity *= 0.5; // High damping when held
                }
             }
        }

        velocity += force * delta;
        
        // Damping
        velocity *= 0.92;

        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`;

// POSITION SHADER (Updates Position texture based on Velocity)
export const positionShader = `
    uniform float delta;
    uniform sampler2D texturePos;
    uniform sampler2D textureVel;

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 posData = texture2D(texturePos, uv);
        vec4 velData = texture2D(textureVel, uv);

        vec2 pos = posData.rg;
        vec2 vel = velData.rg;

        pos += vel * delta;

        // Geometric Constraints (Blade cannot stretch infinitely)
        float h = posData.b;
        if(length(pos) > h) {
            pos = normalize(pos) * h;
        }

        gl_FragColor = vec4(pos, h, posData.a);
    }
`;

// RENDER VERTEX SHADER
export const grassVertexShader = `
    attribute mat4 instanceMatrix;
    attribute vec3 simUv; // Changed from instanceColor to avoid collisions

    uniform sampler2D texturePos;
    uniform float time;
    
    varying vec2 vUv;
    varying float vBend;
    varying vec3 vWorldPosition;
    varying float vStress;
    varying vec3 vNormal;

    void main() {
        vUv = uv;
        
        vec4 simData = texture2D(texturePos, simUv.xy);
        
        vec2 bend = simData.rg;
        float height = simData.b;
        
        // Deform geometry
        vec3 pos = position;
        
        float t = pos.y / 0.5; // Normalized height (0 to 1)
        
        // Scale to simulated height
        pos.y *= (height / 0.5); 

        // Apply bend curve: quadratic curve
        pos.x += bend.x * (t * t);
        pos.z += bend.y * (t * t);

        // Length preservation approx
        float bendAmt = length(bend * t * t);
        pos.y -= bendAmt * 0.3; 

        vBend = t;
        vStress = length(bend) / height;

        // Calculate Smooth Normal based on bend
        // Base normal is (0,1,0), bent normal tilts towards bend
        vec3 bentNormal = normalize(vec3(bend.x, 2.0, bend.y)); 
        // Mix with instance rotation logic if needed, but for simple grass:
        // We actually want to rotate this normal by the instance matrix rotation
        
        vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPos.xyz;
        
        // Transform normal by instance matrix (rotation part only)
        vNormal = normalize(mat3(instanceMatrix) * bentNormal);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos.xyz, 1.0);
    }
`;

// RENDER FRAGMENT SHADER
export const grassFragmentShader = `
    varying vec2 vUv;
    varying float vBend;
    varying vec3 vWorldPosition;
    varying float vStress;
    varying vec3 vNormal;

    uniform vec3 colorBase;
    uniform vec3 colorTip;
    uniform vec3 sunPosition;

    void main() {
        // Basic Gradient
        vec3 color = mix(colorBase, colorTip, vBend);

        // Stress visualization
        color = mix(color, vec3(0.9, 0.9, 0.2), vStress * 0.6);

        // Lighting
        vec3 normal = normalize(vNormal);
        // Ensure double sided lighting looks okay
        if (!gl_FrontFacing) normal = -normal;

        vec3 lightDir = normalize(sunPosition);
        
        // Diffuse
        float diff = max(dot(normal, lightDir), 0.0);
        
        // Ambient (Brighter)
        vec3 ambient = vec3(0.4);

        // Subsurface Scattering (Fake)
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float sss = max(dot(viewDir, -lightDir), 0.0);
        sss = pow(sss, 2.0) * 1.0; 
        sss *= vBend; // More SSS at tips

        // Specular
        vec3 halfVec = normalize(lightDir + viewDir);
        float spec = max(dot(normal, halfVec), 0.0);
        spec = pow(spec, 16.0) * 0.3;

        // Combine
        vec3 lighting = ambient + (vec3(1.0, 0.95, 0.8) * diff) + (vec3(0.5, 0.8, 0.2) * sss) + spec;
        
        vec3 finalColor = color * lighting;

        // Distance fog
        float dist = length(cameraPosition - vWorldPosition);
        float fogFactor = smoothstep(10.0, 30.0, dist);
        finalColor = mix(finalColor, vec3(0.125, 0.188, 0.25), fogFactor);

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

