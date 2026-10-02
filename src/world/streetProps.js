import * as THREE from 'three';

// Everyday clutter along the house fronts: rain barrels, pyramids of fire buckets,
// firewood stacks, crates, potted shrubs and teahouse benches with red cloth. Built
// here as small meshes in the village material's format (planar UVs in metres, texture
// layer + emission in uv1, tint in the vertex colour), instanced per kind, placed in
// front of the houses (their +z side) where there's room: not on the shop lot, not in
// the water, clear of lanterns and of each other. Each solid prop also returns a box for
// the physics (village.json blocker format).

const L = { wood: 0, plaster: 1, shoji: 2, roof: 3, stone: 4 };
const T = {
  wood: [0.74, 0.6, 0.46], darkWood: [0.42, 0.33, 0.27], hoop: [0.2, 0.18, 0.17], log: [0.66, 0.52, 0.38],
  pot: [0.32, 0.22, 0.18], leaf: [0.09, 0.15, 0.07], red: [0.62, 0.07, 0.05], stone: [0.7, 0.7, 0.7],
};

class Geo {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.uv1 = [];
    this.col = [];
    this.idx = [];
  }
  poly(pts, layer, tint) {
    const a = new THREE.Vector3().subVectors(pts[1], pts[0]), b = new THREE.Vector3().subVectors(pts[2], pts[0]);
    const n = a.cross(b).normalize();
    const u = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0);
    const v = new THREE.Vector3().crossVectors(n, u);
    const base = this.pos.length / 3;
    for (const p of pts) {
      this.pos.push(p.x, p.y, p.z);
      this.uv.push(p.dot(u), p.dot(v));
      this.uv1.push(layer, 0);
      this.col.push(...tint, 1);
    }
    for (let k = 1; k < pts.length - 1; k++) this.idx.push(base, base + k, base + k + 1);
  }
  box(cx, cy, cz, sx, sy, sz, layer, tint, rotY = 0) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(UP, rotY).add(new THREE.Vector3(cx, cy, cz));
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const c = [V(-hx, -hy, -hz), V(hx, -hy, -hz), V(hx, hy, -hz), V(-hx, hy, -hz), V(-hx, -hy, hz), V(hx, -hy, hz), V(hx, hy, hz), V(-hx, hy, hz)];
    for (const f of [[1, 0, 3, 2], [4, 5, 6, 7], [0, 4, 7, 3], [5, 1, 2, 6], [3, 7, 6, 2], [0, 1, 5, 4]]) this.poly(f.map((i) => c[i]), layer, tint);
  }
  // cylinder along y (axis 'y') or lying along x (axis 'x')
  cyl(cx, cy, cz, r, h, layer, tint, segs = 10, axis = 'y', r2 = r) {
    const P = (a, y, rr) => {
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      return axis === 'y' ? new THREE.Vector3(cx + x, cy + y, cz + z) : new THREE.Vector3(cx + y - h / 2, cy + x, cz + z);
    };
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      this.poly([P(a1, 0, r), P(a0, 0, r), P(a0, h, r2), P(a1, h, r2)], layer, tint);
    }
    const top = [], bot = [];
    for (let i = segs - 1; i >= 0; i--) top.push(P((i / segs) * Math.PI * 2, h, r2));
    for (let i = 0; i < segs; i++) bot.push(P((i / segs) * Math.PI * 2, 0, r));
    this.poly(top, layer, tint);
    this.poly(bot, layer, tint);
  }
  blob(cx, cy, cz, r, layer, tint) {
    const g = new THREE.IcosahedronGeometry(r, 1).toNonIndexed();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const tri = [0, 1, 2].map((k) => {
        const v = new THREE.Vector3().fromBufferAttribute(p, i + k);
        v.multiplyScalar(0.85 + 0.3 * Math.abs(Math.sin(v.x * 9 + v.z * 7)));
        v.y *= 0.8;
        return v.add(new THREE.Vector3(cx, cy, cz));
      });
      this.poly(tri, layer, tint);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}
