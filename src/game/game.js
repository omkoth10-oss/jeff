import { createPhysics } from './physics.js';
import { createPlayer } from './player.js';
import { createCameraRig } from './cameraRig.js';
import { createInput } from './input.js';
import { createProceduralAnimator } from './proc/animator.js';
import { createHud } from './hud.js';
import * as THREE from 'three';
import { NINJA, CAMERA } from '../config.js';
import { GROUP, FOOT_QUERY } from './physics.js';

const MODEL_SCALE = 1.08; // the model is 1.6 m; ~1.73 m reads right next to the buildings

// Exploration: the opening shot on the ledge, then (on the first click) the player
// takes the ninja down into the valley. Owns the physics world, the player, the
// third-person camera and the ninja's (procedural) animation.
export async function createGame(o) {
  const { camera, dom, ninja, ninjaModel, water } = o;
  const physics = await createPhysics(o);
  const input = createInput(dom);
  const hud = createHud(document.body);

  // start standing on the ledge where the opening shot shows him
  const down = physics.world.castRay(new physics.RAPIER.Ray({ x: NINJA.position.x, y: NINJA.position.y + 5, z: NINJA.position.z }, { x: 0, y: -1, z: 0 }), 20, true);
  const groundY = down ? NINJA.position.y + 5 - down.timeOfImpact : NINJA.position.y;
  const player = createPlayer(physics, NINJA.position, { yaw: NINJA.yaw + Math.PI, groundY });
  const rig = createCameraRig(camera, physics, { yaw: CAMERA.yaw, pitch: CAMERA.pitch });
  ninja.scale.setScalar(MODEL_SCALE);
  ninja.position.copy(player.state.feet);
  ninja.rotation.y = player.state.facing;
  const animator = createProceduralAnimator({ root: ninja, model: ninjaModel, ground: groundProbe(physics) });
  if (animator.rig.missing.length) console.warn('[game] missing bones', animator.rig.missing);

  const state = { started: false, paused: false, driving: false }; // driving: the walk test is in control
  const start = () => {
    if (state.started) return;
    state.started = true;
    rig.activate();
    hud.started();
  };
  document.addEventListener('pointerlockchange', () => {
    if (input.state.locked) start();
    hud.locked(input.state.locked);
  });

  function update(dt, { cameraFree = false } = {}) {
    const inp = input.poll();
    if (state.driving) start();
    // before the first click the ninja stays put for the opening shot
    const control = state.started && (input.state.locked || state.driving);
    if (!control) {
      inp.move.x = inp.move.y = 0;
      inp.jumpPressed = false;
    }
    if (!cameraFree) {
      const [dx, dy] = input.consumeLook();
      if (control && !state.driving) rig.look(dx, dy);
    }
    player.update(dt, inp, rig.yaw, water.depthAt);
    physics.world.step();

    const p = player.state;
    ninja.position.copy(p.feet);
    ninja.rotation.y = p.facing;
    animator.update(dt, p, { yaw: rig.yaw, pitch: rig.pitch });
    ninjaModel.visible = true;
    blob.update();
    if (!cameraFree) rig.update(dt, p.feet);
    sounds(dt, p);
  }

  // footsteps (when a foot plants), jumps and landings, for the sound (api.onEvent)
  const surfaceAt = createSurfaceProbe(physics, o.layout, water);
  const wasPlanted = [true, true];
  let sinceLand = 1;
  function sounds(dt, p) {
    sinceLand += dt;
    const emit = api.onEvent;
    if (!emit) return;
    if (p.jumped) emit({ type: 'jump', surface: surfaceAt(p.feet) });
    if (p.grounded && p.landed < dt * 1.5 && p.impact > 0) {
      emit({ type: 'land', surface: surfaceAt(p.feet), impact: p.impact });
      sinceLand = 0;
    }
    animator.gait.feet.forEach((f, i) => {
      if (f.planted && !wasPlanted[i] && p.grounded && sinceLand > 0.2) {
        emit({ type: 'step', surface: surfaceAt(f.anchor), side: f.side, intensity: THREE.MathUtils.clamp(0.3 + (p.speed / 7.2) * 0.7, 0.25, 1) });
      }
      wasPlanted[i] = f.planted;
    });
  }

  const blob = createContactShadow(physics, player);
  o.scene.add(blob.mesh);
  const api = { physics, input, player, rig, animator, hud, state, update, start, ninjaModel, surfaceAt, onEvent: null };
  return api;
}


