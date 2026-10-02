import * as THREE from 'three';

// Dev-only: top-down map of the valley saved to screenshots/<name>.png — the terrain
// rendered from above (brightened, no fog) with the layout drawn over it: play area
// (green), paths (orange), pads (cyan), house footprints (white) and a 25 m grid.
export function createMapView(app) {
  return async (name, cx = 20, cz = -160, half = 190) => {
    const { renderer, scene, fog } = app;
    const [village, layout] = await Promise.all(
      ['village', 'layout'].map((f) => fetch(`/data/${f}.json?${Date.now()}`).then((r) => r.json())),
    );
    const canvas = renderer.domElement;
    const w = canvas.width, h = canvas.height, asp = w / h;
    const cam = new THREE.OrthographicCamera(-half * asp, half * asp, half, -half, 1, 3000);
    cam.position.set(cx, 1500, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateMatrixWorld();
    const saved = [fog.uniforms.uFogDensity.value, fog.uniforms.uRidgeHaze.value.x, fog.uniforms.uFogHaze.value];
    fog.uniforms.uFogDensity.value = fog.uniforms.uRidgeHaze.value.x = fog.uniforms.uFogHaze.value = 0;
    renderer.setRenderTarget(null);
    renderer.render(scene, cam);
    [fog.uniforms.uFogDensity.value, fog.uniforms.uRidgeHaze.value.x, fog.uniforms.uFogHaze.value] = saved;

    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.filter = 'brightness(3)';
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';
    const P = (x, z) => [((x - (cx - half * asp)) / (2 * half * asp)) * w, ((z - (cz - half)) / (2 * half)) * h];
    ctx.strokeStyle = 'rgba(255,255,0,0.25)';
    ctx.fillStyle = '#ff0';
    ctx.font = '18px monospace';
    for (let x = Math.ceil((cx - half * asp) / 25) * 25; x < cx + half * asp; x += 25) {
      const [px] = P(x, 0);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
      if (x % 50 === 0) ctx.fillText(x, px + 3, 20);
    }
    for (let z = Math.ceil((cz - half) / 25) * 25; z < cz + half; z += 25) {
      const [, pz] = P(0, z);
      ctx.beginPath(); ctx.moveTo(0, pz); ctx.lineTo(w, pz); ctx.stroke();
      if (z % 50 === 0) ctx.fillText(z, 3, pz - 3);
    }
    const poly = (pts, stroke, width, close, fill) => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => (i ? ctx.lineTo(...P(x, z)) : ctx.moveTo(...P(x, z))));
      if (close) ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const rect = (x, z, sx, sz, rot) =>
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
        const du = (u * sx) / 2, dv = (v * sz) / 2;
        return [x + du * Math.cos(rot) + dv * Math.sin(rot), z - du * Math.sin(rot) + dv * Math.cos(rot)];
      });
    poly(layout.playArea, '#3f3', 2, true);
    for (const p of Object.values(layout.paths)) poly(p.points.map((q) => [q[0], q[2]]), '#fa0', Math.max(2, (p.width / (2 * half)) * h), false);
    for (const p of Object.values(layout.pads)) poly(rect(p.center[0], p.center[1], p.size[0], p.size[1], (p.angle * Math.PI) / 180), '#0ff', 2, true);
    for (const hs of village.houses) poly(rect(hs.x, hs.z, hs.w, hs.d, hs.rot), '#fff', 1.5, true, 'rgba(255,255,255,0.35)');
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    const res = await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    return `${await res.text()} (${village.houses.length} houses)`;
  };
}
