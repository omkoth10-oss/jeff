// Maps pixel coordinates in the main reference (1536x1024) to world positions,
// using the step-1 camera, by intersecting the view ray with a horizontal plane.
import * as THREE from 'three';
import { CAMERA, NINJA } from '../../src/config.js';

const cam = new THREE.PerspectiveCamera(CAMERA.fov, 1536 / 1024, CAMERA.near, CAMERA.far);
cam.position.copy(NINJA.position).add(CAMERA.offset);
cam.rotation.set(CAMERA.pitch, CAMERA.yaw, 0, 'YXZ');
cam.updateMatrixWorld();
cam.updateProjectionMatrix();

export function refToWorld(px, py, planeY = 0) {
  const ndc = new THREE.Vector3((px / 1536) * 2 - 1, 1 - (py / 1024) * 2, 0.5);
  const dir = ndc.unproject(cam).sub(cam.position).normalize();
  const t = (planeY - cam.position.y) / dir.y;
  return cam.position.clone().addScaledVector(dir, t);
}
export function refAtDistance(px, py, horizDist) {
  const ndc = new THREE.Vector3((px / 1536) * 2 - 1, 1 - (py / 1024) * 2, 0.5);
  const dir = ndc.unproject(cam).sub(cam.position).normalize();
  const t = horizDist / Math.hypot(dir.x, dir.z);
  return cam.position.clone().addScaledVector(dir, t);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fmt = (v) => `(${v.x.toFixed(0)}, ${v.y.toFixed(0)}, ${v.z.toFixed(0)})`;
  const pts = {
    'river bottom edge (1110,1000) y0': [1110, 1000, 0],
    'river boat (1125,790) y0': [1125, 790, 0],
    'river pond (1000,680) y0': [1000, 680, 0],
    'bridge center (860,578) y0': [860, 578, 0],
    'river upstream (760,540) y0': [760, 540, 0],
    'waterfall1 base (670,405) y0': [670, 405, 0],
    'waterfall1 base (670,405) y8': [670, 405, 8],
    'village left edge (440,650) y2': [440, 650, 2],
    'village far (700,430) y2': [700, 430, 2],
    'watchtower base (1415,840) y0': [1415, 840, 0],
    'torii right (1350,600) y4': [1350, 600, 4],
    'waterfall2 base (220,560) y20': [220, 560, 20],
    'waterfall2 base (220,560) y30': [220, 560, 30],
    'pagoda hill base (1060,330) y25': [1060, 330, 25],
    'pagoda hill base (1060,330) y40': [1060, 330, 40],
    'ledge front edge (520,900) y46': [520, 900, 46],
    'torii left (110,330) y45': [110, 330, 45],
  };
  for (const [k, [x, y, h]] of Object.entries(pts)) console.log(k.padEnd(38), fmt(refToWorld(x, y, h)));
  for (const d of [400, 800, 1500, 2500, 3500]) {
    console.log(`horizon row at ${d}m: y at px row 60 =`, refAtDistance(768, 60, d).y.toFixed(0), ' row 200 =', refAtDistance(768, 200, d).y.toFixed(0), ' row 280 =', refAtDistance(768, 280, d).y.toFixed(0));
  }
}
