import * as THREE from 'three';

// Warm lamp light over the valley, as a top-down map built at load time from every
// light source in the village: street and stone lanterns, lit house fronts, the
// bridge lanterns, the castle and the watchtower torch. R = light intensity,
// G = height of the lights (/60 m) so walls and roofs can fade it vertically.
// render/fog.js samples it for every material (warm light pooling on streets, walls,
// roofs, trees, rocks) and for the mist.
const RES = 0.5; // metres per texel

const HOUSE_GLOW = { inn: 1.5, machiya: 1.0, minka: 1.1, small: 0.8, kura: 0.35, stilt: 1.2 };
// the castle keep's rows of lit windows light its court and base walls
// (PAGODA_HILL in blender/scripts/terrain_lib.py): [x, y, z, strength, radius]
const LANDMARK_LIGHTS = [[118, 36, -290, 1.4, 26], [118, 45, -290, 1.0, 20]];

export function buildLampMap(village, layout, torches = []) {
  const [x0, x1, z0, z1] = layout.valleyRect;
  const w = Math.round((x1 - x0) / RES), h = Math.round((z1 - z0) / RES);
  const I = new Float32Array(w * h);
  const H = new Float32Array(w * h);
  const sources = [];
  const points = []; // lanterns and torches: candidates for the few real lights (main.js)
  const add = (x, y, z, strength, radius, point = false) => {
    sources.push([x, y, z, strength, radius]);
    if (point) points.push([x, y, z, strength]);
  };

  for (const p of village.props) {
    if (p.type === 'StreetLantern') add(p.x, p.y + 1.9, p.z, 1.9, 10, true);
    else if (p.type === 'StoneLantern') add(p.x, p.y + 1.1, p.z, 1.3, 6, true);
  }
  for (const hs of village.houses) {
    const kind = hs.type.split('_')[0];
    const fx = Math.sin(hs.rot), fz = Math.cos(hs.rot);
    const out = hs.d * 0.32 + 1.2; // just in front of the lit shoji: spills onto veranda and street
    add(hs.x + fx * out, hs.y + 1.6, hs.z + fz * out, (HOUSE_GLOW[kind] ?? 0.8) * 1.4, Math.max(6.5, hs.w * 0.8));
  }
  const deck = village.bridgeDeck;
  // small pools: the railings brighten beside each lantern and stay dark between them
  for (let i = 3; i < deck.length; i += 6) add(deck[i][0], deck[i][1] + 1.5, deck[i][2], 1.5, 5, true);
  for (const t of village.torches) add(t[0], t[1], t[2], 1.3, 10, true);
  for (const t of torches) add(t[0], t[1], t[2], 1.45, 10.5, true);
  for (const l of LANDMARK_LIGHTS) add(...l);

  for (const [sx, sy, sz, s, r] of sources) {
    const cx = (sx - x0) / RES, cz = (sz - z0) / RES, rr = r / RES;
    const ia = Math.max(0, Math.floor(cx - rr)), ib = Math.min(w - 1, Math.ceil(cx + rr));
    const ja = Math.max(0, Math.floor(cz - rr)), jb = Math.min(h - 1, Math.ceil(cz + rr));
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        const d2 = ((i - cx) ** 2 + (j - cz) ** 2) / (rr * rr);
        if (d2 >= 1) continue;
        const f = s * (1 - d2) ** 3; // bright near the lamp, a long soft tail
        const k = j * w + i;
        H[k] = (H[k] * I[k] + sy * f) / (I[k] + f);
        I[k] += f;
      }
    }
  }
  // B: contact darkening on the ground around each building (walls meet the ground in
  // soft dark, not pasted on), used by the terrain shader
  const AO = new Float32Array(w * h);
  const AO_REACH = 3.0;
  for (const hs of village.houses) {
    const hw = hs.w * 0.42, hd = hs.d * 0.42; // walls, without the roof overhang
    const c = Math.cos(hs.rot), sn = Math.sin(hs.rot);
    const r = Math.hypot(hw, hd) + AO_REACH;
    const ia = Math.max(0, Math.floor((hs.x - r - x0) / RES)), ib = Math.min(w - 1, Math.ceil((hs.x + r - x0) / RES));
    const ja = Math.max(0, Math.floor((hs.z - r - z0) / RES)), jb = Math.min(h - 1, Math.ceil((hs.z + r - z0) / RES));
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        const dx = x0 + i * RES - hs.x, dz = z0 + j * RES - hs.z;
        const u = Math.abs(dx * c - dz * sn) - hw, v = Math.abs(dx * sn + dz * c) - hd;
        const d = Math.hypot(Math.max(u, 0), Math.max(v, 0));
        if (d < AO_REACH) AO[j * w + i] = Math.max(AO[j * w + i], (1 - d / AO_REACH) ** 2);
      }
    }
  }
  const data = new Uint16Array(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    data[k * 4 + 2] = THREE.DataUtils.toHalfFloat(AO[k]);
    // soft limit: a single lamp keeps its strength, overlapping ones don't add up to glare
    data[k * 4] = THREE.DataUtils.toHalfFloat(2.6 * (1 - Math.exp(-I[k] / 2.2)));
    data[k * 4 + 1] = THREE.DataUtils.toHalfFloat(H[k] / 60);
    data[k * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { texture: tex, rect: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0), count: sources.length, points };
}