// Where a foot lands: the first ground, bridge deck or stair tread below (x, top, z).
// Surfaces steeper than ~45 degrees (a riser's edge) count as level.
function groundProbe(physics) {
  const { RAPIER, world } = physics;
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const out = { y: 0, n: new THREE.Vector3() };
  return (x, z, top) => {
    ray.origin = { x, y: top, z };
    const hit = world.castRayAndGetNormal(ray, 3.5, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, FOOT_QUERY);
    if (!hit) return null;
    out.y = top - hit.timeOfImpact;
    out.n.set(hit.normal.x, hit.normal.y, hit.normal.z);
    if (out.n.y < 0.7) out.n.set(0, 1, 0);
    return out;
  };
}

// What a foot lands on: water where it's wading; the bridge deck (wood); the river
// walls, castle and terrace walls and the stair treads (stone); otherwise the ground,
// told apart by the paths (streets and stairs paved, the trail packed earth), with the
// rock of the ledge, and grass everywhere else.
function createSurfaceProbe(physics, layout, water) {
  const { RAPIER, world, sets, box } = physics;
  const res = 1, nx = Math.ceil((box.x1 - box.x0) / res), nz = Math.ceil((box.z1 - box.z0) / res);
  const grid = new Uint8Array(nx * nz); // 0 ground, 1 stone, 2 earth
  for (const path of Object.values(layout.paths)) {
    const kind = path.kind === 'trail' ? 2 : 1, half = path.width / 2 + 0.3, pts = path.points;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, , az] = pts[k], [bx, , bz] = pts[k + 1];
      const i0 = Math.floor((Math.min(ax, bx) - half - box.x0) / res), i1 = Math.ceil((Math.max(ax, bx) + half - box.x0) / res);
      const j0 = Math.floor((Math.min(az, bz) - half - box.z0) / res), j1 = Math.ceil((Math.max(az, bz) + half - box.z0) / res);
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      for (let j = Math.max(0, j0); j <= Math.min(nz - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) {
          const x = box.x0 + (i + 0.5) * res, z = box.z0 + (j + 0.5) * res;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          if (Math.hypot(x - ax - dx * t, z - az - dz * t) < half && grid[j * nx + i] !== 1) grid[j * nx + i] = kind;
        }
      }
    }
  }
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const stoneHandles = new Set([sets.walls?.handle, sets.stairs?.handle].filter((h) => h !== undefined));
  return (p) => {
    if (water.depthAt(p.x, p.z) > 0.03 && p.y < 0.25) return 'water';
    ray.origin = { x: p.x, y: p.y + 0.6, z: p.z };
    const hit = world.castRay(ray, 1.6, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, FOOT_QUERY);
    if (hit) {
      if (sets.bridge && hit.collider.handle === sets.bridge.handle) return 'wood';
      if (stoneHandles.has(hit.collider.handle)) return 'stone';
    }
    const i = Math.floor((p.x - box.x0) / res), j = Math.floor((p.z - box.z0) / res);
    const k = i >= 0 && j >= 0 && i < nx && j < nz ? grid[j * nx + i] : 0;
    if (k === 1) return 'stone';
    if (k === 2) return 'dirt';
    if (Math.hypot(p.x - NINJA.position.x, p.z - NINJA.position.z) < 14) return 'stone'; // the rock ledge
    return 'grass';
  };
}

// A soft dark blob under the ninja's feet. The moon's shadow map is static (the world
// doesn't move), so this is what grounds him: it lies on whatever is under him (ground,
// bridge deck), tilted with it, and fades as he leaves the ground.
function createContactShadow(physics, player) {
  const { RAPIER, world } = physics;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.38)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25).rotateX(-Math.PI / 2), mat);
  mesh.renderOrder = 2;
  mesh.name = 'ContactShadow';
  const up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3();
  const groups = (GROUP.CAMERA << 16) | GROUP.SOLID;
  return {
    mesh,
    update() {
      const f = player.state.feet;
      const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x: f.x, y: f.y + 0.4, z: f.z }, { x: 0, y: -1, z: 0 }), 6, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, groups);
      if (!hit) {
        mesh.visible = false;
        return;
      }
      const drop = hit.timeOfImpact - 0.4; // height of the feet above the surface
      mesh.visible = true;
      mesh.position.set(f.x, f.y + 0.4 - hit.timeOfImpact + 0.02, f.z);
      mesh.quaternion.setFromUnitVectors(up, n.set(hit.normal.x, hit.normal.y, hit.normal.z));
      const fade = THREE.MathUtils.clamp(1 - drop / 2.5, 0, 1);
      mat.opacity = fade;
      mesh.scale.setScalar(1 + (1 - fade) * 0.6);
    },
  };
}
