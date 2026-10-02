import * as THREE from 'three';

// Ambient life: fireflies drifting over the river banks and the village gardens, and
// cherry petals falling from the cherry trees. Both are single draw calls animated
// entirely in the vertex shader (no per-frame CPU work). They matter up close, at
// street level; from the ledge they read as sparse glints around the village.

const SAKURA = 2;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// trees: parsed forest.bin (vegetation.js); rockList: rocks.json rocks [type, x, y, z, ...]
export function createAmbient({ trees, rockList, props = [] }, valleyRect, renderer) {
  const [x0, x1, z0, z1] = valleyRect;
  const inValley = (x, z) => x > x0 && x < x1 && z > z0 && z < z1;
  const rand = rng(1234);
  const group = new THREE.Group();
  group.name = 'Ambient';
  const time = { value: 0 };

  // ---- fireflies: near the water (bank rocks) and around the garden trees
  const flies = [];
  for (const r of rockList) {
    const [, x, y, z] = r;
    if (y < 2.5 && inValley(x, z) && rand() < 0.5) {
      for (let k = 0; k < 2; k++) flies.push([x + (rand() - 0.5) * 8, y + 0.6 + rand() * 2.2, z + (rand() - 0.5) * 8]);
    }
  }
  for (let i = 0; i < trees.count; i++) {
    const x = trees.pos[i * 3], y = trees.pos[i * 3 + 1], z = trees.pos[i * 3 + 2];
    if (y < 14 && inValley(x, z) && rand() < (trees.type[i] === SAKURA ? 0.9 : 0.12)) {
      for (let k = 0; k < 2; k++) flies.push([x + (rand() - 0.5) * 10, y + 0.5 + rand() * 3, z + (rand() - 0.5) * 10]);
    }
  }
  // around the street lanterns, and over the slope below the ledge (seen from the hero view)
  for (const p of props) {
    if (p.type !== 'StreetLantern') continue;
    for (let k = 0; k < 2; k++) flies.push([p.x + (rand() - 0.5) * 9, p.y + 0.6 + rand() * 2.6, p.z + (rand() - 0.5) * 9]);
  }
  for (let k = 0; k < 45; k++) flies.push([-25 + rand() * 40, 36 + rand() * 12, -10 - rand() * 38]);
  const fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute('position', new THREE.Float32BufferAttribute(flies.flat(), 3));
  fGeo.setAttribute('seed', new THREE.Float32BufferAttribute(flies.map(() => rand()), 1));
  fGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const fMat = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime, uScale;
      varying float vGlow;
      void main() {
        float t = uTime * (0.25 + 0.2 * seed) + seed * 40.0;
        // slow looping wander around the home position
        vec3 p = position + vec3(sin(t * 1.3) + 0.5 * sin(t * 2.9 + 1.0), 0.45 * sin(t * 1.7 + 2.0), cos(t * 1.1) + 0.5 * cos(t * 2.3)) * 1.4;
        // each one blinks on for a moment every few seconds
        float blink = pow(max(sin(uTime * (0.7 + seed * 0.9) + seed * 31.0), 0.0), 3.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        vGlow = blink * smoothstep(120.0, 20.0, d);
        gl_PointSize = clamp(0.16 * uScale / d, 2.5, 10.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-r * r * 5.0);
        gl_FragColor = vec4(vec3(0.75, 1.0, 0.35) * 6.0 * vGlow * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const fireflies = new THREE.Points(fGeo, fMat);
  fireflies.frustumCulled = false;
  fireflies.renderOrder = 4;
  fireflies.name = 'Fireflies';
  group.add(fireflies);

  // ---- petals: fall from the crowns of the cherry trees and loop
  const petals = [];
  for (let i = 0; i < trees.count; i++) {
    if (trees.type[i] !== SAKURA) continue;
    const x = trees.pos[i * 3], y = trees.pos[i * 3 + 1], z = trees.pos[i * 3 + 2], s = trees.scale[i];
    for (let k = 0; k < 22; k++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 3.2 * s;
      const top = y + (3.5 + rand() * 3.0) * s;
      // origin (crown), fall height to the ground, phase, speed
      petals.push([x + Math.cos(a) * r, top, z + Math.sin(a) * r, top - y, rand(), 0.55 + rand() * 0.45]);
    }
  }
  // a few petals blowing across the ledge on the breeze, from cherry trees just out of frame
  for (let k = 0; k < 160; k++) {
    petals.push([-25 + rand() * 45, 51 + rand() * 4, -4 - rand() * 30, 12 + rand() * 6, rand(), 0.5 + rand() * 0.4]);
  }
  const pGeo = new THREE.InstancedBufferGeometry();
  pGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.35, 0.5, 0, -0.35, 0.5, 0, 0.35, -0.5, 0, 0.35], 3));
  pGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  pGeo.setIndex([0, 1, 2, 0, 2, 3]);
  pGeo.setAttribute('iOrigin', new THREE.InstancedBufferAttribute(new Float32Array(petals.flatMap((p) => p.slice(0, 4))), 4));
  pGeo.setAttribute('iParams', new THREE.InstancedBufferAttribute(new Float32Array(petals.flatMap((p) => [p[4], p[5]])), 2));
  pGeo.instanceCount = petals.length;
  pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uMoonDir: { value: new THREE.Vector3(0.8, 0.53, 0.29) } },
    vertexShader: /* glsl */ `
      attribute vec4 iOrigin;
      attribute vec2 iParams;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFade;
      varying float vShade;
      mat3 rot(vec3 a, float t) {
        a = normalize(a);
        float c = cos(t), s = sin(t), k = 1.0 - c;
        return mat3(c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
                    a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
                    a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
      }
      void main() {
        float fall = iOrigin.w, phase = iParams.x, speed = iParams.y;
        float life = fall / speed;
        float t = mod(uTime + phase * life, life);             // seconds since this petal let go
        vec3 p = iOrigin.xyz;
        p.y -= t * speed;
        p.x += t * 0.35 + sin(t * 1.9 + phase * 30.0) * 0.5;   // light breeze and a side-to-side flutter
        p.z += cos(t * 1.4 + phase * 17.0) * 0.4;
        mat3 r = rot(vec3(sin(phase * 50.0), 1.0, cos(phase * 70.0)), t * (2.0 + phase * 3.0));
        vec3 n = r * vec3(0.0, 1.0, 0.0);
        vec3 wp = p + r * (position * 0.13);
        vUv = uv;
        vShade = 0.55 + 0.45 * abs(n.y);
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vFade = smoothstep(45.0, 12.0, -mv.z) * smoothstep(0.0, 0.6, t) * smoothstep(life, life - 0.8, t);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFade;
      varying float vShade;
      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        if (dot(q, q) > 1.0 || vFade < 0.01) discard;
        gl_FragColor = vec4(vec3(0.95, 0.62, 0.74) * vShade * 0.6, vFade);   // pale petals catching the moon
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const petalMesh = new THREE.Mesh(pGeo, pMat);
  petalMesh.frustumCulled = false;
  petalMesh.renderOrder = 3;
  petalMesh.name = 'Petals';
  group.add(petalMesh);

  const size = new THREE.Vector2();
  return {
    root: group,
    counts: { fireflies: flies.length, petals: petals.length },
    update(dt, camera) {
      time.value += dt;
      // point sizes are in drawing-buffer pixels: follow its height and the field of view
      renderer.getDrawingBufferSize(size);
      fMat.uniforms.uScale.value = (size.y * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    },
  };
}
