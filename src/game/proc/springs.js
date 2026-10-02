import * as THREE from 'three';

// Springs for the procedural animation.
//
// createSpring: a damped spring for one number (or a Vector3 with createSpring3). The
// pose uses them wherever something should move like a body part with mass, not snap to
// its target: the arm swing lags and overshoots a little, the pelvis settles after a
// landing, the head follows the camera with a delay.
//
// createSecondary: the loose parts of the outfit (the sword on the back, the hood's peak
// and short cape, the four coat panels below the belt). Each bone's tip is a point mass
// in world space pulled toward where the bone would point if it were rigid. Because it
// lives in world space it trails behind when he starts, swings forward when he stops,
// bounces on landings and sways with every step; gravity lets the cloth hang. The tip
// stays at the bone's length and within a maximum angle of the rigid pose, and the bone
// is turned toward it. Fixed substeps keep it identical at any frame rate.

export function createSpring(omega, zeta = 1, x = 0) {
  return {
    x, v: 0, omega, zeta,
    step(target, dt) {
      const n = Math.max(1, Math.ceil(dt * this.omega / 0.5));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.v += (this.omega * this.omega * (target - this.x) - 2 * this.zeta * this.omega * this.v) * h;
        this.x += this.v * h;
      }
      return this.x;
    },
    reset(x = 0) {
      this.x = x;
      this.v = 0;
    },
  };
}

export function createSpring3(omega, zeta = 1) {
  const a = new THREE.Vector3();
  return {
    x: new THREE.Vector3(), v: new THREE.Vector3(), omega, zeta,
    step(target, dt) {
      const n = Math.max(1, Math.ceil(dt * this.omega / 0.5));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        a.subVectors(target, this.x).multiplyScalar(this.omega * this.omega).addScaledVector(this.v, -2 * this.zeta * this.omega);
        this.v.addScaledVector(a, h);
        this.x.addScaledVector(this.v, h);
      }
      return this.x;
    },
    reset(p) {
      this.x.copy(p);
      this.v.set(0, 0, 0);
    },
  };
}

// omega: stiffness (rad/s), zeta: damping ratio, max: largest swing from the rigid pose
// (radians), gravity: m/s^2 pulling the tip down
const PARTS = {
  sword: { omega: 24, zeta: 0.5, max: 0.06, gravity: 0 }, // strapped tight: shifts a few degrees
  hoodTip: { omega: 12, zeta: 0.28, max: 0.35, gravity: 2.5 },
  hoodCape: { omega: 10, zeta: 0.3, max: 0.45, gravity: 3 },
  skirtFL: { omega: 12, zeta: 0.45, max: 0.4, gravity: 3 },
  skirtFR: { omega: 12, zeta: 0.45, max: 0.4, gravity: 3 },
  skirtBL: { omega: 12, zeta: 0.45, max: 0.3, gravity: 3 },
  skirtBR: { omega: 12, zeta: 0.45, max: 0.3, gravity: 3 },
};
const STEP = 1 / 120;

export function createSecondary(rig) {
  const parts = [];
  for (const [key, cfg] of Object.entries(PARTS)) {
    const bone = rig.bones[key];
    if (!bone) continue;
    // length: to the child if it has one, else the bone's tail as exported (its +y axis)
    const child = bone.children.find((c) => c.isBone);
    const len = child ? child.position.length() : ({ sword: 0.35, hoodTip: 0.12, hoodCape: 0.18 }[key] ?? 0.32);
    parts.push({ key, bone, cfg, len, tip: new THREE.Vector3(), vel: new THREE.Vector3(), init: false });
  }
  const head = new THREE.Vector3(), dir = new THREE.Vector3(), target = new THREE.Vector3(), q = new THREE.Quaternion();
  const d = new THREE.Vector3(), acc = new THREE.Vector3(), sc = new THREE.Vector3();
  let acc_t = 0;

  return {
    parts,
    // call after the body is posed; drive(key) may return a world rotation to apply to
    // the rigid pose first (the coat panels follow the thighs)
    update(dt, drive) {
      acc_t += dt;
      const steps = Math.min(8, Math.floor(acc_t / STEP));
      acc_t -= steps * STEP;
      for (const p of parts) {
        const { bone, cfg } = p;
        const dq = drive?.(p.key);
        if (dq) rig.rotateWorld(bone, dq);
        bone.getWorldPosition(head);
        bone.getWorldScale(sc);
        const len = p.len * sc.x;
        dir.set(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(q)); // rigid direction
        target.copy(head).addScaledVector(dir, len);
        if (!p.init || p.tip.distanceTo(target) > 1) {
          p.tip.copy(target);
          p.vel.set(0, 0, 0);
          p.init = true;
        }
        for (let i = 0; i < steps; i++) {
          acc.subVectors(target, p.tip).multiplyScalar(cfg.omega * cfg.omega).addScaledVector(p.vel, -2 * cfg.zeta * cfg.omega);
          acc.y -= cfg.gravity;
          p.vel.addScaledVector(acc, STEP);
          p.tip.addScaledVector(p.vel, STEP);
          // keep the length, and within the angle limit of the rigid pose
          d.subVectors(p.tip, head).normalize();
          const ang = d.angleTo(dir);
          if (ang > cfg.max) {
            d.lerp(dir, 1 - cfg.max / ang).normalize(); // near enough a slerp for these angles
            p.vel.multiplyScalar(0.6);
          }
          p.tip.copy(head).addScaledVector(d, len);
          p.vel.addScaledVector(d, -p.vel.dot(d)); // no stretching
        }
        d.subVectors(p.tip, head).normalize();
        rig.rotateWorld(bone, q.setFromUnitVectors(dir, d));
      }
    },
    reset() {
      for (const p of parts) p.init = false;
    },
  };
}
