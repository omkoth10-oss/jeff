import * as THREE from 'three';
import { noiseGLSL } from '../shaders/noise.js';
import { createWaterfalls } from './waterfalls.js';

// River, streams and waterfalls.
//  - The lower river is one flat plane at y = 0 (a clean mirror for the planar
//    reflection, render/reflection.js). A water map computed at load from the river
//    centreline (layout.json) gives every point its depth, flow direction and
//    whitewater: the shader discards the plane over the banks (it never pokes through
//    the ground), turns transparent and teal in the shallows, runs its ripples
//    downstream and churns white at the rapids.
//  - The sloped upper river and the waterfall-2 stream are ribbons from water.glb with
//    the same shader; their flow comes from their own centrelines.
//  - Waterfalls: world/waterfalls.js.
const RIVER_BOUNDS = { minX: -140, maxX: 180, minZ: -310, maxZ: 720 };
const MAP_RES = 1; // metres per water-map texel
const BED_DEPTH = 1.8; // river bed below the surface in the channel (terrain_lib BED)

export async function createWater(loaders, reflection, specDir, layout) {
  const gltf = await loaders.loadModel('water.glb');
  const group = new THREE.Group();
  const time = { value: 0 };
  const normals = bakeRippleTexture();
  const map = buildWaterMap(layout.rivers.main);
  const falls = layout.waterfalls;

  const shared = {
    uTime: time,
    uSpecDir: { value: specDir },
    uNormals: { value: normals },
    uWaterMap: { value: map.texture },
    uWaterRect: { value: map.rect },
    // cold glow of the falls on their pools: x, z, radius, strength
    uFallGlow: { value: falls.map((f, i) => new THREE.Vector4(f.foot[0], f.foot[2], i === 0 ? 10 : 5, i === 0 ? 0.15 : 0.1)) },
    // colour of the moon's glints, and the light on the water's own cool tones (body, sheen,
    // foam): the moon's phase changes both (src/loop/moonPhases.js)
    uMoonTint: { value: new THREE.Color(0.8, 0.88, 1.0) },
    uWaterTint: { value: new THREE.Color(1, 1, 1) },
  };
  const riverMat = createWaterMaterial(shared, reflection, false);
  const { minX, maxX, minZ, maxZ } = RIVER_BOUNDS;
  const river = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ).rotateX(-Math.PI / 2), riverMat);
  river.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  river.name = 'River';
  river.renderOrder = 1; // after the terrain (its bed shows through the shallows)
  group.add(river);

  const ribbonMat = createWaterMaterial(shared, null, true);
  ribbonMat.side = THREE.DoubleSide;
  // the stream ends in the river at the same height: draw it slightly in front
  ribbonMat.polygonOffset = true;
  ribbonMat.polygonOffsetFactor = -1;
  ribbonMat.polygonOffsetUnits = -2;
  gltf.scene.traverse((o) => {
    if (o.name === 'UpperRiver') addRibbonFlow(o.geometry, layout.rivers.upper, -1); // listed upstream from the fall
    else if (o.name === 'Stream2') addRibbonFlow(o.geometry, layout.rivers.stream2, 1);
    else if (o.name.startsWith('Waterfall') && o.isMesh) o.visible = false; // replaced by waterfalls.js
    if (o.name === 'UpperRiver' || o.name === 'Stream2') o.material = ribbonMat;
  });
  group.add(gltf.scene);

  // separate from the water root: the falls show in the river's reflection
  const waterfalls = createWaterfalls(falls, time, shared.uWaterTint);

  // churning foam where each fall lands, spreading downstream
  const poolFoam = createFoamMaterial(time, 'pool', shared.uWaterTint);
  falls.forEach((f, i) => {
    const size = i === 0 ? 26 : 12;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 1.4).rotateX(-Math.PI / 2), poolFoam);
    const dir = new THREE.Vector2(f.foot[0] - f.top[0], f.foot[2] - f.top[2]).normalize();
    m.position.set(f.foot[0] + dir.x * size * 0.25, f.foot[1] + 0.06, f.foot[2] + dir.y * size * 0.25);
    m.rotation.y = Math.atan2(dir.x, dir.y);
    m.renderOrder = 2;
    group.add(m);
  });

  const rockFoam = createFoamMaterial(time, 'rock', shared.uWaterTint);
  return {
    root: group,
    falls: waterfalls.root,
    uniforms: shared,
    update(dt) {
      time.value += dt;
    },
    // rapids: [x, z, radius, flowAngle] around the boulders in the stream. Each gets a
    // foam collar and a V-shaped wake, and the water map churns white around it.
    addFoam(spots) {
      map.addRapids(spots);
      const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.3); // quad reaches downstream
      const m = new THREE.InstancedMesh(geo, rockFoam, spots.length);
      const mat = new THREE.Matrix4();
      spots.forEach(([x, z, r, a], i) => {
        mat.compose(new THREE.Vector3(x, 0.04, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a),
          new THREE.Vector3(r * 3, 1, r * 4.5));
        m.setMatrixAt(i, mat);
      });
      m.renderOrder = 2;
      m.name = 'RapidsFoam';
      group.add(m);
    },
    // depth and flow of the main river at (x, z), depth 0 on the banks
    depthAt: map.depthAt,
    flowAt: map.flowAt,
  };
}

