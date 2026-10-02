import * as THREE from 'three';
import { GROUP } from '../game/physics.js';

// Dev-only automated walk: drives the player through the game's own input path (a
// virtual stick, the camera turned toward where he walks) along a route through the
// world, at a fixed 60 Hz step, and reports every problem:
//   stuck        no progress toward the next waypoint for 2.5 s (then skips ahead)
//   fell through feet more than 0.3 m below the ground surface under them
//   in a wall    the capsule overlapping a solid collider (walked through something)
//   respawned    the player had to be recovered (fell off the world, deep water)
// Route legs: ledge -> trail down -> left street -> bridge -> right street -> castle
// stairs -> castle court -> back down -> riverbank -> wading into the river (where the
// deep-water wall should stop him; that leg expects to be blocked).
//   const r = await app.walkTest.run({ shots: true })
export function createWalkTest(app, layout, village) {
  const { game } = app;
  const { RAPIER, world } = game.physics;
  const player = game.player;
  const probe = new RAPIER.Capsule(player.HALF, player.RADIUS - 0.06);
  const rot = new RAPIER.Quaternion(0, 0, 0, 1);
  const P = (x, z) => new THREE.Vector2(x, z);
  const pts = (name) => layout.paths[name].points.map(([x, , z]) => P(x, z));
  const near = (list, x, z) => list.reduce((best, p, i) => (p.distanceTo(P(x, z)) < list[best].distanceTo(P(x, z)) ? i : best), 0);
  const slice = (list, from, to) => {
    const a = near(list, ...from), b = near(list, ...to);
    return a <= b ? list.slice(a, b + 1) : list.slice(b, a + 1).reverse();
  };
  const [b0, b1] = [village.bridgeDeck[0], village.bridgeDeck[village.bridgeDeck.length - 1]];
  const deck = village.bridgeDeck.map(([x, , z]) => P(x, z));
  const right = pts('right_street');
  const legs = [
    { name: 'ledge trail', pts: pts('ledge_trail') },
    { name: 'left street', pts: slice(pts('left_street'), [-16, -104], [b0[0], b0[2]]) },
    { name: 'bridge', pts: deck, jumpAt: 12 },
    { name: 'right street', pts: slice(right, [b1[0], b1[2]], [78, -238]), sprint: true },
    { name: 'castle stairs', pts: pts('pagoda_stairs') },
    { name: 'castle court', pts: slice(pts('pagoda_court'), [106, -275], [111, -281]) },
    { name: 'stairs down', pts: pts('pagoda_stairs').slice().reverse() },
    { name: 'street back', pts: slice(right, [78, -238], [49, -210]) },
    { name: 'to riverbank', pts: [P(40, -200), P(24, -193), P(10, -190)] },
    { name: 'into the river', pts: [P(6, -186), P(-8, -186)], expectBlocked: true, maxDepth: 0.95 },
    { name: 'back to the street', plan: [P(8, -188), P(49, -210)] },
    { name: 'right street north', pts: slice(right, [49, -210], [50, -97]) },
    { name: 'shrine stairs', pts: [...pts('terrace_stairs'), P(69, -113.3), P(74, -114)] },
    { name: 'into the shrine', pts: [P(78, -117), P(80, -118.5)], expectBlocked: true },
    { name: 'up the cliff', teleport: [-50, -205], pts: [P(-70, -205), P(-90, -205)], expectBlocked: true, maxClimb: 12, stopBy: 'terrain' },
    { name: 'off the world', drop: true, pts: [] },
  ];

  // ground under (x, z), searching down from `y` + 1.2 m over `range` metres
  function groundAt(x, z, y, range = 6) {
    const hit = world.castRay(new RAPIER.Ray({ x, y: y + 1.2, z }, { x: 0, y: -1, z: 0 }), range, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,
      (GROUP.CAMERA << 16) | GROUP.SOLID);
    return hit ? y + 1.2 - hit.timeOfImpact : null;
  }
  const physicsSets = game.physics.sets;
  const isTerrain = (c) => c.handle === physicsSets.terrain.handle;

  // A* over a 1 m grid between two points: blocked where a 0.45 m ball at chest height
  // touches anything solid but the ground, where the ground is steeper than 40 degrees,
  // where the water is deeper than 0.6 m, or outside the play area
  function plan(a, b, margin = 30) {
    const x0 = Math.floor(Math.min(a.x, b.x) - margin), z0 = Math.floor(Math.min(a.y, b.y) - margin);
    const nx = Math.ceil(Math.abs(a.x - b.x) + 2 * margin), nz = Math.ceil(Math.abs(a.y - b.y) + 2 * margin);
    const ball = new RAPIER.Ball(0.45);
    const inPlay = (x, z) => {
      let inside = false;
      const poly = layout.playArea;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    };
    const free = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i + 0.5, z = z0 + j + 0.5;
        const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x, y: 120, z }, { x: 0, y: -1, z: 0 }), 200, true, undefined, undefined, undefined, undefined, isTerrain);
        if (!hit || !inPlay(x, z)) continue;
        const y = 120 - hit.timeOfImpact;
        if (hit.normal.y < Math.cos((40 * Math.PI) / 180) || y < -0.6) continue;
        let blocked = false;
        world.intersectionsWithShape({ x, y: y + 1.1, z }, rot, ball, (c) => {
          if (!isTerrain(c)) blocked = true;
          return !blocked;
        }, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, (GROUP.CAMERA << 16) | GROUP.SOLID);
        if (!blocked) free[j * nx + i] = 1;
      }
    }
    const idx = (p) => Math.floor(p.y - z0) * nx + Math.floor(p.x - x0);
    const start = idx(a), goal = idx(b);
    const g = new Float32Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1);
    const open = [[0, start]];
    g[start] = 0;
    const h = (k) => Math.hypot((k % nx) - (goal % nx), Math.floor(k / nx) - Math.floor(goal / nx));
    while (open.length) {
      open.sort((p, q) => p[0] - q[0]);
      const [, k] = open.shift();
      if (k === goal) break;
      const ci = k % nx, cj = Math.floor(k / nx);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const n = nj * nx + ni;
        if (!free[n] || (di && dj && (!free[cj * nx + ni] || !free[nj * nx + ci]))) continue;
        const cost = g[k] + Math.hypot(di, dj);
        if (cost < g[n]) {
          g[n] = cost;
          from[n] = k;
          open.push([cost + h(n), n]);
        }
      }
    }
    if (from[goal] < 0) return null;
    const route = [];
    for (let k = goal; k >= 0; k = from[k]) route.push(P(x0 + (k % nx) + 0.5, z0 + Math.floor(k / nx) + 0.5));
    route.reverse();
    return route.filter((_, i) => i % 3 === 0 || i === route.length - 1);
  }
  function overlapping() {
    const f = player.state.feet;
    const hits = [];
    world.intersectionsWithShape({ x: f.x, y: f.y + player.HALF + player.RADIUS + 0.05, z: f.z }, rot, probe, (c) => {
      hits.push(c.handle);
      return true;
    }, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, (GROUP.CAMERA << 16) | GROUP.SOLID);
    return hits;
  }

  // render: draw every frame (the whole world updates, as in play) and time the frames
  // (GPU synced every 30 frames); onlyLegs: run just these legs (after a teleport to
  // the first one's start)
  async function run({ shots = false, shotEvery = 0, dt = 1 / 60, maxSeconds = 400, onFrame = null, render = false, onlyLegs = null } = {}) {
    const gl = app.renderer.getContext();
    const px = new Uint8Array(4);
    const frameTimes = [];
    let batchStart = performance.now(), batchFrames = 0;
    const step = async () => {
      app.tick(dt); // the full per-frame update: the game, LODs, water, mist...
      if (!render) return;
      app.render();
      if (++batchFrames === 30) {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        frameTimes.push((performance.now() - batchStart) / 30);
        batchStart = performance.now();
        batchFrames = 0;
        // (no yielding: a background tab throttles timers to as little as once a minute;
        // run long rendered walks leg by leg instead)
      }
    };
    const issues = [];
    const legLog = [];
    const inp = game.input.state;
    inp.virtual = { x: 0, y: 0, sprint: false, jump: false };
    game.state.driving = true;
    player.respawn(true); // start on the ledge
    player.state.respawns = 0;
    let t = 0, lastShot = 0;
    const files = [];
    const chosen = onlyLegs ? legs.filter((l) => onlyLegs.includes(l.name)) : legs;
    if (onlyLegs && chosen[0]?.pts?.length) {
      const p0 = chosen[0].pts[0];
      player.teleport(new THREE.Vector3(p0.x, (groundAt(p0.x, p0.y, 200, 300) ?? 0) + 0.05, p0.y));
    }
    for (const leg of chosen) {
      const t0 = t;
      if (leg.plan) {
        leg.pts = plan(...leg.plan);
        if (!leg.pts) {
          issues.push({ leg: leg.name, kind: 'no walkable route found', from: leg.plan[0].toArray(), to: leg.plan[1].toArray() });
          leg.pts = leg.plan;
        }
      }
      if (leg.teleport) {
        const [x, z] = leg.teleport;
        player.teleport(new THREE.Vector3(x, (groundAt(x, z, 200, 300) ?? 0) + 0.05, z));
      }
      if (leg.drop) {
        // pushed below the world: he has to come back on the ledge
        const before = player.state.respawns;
        player.teleport(new THREE.Vector3(0, -40, -150));
        for (let k = 0; k < 30; k++) await step();
        const back = player.state.feet;
        const ok = player.state.respawns > before && back.distanceTo(new THREE.Vector3(0, back.y, 0)) < 3 && back.y > 45;
        legLog.push({ leg: leg.name, respawnedOnLedge: ok, to: fmt(back) });
        if (!ok) issues.push({ leg: leg.name, kind: 'no respawn at the ledge', at: fmt(back) });
        continue;
      }
      const startY = player.state.feet.y;
      let i = 0, bestD = Infinity, since = 0, blocked = false, jumped = false;
      const start = player.state.feet.clone();
      let dist = 0;
      const prev = player.state.feet.clone();
      while (i < leg.pts.length && t < maxSeconds) {
        const f = player.state.feet;
        // lookahead: the farthest waypoint within 2.2 m counts as reached
        while (i < leg.pts.length - 1 && leg.pts[i].distanceTo(P(f.x, f.z)) < 2.2) {
          i++;
          bestD = Infinity; // progress is measured toward the new waypoint
        }
        const tgt = leg.pts[i];
        const dx = tgt.x - f.x, dz = tgt.y - f.z, d = Math.hypot(dx, dz);
        if (d < 0.9 && i === leg.pts.length - 1) break;
        // turn the camera toward the target like a player would, push the stick forward
        const yaw = Math.atan2(-dx, -dz);
        let dy = yaw - game.rig.state.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        game.rig.state.yaw += dy * Math.min(1, dt * 8);
        inp.virtual.x = 0;
        inp.virtual.y = Math.cos(dy) > 0.2 ? 1 : 0.3;
        inp.virtual.sprint = !!leg.sprint;
        if (leg.jumpAt !== undefined && !jumped && i >= leg.jumpAt) {
          inp.virtual.jump = true;
          jumped = true;
        }
        const respawns = player.state.respawns;
        await step();
        const ctl = player.ctrl;
        for (let k = 0; k < ctl.numComputedCollisions(); k++) {
          const cc = ctl.computedCollision(k);
          if (cc.normal1.y < 0.64) leg.lastWall = cc.collider;
        }
        onFrame?.(t);
        t += dt;
        dist += player.state.feet.distanceTo(prev);
        prev.copy(player.state.feet);

        if (player.state.respawns !== respawns) issues.push({ leg: leg.name, kind: 'respawned', at: fmt(f) });
        const gy = groundAt(f.x, f.z, f.y);
        if (gy !== null && f.y < gy - 0.3) issues.push({ leg: leg.name, kind: 'fell through', at: fmt(f), ground: +gy.toFixed(2) });
        const ov = overlapping();
        if (ov.length) issues.push({ leg: leg.name, kind: 'in a wall', at: fmt(f), colliders: ov.slice(0, 3) });

        // progress
        if (d < bestD - 0.3) {
          bestD = d;
          since = 0;
        } else since += dt;
        if (since > 2.5) {
          if (leg.expectBlocked) {
            blocked = true;
            break;
          }
          issues.push({ leg: leg.name, kind: 'stuck', at: fmt(f), waypoint: [+tgt.x.toFixed(1), +tgt.y.toFixed(1)] });
          const gy2 = groundAt(tgt.x, tgt.y, f.y + 60, 120) ?? f.y;
          player.teleport(new THREE.Vector3(tgt.x, gy2 + 0.05, tgt.y));
          i++;
          bestD = Infinity;
          since = 0;
        }
        if (shots && shotEvery && t - lastShot > shotEvery) {
          lastShot = t;
          files.push(await app.shot(`walk-${String(Math.round(t)).padStart(3, '0')}-${leg.name.replace(/\s/g, '-')}`));
        }
      }
      // wading: he may go in to about thigh depth, never deeper (the deep-water wall)
      if (leg.maxDepth !== undefined) {
        const depth = -player.state.feet.y;
        leg.depth = +depth.toFixed(2);
        if (depth > leg.maxDepth || depth < 0.3) issues.push({ leg: leg.name, kind: depth < 0.3 ? 'never reached the water' : 'went into deep water', at: fmt(player.state.feet), depth: leg.depth });
      }
      if (leg.maxClimb !== undefined && player.state.feet.y - startY > leg.maxClimb)
        issues.push({ leg: leg.name, kind: 'climbed a cliff', at: fmt(player.state.feet), climbed: +(player.state.feet.y - startY).toFixed(1) });
      if (leg.expectBlocked) {
        const c = leg.lastWall;
        const named = Object.entries(physicsSets).find(([, set]) => set && c && (set.handle === c.handle || (set.body && c.parent()?.handle === set.body.handle)));
        const by = !c ? 'nothing' : named ? named[0] : 'rock/trunk/post';
        leg.stoppedBy = by;
        if (leg.stopBy && by !== leg.stopBy) issues.push({ leg: leg.name, kind: `stopped by ${by}, expected ${leg.stopBy}`, at: fmt(player.state.feet) });
      }
      legLog.push({ leg: leg.name, ...(leg.stoppedBy ? { stoppedBy: leg.stoppedBy } : {}), ...(leg.depth !== undefined ? { waterDepth: leg.depth } : {}), seconds: +(t - t0).toFixed(1), metres: +dist.toFixed(0), from: fmt(start), to: fmt(player.state.feet), ...(leg.expectBlocked ? { stoppedByWater: blocked, water: +player.state.wading.toFixed(2) } : {}) });
      if (leg.expectBlocked && !blocked) issues.push({ leg: leg.name, kind: 'deep water did not stop him', at: fmt(player.state.feet) });
    }
    inp.virtual.x = inp.virtual.y = 0;
    for (let k = 0; k < 90; k++) await step(); // come to a stop
    game.state.driving = false;
    inp.virtual = null;
    // merge repeats of the same problem in the same place
    const merged = [];
    for (const is of issues) {
      const last = merged[merged.length - 1];
      if (last && last.kind === is.kind && last.leg === is.leg && Math.hypot(last.at[0] - is.at[0], last.at[2] - is.at[2]) < 2) last.frames = (last.frames ?? 1) + 1;
      else merged.push(is);
    }
    const ft = frameTimes.slice(2).sort((x, y) => x - y);
    const timing = ft.length ? { frames: ft.length * 30, medianMs: +ft[ft.length >> 1].toFixed(2), p90Ms: +ft[Math.floor(ft.length * 0.9)].toFixed(2), worstMs: +ft[ft.length - 1].toFixed(2) } : null;
    return { seconds: +t.toFixed(1), legs: legLog, issues: merged, files, timing };
  }
  const fmt = (v) => [+v.x.toFixed(1), +v.y.toFixed(1), +v.z.toFixed(1)];
  return { run, legs, plan };
}
