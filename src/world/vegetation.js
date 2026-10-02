import * as THREE from 'three';

// Forest, cherry trees and rocks from blender/scripts/build_vegetation.py.
//  - Trees within LOD_DISTANCE of the camera are real meshes (instanced per type).
//  - Every other tree is a camera-facing billboard. The billboard images are rendered
//    from the real tree meshes at load time, so both levels always match. All
//    billboards are one draw call; the vertex shader collapses the ones that are close
//    enough to be drawn as meshes.
//  - Rocks are instanced, with a simpler mesh beyond ROCK_LOD_DISTANCE, and use the
//    terrain's dark rock texture (triplanar) with moss on top.
// types in forest.bin; Broadleaf is derived from the Sakura model at load (makeBroadleaf)
const TREE_TYPES = ['Fir_A', 'Fir_B', 'Sakura', 'Pine_1', 'Pine_2', 'Pine_3', 'Broadleaf'];
const LOD_DISTANCE = 55;
const ROCK_LOD_DISTANCE = 70;
const CELL = 40;

export async function createVegetation(loaders, renderer, terrainTextures) {
  const base = import.meta.env.BASE_URL;
  const [treesGltf, rocksGltf, forestBuf, rockData] = await Promise.all([
    loaders.loadModel('trees.glb'),
    loaders.loadModel('rocks.glb'),
    fetch(`${base}data/forest.bin`).then((r) => r.arrayBuffer()),
    fetch(`${base}data/rocks.json`).then((r) => r.json()),
  ]);
  const root = new THREE.Group();
  root.name = 'Vegetation';

  const trees = parseForest(forestBuf);
  const protos = TREE_TYPES.slice(0, 6).map((name) => treesGltf.scene.getObjectByName(name));
  for (const p of protos) prepareTreeMaterials(p);
  protos.push(makeBroadleaf(protos[2]));

  const atlas = bakeImpostors(renderer, protos);
  const billboards = createBillboards(trees, atlas);
  root.add(billboards.mesh);

  const near = createNearTrees(trees, protos);
  root.add(near.group);

  const rocks = createRocks(rocksGltf, rockData, terrainTextures);
  root.add(rocks.group);

  return {
    root,
    near: near.group,
    rocks: rocks.group,
    trees,
    rockList: rockData.rocks,
    rockColliders: rockData.colliders,
    foam: rockData.foam,
    update(dt, camera) {
      near.update(camera);
      rocks.update(camera);
    },
  };
}

function parseForest(buf) {
  const n = new Uint32Array(buf, 0, 1)[0];
  let o = 4;
  const i16 = () => {
    const a = new Int16Array(buf.slice(o, o + n * 2));
    o += n * 2;
    return a;
  };
  const u8 = () => {
    const a = new Uint8Array(buf, o, n);
    o += n;
    return a;
  };
  const x = i16(), z = i16(), y = i16();
  const type = u8(), scale = u8(), rot = u8();
  const out = { count: n, pos: new Float32Array(n * 3), type, scale: new Float32Array(n), rot: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    out.pos[i * 3] = x[i] / 10;
    out.pos[i * 3 + 1] = y[i] / 20;
    out.pos[i * 3 + 2] = z[i] / 10;
    out.scale[i] = 0.5 + (scale[i] / 255) * 1.2;
    out.rot[i] = (rot[i] / 255) * Math.PI * 2;
  }
  return out;
}

function prepareTreeMaterials(proto) {
  proto.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    // foliage cards: alpha-tested (no sorting), double sided. Materials authored with
    // soft (blended) alpha have faint needle clusters, so they get a lower cut-off.
    m.alphaTest = m.transparent ? 0.18 : 0.45;
    m.transparent = false;
    m.side = THREE.DoubleSide;
    m.metalness = 0;
    m.roughness = 0.9;
    m.color.multiplyScalar(0.78);   // matches the average tint of the distant billboards
    // the blossom texture is a pale pink that reads lavender under blue moonlight:
    // push it to a saturated cherry pink so it survives the grade
    if (m.name === 'Sakura_Mat') m.color.multiply(new THREE.Color(1.2, 0.66, 0.82));
    m.metalnessMap = null;
    m.roughnessMap = null;
    m.needsUpdate = true;
  });
}