// ------------------------------------------------------------------ water map
// R: depth below the surface (the channel profile of terrain_lib.channel), GB: flow
// direction, A: whitewater. One texel per metre over RIVER_BOUNDS.
function buildWaterMap(pts) {
  const { minX, maxX, minZ, maxZ } = RIVER_BOUNDS;
  const w = Math.round((maxX - minX) / MAP_RES), h = Math.round((maxZ - minZ) / MAP_RES);
  const best = new Float32Array(w * h).fill(1e9);
  const depth = new Float32Array(w * h);
  const flow = new Float32Array(w * h * 2);
  const rapids = new Float32Array(w * h);
  const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az, aw] = pts[i], [bx, bz, bw] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
    const len = Math.sqrt(len2);
    const reach = Math.max(aw, bw) / 2 + 2;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - minX) / MAP_RES)), i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + reach - minX) / MAP_RES));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - minZ) / MAP_RES)), j1 = Math.min(h - 1, Math.ceil((Math.max(az, bz) + reach - minZ) / MAP_RES));
    for (let j = j0; j <= j1; j++) {
      for (let k = i0; k <= i1; k++) {
        const px = minX + (k + 0.5) * MAP_RES, pz = minZ + (j + 0.5) * MAP_RES;
        const u = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / len2));
        const d = Math.hypot(ax + dx * u - px, az + dz * u - pz);
        const idx = j * w + k;
        if (d >= best[idx]) continue;
        best[idx] = d;
        const half = (aw + (bw - aw) * u) / 2;
        depth[idx] = d < half ? BED_DEPTH * (1 - smooth(half - 7, half, d)) : 0;
        flow[idx * 2] = dx / len;
        flow[idx * 2 + 1] = dz / len;
      }
    }
  }
  const data = new Uint16Array(w * h * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  const write = () => {
    for (let k = 0; k < w * h; k++) {
      data[k * 4] = toHalf(depth[k]);
      data[k * 4 + 1] = toHalf(flow[k * 2]);
      data[k * 4 + 2] = toHalf(flow[k * 2 + 1]);
      data[k * 4 + 3] = toHalf(Math.min(rapids[k], 1));
    }
  };
  write();
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const cell = (x, z) => {
    const k = Math.floor((x - minX) / MAP_RES), j = Math.floor((z - minZ) / MAP_RES);
    return k < 0 || j < 0 || k >= w || j >= h ? -1 : j * w + k;
  };
  return {
    texture,
    rect: new THREE.Vector4(minX, minZ, maxX - minX, maxZ - minZ),
    depthAt: (x, z) => {
      const c = cell(x, z);
      return c < 0 ? 0 : depth[c];
    },
    flowAt: (x, z) => {
      const c = cell(x, z);
      return c < 0 ? [0, 1] : [flow[c * 2], flow[c * 2 + 1]];
    },
    // whitewater around each rapids boulder, trailing downstream
    addRapids(spots) {
      for (const [sx, sz, r0, a] of spots) {
        const r = Math.min(r0, 2.4); // pool markers are ~10 m: churn only near the rocks
        const fx = Math.sin(a), fz = Math.cos(a);
        const reach = r * 6;
        for (let j = Math.floor((sz - reach - minZ) / MAP_RES); j <= Math.ceil((sz + reach - minZ) / MAP_RES); j++) {
          for (let k = Math.floor((sx - reach - minX) / MAP_RES); k <= Math.ceil((sx + reach - minX) / MAP_RES); k++) {
            if (k < 0 || j < 0 || k >= w || j >= h) continue;
            const px = minX + (k + 0.5) * MAP_RES - sx, pz = minZ + (j + 0.5) * MAP_RES - sz;
            const along = px * fx + pz * fz - r * 1.5, across = -px * fz + pz * fx;
            const v = Math.exp(-(across * across) / (r * r * 0.7) - (along * along) / (r * r * 3.5));
            rapids[j * w + k] = Math.max(rapids[j * w + k], v);
          }
        }
      }
      write();
      texture.needsUpdate = true;
    },
  };
}

