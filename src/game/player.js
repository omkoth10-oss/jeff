import * as THREE from 'three';
import { GROUP } from './physics.js';

// The player: a kinematic capsule moved by Rapier's character controller. It walks on
// the terrain, steps up stairs and kerbs, climbs slopes up to 46 degrees, slides off
// steeper ones and stops at walls. Movement is relative to the camera's heading, with
// eased acceleration and stopping, a short grace period for jumping off ledges
// (coyote time) and a jump buffer. The ninja model turns smoothly toward where he
// moves. Shallow water slows him down; deep water is walled off (physics.js). If he
// ever ends up somewhere he shouldn't (fell off the world, in deep water), he returns
// to the last safe place he stood.

const RADIUS = 0.32;
const HALF = 0.55; // capsule half-height (cylinder part): total height 1.74 m
export const SPEED = { walk: 1.6, run: 4.2, sprint: 7.2 };
const ACCEL = 5, DECEL = 7, AIR_ACCEL = 2.5; // a person needs a few steps to get going or stop
// gravity a little stronger than real (snappier than real, but falls still read as falls)
const GRAVITY = -16, JUMP_SPEED = 6.0; // about 1.1 m of jump
const TURN_RATE = { slow: 4.5, fast: 11 }; // turning toward where he moves: unhurried when slow
const COYOTE = 0.12, BUFFER = 0.14;
const JUMP_CROUCH = 0.26; // seconds of crouch before take-off (the animation's anticipation)
const KILL_Y = -25;
const STEEP = Math.cos(THREE.MathUtils.degToRad(50)); // contact normals flatter than this are walls

