import * as THREE from 'three';
import { noiseGLSL } from '../shaders/noise.js';

// Buildings, landmarks and props from blender/scripts/build_village.py.
// Houses and repeated props are instanced; each house type has a detailed (LOD0) and
// a simple (LOD1) mesh and instances move between the two by distance to the camera.
// Everything uses one material: a texture array indexed per face (uv1.x), a per-face
// tint (vertex colour) and an emissive strength (uv1.y) for shoji paper and lanterns.
const LAYERS = { wood: 0, plaster: 1, shoji: 2, roof: 3, stone: 4 };
const LOD_DISTANCE = 170;

export async function createVillage(loaders) {
  const base = import.meta.env.BASE_URL;
  const [houses, props, landmarks, color, normal, data] = await Promise.all([
    loaders.loadModel('houses.glb'),
    loaders.loadModel('props.glb'),
    loaders.loadModel('landmarks.glb'),
    loaders.loadTexture('arch_color.ktx2'),
    loaders.loadTexture('arch_normal.ktx2'),
    fetch(`${base}data/village.json`).then((r) => r.json()),
  ]);
  for (const t of [color, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = loaders.maxAnisotropy;
  }
  const time = { value: 0 };
  const material = createArchMaterial(color, normal, time);

  const root = new THREE.Group();
  root.name = 'Village';

  // landmarks are exported in place
  landmarks.scene.traverse((o) => {
    if (o.isMesh) o.material = material;
  });
  root.add(landmarks.scene);

  // houses: one InstancedMesh per type and level of detail
  const protos = meshesByName(houses.scene);
  const byType = groupBy(data.houses, (h) => h.type);
  const lodSets = [];
  for (const [type, list] of Object.entries(byType)) {
    const lod = [0, 1].map((l) => {
      const m = new THREE.InstancedMesh(protos[`House_${type}_LOD${l}`].geometry, material, list.length);
      m.name = `House_${type}_LOD${l}`;
      m.count = 0;
      m.frustumCulled = false; // instances span the whole valley; culling happens by LOD count
      root.add(m);
      return m;
    });
    const matrices = list.map((h) => composeMatrix(h));
    lodSets.push({ lod, matrices, positions: list.map((h) => new THREE.Vector3(h.x, h.y, h.z)) });
  }

  // props: torii, street lanterns, stone lanterns
  const propProtos = meshesByName(props.scene);
  for (const [type, list] of Object.entries(groupBy(data.props, (p) => p.type))) {
    const m = new THREE.InstancedMesh(propProtos[type].geometry, material, list.length);
    m.name = type;
    list.forEach((p, i) => m.setMatrixAt(i, composeMatrix(p)));
    m.computeBoundingSphere();
    root.add(m);
  }

  const camPos = new THREE.Vector3();
  let frame = 0;
  function updateLods(camera) {
    camera.getWorldPosition(camPos);
    for (const set of lodSets) {
      let n0 = 0;
      let n1 = 0;
      set.positions.forEach((p, i) => {
        if (p.distanceTo(camPos) < LOD_DISTANCE) set.lod[0].setMatrixAt(n0++, set.matrices[i]);
        else set.lod[1].setMatrixAt(n1++, set.matrices[i]);
      });
      set.lod[0].count = n0;
      set.lod[1].count = n1;
      set.lod[0].instanceMatrix.needsUpdate = true;
      set.lod[1].instanceMatrix.needsUpdate = true;
    }
  }

  return {
    root,
    material,
    data,
    update(dt, camera) {
      time.value += dt;
      if (frame++ % 10 === 0) updateLods(camera); // houses don't need per-frame LOD checks
    },
  };
}

function composeMatrix(p) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot),
    new THREE.Vector3().setScalar(p.scale ?? 1),
  );
}

function meshesByName(scene) {
  const out = {};
  scene.traverse((o) => {
    if (o.isMesh) out[o.name] = o;
  });
  return out;
}

function groupBy(list, key) {
  const out = {};
  for (const x of list) (out[key(x)] ??= []).push(x);
  return out;
}

