// Dev-only: clean renders for the title screen (no labels, any size), saved to
// screenshots/title-<name>.jpg through the dev server.
//   await app.titleShots.capture('falls', { from: [x, y, z], to: [x, y, z], fov: 45 })
//   await app.titleShots.capture('hero', { ledge: true })      the game's opening shot
export function createTitleShots(app) {
  async function capture(name, { from, to, fov = 50, w = 2048, h = 1152, ticks = 45, quality = 0.9, ledge = false } = {}) {
    const { renderer, camera, post, fly } = app;
    const place = () => {
      if (ledge) return;
      camera.position.set(...from);
      camera.lookAt(...to);
      camera.updateMatrixWorld();
    };
    fly.toggle(!ledge);
    place();
    const prevFov = camera.fov;
    camera.fov = fov;
    for (let i = 0; i < ticks; i++) {
      app.tick(1 / 60); // LOD, near trees, mist, water settle around the new view
      place();
    }
    const prevRatio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    post.composer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    app.tick(1 / 60);
    place();
    app.render();
    const blob = await new Promise((r) => renderer.domElement.toBlob(r, 'image/jpeg', quality));
    camera.fov = prevFov;
    app.setResolution(prevRatio);
    fly.toggle(false);
    const res = await fetch(`/__shot?name=title-${name}&ext=jpg`, { method: 'POST', body: blob });
    return res.text();
  }
  return { capture };
}
