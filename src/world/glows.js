import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Lantern glows and torch flames: a camera-facing sprite on every light in the village
// (street, stone and bridge lanterns) and flickering flames on torch posts along the
// ledge trail, the stairs and the pagoda court, plus two on the watchtower. The sprites
// are bright enough to feed the bloom, and keep a minimum size on screen so distant
// lamps still read as points of light from the ledge, like the reference.
// Torches also go into the warm light map (world/lamps.js) and their posts are
// returned as colliders for the controller.

const LANTERN = 0, TORCH = 1;

function torchSpots(layout, village) {
  const spots = [];   // [x, groundY, z]
  const along = (name, every, offset) => {
    const path = layout.paths[name];
    const pts = path.points;
    const half = path.width / 2 + offset;
    for (let i = every >> 1, k = 0; i < pts.length - 1; i += every, k++) {
      const [x, y, z] = pts[i];
      const [nx, , nz] = pts[i + 1];
      const len = Math.hypot(nx - x, nz - z) || 1;
      const side = k % 2 ? 1 : -1;               // alternate sides of the path
      spots.push([x + (-(nz - z) / len) * half * side, y, z + ((nx - x) / len) * half * side]);
    }
  };
  const ends = (name, offset, which = [0, -1]) => {
    const path = layout.paths[name];
    const pts = path.points;
    const half = path.width / 2 + offset;
    for (const w of which) {
      const i = w < 0 ? pts.length + w : w;
      const j = i === pts.length - 1 ? i - 1 : i + 1;
      const [x, y, z] = pts[i];
      const dx = pts[j][0] - x, dz = pts[j][2] - z;
      const len = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) spots.push([x - (dz / len) * half * side, y, z + (dx / len) * half * side]);
    }
  };
  along('ledge_trail', 12, 0.5);
  ends('pagoda_stairs', 0.5);
  along('pagoda_stairs', 20, 0.5);                      // and one pair halfway up, so the steps aren't a black hole
  ends('terrace_stairs', 0.5);
  ends('pagoda_court', 0.6, [-1]);
  return spots;
}

export function createGlows(village, layout) {
  const group = new THREE.Group();
  group.name = 'Glows';
  const sprites = [];   // [x, y, z, size, kind, intensity]

  for (const p of village.props) {
    if (p.type === 'StreetLantern') sprites.push([p.x, p.y + 1.65, p.z, 1.3, LANTERN, 1.0]);
    else if (p.type === 'StoneLantern') sprites.push([p.x, p.y + 1.05, p.z, 0.9, LANTERN, 0.7]);
  }
  // paper lanterns on the bridge railings (same spacing as build_village.py)
  const deck = village.bridgeDeck;
  const a = deck[0], c = deck[deck.length - 1];
  const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
  const sx = -(c[2] - a[2]) / len, sz = (c[0] - a[0]) / len;
  for (let i = 3; i < deck.length - 1; i += 6) {
    for (const side of [-1, 1]) {
      const [x, y, z] = deck[i];
      sprites.push([x + sx * side * 1.92, y + 1.5, z + sz * side * 1.92, 0.9, LANTERN, 0.8]);
    }
  }

  // torch posts
  const spots = torchSpots(layout, village);
  const post = mergeGeometries([
    new THREE.CylinderGeometry(0.05, 0.07, 2.2, 6).translate(0, 1.1, 0),
    new THREE.CylinderGeometry(0.2, 0.08, 0.22, 8).translate(0, 2.25, 0),
  ]);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.9 });
  const posts = new THREE.InstancedMesh(post, postMat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, y, z], i) => {
    posts.setMatrixAt(i, m.makeTranslation(x, y - 0.05, z));
    sprites.push([x, y + 2.62, z, 1.6, TORCH, 1.0]);
  });
  posts.name = 'TorchPosts';
  group.add(posts);

  // the watchtower: torches on the two front corner posts of the platform
  const [tx, ty, tz] = village.torches[0];
  const deckY = ty - 2.4;
  const torches = spots.map(([x, y, z]) => [x, y + 2.4, z]);
  for (const s of [-1, 1]) {
    sprites.push([tx + s * 2.3, deckY + 1.55, tz + 2.3, 2.0, TORCH, 1.3]);
    torches.push([tx + s * 2.3, deckY + 1.55, tz + 2.3]);
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const iPos = new Float32Array(sprites.length * 4);
  const iKind = new Float32Array(sprites.length * 3);
  sprites.forEach(([x, y, z, size, kind, k], i) => {
    iPos.set([x, y, z, size], i * 4);
    iKind.set([kind, k, Math.random()], i * 3);
  });
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
  geo.setAttribute('iKind', new THREE.InstancedBufferAttribute(iKind, 3));
  geo.instanceCount = sprites.length;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec4 iPos;
      attribute vec3 iKind;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vKind;
      varying float vGain;
      void main() {
        vec3 toCam = cameraPosition - iPos.xyz;
        float d = length(toCam);
        // keep a minimum angular size; spread the same light over the larger sprite
        float size = max(iPos.w, d * 0.0055);
        // softer right next to the lamp, so its paper and frame stay visible through the glow
        vGain = pow(iPos.w / size, 1.3) * exp(-d / 1400.0) * (0.4 + 0.6 * smoothstep(3.0, 18.0, d));
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        // in front of the lamp's own geometry so it isn't hidden by it
        vec3 c = iPos.xyz + toCam / d * min(0.6, iPos.w * 0.5);
        vec3 wp = c + (right * position.x + up * position.y) * size;
        vUv = position.xy;
        vKind = iKind;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vKind;
      varying float vGain;
      void main() {
        float r2 = dot(vUv, vUv);
        vec3 col;
        if (vKind.x < 0.5) {
          // paper lantern: small hot core, soft warm halo
          col = vec3(1.0, 0.55, 0.25) * (exp(-r2 * 28.0) * 1.1 + exp(-r2 * 5.0) * 0.24);
        } else {
          // torch: a flickering tongue of flame over a glow
          float t = uTime * 9.0 + vKind.z * 40.0;
          float flick = 0.8 + 0.2 * sin(t) * sin(t * 1.7 + 1.3);
          vec2 q = vUv;
          q.x += sin(q.y * 4.0 - t * 0.9) * 0.06 * (q.y + 0.6);
          float taper = mix(3.2, 7.0, clamp(q.y + 0.5, 0.0, 1.0));
          float flame = exp(-(q.x * q.x * taper * taper + pow(max(q.y + 0.25, 0.0) * 1.9, 2.0) + pow(min(q.y + 0.25, 0.0) * 5.0, 2.0)));
          // hot core held just below clipping, with a wide soft halo instead
          col = vec3(1.0, 0.45, 0.12) * flame * 2.1 * flick + vec3(1.0, 0.72, 0.4) * flame * flame * 1.4
              + vec3(1.0, 0.45, 0.15) * exp(-r2 * 1.6) * 0.3 * flick * (1.0 - r2) * (1.0 - r2) * step(r2, 1.0);   // halo fades to zero inside the quad
        }
        gl_FragColor = vec4(col * vKind.y * vGain, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'LampGlows';
  group.add(mesh);

  return {
    root: group,
    torches,                                             // flame positions, for the light map
    colliders: spots.map(([x, y, z]) => [x, y, z, 0.12]), // torch posts: x, y, z, radius
    update(dt) {
      uniforms.uTime.value += dt;
    },
  };
}
