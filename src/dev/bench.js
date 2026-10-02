// Dev-only frame-time benchmark. Renders frames back to back and waits for the GPU only
// every 30 frames, so CPU and GPU overlap as in the real loop (a sync every frame
// inflates the time by the flush). Returns the median ms per frame at each pixel ratio,
// for the current camera. Run it with the page at full window size (no ?ref).
export function createBench(app, resize) {
  const { renderer } = app;
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return (ratios = [1.25, 1.5]) => {
    const before = renderer.getPixelRatio();
    const out = {};
    for (const r of ratios) {
      renderer.setPixelRatio(r);
      resize();
      for (let i = 0; i < 5; i++) app.render();
      sync();
      const batches = [];
      for (let b = 0; b < 6; b++) {
        const t0 = performance.now();
        for (let i = 0; i < 30; i++) {
          app.tick(1 / 60);
          app.render();
        }
        sync();
        batches.push((performance.now() - t0) / 30);
      }
      batches.sort((a, b) => a - b);
      out[`dpr${r}`] = +batches[3].toFixed(2);
    }
    renderer.setPixelRatio(before);
    resize();
    // draw calls and triangles of one frame (the perf HUD turns the auto reset off)
    const auto = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    app.render();
    out.calls = renderer.info.render.calls;
    out.tris = renderer.info.render.triangles;
    renderer.info.autoReset = auto;
    return out;
  };
}