// Round-crowned broadleaf trees for a mixed forest (the reference's forest isn't all
// conifers): the cherry model, larger, with its blossom cards turned into dark leaves by
// taking their brightness and tinting it green.
const leafTint = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#include <map_fragment>
    #ifdef USE_MAP
      diffuseColor.rgb = diffuse * dot(sampledDiffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * 1.6;
    #endif`,
  );
};

function makeBroadleaf(sakura) {
  const tree = sakura.clone(true);
  tree.name = 'Broadleaf';
  tree.scale.multiplyScalar(1.6);
  tree.traverse((o) => {
    if (!o.isMesh || o.material.name !== 'Sakura_Mat') return;
    const m = o.material.clone();
    m.name = 'Broadleaf_Mat';
    m.color.setRGB(0.1, 0.15, 0.075);
    m.onBeforeCompile = leafTint;
    m.userData.leafTint = leafTint;
    o.material = m;
  });
  return tree;
}

// Renders each tree type from the side into one texture: 256 x 512 per type.
function bakeImpostors(renderer, protos) {
  const W = 256, H = 512;
  const target = new THREE.WebGLRenderTarget(W * protos.length, H, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const sizes = [];
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping;
  const prevAuto = renderer.autoClear;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);
  target.viewport.set(0, 0, W * protos.length, H);
  renderer.setRenderTarget(target);
  renderer.clear();
  protos.forEach((proto, i) => {
    const clone = proto.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.traverse((o) => {
      if (o.isMesh) {
        const tint = o.material.userData.leafTint;
        o.material = new THREE.MeshBasicMaterial({ map: o.material.map, color: o.material.color, alphaTest: o.material.alphaTest, side: THREE.DoubleSide });
        if (tint) o.material.onBeforeCompile = tint;
      }
    });
    const box = new THREE.Box3().setFromObject(clone);
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 1.02;
    const height = Math.max(box.max.y * 1.02, width * 2);
    sizes.push(new THREE.Vector2(height / 2, height));
    cam.left = -height / 4; cam.right = height / 4; cam.top = height; cam.bottom = 0;
    cam.position.set(0, 0, 100);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    scene.add(clone);
    target.viewport.set(i * W, 0, W, H);           // render targets use their own viewport
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    scene.remove(clone);
  });
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.toneMapping = prevTone;
  renderer.autoClear = prevAuto;
  return { texture: target.texture, sizes, slots: protos.length };
}

// The forest is split into square chunks, each its own draw with tight bounds, so the
// camera (and the mirrored reflection camera) skip the ones out of view.
const BILLBOARD_CHUNK = 400;