const UP = new THREE.Vector3(0, 1, 0);

// prototypes: geometry, footprint (for spacing and collision: sx, sy, sz)
function prototypes() {
  const out = {};
  // rain barrel with two hoops and a lid
  let g = new Geo();
  g.cyl(0, 0, 0, 0.3, 0.78, L.wood, T.wood, 12, 'y', 0.28);
  for (const y of [0.12, 0.62]) g.cyl(0, y, 0, 0.305, 0.05, L.wood, T.hoop, 12);
  g.cyl(0, 0.78, 0, 0.27, 0.03, L.wood, T.darkWood, 12);
  out.barrel = { geo: g.build(), size: [0.62, 0.82, 0.62] };
  // fire buckets stacked 3-2-1 on a low stand
  g = new Geo();
  g.box(0, 0.06, 0, 1.0, 0.12, 0.42, L.wood, T.darkWood);
  [[-0.31, 0.12], [0, 0.12], [0.31, 0.12], [-0.155, 0.34], [0.155, 0.34], [0, 0.56]].forEach(([x, y]) => g.cyl(x, y, 0, 0.13, 0.22, L.wood, T.wood, 10, 'y', 0.15));
  out.buckets = { geo: g.build(), size: [1.0, 0.8, 0.42] };
  // firewood: logs stacked between two posts
  g = new Geo();
  for (const x of [-0.52, 0.52]) g.box(x, 0.5, 0, 0.07, 1.0, 0.07, L.wood, T.darkWood);
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 5; k++) {
      const z = -0.32 + k * 0.16 + (row % 2) * 0.08 - 0.04;
      const gl = new Geo();
      gl.cyl(0, 0, 0, 0.075, 0.98, L.wood, T.log, 7, 'x');
      // (rotate the log so it lies across the stack, along x)
      const geo = gl;
      for (let i = 0; i < geo.pos.length; i += 3) {
        geo.pos[i + 1] += 0.08 + row * 0.15;
        geo.pos[i + 2] += z;
      }
      appendGeo(g, geo);
    }
  }
  out.firewood = { geo: g.build(), size: [1.1, 0.75, 0.75] };
  // crates, one on top of a bigger one
  g = new Geo();
  g.box(0, 0.25, 0, 0.62, 0.5, 0.62, L.wood, T.wood);
  g.box(0.04, 0.68, -0.02, 0.44, 0.36, 0.44, L.wood, T.wood, 0.4);
  out.crates = { geo: g.build(), size: [0.65, 0.86, 0.65] };
  // glazed pot with a clipped shrub
  g = new Geo();
  g.cyl(0, 0, 0, 0.19, 0.34, L.stone, T.pot, 10, 'y', 0.24);
  g.blob(0, 0.62, 0, 0.36, L.plaster, T.leaf);
  out.shrub = { geo: g.build(), size: [0.6, 0.95, 0.6] };
  // teahouse bench (shogi) with a red cloth
  g = new Geo();
  for (const [x, z] of [[-0.7, -0.22], [0.7, -0.22], [-0.7, 0.22], [0.7, 0.22]]) g.box(x, 0.2, z, 0.07, 0.4, 0.07, L.wood, T.darkWood);
  g.box(0, 0.42, 0, 1.6, 0.06, 0.56, L.wood, T.wood);
  g.box(0, 0.46, 0, 1.5, 0.02, 0.62, L.plaster, T.red);
  out.bench = { geo: g.build(), size: [1.6, 0.48, 0.6] };
  return out;
}

function appendGeo(dst, src) {
  const base = dst.pos.length / 3;
  dst.pos.push(...src.pos);
  dst.uv.push(...src.uv);
  dst.uv1.push(...src.uv1);
  dst.col.push(...src.col);
  for (const i of src.idx) dst.idx.push(base + i);
}