// Per-vertex flow for the sloped ribbons: direction of the nearest centreline segment
// (sign: +1 when the points are listed downstream) and depth across the ribbon.
function addRibbonFlow(geometry, pts, sign) {
  const pos = geometry.attributes.position, uv = geometry.attributes.uv;
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let best = 1e9, fx = 0, fz = 1;
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      const u = Math.min(1, Math.max(0, ((v.x - ax) * dx + (v.z - az) * dz) / len2));
      const d = Math.hypot(ax + dx * u - v.x, az + dz * u - v.z);
      if (d < best) {
        best = d;
        const l = Math.sqrt(len2);
        fx = (dx / l) * sign;
        fz = (dz / l) * sign;
      }
    }
    // depth: 0 at the ribbon's edges (it is wider than the channel, the ends tuck under
    // the banks) and at both ends (the upper river starts just past the waterfall lip)
    const across = uv ? uv.getX(i) : 0.5;
    const [sx, sz] = pts[0], [ex, ez] = pts[pts.length - 1];
    // short fade at the ends (the upper river overhangs the waterfall lip by ~1.5 m)
    const endFade = Math.min(1, Math.min(Math.hypot(v.x - sx, v.z - sz), Math.hypot(v.x - ex, v.z - ez)) / 1.6);
    out.set([fx, fz, Math.max(0, 1.1 * Math.sin(Math.PI * across) - 0.2) * endFade], i * 3);
  }
  geometry.setAttribute('aFlow', new THREE.BufferAttribute(out, 3));
}

// ------------------------------------------------------------------ ripple texture
// Tileable, 256 px, built from sums of waves with integer wave numbers (so it tiles and
// has no grid artefacts). RG = slope of the ripple height field; A = foam noise.
// Wave crests are stretched along texture y, which lies along the river's main
// direction (world z), so ripples and foam streak with the current.
function bakeRippleTexture() {
  const N = 256;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const waves = (count, kMin, kMax, falloff, stretch) => {
    const list = [];
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const k = kMin + (kMax - kMin) * rand() ** 1.5;
      // wave vectors mostly across y: features elongated along y
      const kx = Math.round(Math.cos(a) * k), ky = Math.round((Math.sin(a) * k) / stretch);
      if (kx === 0 && ky === 0) continue;
      list.push([kx, ky, k ** -falloff, rand() * Math.PI * 2]);
    }
    return list;
  };
  const height = waves(56, 2, 34, 1.4, 2.2);
  const foamW = waves(40, 2, 20, 1.1, 3.0);
  const data = new Uint8Array(N * N * 4);
  const gx = new Float32Array(N * N), gy = new Float32Array(N * N), fo = new Float32Array(N * N);
  let gmax = 0, fmin = 1e9, fmax = -1e9;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let sx = 0, sy = 0, f = 0;
      for (const [kx, ky, amp, ph] of height) {
        const d = -Math.sin((2 * Math.PI * (kx * x + ky * y)) / N + ph) * amp;
        sx += d * kx;
        sy += d * ky;
      }
      for (const [kx, ky, amp, ph] of foamW) f += Math.cos((2 * Math.PI * (kx * x + ky * y)) / N + ph) * amp;
      const i = y * N + x;
      gx[i] = sx; gy[i] = sy; fo[i] = f;
      gmax = Math.max(gmax, Math.abs(sx), Math.abs(sy));
      fmin = Math.min(fmin, f); fmax = Math.max(fmax, f);
    }
  }
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(128 + (gx[i] / gmax) * 127);
    data[i * 4 + 1] = Math.round(128 + (gy[i] / gmax) * 127);
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = Math.round(((fo[i] - fmin) / (fmax - fmin)) * 255);
  }
  const tex = new THREE.DataTexture(data, N, N);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------ water shader
