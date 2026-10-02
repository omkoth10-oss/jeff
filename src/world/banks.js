import * as THREE from 'three';

// Reeds and rushes along the river banks: clumps of blades standing in the shallows and
// at the water line, swaying slightly. One instanced mesh of three crossed cards per
// clump; the blades are cut out procedurally in the shader (alpha test), so there is no
// texture to load. Placed along the river centreline (layout.json rivers.main), clear of
// the bridge, the stilt houses, the boat and the waterfall pools.
export function createReeds(layout, village, groundHeight, time) {
  const pts = layout.rivers.main;
  const [bx0, bz0, bx1, bz1] = [...bridgeEnds(village)];
  const stilts = village.houses.filter((h) => h.type.startsWith('stilt'));
  const pools = layout.waterfalls.map((f) => [f.foot[0], f.foot[2]]);
  let seed = 99;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const segDist = (x, z, ax, az, cx, cz) => {
    const dx = cx - ax, dz = cz - az, l2 = dx * dx + dz * dz || 1;
    const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2));
    return Math.hypot(ax + dx * u - x, az + dz * u - z);
  };
  const blocked = (x, z) =>
    segDist(x, z, bx0, bz0, bx1, bz1) < 7 ||
    stilts.some((h) => Math.hypot(x - h.x, z - h.z) < Math.max(h.w, h.d) * 0.6 + 1) ||
    Math.hypot(x - 33.5, z + 86) < 6 ||
    pools.some(([px, pz]) => Math.hypot(x - px, z - pz) < 13);

  const clumps = []; // x, y, z, scale, rotation
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az, aw] = pts[i], [cx, cz] = pts[i + 1];
    if (az > 40 || az < -272) continue;
    const len = Math.hypot(cx - ax, cz - az);
    const nx = -(cz - az) / len, nz = (cx - ax) / len;
    for (s += len; s > 1.7; s -= 1.7) {
      if (rand() > 0.62) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const d = aw / 2 + (rand() - 0.55) * 2.0; // along the water line: the shallows and the bank edge
      const x = ax + nx * d * side + (rand() - 0.5) * 2, z = az + nz * d * side + (rand() - 0.5) * 2;
      if (blocked(x, z)) continue;
      const y = Math.max(groundHeight(x, z), -0.5);
      if (y > 1.4) continue; // up on the bank proper: no reeds
      const n = 2 + Math.floor(rand() * 3); // reeds grow in stands
      for (let k = 0; k < n; k++) {
        clumps.push([x + (rand() - 0.5) * 1.6 * (k > 0), y - 0.05, z + (rand() - 0.5) * 1.6 * (k > 0), 0.6 + rand() * 0.7, rand() * Math.PI]);
      }
    }
  }

  const mesh = cardMesh(clumps, 'reeds', time, 1.2, 1.7, 0x222c1b);
  mesh.name = 'Reeds';
  return { mesh, count: clumps.length };
}

// Grass and fern tufts on the banks, spilling toward the water: low, broad clumps of
// drooping blades on the strip of bank above the water line, clear of the streets and
// the houses.
export function createBankGrass(layout, village, groundHeight, time) {
  const pts = layout.rivers.main;
  const paths = Object.values(layout.paths);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const onPath = (x, z) =>
    paths.some((p) => p.points.some(([px, , pz]) => (px - x) ** 2 + (pz - z) ** 2 < (p.width / 2 + 0.8) ** 2));
  const inHouse = (x, z) => village.houses.some((h) => Math.hypot(x - h.x, z - h.z) < Math.max(h.w, h.d) * 0.45);
  const [bx0, bz0, bx1, bz1] = bridgeEnds(village);
  const nearBridge = (x, z) => Math.hypot(x - (bx0 + bx1) / 2, z - (bz0 + bz1) / 2) < 22;
  const tufts = [];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az, aw] = pts[i], [cx, cz] = pts[i + 1];
    if (az > 40 || az < -268) continue;
    const len = Math.hypot(cx - ax, cz - az);
    const nx = -(cz - az) / len, nz = (cx - ax) / len;
    for (s += len; s > 0.9; s -= 0.9) {
      for (const side of [-1, 1]) {
        if (rand() > 0.85) continue;
        const d = aw / 2 + 0.1 + rand() ** 1.4 * 6;          // thickest right at the edge
        const x = ax + nx * d * side + (rand() - 0.5) * 1.2, z = az + nz * d * side + (rand() - 0.5) * 1.2;
        const y = groundHeight(x, z);
        if (y < -0.2 || y > 2.4 || nearBridge(x, z) || onPath(x, z) || inHouse(x, z)) continue;   // right down to the water line
        tufts.push([x, y - 0.05, z, 0.55 + rand() * 0.6, rand() * Math.PI]);
      }
    }
  }
  const mesh = cardMesh(tufts, 'grass', time, 1.5, 0.75, 0x243220);
  mesh.name = 'BankGrass';
  return { mesh, count: tufts.length };
}

