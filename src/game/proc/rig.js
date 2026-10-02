import * as THREE from 'three';

// The ninja's skeleton for procedural animation: finds the bones by name (Character
// Creator bones, plus the secondary bones added by blender/scripts/rig_secondary.py),
// records the rest pose in character space (x left, y up, z forward, before the model's
// scale) and provides the world-space operations the animation is built from:
//   setWorld(bone, q)            give a bone this world rotation
//   rotateWorld(bone, q)         turn a bone by a world-space rotation
//   aim(bone, child, target, frontHint)
//                                point a bone at a target (its child along the line) with
//                                its front (what faced character +z at rest) toward the hint
//   pointAt(bone, child, target)  the smallest turn that points a bone at a target (hinges:
//                                knees and elbows keep the plane their parent set up)
// Every operation updates the bone's subtree, so the next bone down the chain reads
// current positions.

const NAMES = {
  hip: 'CC_Base_Hip', pelvis: 'CC_Base_Pelvis', waist: 'CC_Base_Waist', spine1: 'CC_Base_Spine01', spine2: 'CC_Base_Spine02',
  neck1: 'CC_Base_NeckTwist01', neck2: 'CC_Base_NeckTwist02', head: 'CC_Base_Head',
  clavL: 'CC_Base_L_Clavicle', armL: 'CC_Base_L_Upperarm', foreL: 'CC_Base_L_Forearm', handL: 'CC_Base_L_Hand',
  clavR: 'CC_Base_R_Clavicle', armR: 'CC_Base_R_Upperarm', foreR: 'CC_Base_R_Forearm', handR: 'CC_Base_R_Hand',
  thighL: 'CC_Base_L_Thigh', calfL: 'CC_Base_L_Calf', footL: 'CC_Base_L_Foot', toeL: 'CC_Base_L_ToeBase',
  thighR: 'CC_Base_R_Thigh', calfR: 'CC_Base_R_Calf', footR: 'CC_Base_R_Foot', toeR: 'CC_Base_R_ToeBase',
  indexL1: 'CC_Base_L_Index1', indexL2: 'CC_Base_L_Index2', thumbL1: 'CC_Base_L_Thumb1',
  indexR1: 'CC_Base_R_Index1', indexR2: 'CC_Base_R_Index2', thumbR1: 'CC_Base_R_Thumb1',
  sword: 'Sword', hoodTip: 'HoodTip', hoodCape: 'HoodCape',
  skirtFL: 'Skirt_FL', skirtFR: 'Skirt_FR', skirtBL: 'Skirt_BL', skirtBR: 'Skirt_BR',
};

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

// rotation taking the orthonormal frame (u0, f0) onto (u1, f1): u = main axis, f = front
export function frameRotation(u0, f0, u1, f1, out = new THREE.Quaternion()) {
  const basis = (u, f, m) => {
    const x = _c.crossVectors(f, u).normalize();
    const z = _d.crossVectors(u, x).normalize();
    return m.makeBasis(x, u, z);
  };
  const m0 = basis(u0, f0, new THREE.Matrix4());
  const m1 = basis(u1, f1, new THREE.Matrix4());
  out.setFromRotationMatrix(m1.multiply(m0.transpose()));
  return out;
}

export function createRig(root, model) {
  const bones = {};
  model.traverse((o) => {
    if (!o.isBone || o.name.includes('scaleCompensation')) return;
    for (const [key, name] of Object.entries(NAMES)) if (o.name === name || o.name.replace(/_\d+$/, '') === name) bones[key] = o;
  });
  const missing = Object.keys(NAMES).filter((k) => !bones[k]);

  // rest pose: local transforms, and world transforms in character space
  const all = [];
  model.traverse((o) => o.isBone && all.push(o));
  const restLocal = new Map(all.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
  const rootS = root.getWorldScale(new THREE.Vector3()).x;
  const restChar = new Map(); // bone -> { q (char-space world rotation), p (char-space position, model units) }
  for (const b of all) {
    const q = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootQ.clone().invert());
    const p = b.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
    restChar.set(b, { q, p });
  }
  // each bone's local axis that pointed along character +z (front) at rest
  const front = new Map(all.map((b) => [b, new THREE.Vector3(0, 0, 1).applyQuaternion(restChar.get(b).q.clone().invert())]));
  // segment lengths (model units)
  const dist = (a, b) => restChar.get(bones[a]).p.distanceTo(restChar.get(bones[b]).p);
  const lengths = { thigh: dist('thighL', 'calfL'), calf: dist('calfL', 'footL'), upper: dist('armL', 'foreL'), fore: dist('foreL', 'handL') };

  function reset() {
    for (const [b, r] of restLocal) {
      b.quaternion.copy(r.q);
      b.position.copy(r.p);
    }
  }
  function worldQuat(bone, out = new THREE.Quaternion()) {
    return bone.getWorldQuaternion(out);
  }
  function setWorld(bone, q) {
    bone.parent.getWorldQuaternion(_q);
    bone.quaternion.copy(_q.invert().multiply(q));
    bone.updateMatrixWorld(true);
  }
  function rotateWorld(bone, q) {
    bone.getWorldQuaternion(_q2);
    setWorld(bone, _q2.premultiply(q));
  }
  function setWorldPosition(bone, p) {
    bone.parent.updateWorldMatrix(true, false);
    bone.position.copy(bone.parent.worldToLocal(_a.copy(p)));
    bone.updateMatrixWorld(true);
  }
  // current world-space front vector of a bone
  function frontOf(bone, out = new THREE.Vector3()) {
    return out.copy(front.get(bone)).applyQuaternion(bone.getWorldQuaternion(_q));
  }
  const _u0 = new THREE.Vector3(), _u1 = new THREE.Vector3(), _f0 = new THREE.Vector3(), _f1 = new THREE.Vector3(), _rq = new THREE.Quaternion();
  function aim(bone, child, target, frontHint) {
    const B = bone.getWorldPosition(_a);
    _u0.copy(child.getWorldPosition(_b)).sub(B).normalize();
    _u1.copy(target).sub(B).normalize();
    frontOf(bone, _f0);
    _f0.addScaledVector(_u0, -_f0.dot(_u0)).normalize();
    _f1.copy(frontHint).addScaledVector(_u1, -frontHint.dot(_u1));
    if (_f1.lengthSq() < 1e-8) _f1.copy(_f0).addScaledVector(_u1, -_f0.dot(_u1));
    _f1.normalize();
    frameRotation(_u0, _f0, _u1, _f1, _rq);
    rotateWorld(bone, _rq);
  }

  function pointAt(bone, child, target) {
    const B = bone.getWorldPosition(_a);
    _u0.copy(child.getWorldPosition(_b)).sub(B).normalize();
    _u1.copy(target).sub(B).normalize();
    rotateWorld(bone, _rq.setFromUnitVectors(_u0, _u1));
  }
  // turn a bone about its own front axis (finger curls): local, no world update
  const _ax = new THREE.Quaternion();
  function curl(bone, angle) {
    bone.quaternion.multiply(_ax.setFromAxisAngle(front.get(bone), angle));
  }

  return { bones, missing, restChar, restLocal, lengths, rootScale: rootS, reset, worldQuat, setWorld, rotateWorld, setWorldPosition, frontOf, aim, pointAt, curl };
}