// Ripples: two phases of flow-mapped slope texture (so they run downstream without
// stretching) at two scales, fading out with distance. Colour: teal-grey in the
// shallows, blue-black in the channel, mixed with the planar reflection by Fresnel.
// The reflection is distorted only slightly and smeared vertically, so lanterns become
// short warm streaks broken by the ripples. The moon's reflection is a column of small
// glints (the moon direction is raised: its true reflection would sit at the horizon).
function createWaterMaterial(shared, reflection, ribbon) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.uniforms.uReflection = { value: reflection ? reflection.texture : null };
    shader.uniforms.uTexMatrix = { value: reflection ? reflection.textureMatrix : new THREE.Matrix4() };
    shader.defines = { ...(shader.defines || {}), ...(reflection ? { USE_REFLECTION: '' } : {}), ...(ribbon ? { USE_RIBBON: '' } : {}) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform mat4 uTexMatrix;
        varying vec3 vWW;
        varying vec4 vRefl;
        #ifdef USE_RIBBON
          attribute vec3 aFlow;
          varying vec3 vFlow;
        #endif`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vRefl = uTexMatrix * vec4(vWW, 1.0);
        #ifdef USE_RIBBON
          vFlow = aFlow;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uReflection, uNormals, uWaterMap;
        uniform vec4 uWaterRect;
        uniform vec4 uFallGlow[2];
        uniform float uTime;
        uniform vec3 uSpecDir, uMoonTint, uWaterTint;
        varying vec3 vWW;
        varying vec4 vRefl;
        #ifdef USE_RIBBON
          varying vec3 vFlow;
        #endif
        ${noiseGLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `{
        vec3 toCam = cameraPosition - vWW;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        #ifdef USE_RIBBON
          vec2 flow = vFlow.xy;
          float depth = vFlow.z;
          float rapids = 0.18;                                     // sloped streams run a little faster and broken
        #else
          vec4 wm = texture2D(uWaterMap, (vWW.xz - uWaterRect.xy) / uWaterRect.zw);
          float depth = wm.r;
          vec2 flow = wm.gb;
          float rapids = wm.a;
          if (depth <= 0.002) discard;                             // over the banks: no water plane
        #endif

        // flow-mapped ripples, two phases blended so the pattern never stretches
        float speed = 0.7 + 1.6 * rapids;
        float t = uTime * 0.16;
        float fA = fract(t), fB = fract(t + 0.5);
        float wA = 1.0 - abs(2.0 * fA - 1.0);
        vec2 off = flow * speed * 3.0;                             // metres travelled per phase cycle (6 s)
        vec2 p = vWW.xz;
        vec4 a1 = texture2D(uNormals, (p - off * fA) / 6.0);
        vec4 b1 = texture2D(uNormals, (p - off * fB) / 6.0 + 0.5);
        vec4 a2 = texture2D(uNormals, (p - off * fA) / 23.0 + 0.21);
        vec4 b2 = texture2D(uNormals, (p - off * fB) / 23.0 + 0.71);
        // a third, finer layer for crisp glints up close
        vec4 a3 = texture2D(uNormals, (p - off * fA * 1.6) / 1.7 + 0.37);
        vec4 b3 = texture2D(uNormals, (p - off * fB * 1.6) / 1.7 + 0.83);
        vec2 fine = mix(b1.xy, a1.xy, wA) * 2.0 - 1.0;
        vec2 broad = mix(b2.xy, a2.xy, wA) * 2.0 - 1.0;
        vec2 micro = (mix(b3.xy, a3.xy, wA) * 2.0 - 1.0) * (1.0 - smoothstep(15.0, 60.0, dist));
        vec2 slope = (fine * (0.3 + 0.45 * rapids) + micro * 0.35) * mix(1.0, 0.4, smoothstep(35.0, 200.0, dist)) + broad * mix(0.12, 0.3, smoothstep(40.0, 150.0, dist));
        vec3 N = normalize(vec3(slope.x, 1.0, slope.y));
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

        // colour of the water body: teal-grey in the shallows, blue-black in the channel
        vec3 body = mix(vec3(0.03, 0.05, 0.055), vec3(0.004, 0.009, 0.016), smoothstep(0.1, 1.3, depth));
        for (int i = 0; i < 2; i++) {                              // cold glow of a waterfall on its pool
          vec4 g = uFallGlow[i];
          body += vec3(0.05, 0.075, 0.11) * g.w * exp(-length(p - g.xy) / g.z);
        }
        body *= uWaterTint;
        vec3 col = body;
        #ifdef USE_REFLECTION
          // small distortion that shrinks with distance; reflections stretch vertically
          // reflections shimmer sideways only a little and stretch toward the viewer
          // (screen-vertical), so shapes stay readable and lights become broken streaks
          vec2 ruv = vRefl.xy / vRefl.w + vec2(slope.x * 0.006, slope.y * 0.016) * clamp(30.0 / dist, 0.3, 1.0);
          float st = 0.004 + 0.02 * abs(slope.y);
          vec3 refl = texture2D(uReflection, ruv).rgb * 0.5
                    + texture2D(uReflection, ruv + vec2(0.0, st)).rgb * 0.25
                    + texture2D(uReflection, ruv - vec2(0.0, st * 1.6)).rgb * 0.25;
          col = mix(body, refl * 0.85, clamp(F * 1.25 + 0.08, 0.0, 0.92));
        #endif
        // a faint sky sheen, so grazing water never goes dead black
        col += vec3(0.012, 0.022, 0.045) * F * uWaterTint;

        // moon: a column of small glints toward the moon, plus a faint sheen that shows
        // the river's course from afar
        vec3 R = reflect(-V, N);
        float m = max(dot(R, uSpecDir), 0.0);
        vec3 R0 = reflect(-V, vec3(0.0, 1.0, 0.0));
        float az0 = 1.0 - dot(normalize(R0.xz), normalize(uSpecDir.xz));
        // a column broken into short ripple highlights that drift downstream; up close
        // the individual glints (far away the ripples average out and would merge them)
        float elev = exp(-pow((R0.y - uSpecDir.y) / 0.4, 2.0));
        float column = exp(-az0 * 3000.0) * elev;
        float broken = smoothstep(0.6, 0.85, mix(b3.a, a3.a, wA) * 0.7 + mix(b1.a, a1.a, wA) * 0.3 + slope.y * 0.6);   // small glints, not blobs
        float nearGlints = 1.0 - smoothstep(30.0, 110.0, dist);
        col += uMoonTint * (column * (0.03 + 0.5 * broken) + exp(-az0 * 900.0) * elev * pow(m, 900.0) * 6.0 * nearGlints + pow(m, 12.0) * 0.012);

        #ifdef USE_FOG
          // lanterns on the banks: warm streaks on the water between the lamp and the
          // viewer, broken up by the ripples (lamp map, render/fog.js)
          vec2 toward = normalize(toCam.xz);
          vec3 warm = lampLight(vec3(p.x, 0.0, p.y) - vec3(toward.x, 0.0, toward.y) * 3.0) * 0.4
                    + lampLight(vec3(p.x, 0.0, p.y) - vec3(toward.x, 0.0, toward.y) * 8.0) * 0.35
                    + lampLight(vec3(p.x, 0.0, p.y) - vec3(toward.x, 0.0, toward.y) * 14.0) * 0.25;
          // only as broken reflections: the water between the glints stays dark
          float glitter = smoothstep(0.55, 0.9, 0.5 + dot(slope, toward) * 1.8);
          col += warm * glitter * 0.7 * smoothstep(0.05, 0.4, depth);
        #endif

        // whitewater: broken foam lines along the shore and churn at the rapids
        float foamN = mix(b1.a, a1.a, wA);
        float foamF = mix(b3.a, a3.a, wA);
        #ifdef USE_RIBBON
          float shore = 0.0;                                       // narrow streams: no foam lines
        #else
          float shore = smoothstep(0.12, 0.03, depth) * smoothstep(0.012, 0.03, depth) * smoothstep(0.62, 0.82, foamF) * smoothstep(0.4, 0.7, foamN) * 0.6;   // broken foam, not an outline
        #endif
        float churn = smoothstep(0.25, 0.9, rapids) * smoothstep(0.55 - 0.25 * rapids, 0.8, foamF * 0.6 + foamN * 0.4 + 0.2 * rapids);
        float flecks = smoothstep(0.86, 0.93, foamF) * smoothstep(0.3, 1.0, depth) * 0.35 * (1.0 - smoothstep(20.0, 70.0, dist));
        float white = clamp(shore * 0.7 + churn * 0.7 + flecks, 0.0, 0.85) * mix(1.0, 0.35, smoothstep(60.0, 220.0, dist));
        col = mix(col, vec3(0.34, 0.39, 0.47) * uWaterTint, white);

        // see into the shallows (the bed shows), opaque in the channel, soft at the bank
        float alpha = clamp(F + 1.0 - exp(-depth * 3.0), 0.0, 1.0) * smoothstep(0.0, 0.1, depth);
        #ifdef USE_RIBBON
          alpha *= smoothstep(0.0, 0.25, depth);                 // edges and ends fade out under the banks
          white *= smoothstep(0.1, 0.3, depth);
          if (max(alpha, white) < 0.01) discard;
        #endif
        diffuseColor = vec4(col, max(alpha, white));
        }`,
      );
  };
  mat.customProgramCacheKey = () => `water${reflection ? '-refl' : ''}${ribbon ? '-ribbon' : ''}`;
  return mat;
}