// Foam rings where posts stand in the water: the stilt houses' posts, the bridge piles
// and the moored boat, plus the seam where the side stream joins. Same format as the
// rapids spots: [x, z, radius, flowAngle].
export function postFoamSpots(village, layout, depthAt, flowAt) {
  const spots = [];
  const push = (x, z, r) => {
    if (depthAt(x, z) < 0.12) return;
    const [fx, fz] = flowAt(x, z);
    spots.push([x, z, r, Math.atan2(fx, fz)]);
  };
  for (const h of village.houses) {
    if (!h.type.startsWith('stilt')) continue;
    const w = h.w - 2.4, d = h.d - 2.6; // posts under the house (the footprint includes the eaves)
    const c = Math.cos(h.rot), sn = Math.sin(h.rot);
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 4; j++) {
        const lx = -w / 2 - 0.9 + ((w + 1.8) * i) / 4, lz = -d / 2 + ((d + 0.9) * j) / 3;
        push(h.x + lx * c + lz * sn, h.z - lx * sn + lz * c, 0.28);
      }
    }
  }
  const deck = village.bridgeDeck;
  const [bx0, bz0, bx1, bz1] = bridgeEnds(village);
  const l = Math.hypot(bx1 - bx0, bz1 - bz0), px = -(bz1 - bz0) / l, pz = (bx1 - bx0) / l;
  for (let i = 0; i < deck.length; i += 3) for (const sd of [-1, 1]) push(deck[i][0] + px * sd * 1.7, deck[i][2] + pz * sd * 1.7, 0.3);
  push(33.5, -86, 1.1); // the boat
  const s2 = layout.rivers.stream2;
  const [mx, mz] = s2[s2.length - 1];
  push(mx, mz, 2.6); // where the side stream meets the river
  return spots;
}

// Instanced clumps of three crossed cards whose blades are cut out in the shader.
// kind 'reeds': tall straight rushes; 'grass': short drooping blades.
function cardMesh(list, kind, time, width, height, color) {
  const cards = [];
  for (let k = 0; k < 3; k++) cards.push(new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0).rotateY((k * Math.PI) / 3));
  const geo = mergeCards(cards);
  const grass = kind === 'grass';
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vReedUv;\nvarying float vReedSeed;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        vReedUv = uv;
        vec2 home = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        vReedSeed = fract(sin(dot(home, vec2(12.9898, 78.233))) * 43758.5453);
        // sway: stronger toward the tips, a slow gust travelling along the river
        float sway = sin(uTime * 1.3 + home.x * 0.15 + home.y * 0.1) * 0.6 + sin(uTime * 3.1 + vReedSeed * 20.0) * 0.25;
        transformed.x += sway * ${grass ? '0.06' : '0.12'} * uv.y * uv.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vReedUv;\nvarying float vReedSeed;')
      .replace(
        '#include <alphatest_fragment>',
        `{
          float a = 0.0;
          float shade = 0.0;
          for (int i = 0; i < ${grass ? 12 : 7}; i++) {
            float fi = float(i);
            float h = fract(sin(fi * 91.3 + vReedSeed * 37.0) * 4375.5);
            float x0 = 0.1 + 0.8 * fract(h * 7.1 + fi * 0.37);
            float lean = (h - 0.5) * ${grass ? '1.3' : '0.5'};
            float top = ${grass ? '0.45 + 0.55' : '0.55 + 0.45'} * fract(h * 3.3);
            float y = vReedUv.y / top;
            float w = ${grass ? '0.05' : '0.035'} * (1.0 - y) + 0.004;
            float blade = step(abs(vReedUv.x - x0 - lean * y * y), w) * step(y, 1.0);
            a = max(a, blade);
            shade = max(shade, blade * y);
          }
          diffuseColor.a = a;
          diffuseColor.rgb *= mix(0.5, 1.35, shade);   // darker at the base, paler tips
        }
        #include <alphatest_fragment>`,
      )
      // soft, mostly upward-facing shading so both sides of the cards read alike
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => `cards-${kind}`;
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(list.length, 1));
  mesh.count = list.length;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  list.forEach(([x, y, z, sc, r], i) => {
    m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, r), new THREE.Vector3(sc, sc * (0.8 + 0.4 * ((i * 0.618) % 1)), sc));
    mesh.setMatrixAt(i, m);
  });
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.renderOrder = 1; // alpha-tested, after the solid geometry
  return mesh;
}

function bridgeEnds(village) {
  const d = village.bridgeDeck;
  return [d[0][0], d[0][2], d[d.length - 1][0], d[d.length - 1][2]];
}

function mergeCards(list) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (const g of list) {
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(base + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}
