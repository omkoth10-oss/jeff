import * as THREE from 'three';

// Real shading for the lanterns and torches nearest the camera. The lamp light map
// (world/lamps.js) gives every lamp in the valley a warm pool cheaply but it ignores
// surface direction; the four nearest lamps are also passed to every material
// (uLampPoints, render/fog.js) and shaded with N.L and distance falloff, so up close
// walls light on the side facing the lamp and the light falls off over the paving.
// Cheaper than three.js point lights, which run the full BRDF on every pixel.
const FADE_START = 32, FADE_END = 45; // metres from the camera
const INTENSITY = 3;

export function createLightPool(slots) {
  let points = [];
  const cam = new THREE.Vector3();
  const last = new THREE.Vector3(1e9, 0, 0);
  const near = [];

  return {
    setPoints(p) {
      points = p;
      last.set(1e9, 0, 0);
    },
    update(dt, camera) {
      camera.getWorldPosition(cam);
      if (cam.distanceToSquared(last) < 0.25) return;
      last.copy(cam);
      near.length = 0;
      for (const p of points) {
        const d2 = (p[0] - cam.x) ** 2 + (p[1] - cam.y) ** 2 + (p[2] - cam.z) ** 2;
        if (d2 < FADE_END * FADE_END) near.push([d2, p]);
      }
      near.sort((a, b) => a[0] - b[0]);
      slots.forEach((v, i) => {
        const n = near[i];
        if (!n) {
          v.set(0, -1000, 0, 0);
          return;
        }
        const [d2, [x, y, z, strength]] = n;
        v.set(x, y, z, INTENSITY * strength * THREE.MathUtils.smoothstep(FADE_END - Math.sqrt(d2), 0, FADE_END - FADE_START));
      });
    },
  };
}