export function createStreetProps({ houses, props = [], torches = [], shopLot, depthAt, groundHeight, material, seed = 11 }) {
  const protos = prototypes();
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const placed = [];
  const taken = [...props.map((p) => [p.x, p.z, 1.4]), ...torches.map((t) => [t[0], t[2], 1.2])];
  const free = (x, z, r) => taken.every(([tx, tz, tr]) => (tx - x) ** 2 + (tz - z) ** 2 > (tr + r) ** 2);
  const inHouse = (x, z) => houses.some((h) => {
    const c = Math.cos(-h.rot), sn = Math.sin(-h.rot);
    const lx = (x - h.x) * c + (z - h.z) * sn, lz = -(x - h.x) * sn + (z - h.z) * c;
    return Math.abs(lx) < h.w / 2 + 0.2 && Math.abs(lz) < h.d / 2 + 0.2;
  });
  const onShopLot = (x, z) => {
    if (!shopLot) return false;
    const a = (-shopLot.angle * Math.PI) / 180, dx = x - shopLot.center[0], dz = z - shopLot.center[1];
    const lx = dx * Math.cos(a) - dz * Math.sin(a), lz = dx * Math.sin(a) + dz * Math.cos(a);
    return Math.abs(lx) < shopLot.size[0] / 2 + 2 && Math.abs(lz) < shopLot.size[1] / 2 + 2;
  };
  const kinds = ['barrel', 'buckets', 'firewood', 'crates', 'shrub', 'barrel', 'shrub', 'bench'];
  for (const h of houses) {
    if (h.type.startsWith('stilt')) continue;
    const n = 1 + Math.floor(rand() * 2.2);
    for (let k = 0; k < n; k++) {
      const kind = kinds[Math.floor(rand() * kinds.length)];
      if (kind === 'bench' && !h.type.startsWith('inn') && !h.type.startsWith('machiya')) continue;
      const { size } = protos[kind];
      // along the front wall, just outside it (sides for firewood: stacked against a wall)
      const side = kind === 'firewood' ? (rand() < 0.5 ? 'left' : 'right') : 'front';
      let lx, lz, rot = h.rot;
      if (side === 'front') {
        lx = (rand() - 0.5) * Math.max(0, h.w - 2.4);
        lz = h.d / 2 + size[2] / 2 + 0.35;
      } else {
        const sgn = side === 'left' ? -1 : 1;
        lx = sgn * (h.w / 2 + size[2] / 2 + 0.3);
        lz = (rand() - 0.5) * Math.max(0, h.d - 2.5);
        rot += (sgn * Math.PI) / 2;
      }
      const c = Math.cos(h.rot), sn = Math.sin(h.rot);
      const x = h.x + lx * c + lz * sn, z = h.z - lx * sn + lz * c;
      const r = Math.max(size[0], size[2]) / 2;
      if (!free(x, z, r) || inHouse(x, z) || onShopLot(x, z) || depthAt(x, z) > 0) continue;
      const y = groundHeight(x, z);
      if (Math.abs(y - h.y) > 1.2) continue; // (not off a terrace edge)
      placed.push({ kind, x, y, z, rot: rot + (kind === 'barrel' || kind === 'shrub' ? rand() * 6.28 : (rand() - 0.5) * 0.2) });
      taken.push([x, z, r + 0.25]);
    }
  }

  const root = new THREE.Group();
  root.name = 'StreetProps';
  const blockers = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (const [kind, proto] of Object.entries(protos)) {
    const list = placed.filter((p) => p.kind === kind);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(proto.geo, material, list.length);
    mesh.name = `Prop_${kind}`;
    list.forEach((p, i) => {
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y - 0.02, p.z), q.setFromAxisAngle(UP, p.rot), new THREE.Vector3(1, 1, 1)));
      const [sx, sy, sz] = proto.size;
      blockers.push([p.x, p.y + sy / 2, p.z, sx, sy, sz, p.rot]);
    });
    mesh.computeBoundingSphere();
    root.add(mesh);
  }
  return { root, blockers, count: placed.length };
}