function createArchMaterial(colorArray, normalArray, time) {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uArchColor = { value: colorArray };
    shader.uniforms.uArchNormal = { value: normalArray };
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 color;
        #ifndef USE_UV1
          attribute vec2 uv1;
        #endif
        varying vec2 vArchUv;
        varying vec2 vArchLayer;
        varying vec3 vTint;
        varying float vVariant;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vArchUv = uv;
        vArchLayer = uv1;
        vTint = color.rgb;
        #ifdef USE_INSTANCING
          vVariant = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
        #else
          vVariant = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray uArchColor;
        uniform sampler2DArray uArchNormal;
        uniform float uTime;
        varying vec2 vArchUv;
        varying vec2 vArchLayer;
        varying vec3 vTint;
        varying float vVariant;
        ${noiseGLSL}
        vec3 gArchEmissive;
        float gArchRough;
        vec2 gTileN;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
        float layer = floor(vArchLayer.x + 0.5);
        vec4 tex = texture(uArchColor, vec3(vArchUv, layer));
        // shoji paper and lanterns glow warm; lattice bars stay dark. Lit paper gets a dark
        // diffuse so the moonlight doesn't wash the glow out to white.
        float paper = layer == ${LAYERS.shoji}.0 ? smoothstep(0.3, 0.55, dot(tex.rgb, vec3(0.3, 0.55, 0.15))) : 0.0;
        float lit = vArchLayer.y * paper;
        // vermilion lacquer reads as deep oxblood under the moon; lanterns warm it back up
        float redness = clamp((vTint.r - max(vTint.g, vTint.b)) * 1.6, 0.0, 1.0);
        vec3 tint = vTint * mix(vec3(1.0), vec3(0.36, 0.3, 0.36), redness);
        diffuseColor.rgb *= tex.rgb * tint * (1.0 - 0.8 * min(lit, 1.0));
        // UVs are metres: u along the face, v up a wall or along a roof slope
        float worldUp = dot(normalize(vNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
        gTileN = vec2(0.0);
        if (layer == ${LAYERS.roof}.0) {
          // hongawara: concave pan tiles in columns down the slope, each joint covered by a
          // round cap tile; courses overlap every 27 cm. Shaded and bumped procedurally:
          // dark channels, moonlit caps, a shadow line under each course, and the odd
          // tile a little lighter or darker
          float cu = vArchUv.x / 0.3;
          float fu = fract(cu);
          float course = vArchUv.y / 0.27;
          float fc = fract(course);
          float H = pow(0.5 + 0.5 * cos(6.2832 * fu), 3.0);
          float dH = -3.0 * pow(0.5 + 0.5 * cos(6.2832 * fu), 2.0) * 0.5 * sin(6.2832 * fu) * 6.2832;
          // (fades to the average where a tile is smaller than a few pixels: no moire)
          float aaU = clamp(1.6 - fwidth(cu) * 4.0, 0.0, 1.0), aaV = clamp(1.6 - fwidth(course) * 4.0, 0.0, 1.0);
          gTileN = vec2(-dH * 0.09 * aaU, (fc < 0.12 ? -0.25 : 0.04) * aaV);
          float id = hash12(vec2(floor(cu), floor(course)) + vVariant * 13.0);
          float lip = mix(1.0, smoothstep(0.0, 0.1, fc), aaV);
          diffuseColor.rgb *= 0.55 * mix(0.82, mix(0.58, 1.18, H), aaU) * mix(0.8, 1.0, lip) * (1.0 + (0.24 * id - 0.12) * aaU);
        } else if (abs(worldUp) < 0.5) {
          if (layer == ${LAYERS.wood}.0) {
            // boards weather unevenly
            float board = floor(vArchUv.x / 0.21);
            diffuseColor.rgb *= 0.86 + 0.28 * hash12(vec2(board, vVariant * 31.0 + floor(vArchUv.y / 2.7)));
          } else if (layer == ${LAYERS.plaster}.0) {
            // rain streaks down the lime plaster
            float streak = vnoise(vec2(vArchUv.x * 5.0, vArchUv.y * 0.3 + vVariant * 17.0));
            diffuseColor.rgb *= 1.0 - 0.2 * smoothstep(0.5, 0.9, streak) * smoothstep(3.5, 1.0, vArchUv.y);
          }
          // splashed soil darkens the foot of walls and posts
          if (layer != ${LAYERS.shoji}.0) diffuseColor.rgb *= mix(0.68, 1.0, smoothstep(0.15, 0.95, vArchUv.y));
        }
        // every room is lit differently: per house and per window bay (about a metre of
        // wall), a few dark rooms, some deep orange, some paler candle light
        float bay = fract(sin(floor(vArchUv.x * 0.8) * 91.7 + vVariant * 437.1) * 43758.5453);
        float room = bay < 0.12 ? 0.12 : mix(0.45, 1.3, bay);
        float window = (0.6 + 0.6 * vVariant) * room;
        float flicker = 0.9 + 0.1 * vnoise(vec2(uTime * 1.7, vVariant * 91.0 + floor(vArchUv.x * 0.8)));
        vec3 glow = mix(vec3(1.0, 0.38, 0.1), vec3(1.0, 0.6, 0.3), fract(bay * 7.3));
        gArchEmissive = lit * vTint * glow * 1.15 * window * flicker;   // amber, not blown to white
        gArchRough = layer == ${LAYERS.roof}.0 ? 0.64 : (layer == ${LAYERS.wood}.0 ? 0.78 : 0.92);
        }`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gArchRough;')
      .replace(
        '#include <normal_fragment_maps>',
        `{
        // tangent frame from screen-space derivatives (no tangents stored)
        vec3 mapN = texture(uArchNormal, vec3(vArchUv, floor(vArchLayer.x + 0.5))).xyz * 2.0 - 1.0;
        vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
        vec2 st0 = dFdx(vArchUv), st1 = dFdy(vArchUv);
        vec3 q1perp = cross(q1, normal), q0perp = cross(normal, q0);
        vec3 T = q1perp * st0.x + q0perp * st1.x;
        vec3 B = q1perp * st0.y + q0perp * st1.y;
        float det = max(dot(T, T), dot(B, B));
        float scale = det == 0.0 ? 0.0 : inversesqrt(det);
        normal = normalize(mat3(T * scale, B * scale, normal) * vec3(mapN.xy * 0.8 + gTileN, mapN.z));
        }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gArchEmissive;');
  };
  return material;
}
