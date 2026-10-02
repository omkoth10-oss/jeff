import * as THREE from 'three';

// Stone river walls (ishigaki) where the river runs between the houses: a battered stone
// face from below the water up to street level along the water's edge, capped by a strip
// of flat stone back to the street, so the village meets the river the way canal towns
// do. Every ~45 m a gap with stone steps leads down to the water.
//
// The water's edge comes from the water map (marching squares on the channel depth, like
// the deep-water wall in game/physics.js), kept only where houses stand near the bank.
// Uses the village material (stone layer of its texture array). The mesh is named
// 'RiverWall' so the physics turns it into a wall the player walks along and on.

const EDGE = 0.05; // channel depth at the wall line (m)
const STEP = 1; // contour grid (m)
const NEAR_HOUSE = 26; // walls only where a house is this close to the bank
const BATTER = 0.3; // the face leans back this much over its height
const COPING = 2.6; // width of the stone strip on top
const GAP_EVERY = 46, GAP = 3.2; // steps down to the water
const STONE = 4;

export function createEmbankments({ depthAt, groundHeight, houses, rect, material, exclude = [] }) {
  const [x0, z0, x1, z1] = rect;
  const nx = Math.ceil((x1 - x0) / STEP) + 1, nz = Math.ceil((z1 - z0) / STEP) + 1;
  const d = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = depthAt(x0 + i * STEP, z0 + j * STEP) - EDGE;

  // marching squares -> segments
  const segs = [];
  const P = (i, j) => [x0 + i * STEP, z0 + j * STEP];
  const cross = (p, q, a, b) => {
    const t = a / (a - b);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const v = c.map(([a, b]) => d[b * nx + a]);
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) % 4;
        if ((v[e] > 0) !== (v[f] > 0)) pts.push(cross(P(...c[e]), P(...c[f]), v[e], v[f]));
      }
      if (pts.length === 2) segs.push(pts);
      else if (pts.length === 4) segs.push([pts[0], pts[1]], [pts[2], pts[3]]);
    }
  }

  // chain into polylines
  const key = (p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const ends = new Map();
  segs.forEach((s, k) => {
    for (const p of s) (ends.get(key(p)) ?? ends.set(key(p), []).get(key(p))).push(k);
  });
  const used = new Uint8Array(segs.length);
  const lines = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = 1;
    const line = [segs[k][0], segs[k][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const tip = dir > 0 ? line[line.length - 1] : line[0];
        const next = (ends.get(key(tip)) ?? []).find((n) => !used[n]);
        if (next === undefined) break;
        used[next] = 1;
        const s = segs[next];
        const other = key(s[0]) === key(tip) ? s[1] : s[0];
        if (dir > 0) line.push(other);
        else line.unshift(other);
      }
    }
    if (line.length > 6) lines.push(line);
  }

  // keep the stretches near houses (and away from excluded spots: bridge ends, the pool)
  const nearHouse = (p) => houses.some((h) => (h.x - p[0]) ** 2 + (h.z - p[1]) ** 2 < NEAR_HOUSE * NEAR_HOUSE);
  const excluded = (p) => exclude.some(([ex, ez, r]) => (ex - p[0]) ** 2 + (ez - p[1]) ** 2 < r * r);
  const runs = [];
  for (const line of lines) {
    // resample every ~1.5 m, smoothed
    const pts = resample(line, 1.5);
    let run = [];
    pts.forEach((p) => {
      if (nearHouse(p) && !excluded(p)) run.push(p);
      else {
        if (run.length > 8) runs.push(run);
        run = [];
      }
    });
    if (run.length > 8) runs.push(run);
  }

  const pos = [], uv = [], uv1 = [], col = [], idx = [];
  const colPos = [], colIdx = [];
  const tint = [0.62, 0.6, 0.57], capTint = [0.78, 0.76, 0.72];
  const quad = (a, b, c, e, u0, u1, v0, v1, t, collide = true) => {
    const base = pos.length / 3;
    for (const p of [a, b, c, e]) pos.push(...p);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    for (let k = 0; k < 4; k++) {
      uv1.push(STONE, 0);
      col.push(...t, 1);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    if (collide) {
      const cb = colPos.length / 3;
      for (const p of [a, b, c, e]) colPos.push(...p);
      colIdx.push(cb, cb + 1, cb + 2, cb, cb + 2, cb + 3);
    }
  };
  let walls = 0, steps = 0;
  for (const run of runs) {
    // land side: away from the water (the channel gets deeper the other way)
    const n = run.map((p, k) => {
      const a = run[Math.max(0, k - 1)], b = run[Math.min(run.length - 1, k + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      let nx = -tz, nz = tx;
      if (depthAt(p[0] + nx * 1.5, p[1] + nz * 1.5) > depthAt(p[0] - nx * 1.5, p[1] - nz * 1.5)) {
        nx = -nx;
        nz = -nz;
      }
      return [nx, nz];
    });
    // street level behind the wall, smoothed along the run
    const raw = run.map((p, k) => Math.max(groundHeight(p[0] + n[k][0] * (COPING + 0.6), p[1] + n[k][1] * (COPING + 0.6)), 0.6));
    const top = raw.map((_, k) => {
      let s = 0, w = 0;
      for (let q = -2; q <= 2; q++) {
        const r = raw[Math.min(raw.length - 1, Math.max(0, k + q))];
        s += r;
        w++;
      }
      return s / w + 0.08;
    });
    let along = 0;
    for (let k = 0; k < run.length - 1; k++) {
      const a = run[k], b = run[k + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mid = along + len / 2;
      const inGap = (mid % GAP_EVERY) > GAP_EVERY - GAP && along > 6;
      const [na, nb] = [n[k], n[k + 1]];
      const ta = top[k], tb = top[k + 1];
      const lo = -1.3;
      // face (battered back toward the land)
      const fa0 = [a[0], lo, a[1]], fb0 = [b[0], lo, b[1]];
      const fa1 = [a[0] + na[0] * BATTER, ta, a[1] + na[1] * BATTER], fb1 = [b[0] + nb[0] * BATTER, tb, b[1] + nb[1] * BATTER];
      if (!inGap) {
        quad(fa0, fb0, fb1, fa1, along, along + len, lo, Math.max(ta, tb), tint);
        // coping: a flat strip back to the street, with a slight lip
        const ca = [a[0] + na[0] * (BATTER + COPING), ta, a[1] + na[1] * (BATTER + COPING)];
        const cb = [b[0] + nb[0] * (BATTER + COPING), tb, b[1] + nb[1] * (BATTER + COPING)];
        const la = [a[0] + na[0] * (BATTER - 0.06), ta + 0.12, a[1] + na[1] * (BATTER - 0.06)];
        const lb = [b[0] + nb[0] * (BATTER - 0.06), tb + 0.12, b[1] + nb[1] * (BATTER - 0.06)];
        quad(fa1, fb1, lb, la, along, along + len, 0, 0.13, capTint);
        quad(la, lb, cb, ca, along, along + len, 0, COPING, capTint);
        walls++;
      } else if ((mid % GAP_EVERY) - (GAP_EVERY - GAP) < len) {
        // stone steps down to the water, across the gap
        const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], nn = na;
        const t = [b[0] - a[0], b[1] - a[1]].map((x) => x / (len || 1));
        const h = (ta + tb) / 2, count = Math.max(3, Math.round((h + 0.1) / 0.28));
        for (let q = 0; q < count; q++) {
          const y = h - (q + 1) * ((h + 0.15) / count);
          const off = BATTER + COPING * 0.6 - q * ((COPING * 0.6 + 0.4) / count);
          const w = GAP / 2 + 0.2;
          const p0 = [c[0] + nn[0] * off - t[0] * w, y, c[1] + nn[1] * off - t[1] * w];
          const p1 = [c[0] + nn[0] * off + t[0] * w, y, c[1] + nn[1] * off + t[1] * w];
          const q0 = [p0[0] - nn[0] * 0.45, y, p0[2] - nn[1] * 0.45], q1 = [p1[0] - nn[0] * 0.45, y, p1[2] - nn[1] * 0.45];
          quad(q0, q1, p1, p0, 0, w * 2, 0, 0.45, capTint, false);
          const r0 = [q0[0], y - 0.3, q0[2]], r1 = [q1[0], y - 0.3, q1[2]];
          quad(r0, r1, q1, q0, 0, w * 2, y - 0.3, y, tint, false);
        }
        steps++;
      }
      along += len;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'RiverWall';
  // (the collider: the faces and coping, not the steps, which the terrain ramp carries)
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(colPos, 3));
  cg.setIndex(colIdx);
  const collider = new THREE.Mesh(cg);
  collider.name = 'RiverWallCollider';
  collider.visible = false;
  return { mesh, collider, stats: { runs: runs.length, walls, steps } };
}

function resample(line, spacing) {
  const out = [line[0]];
  let carry = 0;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = spacing - carry;
    while (t <= len) {
      out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  // smooth (marching squares zig-zags at 1 m)
  for (let it = 0; it < 3; it++) {
    for (let k = 1; k < out.length - 1; k++) {
      out[k] = [(out[k - 1][0] + 2 * out[k][0] + out[k + 1][0]) / 4, (out[k - 1][1] + 2 * out[k][1] + out[k + 1][1]) / 4];
    }
  }
  return out;
}
