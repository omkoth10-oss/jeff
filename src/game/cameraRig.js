import * as THREE from 'three';
import { CAMERA_QUERY } from './physics.js';
import { CAMERA } from '../config.js';

// Third-person over-the-shoulder camera. It orbits a pivot above the player's feet:
//   camera = pivot + rotation(yaw, pitch) * (shoulder, 0, distance)
// so with the opening values it reproduces the ledge shot from the main reference
// exactly (the ninja lower left, the valley below). When the player takes control it
// eases into a closer gameplay framing.
//
// Obstacles: a small sphere is cast from the head to the shoulder point, then on to the
// camera position; the camera stops in front of the first solid hit (terrain,
// buildings, rocks, trunks; not the invisible walls). It pushes in at once and eases
// back out, so walls and trees never cut through the view.

// the ledge shot (config.js CAMERA.offset: right, up, back from the feet, seen at CAMERA.pitch)
const OPENING = {
  shoulder: CAMERA.offset.x,
  distance: CAMERA.offset.z / Math.cos(CAMERA.pitch),
  height: CAMERA.offset.y + (CAMERA.offset.z / Math.cos(CAMERA.pitch)) * Math.sin(CAMERA.pitch),
};
const PLAY = { shoulder: 0.72, distance: 3.6, height: 1.55 };
const PITCH_MIN = THREE.MathUtils.degToRad(-72);
const PITCH_MAX = THREE.MathUtils.degToRad(38);
const SENSITIVITY = 0.0022; // rad per pixel
const PROBE = 0.22; // camera sphere radius

export function createCameraRig(camera, physics, { yaw, pitch }) {
  const { RAPIER, world } = physics;
  const probe = new RAPIER.Ball(PROBE);
  const rot = new RAPIER.Quaternion(0, 0, 0, 1);
  const state = { yaw, pitch, blend: 0, pull: 1, active: false, sensitivity: 1, invertY: false };
  const pivot = new THREE.Vector3();
  const smoothPivot = new THREE.Vector3();
  let havePivot = false;
  const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const shoulderPt = new THREE.Vector3(), camPt = new THREE.Vector3(), dir = new THREE.Vector3();

  // fraction (0..1) of the way from a to b a sphere can travel before touching something solid
  function sweep(a, b) {
    dir.subVectors(b, a);
    const hit = world.castShape({ x: a.x, y: a.y, z: a.z }, rot, { x: dir.x, y: dir.y, z: dir.z }, probe, 0, 1, true,
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, CAMERA_QUERY);
    return hit ? hit.time_of_impact : 1;
  }

  return {
    state,
    // mouse look (pixels since the last frame)
    look(dx, dy) {
      const k = SENSITIVITY * state.sensitivity;
      state.yaw -= dx * k;
      state.pitch = THREE.MathUtils.clamp(state.pitch - dy * k * (state.invertY ? -1 : 1), PITCH_MIN, PITCH_MAX);
    },
    // player settings (title screen)
    configure({ sensitivity = state.sensitivity, invertY = state.invertY } = {}) {
      state.sensitivity = sensitivity;
      state.invertY = invertY;
    },
    // the player has taken control: ease from the opening shot to the gameplay framing
    activate() {
      state.active = true;
    },
    update(dt, feet) {
      if (state.active) state.blend = Math.min(1, state.blend + dt / 1.6);
      const b = THREE.MathUtils.smootherstep(state.blend, 0, 1);
      const shoulder = THREE.MathUtils.lerp(OPENING.shoulder, PLAY.shoulder, b);
      const distance = THREE.MathUtils.lerp(OPENING.distance, PLAY.distance, b);
      const height = THREE.MathUtils.lerp(OPENING.height, PLAY.height, b);

      // the pivot follows the feet, with the vertical smoothed (stairs, landing from a jump)
      pivot.set(feet.x, feet.y + height, feet.z);
      if (!havePivot) {
        smoothPivot.copy(pivot);
        havePivot = true;
      }
      smoothPivot.x = pivot.x;
      smoothPivot.z = pivot.z;
      smoothPivot.y += (pivot.y - smoothPivot.y) * (1 - Math.exp(-dt * 10));

      e.set(state.pitch, state.yaw, 0);
      q.setFromEuler(e);
      shoulderPt.set(shoulder, 0, 0).applyQuaternion(q).add(smoothPivot);
      camPt.set(shoulder, 0, distance).applyQuaternion(q).add(smoothPivot);

      // obstacle avoidance: head -> shoulder -> camera
      const s1 = sweep(smoothPivot, shoulderPt);
      if (s1 < 1) shoulderPt.lerpVectors(smoothPivot, shoulderPt, Math.max(0, s1 - 0.05));
      const s2 = sweep(shoulderPt, camPt);
      const want = s2 < 1 ? Math.max(0.05, s2 - 0.04) : 1;
      // in at once, out slowly
      state.pull = want < state.pull ? want : state.pull + (want - state.pull) * (1 - Math.exp(-dt * 3.5));
      camera.position.lerpVectors(shoulderPt, camPt, state.pull);
      camera.quaternion.copy(q);
      camera.updateMatrixWorld();
    },
    // for the player: movement is relative to the camera's heading
    get yaw() {
      return state.yaw;
    },
    get pitch() {
      return state.pitch;
    },
  };
}