export function createPlayer(physics, spawn, { yaw = 0, groundY = null } = {}) {
  const { RAPIER, world } = physics;
  const feet = spawn.clone();
  if (groundY !== null) feet.y = groundY;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, feet.y + HALF + RADIUS + 0.05, feet.z));
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups((GROUP.PLAYER << 16) | (GROUP.SOLID | GROUP.PLAYER_ONLY)),
    body,
  );
  const ctrl = world.createCharacterController(0.03);
  ctrl.setUp({ x: 0, y: 1, z: 0 });
  ctrl.enableAutostep(0.36, 0.18, false);
  ctrl.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(46));
  ctrl.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(52));
  ctrl.enableSnapToGround(0.45);
  ctrl.setSlideEnabled(true);
  const filterGroups = (GROUP.PLAYER << 16) | (GROUP.SOLID | GROUP.PLAYER_ONLY);

  const vel = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const state = {
    feet,
    facing: yaw, // model heading (radians, 0 = +z)
    grounded: true,
    speed: 0, // actual horizontal speed (m/s), for the animations
    vy: 0,
    airTime: 0,
    landed: 0, // seconds since the last landing (for the landing animation)
    jumped: false, // set on the frame the feet leave the ground in a jump
    crouch: 0, // 0..1 while crouching to jump
    impact: 0, // downward speed (m/s) at the last landing
    fallSpeed: 0, // current downward speed while airborne (m/s)
    drive: 0, // how much faster (+) or slower (-) he's trying to go along his heading (m/s)
    wading: 0, // 0..1
    lastSafe: feet.clone(),
    respawns: 0,
    blocked: 0, // how much of the wished movement was stopped this frame (0..1)
  };
  let coyote = 0, buffer = 0, safeTimer = 0, charge = 0, chargeTotal = 0, recover = 0;
  const spawnPoint = feet.clone();

  function teleport(p) {
    feet.copy(p);
    vel.set(0, 0, 0);
    state.vy = 0;
    body.setTranslation({ x: p.x, y: p.y + HALF + RADIUS + 0.05, z: p.z }, true);
    body.setNextKinematicTranslation({ x: p.x, y: p.y + HALF + RADIUS + 0.05, z: p.z });
  }

  function respawn(toSpawn = false) {
    teleport(toSpawn ? spawnPoint : state.lastSafe);
    state.respawns++;
  }

  return {
    state,
    body,
    collider,
    ctrl, // for the dev tools (collision details)
    RADIUS,
    HALF,
    teleport,
    respawn,
    update(dt, input, cameraYaw, depthAt) {
      state.jumped = false;
      // wished direction on the ground plane, relative to the camera
      const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw); // camera forward
      const rx = Math.cos(cameraYaw), rz = -Math.sin(cameraYaw); // camera right
      wish.set(rx * input.move.x + fx * input.move.y, 0, rz * input.move.x + fz * input.move.y);
      const amount = Math.min(1, wish.length());
      if (amount > 0) wish.normalize();

      // shallow water slows him down (the river surface is at y = 0)
      const depth = depthAt && depthAt(feet.x, feet.z) > 0 ? Math.max(0, -feet.y) : 0;
      state.wading = THREE.MathUtils.clamp(depth / 0.8, 0, 1);
      // (a hard landing takes a moment to recover from)
      recover = Math.max(0, recover - dt);
      const top = (input.walk ? SPEED.walk : input.sprint ? SPEED.sprint : SPEED.run) * (1 - 0.7 * state.wading) * (1 - 0.7 * Math.min(1, recover / 0.25));
      const target = wish.clone().multiplyScalar(top * amount);
      const horiz = new THREE.Vector3(vel.x, 0, vel.z);
      const rate = !state.grounded ? AIR_ACCEL : target.lengthSq() > horiz.lengthSq() ? ACCEL : DECEL;
      // (the push he's making, for the animation's lean: ahead of the speed it produces)
      const fwdX = Math.sin(state.facing), fwdZ = Math.cos(state.facing);
      state.drive = state.grounded ? target.x * fwdX + target.z * fwdZ - (horiz.x * fwdX + horiz.z * fwdZ) : 0;
      horiz.lerp(target, 1 - Math.exp(-rate * dt));
      vel.x = horiz.x;
      vel.z = horiz.z;

      // jumping and gravity
      if (input.jumpPressed) {
        buffer = BUFFER;
        input.jumpPressed = false;
      } else buffer = Math.max(0, buffer - dt);
      coyote = state.grounded ? COYOTE : Math.max(0, coyote - dt);
      // a short crouch, then take-off (walking off a ledge mid-crouch still jumps)
      if (buffer > 0 && coyote > 0 && state.wading < 0.7 && charge === 0) {
        // standing: a crouch first; running: straight off the leading foot
        charge = state.speed > 2.5 ? 0.04 : JUMP_CROUCH;
        chargeTotal = charge;
        buffer = 0;
      }
      if (charge > 0) {
        charge = Math.max(0, charge - dt);
        state.crouch = chargeTotal > 0.1 ? 1 - charge / chargeTotal : 0;
        if (charge === 0) {
          state.vy = JUMP_SPEED;
          coyote = 0;
          state.jumped = true;
          state.grounded = false;
          state.crouch = 0;
        }
      }
      state.vy = Math.max(-40, state.vy + GRAVITY * dt);

      // move. On the ground there is no push down: snap-to-ground keeps the feet on it,
      // and a constant downward push would be slid along any slope (he'd creep downhill)
      const want = { x: vel.x * dt, y: (state.grounded && state.vy <= 0 ? 0 : state.vy * dt), z: vel.z * dt };
      ctrl.computeColliderMovement(collider, want, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, filterGroups);
      const got = ctrl.computedMovement();
      state.debug = { want: [want.x, want.y, want.z], got: [got.x, got.y, got.z], grounded: state.grounded };
      if (state.grounded && amount === 0 && Math.hypot(vel.x, vel.z) < 0.05) {
        got.x = 0; // standing still stays still
        got.z = 0;
      }
      const wasGrounded = state.grounded;
      state.grounded = ctrl.computedGrounded();
      feet.x += got.x;
      feet.y += got.y;
      feet.z += got.z;
      body.setNextKinematicTranslation({ x: feet.x, y: feet.y + HALF + RADIUS + 0.05, z: feet.z });

      // walls (surfaces too steep to climb) take away the part of the velocity that
      // pushes into them, so he slides along them and doesn't build up speed against them.
      // Slopes he can climb keep the full velocity (their projection only tilts it).
      const wantH = Math.hypot(want.x, want.z), gotH = Math.hypot(got.x, got.z);
      state.blocked = wantH > 1e-4 ? THREE.MathUtils.clamp(1 - gotH / wantH, 0, 1) : 0;
      for (let k = 0; k < ctrl.numComputedCollisions(); k++) {
        const n = ctrl.computedCollision(k).normal1;
        if (n.y > STEEP) continue;
        const hl = Math.hypot(n.x, n.z) || 1;
        const nx = n.x / hl, nz = n.z / hl;
        const into = vel.x * nx + vel.z * nz;
        if (into < 0) {
          vel.x -= nx * into;
          vel.z -= nz * into;
        }
      }
      if (state.grounded) {
        if (!wasGrounded && state.airTime > 0.25) {
          state.landed = 0;
          state.impact = state.fallSpeed;
          if (state.impact > 9) recover = 0.45;
        }
        state.vy = 0;
        state.fallSpeed = 0;
        state.airTime = 0;
      } else {
        state.airTime += dt;
        state.fallSpeed = Math.max(0, -state.vy);
        if (got.y > want.y + 1e-4 && state.vy < 0) state.vy = got.y / dt; // resting on something while falling
        if (want.y > 0 && got.y < want.y * 0.5) state.vy = Math.min(state.vy, 0); // bumped the head
      }
      state.landed += dt;
      // what he actually covers drives the animations (no running on the spot at a wall)
      const actual = dt > 0 ? gotH / dt : 0;
      state.speed += (actual - state.speed) * (1 - Math.exp(-dt * 20));

      // face where he is going
      if (Math.hypot(vel.x, vel.z) > 0.35) {
        const targetYaw = Math.atan2(vel.x, vel.z);
        let d = targetYaw - state.facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const rate = THREE.MathUtils.lerp(TURN_RATE.slow, TURN_RATE.fast, THREE.MathUtils.clamp(state.speed / 3, 0, 1));
        state.facing += d * (1 - Math.exp(-rate * dt));
      }

      // safety: remember safe footing, recover from falls out of the world or deep water
      safeTimer += dt;
      if (state.grounded && state.wading < 0.6 && safeTimer > 0.5) {
        state.lastSafe.copy(feet);
        safeTimer = 0;
      }
      if (feet.y < KILL_Y) respawn(true); // fell off the world: back to the ledge
      else if (state.grounded && depth > 1.0) respawn(false); // somehow in deep water: back to the bank
    },
  };
}
