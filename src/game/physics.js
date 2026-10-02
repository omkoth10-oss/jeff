import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// The physics world for exploration: static colliders for everything the player can
// stand on or bump into, built from data that is already loaded for rendering.
//  - ground: the rendered valley terrain itself (Valley_* chunks, clipped to the play
//    area), so feet sit exactly on the visible ground
//  - the retaining walls of the castle hill, the shrine terrace and the river through the
//    village (world/embankments.js); stairs
//    are walked as the graded ramp under them (see below)
//  - the bridge deck (village_collision.glb Walkable) and every building, railing,
//    torii and lantern (village_collision.glb Blockers)
//  - invisible walls: the play-area boundary (collision.glb Bounds) and the edge of
//    the deep river water (built here from the water map), which only the player hits
//  - rocks, tree trunks and torch posts (rocks.json, world/glows.js)
//
// Collision groups: SOLID blocks the player and the camera; PLAYER_ONLY (invisible
// walls) blocks the player only. GROUND marks what feet can stand on (terrain, walls,
// bridge deck) and STAIRS the visible stair steps, which only the feet's raycasts see
// (the capsule walks the ramp under them, the feet land on the treads).
export const GROUP = { SOLID: 0x0001, PLAYER_ONLY: 0x0002, PLAYER: 0x0004, CAMERA: 0x0008, STAIRS: 0x0010, GROUND: 0x0020, FOOT: 0x0040 };
const groups = (member, filter) => (member << 16) | filter;
export const SOLID_GROUPS = groups(GROUP.SOLID, 0xffff);
const WALKABLE_GROUPS = groups(GROUP.SOLID | GROUP.GROUND, 0xffff);
export const INVISIBLE_GROUPS = groups(GROUP.PLAYER_ONLY, GROUP.PLAYER);
// what the camera's sphere cast hits: only SOLID colliders
export const CAMERA_QUERY = groups(GROUP.CAMERA, GROUP.SOLID);
// what a foot's raycast lands on
export const FOOT_QUERY = groups(GROUP.FOOT, GROUP.GROUND | GROUP.STAIRS);

const DEEP_WATER = 0.8; // metres of water the player can wade through
const PLAY_MARGIN = 25; // ground kept around the play area

