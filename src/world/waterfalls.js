import * as THREE from 'three';
import { noiseGLSL } from '../shaders/noise.js';

// The waterfalls as landmarks: each fall is several ropes of water of different widths
// that leave an uneven lip, spread and wander as they drop, with gaps between them
// showing the wet rock. The water is streaked and aerated (white at the lip and at
// the base), and splash droplets kick up where it lands. Geometry follows the same
// parabola as the terrain's clearance (terrain_lib.waterfall_y).
//   falls: layout.json waterfalls [{ top, foot, widthTop, widthFoot }]

// Sheets per fall: offset across the lip (fraction of the lip width), width fraction,
// lip height offset (m), brightness. A broad curtain made of overlapping layers of
// different widths (so it has a dense core and thinner edges), and a stray strand.
const ROPES = [
  [[-0.05, 0.6, 0.0, 1.0], [0.2, 0.34, -0.25, 0.85], [-0.33, 0.24, -0.5, 0.8], [0.52, 0.07, -0.9, 0.55]],
  [[-0.05, 0.6, 0.0, 1.0], [0.3, 0.26, -0.3, 0.8]],
];

// tint: the moonlight on the falls (the water's uWaterTint, set by the moon's phase)
export function createWaterfalls(falls, time, tint = { value: new THREE.Color(1, 1, 1) }) {
  const group = new THREE.Group();
  group.name = 'Waterfalls';
  const pos = [], uv = [], rope = [], index = [];
  const splash = [];
  falls.forEach((f, fi) => {
    const [tx, ty, tz] = f.top, [fx, fy, fz] = f.foot;
    const ax = fx - tx, az = fz - tz, L = Math.hypot(ax, az);
    const ox = az / L, oz = -ax / L; // across the fall
    const drop = ty - fy;
    for (const [off, wf, lip, bright] of ROPES[fi] ?? ROPES[1]) {
      const seed = Math.random();
      const across = 8, down = 28;
      const base = pos.length / 3;
      for (let j = 0; j <= down; j++) {
        const u = j / down;
        const y = ty + lip - (drop + lip) * u * u;
        const cx = tx + ax * u, cz = tz + az * u;
        const width = f.widthTop * wf * (1 + 0.8 * u); // spreads and thins as it falls
        const centre = off * f.widthTop * (1 + 0.25 * u);
        for (let i = 0; i <= across; i++) {
          const v = i / across - 0.5;
          const bulge = 0.25 * Math.cos(v * Math.PI) * Math.sin(u * Math.PI); // slightly convex curtain
          pos.push(cx + ox * (centre + v * width) + (ax / L) * bulge, y, cz + oz * (centre + v * width) + (az / L) * bulge);
          uv.push(i / across, (Math.sqrt(u) * drop) / 10); // x across the rope, y ~ metres fallen / 10
          rope.push(seed, bright, u, wf);
        }
      }
      for (let j = 0; j < down; j++) {
        for (let i = 0; i < across; i++) {
          const a = base + j * (across + 1) + i;
          index.push(a, a + across + 1, a + across + 2, a, a + across + 2, a + 1);
        }
      }
    }
    // splash droplets around the landing point
    const n = fi === 0 ? 420 : 140;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * f.widthFoot * 0.45;
      splash.push([fx + Math.cos(a) * r, fy + 0.2, fz + Math.sin(a) * r, Math.random(), fi === 0 ? 1 : 0.6]);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aRope', new THREE.Float32BufferAttribute(rope, 4)); // seed, brightness, fall fraction, width fraction
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, createFallMaterial(time, tint));
  mesh.renderOrder = 2;
  mesh.name = 'WaterfallRopes';
  group.add(mesh);
  group.add(createSplash(splash, time, tint));
  group.add(createBoil(falls, time, tint));
  return { root: group };
}

function createFallMaterial(time, tint) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uTint = tint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRope;\nvarying vec4 vRope;\nvarying vec2 vFallUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFallUv = uv;\nvRope = aRope;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform vec3 uTint;\nvarying vec4 vRope;\nvarying vec2 vFallUv;\n${noiseGLSL}`)
      .replace(
        '#include <color_fragment>',
        `{
        float x = vFallUv.x, y = vFallUv.y, seed = vRope.x, u = vRope.z;
        // the rope's edges wander and shred as it falls
        float wob = (vnoise(vec2(y * 1.3 - uTime * 0.4, seed * 17.0)) - 0.5) * 0.35 * u;
        float edgeN = vnoise(vec2(y * 6.0 - uTime * 3.0, seed * 31.0 + x * 2.0));
        float e = x + wob;
        float edge = smoothstep(0.0, 0.14 + 0.3 * edgeN * u, e) * smoothstep(1.0, 0.86 - 0.3 * edgeN * u, e);
        float core = smoothstep(0.0, 0.35, e) * smoothstep(1.0, 0.65, e);   // dense middle, see-through edges
        // fast crisp streaks sliding down, slower churn on top
        // scale noise to the sheet's width: wide sheets get more tongues across them
        float wx = x * (1.5 + 14.0 * vRope.w);
        // broad tongues of water and aerated clumps sliding down; streaks within them
        // turbulence: clumps of aerated water breaking up as they fall, more than stripes
        float body = vnoise(vec2(wx * 0.9 + seed * 9.0, y * 0.45 - uTime * 1.6));
        float clump = vnoise(vec2(wx * 2.4 + seed * 5.0, y * 3.2 - uTime * 4.2));
        float s1 = vnoise(vec2(wx * 3.2 + seed * 3.0, y * 1.8 - uTime * 3.6));
        float churn = vnoise(vec2(wx * 3.0 + seed, y * 6.0 - uTime * 5.0));
        float streak = smoothstep(0.4, 0.92, s1 * 0.35 + clump * 0.45 + body * 0.3);
        // aerated white where it tips over the lip and where it thunders into the pool
        float lip = smoothstep(0.35, 0.0, y * 10.0 / 3.0);
        float froth = smoothstep(0.55, 1.0, u) * (0.6 + 0.4 * churn);
        float white = clamp(streak * 0.7 + lip * 0.8 + froth * 0.7, 0.0, 1.0);
        vec3 dark = vec3(0.06, 0.085, 0.12), bright = vec3(0.4, 0.46, 0.57);
        diffuseColor.rgb = mix(dark, bright, white) * mix(0.8, 1.0, vRope.y) * uTint;
        // the top edge is torn where the water tips over, not a ruler line
        float lipTear = smoothstep(0.0, 0.03 + 0.07 * vnoise(vec2(wx * 2.0 + seed * 11.0, uTime * 0.7)), y);
        diffuseColor.a = edge * lipTear * mix(0.45, 0.95, max(white, froth)) * mix(0.7, 1.0, body) * mix(0.45, 1.0, core) * smoothstep(0.0, 0.02, u + 0.02);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'waterfall-ropes';
  return mat;
}

// Droplets thrown up from the landing point: each rises and falls on a loop; soft
// moonlit sprites. list: [x, y, z, seed, brightness]
function createSplash(list, time, tint) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap(([x, y, z, s]) => [x, y, z, s])), 4));
  geo.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(list.map((d) => d[4])), 1));
  geo.instanceCount = list.length;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uTint: tint },
    vertexShader: /* glsl */ `
      attribute vec4 iA;
      attribute float iB;
      uniform float uTime;
      varying vec2 vUv;
      varying float vA;
      void main() {
        float seed = iA.w;
        float life = 1.1 + seed * 0.9;
        float t = mod(uTime + seed * 17.0, life);
        float h = fract(seed * 91.7);
        vec3 vel = vec3(cos(seed * 40.0), 0.0, sin(seed * 40.0)) * (1.0 + 2.5 * h) + vec3(0.0, 3.5 + 5.0 * fract(seed * 37.3), 0.0);
        vec3 p = iA.xyz + vel * t + vec3(0.0, -4.9 * t * t, 0.0);
        float size = (0.03 + 0.07 * h) * (1.0 + 0.6 * t);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 wp = p + (right * position.x + up * position.y) * size;
        vUv = position.xy;
        vA = iB * (1.0 - t / life) * smoothstep(0.0, 0.15, t);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint;
      varying vec2 vUv;
      varying float vA;
      void main() {
        float r2 = dot(vUv, vUv);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vec3(0.5, 0.57, 0.7) * uTint, vA * 0.3 * (1.0 - r2) * (1.0 - r2));
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'Splash';
  return mesh;
}

// Churning white water where each fall lands: a row of camera-facing sheets across the
// landing, each a few metres tall, billowing upward. It hides where the falling water
// meets the pool and runs into the mist above it.
function createBoil(falls, time, tint) {
  const list = [];
  falls.forEach((f, fi) => {
    const [tx, , tz] = f.top, [fx, fy, fz] = f.foot;
    const ax = fx - tx, az = fz - tz, L = Math.hypot(ax, az);
    const ox = az / L, oz = -ax / L;
    const n = fi === 0 ? 7 : 4;
    for (let k = 0; k < n; k++) {
      const v = (k / (n - 1) - 0.5) * f.widthFoot * 0.95;
      const h = (fi === 0 ? 5.5 : 3.2) * (0.75 + 0.5 * ((k * 0.618) % 1));
      list.push([fx + ox * v, fy - 0.3, fz + oz * v, f.widthFoot * (fi === 0 ? 0.36 : 0.45), h, k * 0.37 + fi]);
    }
  });
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap(([x, y, z, , , s]) => [x, y, z, s])), 4));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap(([, , , w, h]) => [w, h])), 2));
  geo.instanceCount = list.length;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: time, uTint: tint },
    vertexShader: /* glsl */ `
      attribute vec4 iPos;
      attribute vec2 iSize;
      varying vec2 vUv;
      varying float vSeed;
      varying vec2 vSize;
      void main() {
        vec3 toCam = cameraPosition - iPos.xyz;
        vec3 flatDir = normalize(vec3(toCam.x, 0.0, toCam.z));
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), flatDir));
        vec3 wp = iPos.xyz + right * position.x * iSize.x + vec3(0.0, position.y * iSize.y, 0.0) + flatDir * 1.2;
        vUv = vec2(position.x + 0.5, position.y);
        vSeed = iPos.w;
        vSize = iSize;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying float vSeed;
      varying vec2 vSize;
      ${noiseGLSL}
      void main() {
        vec2 m = vUv * vSize;
        float n = fbm3(vec2(m.x * 0.7 + vSeed * 13.0, m.y * 0.9 - uTime * 1.8)) * 0.65
                + fbm3(vec2(m.x * 1.9 - vSeed * 7.0, m.y * 2.2 - uTime * 3.1)) * 0.35;
        float top = mix(0.45, 1.0, n);
        float shape = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(top, top * 0.3, vUv.y) * smoothstep(0.0, 0.1, vUv.y);
        float a = shape * smoothstep(0.3, 0.7, n + 0.35 * (1.0 - vUv.y));
        vec3 col = mix(vec3(0.22, 0.28, 0.38), vec3(0.55, 0.62, 0.75), smoothstep(0.4, 0.9, n) * (1.0 - vUv.y * 0.5));
        gl_FragColor = vec4(col * uTint, a * 0.85);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'Boil';
  return mesh;
}
