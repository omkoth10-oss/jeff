import * as THREE from 'three';

// Dev-only free camera for checking the world up close before the player controller
// exists (step 6).
//   F          toggle fly mode (the ledge camera is restored when you leave it)
//   WASD / QE  move / down-up, Shift = fast; drag the mouse to look
//   1-5        jump to a viewpoint at eye height
export function createFlyCamera(camera, dom, groundHeight) {
  const VIEWS = [
    { name: 'left street', from: [-12, -128], to: [4, -150] },
    { name: 'bridge', from: [-6, -150], to: [30, -140] },
    { name: 'pagoda stairs', from: [48, -222], to: [66, -282] },
    { name: 'ledge trail', from: [-24, -44], to: [20, -140] },
    { name: 'shop lot', from: [-4, -128], to: [-17, -137] },
  ];
  const EYE = 1.65;
  let active = false;
  let saved = null;
  let yaw = 0;
  let pitch = 0;
  const keys = new Set();
  const v = new THREE.Vector3();

  function jump(i) {
    const { from, to } = VIEWS[i];
    const y = groundHeight(from[0], from[1]) + EYE;
    camera.position.set(from[0], y, from[1]);
    const ty = groundHeight(to[0], to[1]) + EYE;
    const d = new THREE.Vector3(to[0] - from[0], ty - y, to[1] - from[1]).normalize();
    yaw = Math.atan2(-d.x, -d.z);
    pitch = Math.asin(d.y);
    apply();
  }

  function apply() {
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
  }

  function toggle(on = !active) {
    if (on === active) return;
    active = on;
    if (active) {
      saved = { p: camera.position.clone(), r: camera.rotation.clone() };
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      yaw = e.y;
      pitch = e.x;
    } else if (saved) {
      camera.position.copy(saved.p);
      camera.rotation.copy(saved.r);
      camera.updateMatrixWorld();
    }
  }

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyF') toggle();
    else if (active && /^Digit[1-5]$/.test(e.code)) jump(Number(e.code.slice(5)) - 1);
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  dom.addEventListener('pointermove', (e) => {
    if (!active || !(e.buttons & 1)) return;
    yaw -= e.movementX * 0.003;
    pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.003, -1.5, 1.5);
    apply();
  });

  return {
    get active() {
      return active;
    },
    toggle,
    jump,
    views: VIEWS,
    update(dt) {
      if (!active) return;
      const speed = (keys.has('ShiftLeft') ? 40 : 6) * dt;
      v.set((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
        (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0));
      if (v.lengthSq() === 0) return;
      v.applyEuler(new THREE.Euler(0, yaw, 0)).multiplyScalar(speed);
      camera.position.add(v);
      camera.updateMatrixWorld();
    },
  };
}