export async function createPhysics({ layout, terrainRoot, villageRoot, villageCollision, collision, blockers, rocks, torches, depthAt }) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const stats = {};

  const xs = layout.playArea.map((p) => p[0]), zs = layout.playArea.map((p) => p[1]);
  const box = { x0: Math.min(...xs) - PLAY_MARGIN, x1: Math.max(...xs) + PLAY_MARGIN, z0: Math.min(...zs) - PLAY_MARGIN, z1: Math.max(...zs) + PLAY_MARGIN };
  const inBox = (x, z) => x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1;

  function addTrimesh(name, meshes, groupsMask = SOLID_GROUPS, keepTri = null) {
    const pos = [], idx = [];
    const v = new THREE.Vector3();
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const g = mesh.geometry;
      const p = g.attributes.position;
      const index = g.index ? g.index.array : [...Array(p.count).keys()];
      const base = pos.length / 3;
      const world = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        world.set([v.x, v.y, v.z], i * 3);
      }
      const used = new Map();
      for (let t = 0; t < index.length; t += 3) {
        const a = index[t], b = index[t + 1], c = index[t + 2];
        if (keepTri && !keepTri(world, a, b, c)) continue;
        for (const k of [a, b, c]) {
          if (!used.has(k)) {
            used.set(k, base + used.size);
            pos.push(world[k * 3], world[k * 3 + 1], world[k * 3 + 2]);
          }
          idx.push(used.get(k));
        }
      }
    }
    if (!idx.length) return null;
    const desc = RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)).setCollisionGroups(groupsMask);
    stats[name] = idx.length / 3;
    return world.createCollider(desc, fixed);
  }
  const meshesNamed = (root, re) => {
    const out = [];
    root.traverse((o) => o.isMesh && re.test(o.name) && out.push(o));
    return out;
  };

  // ground: rendered valley terrain inside the play area (drops the Draco sentinel
  // triangles, whose corners lie ~5 km out)
  const sets = {};
  sets.terrain = addTrimesh('ground', meshesNamed(terrainRoot, /^Valley_/), WALKABLE_GROUPS, (w, a, b, c) => {
    for (const k of [a, b, c]) if (inBox(w[k * 3], w[k * 3 + 2])) return true;
    return false;
  });
  // The stairs themselves are not colliders: their treads (0.27 m) are narrower than the
  // capsule, which can't step onto them. The terrain under every flight is graded to the
  // stair profile (terrain_lib PATHS kind 'stairs'), within a few cm of the step tops,
  // so the player walks up that ramp. The retaining walls around the hill and the
  // shrine terrace do block. The steps are there for the feet only.
  sets.walls = addTrimesh('walls', meshesNamed(villageRoot, /^(PagodaWall|TerraceWall|RiverWallCollider)$/), WALKABLE_GROUPS);
  sets.stairs = addTrimesh('stairs', meshesNamed(villageRoot, /^(PagodaStairs|TerraceStairs)/), groups(GROUP.STAIRS, GROUP.FOOT));
  sets.bridge = addTrimesh('bridge', meshesNamed(villageCollision, /^Walkable/), WALKABLE_GROUPS);
  // buildings, railings, torii pillars, lanterns: solid boxes (a trimesh is hollow, so
  // anything that ended up inside one could walk around in there)
  if (blockers?.length) {
    const compound = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const [cx, cy, cz, sx, sy, sz, r] of blockers) {
      q.setFromAxisAngle(up, r);
      world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(cx, cy, cz)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(SOLID_GROUPS), compound);
    }
    stats.blockerBoxes = blockers.length;
    sets.buildings = { handles: null, body: compound };
  } else sets.buildings = addTrimesh('blockers', meshesNamed(villageCollision, /^Blockers/));
  sets.bounds = addTrimesh('bounds', meshesNamed(collision, /^Bounds/), INVISIBLE_GROUPS);

  let round = 0;
  for (const [x, y, z, r] of rocks.colliders) {
    if (!inBox(x, z)) continue;
    world.createCollider(RAPIER.ColliderDesc.ball(r).setTranslation(x, y, z).setCollisionGroups(SOLID_GROUPS), fixed);
    round++;
  }
  for (const [x, y, z, r] of rocks.trunks) {
    const rr = Math.max(0.18, Math.min(r, 0.45));
    world.createCollider(RAPIER.ColliderDesc.cylinder(2.5, rr).setTranslation(x, y + 2.3, z).setCollisionGroups(SOLID_GROUPS), fixed);
    round++;
  }
  for (const [x, y, z, r] of torches) {
    world.createCollider(RAPIER.ColliderDesc.cylinder(1.2, Math.max(r, 0.12)).setTranslation(x, y + 1.1, z).setCollisionGroups(SOLID_GROUPS), fixed);
    round++;
  }
  stats.round = round;
  sets.river = addRiverWall(world, fixed, depthAt, box, stats);

  world.step(); // fills the broad phase so the first queries see everything
  return { RAPIER, world, stats, box, sets };
}

// Invisible wall along the line where the river gets deeper than DEEP_WATER, found by
// marching squares over the water map (1 m cells), extruded from under the bed to
// just above the surface: the bridge deck passes over it.
function addRiverWall(world, body, depthAt, box, stats) {
  const step = 1;
  const nx = Math.ceil((box.x1 - box.x0) / step) + 1, nz = Math.ceil((box.z1 - box.z0) / step) + 1;
  const d = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = depthAt(box.x0 + i * step, box.z0 + j * step) - DEEP_WATER;
  const segs = [];
  const P = (i, j) => [box.x0 + i * step, box.z0 + j * step];
  const lerp = (p, q, a, b) => {
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
        if ((v[e] > 0) !== (v[f] > 0)) pts.push(lerp(P(...c[e]), P(...c[f]), v[e], v[f]));
      }
      if (pts.length === 2) segs.push(pts);
      else if (pts.length === 4) segs.push([pts[0], pts[1]], [pts[2], pts[3]]);
    }
  }
  stats.riverWall = segs.length;
  if (!segs.length) return null;
  const pos = new Float32Array(segs.length * 12), idx = new Uint32Array(segs.length * 6);
  const lo = -3, hi = 0.9; // below the bed to 0.9 m over the water; the bridge deck is higher
  segs.forEach(([a, b], k) => {
    pos.set([a[0], lo, a[1], b[0], lo, b[1], b[0], hi, b[1], a[0], hi, a[1]], k * 12);
    idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
  });
  return world.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx).setCollisionGroups(INVISIBLE_GROUPS), body);
}
