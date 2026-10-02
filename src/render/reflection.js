import * as THREE from 'three';

// Planar reflection for the water surface at y = level (the river, pond and pools).
// The scene is rendered from a camera mirrored below the water into a low-resolution
// target, with an oblique near plane on the water so nothing under it leaks in (the
// method three's Reflector uses). The caller hides what shouldn't be reflected.
export function createReflection(renderer, level = 0, scale = 1 / 3) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const mirror = new THREE.PerspectiveCamera();
  mirror.matrixAutoUpdate = true;
  const textureMatrix = new THREE.Matrix4();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -level);
  const clipPlane = new THREE.Vector4();
  const q = new THREE.Vector4();
  const size = new THREE.Vector2();
  const camPos = new THREE.Vector3(), target3 = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3();

  function render(scene, camera) {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, Math.round(size.x * scale)), h = Math.max(1, Math.round(size.y * scale));
    if (target.width !== w || target.height !== h) target.setSize(w, h);

    camera.getWorldPosition(camPos);
    if (camPos.y < level) return;                       // under water: nothing to reflect
    camera.getWorldDirection(dir);
    target3.copy(camPos).add(dir);
    mirror.position.set(camPos.x, 2 * level - camPos.y, camPos.z);
    mirror.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    up.copy(mirror.up); up.y = -up.y; mirror.up.copy(up);
    mirror.lookAt(target3.x, 2 * level - target3.y, target3.z);
    mirror.far = Math.min(camera.far, 2500);           // the far mountains never reach the river
    mirror.near = camera.near;
    mirror.fov = camera.fov;
    mirror.aspect = camera.aspect;
    mirror.updateProjectionMatrix();
    mirror.updateMatrixWorld();

    // texture matrix: world -> reflection texture uv
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    // oblique near plane on the water surface (Lengyel)
    const p = plane.clone().applyMatrix4(mirror.matrixWorldInverse);
    clipPlane.set(p.normal.x, p.normal.y, p.normal.z, p.constant);
    const pm = mirror.projectionMatrix.elements;
    q.x = (Math.sign(clipPlane.x) + pm[8]) / pm[0];
    q.y = (Math.sign(clipPlane.y) + pm[9]) / pm[5];
    q.z = -1.0;
    q.w = (1.0 + pm[10]) / pm[14];
    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
    pm[2] = clipPlane.x;
    pm[6] = clipPlane.y;
    pm[10] = clipPlane.z + 1.0;
    pm[14] = clipPlane.w;

    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, mirror);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;
  }

  return { texture: target.texture, textureMatrix, render };
}