function createBillboards(trees, atlas) {
  const position = new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3);
  const normal = new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3);
  const chunks = new Map();
  for (let i = 0; i < trees.count; i++) {
    const key = `${Math.floor(trees.pos[i * 3] / BILLBOARD_CHUNK)},${Math.floor(trees.pos[i * 3 + 2] / BILLBOARD_CHUNK)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(i);
  }
  const maxHeight = Math.max(...atlas.sizes.map((s) => s.y)) * 1.7;   // tallest type at the largest scale
  const geometries = [...chunks.values()].map((list) => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', position);
    geo.setAttribute('normal', normal);
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const iData = new Float32Array(list.length * 4);   // x, y, z, scale
    const iType = new Float32Array(list.length * 2);   // type, mirror
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    list.forEach((i, k) => {
      iData.set([trees.pos[i * 3], trees.pos[i * 3 + 1], trees.pos[i * 3 + 2], trees.scale[i]], k * 4);
      iType[k * 2] = trees.type[i];
      iType[k * 2 + 1] = trees.rot[i] > Math.PI ? 1 : 0;
      box.expandByPoint(v.set(trees.pos[i * 3], trees.pos[i * 3 + 1], trees.pos[i * 3 + 2]));
    });
    box.max.y += maxHeight;
    box.expandByScalar(maxHeight * 0.3);                // crowns reach out sideways
    geo.setAttribute('iData', new THREE.InstancedBufferAttribute(iData, 4));
    geo.setAttribute('iType', new THREE.InstancedBufferAttribute(iType, 2));
    geo.instanceCount = list.length;
    geo.boundingBox = box;
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    return geo;
  });

  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, alphaTest: 0.4, side: THREE.DoubleSide });
  const sizes = atlas.sizes.map((s) => s.clone());
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlas.texture };
    shader.uniforms.uSizes = { value: sizes };
    shader.uniforms.uLod = { value: LOD_DISTANCE };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 iData;
        attribute vec2 iType;
        uniform vec2 uSizes[${atlas.slots}];
        uniform float uLod;
        varying vec2 vBbUv;
        varying float vBbDist;
        varying float vBbTint;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 toCam = cameraPosition - iData.xyz;
        vec3 flatDir = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), flatDir));
        // rounded normal so the canopy shades like a volume, not a card
        vec3 objectNormal = normalize(flatDir + right * position.x * 1.2 + vec3(0.0, 0.5, 0.0));`,
      )
      .replace(
        '#include <begin_vertex>',
        `int ty = int(iType.x + 0.5);
        vec2 sz = uSizes[ty] * iData.w;
        vec3 transformed = iData.xyz + right * position.x * sz.x + vec3(0.0, position.y * sz.y, 0.0);
        vBbDist = length(toCam);
        if (vBbDist < uLod) transformed = iData.xyz;                // drawn as a mesh instead
        float u = position.x + 0.5;
        if (iType.y > 0.5) u = 1.0 - u;
        vBbUv = vec2((float(ty) + u) / ${atlas.slots}.0, position.y);
        // per-tree tint times large patches of lighter and darker forest
        vec2 mp = iData.xz / 110.0;
        vec2 mi = floor(mp), mf = fract(mp);
        mf = mf * mf * (3.0 - 2.0 * mf);
        float h00 = fract(sin(dot(mi, vec2(12.9898, 78.233))) * 43758.5453);
        float h10 = fract(sin(dot(mi + vec2(1.0, 0.0), vec2(12.9898, 78.233))) * 43758.5453);
        float h01 = fract(sin(dot(mi + vec2(0.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
        float h11 = fract(sin(dot(mi + vec2(1.0, 1.0), vec2(12.9898, 78.233))) * 43758.5453);
        float macro = mix(mix(h00, h10, mf.x), mix(h01, h11, mf.x), mf.y);
        vBbTint = (0.55 + 0.35 * fract(sin(dot(iData.xz, vec2(12.9898, 78.233))) * 43758.5453)) * (0.7 + 0.6 * macro);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uAtlas;\nvarying vec2 vBbUv;\nvarying float vBbDist;\nvarying float vBbTint;`)
      .replace(
        '#include <map_fragment>',
        `vec4 bb = texture2D(uAtlas, vBbUv);
        // distant mip levels lose alpha coverage; boost it so far forests stay dense
        bb.a *= 1.0 + clamp(vBbDist / 250.0, 0.0, 2.5);
        // moonlit crowns, shaded bases: breaks the canopy into individual trees
        float crown = mix(0.5, 1.6, smoothstep(0.15, 0.95, vBbUv.y));
        diffuseColor *= vec4(bb.rgb * vBbTint * crown, bb.a);`,
      );
  };
  // shadow casting (the moon's shadow map, main.js): the same cards, turned toward the
  // light's camera and cut out by the atlas alpha. They cast for the near trees too.
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.4, side: THREE.DoubleSide });
  depthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlas.texture };
    shader.uniforms.uSizes = { value: sizes };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 iData;
        attribute vec2 iType;
        uniform vec2 uSizes[${atlas.slots}];
        varying vec2 vBbUv;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 toCam = cameraPosition - iData.xyz;
        vec3 flatDir = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), flatDir));
        int ty = int(iType.x + 0.5);
        vec2 sz = uSizes[ty] * iData.w;
        vec3 transformed = iData.xyz + right * position.x * sz.x + vec3(0.0, position.y * sz.y, 0.0);
        float u = position.x + 0.5;
        if (iType.y > 0.5) u = 1.0 - u;
        vBbUv = vec2((float(ty) + u) / ${atlas.slots}.0, position.y);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uAtlas;\nvarying vec2 vBbUv;')
      .replace('#include <alphatest_fragment>', 'diffuseColor.a *= texture2D(uAtlas, vBbUv).a;\n#include <alphatest_fragment>');
  };
  const mesh = new THREE.Group();
  mesh.name = 'TreeBillboards';
  for (const geo of geometries) {
    const chunk = new THREE.Mesh(geo, material);
    chunk.customDepthMaterial = depthMaterial;
    chunk.castShadow = true;
    chunk.receiveShadow = true;
    // alpha-tested: drawn after the solid geometry so hidden fragments fail the depth
    // test before shading (discard defeats the early hidden-surface removal of tile GPUs)
    chunk.renderOrder = 1;
    mesh.add(chunk);
  }
  return { mesh };
}