// ------------------------------------------------------------------ foam
// 'pool': churning foam where a fall lands, pushed outward and trailing downstream.
// 'rock': a collar around a boulder and a V-shaped wake behind it (the quad's +z runs
// downstream, the rock sits near its upstream end).
function createFoamMaterial(time, kind, tint) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x8a98b2, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uWaterTint = tint; // the moonlight's colour (the moon's phase)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFoamUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFoamUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform vec3 uWaterTint;\nvarying vec2 vFoamUv;\n${noiseGLSL}`)
      .replace(
        '#include <color_fragment>',
        kind === 'pool'
          ? `#include <color_fragment>
          diffuseColor.rgb *= uWaterTint;
          {
            vec2 c = (vFoamUv - vec2(0.5, 0.62)) * vec2(2.0, 2.8);   // the fall lands toward the upstream end
            float r = length(c);
            float a = atan(c.y, c.x);
            float n = fbm3(vec2(a * 2.5, r * 5.0 - uTime * 1.6)) * 0.6 + fbm3(vec2(vFoamUv.x * 9.0, vFoamUv.y * 6.0 + uTime * 0.5)) * 0.4;
            float trail = smoothstep(0.0, 0.5, 1.0 - vFoamUv.y) * smoothstep(1.0, 0.35, abs(c.x));   // drifting away downstream
            float body = smoothstep(1.0, 0.1, r) + trail * 0.7;
            diffuseColor.a *= clamp(body, 0.0, 1.0) * smoothstep(0.45, 0.72, n + 0.25 * smoothstep(0.6, 0.0, r)) * 0.85;
            diffuseColor.rgb *= 0.85 + 0.3 * smoothstep(0.4, 0.0, r);
          }`
          : `#include <color_fragment>
          diffuseColor.rgb *= uWaterTint;
          {
            vec2 q = vFoamUv * 2.0 - 1.0;              // x across the flow
            float v = 1.0 - vFoamUv.y;                 // 0 upstream edge .. 1 downstream end
            vec2 rc = vec2(q.x, (v - 0.2) * 2.3);      // the rock sits at v = 0.2
            float collar = exp(-pow((length(rc) - 0.32) / 0.12, 2.0));
            float behind = smoothstep(0.2, 0.3, v);
            float wake = exp(-pow((abs(q.x) - 0.12 - 0.5 * (v - 0.2)) / (0.08 + 0.12 * v), 2.0)) * behind * smoothstep(1.0, 0.3, v);
            float n = fbm3(vec2(q.x * 5.0, v * 9.0 - uTime * 2.2));
            diffuseColor.a *= clamp(collar * 0.9 + wake * 0.45, 0.0, 1.0) * smoothstep(0.35, 0.75, n) * 0.7;
          }`,
      );
  };
  mat.customProgramCacheKey = () => `foam-${kind}`;
  return mat;
}