// Real tree meshes for the trees near the camera, looked up through a coarse grid.
function createNearTrees(trees, protos) {
  const group = new THREE.Group();
  const cells = new Map();
  for (let i = 0; i < trees.count; i++) {
    const key = `${Math.floor(trees.pos[i * 3] / CELL)},${Math.floor(trees.pos[i * 3 + 2] / CELL)}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = []));
    c.push(i);
  }
  const MAX = 700;
  // one InstancedMesh per tree type and material; they share the per-type matrices
  const perType = protos.map((proto) => {
    const meshes = [];
    proto.updateMatrixWorld(true);
    proto.traverse((o) => {
      if (!o.isMesh) return;
      const geom = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const im = new THREE.InstancedMesh(geom, o.material, MAX);
      im.renderOrder = 1;   // alpha-tested, after the solid geometry (see createBillboards)
      im.receiveShadow = true; // the billboards cast their shadows (see createBillboards)
      im.count = 0;
      im.frustumCulled = false;
      group.add(im);
      meshes.push(im);
    });
    return meshes;
  });
  // per-type bounds (unit scale, tree standing at the origin) for view culling
  const bounds = protos.map((proto) => new THREE.Box3().setFromObject(proto).getBoundingSphere(new THREE.Sphere()));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const last = new THREE.Vector3(1e9, 0, 0);
  const lastDir = new THREE.Vector3();
  const cam = new THREE.Vector3(), dir = new THREE.Vector3();
  const frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4(), sphere = new THREE.Sphere();
  function update(camera) {
    // only the trees in view are drawn, so the set is rebuilt when the camera moves or
    // turns; the test spheres are padded so a small turn between rebuilds shows no gaps
    camera.getWorldPosition(cam);
    camera.getWorldDirection(dir);
    if (cam.distanceToSquared(last) < 1 && dir.dot(lastDir) > 0.99966) return;   // < 1 m, < 1.5 deg
    last.copy(cam);
    lastDir.copy(dir);
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const counts = protos.map(() => 0);
    const r = Math.ceil(LOD_DISTANCE / CELL);
    const cx = Math.floor(cam.x / CELL), cz = Math.floor(cam.z / CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const c = cells.get(`${cx + dx},${cz + dz}`);
        if (!c) continue;
        for (const i of c) {
          p.set(trees.pos[i * 3], trees.pos[i * 3 + 1], trees.pos[i * 3 + 2]);
          if (p.distanceTo(cam) >= LOD_DISTANCE) continue;
          const t = trees.type[i];
          if (counts[t] >= MAX) continue;
          const sc = trees.scale[i], b = bounds[t];
          sphere.center.set(p.x, p.y + b.center.y * sc, p.z);
          sphere.radius = b.radius * sc + 1.5 + p.distanceTo(cam) * 0.03;
          if (!frustum.intersectsSphere(sphere)) continue;
          m.compose(p, q.setFromAxisAngle(up, trees.rot[i]), s.setScalar(trees.scale[i]));
          for (const im of perType[t]) im.setMatrixAt(counts[t], m);
          counts[t]++;
        }
      }
    }
    perType.forEach((meshes, t) => {
      for (const im of meshes) {
        im.count = counts[t];
        im.instanceMatrix.needsUpdate = true;
      }
    });
  }
  return { group, update };
}

function createRocks(gltf, data, tex) {
  const group = new THREE.Group();
  const material = createRockMaterial(tex);
  const byType = [];
  for (let t = 0; t < 7; t++) {
    const lod0 = gltf.scene.getObjectByName(`Rock_${t + 1}`);
    const lod1 = gltf.scene.getObjectByName(`Rock_${t + 1}_LOD1`);
    const list = data.rocks.filter((r) => r[0] === t);
    const meshes = [lod0, lod1].map((src) => {
      const im = new THREE.InstancedMesh(src.geometry, material, Math.max(list.length, 1));
      im.count = 0;
      im.frustumCulled = false;
      group.add(im);
      return im;
    });
    const matrices = list.map((r) =>
      new THREE.Matrix4().compose(
        new THREE.Vector3(r[1], r[2], r[3]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(r[6], r[4], r[7], 'YXZ')),
        new THREE.Vector3().setScalar(r[5]),
      ),
    );
    byType.push({ meshes, matrices, positions: list.map((r) => new THREE.Vector3(r[1], r[2], r[3])) });
  }
  const cam = new THREE.Vector3();
  let frame = 0;
  function update(camera) {
    if (frame++ % 10) return;
    camera.getWorldPosition(cam);
    for (const t of byType) {
      let n0 = 0, n1 = 0;
      t.positions.forEach((p, i) => {
        if (p.distanceTo(cam) < ROCK_LOD_DISTANCE) t.meshes[0].setMatrixAt(n0++, t.matrices[i]);
        else t.meshes[1].setMatrixAt(n1++, t.matrices[i]);
      });
      t.meshes[0].count = n0;
      t.meshes[1].count = n1;
      t.meshes[0].instanceMatrix.needsUpdate = true;
      t.meshes[1].instanceMatrix.needsUpdate = true;
    }
  }
  return { group, update };
}

// Dark rock (triplanar, the same texture as the cliffs) with moss where the surface faces up.
function createRockMaterial(tex) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRockColor = { value: tex.rockColor };
    shader.uniforms.uRockNormal = { value: tex.rockNormal };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRWPos;\nvarying vec3 vRWNormal;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        mat4 rm = modelMatrix;
        #ifdef USE_INSTANCING
          rm = modelMatrix * instanceMatrix;
        #endif
        vRWPos = (rm * vec4(transformed, 1.0)).xyz;
        vRWNormal = normalize(mat3(rm) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uRockColor;
        uniform sampler2D uRockNormal;
        varying vec3 vRWPos;
        varying vec3 vRWNormal;
        vec3 gRockN;`,
      )
      .replace(
        '#include <map_fragment>',
        `{
        vec3 n = normalize(vRWNormal);
        vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
        vec3 p = vRWPos * 0.4;
        vec3 c = texture2D(uRockColor, p.zy).rgb * w.x + texture2D(uRockColor, p.xz).rgb * w.y + texture2D(uRockColor, p.xy).rgb * w.z;
        vec3 tx = texture2D(uRockNormal, p.zy).xyz * 2.0 - 1.0;
        vec3 ty = texture2D(uRockNormal, p.xz).xyz * 2.0 - 1.0;
        vec3 tz = texture2D(uRockNormal, p.xy).xyz * 2.0 - 1.0;
        tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
        ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
        tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
        gRockN = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
        float moss = smoothstep(0.55, 0.85, n.y + (c.g - c.r) * 2.0);
        vec3 rock = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.3) * vec3(5.2, 5.5, 5.9);   // near-black basalt texture, lifted to neutral grey stone
        diffuseColor.rgb *= mix(rock, vec3(0.05, 0.08, 0.035), moss * 0.8);
        // wet near the water line
        diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.1, 0.8, vRWPos.y));
        }`,
      )
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gRockN, 0.0)).xyz);')
      // wet and glossy at the water line, catching the moon and the lanterns
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.38, roughness, smoothstep(0.15, 0.9, vRWPos.y));');
  };
  return material;
}
