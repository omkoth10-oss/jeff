// Small FPS / frame-time / draw-call readout. The renderer's info counters are
// reset manually each frame so post-processing passes are counted too.
export function createPerfHud(renderer) {
  renderer.info.autoReset = false;

  const el = document.createElement('div');
  el.id = 'perf-hud';
  Object.assign(el.style, {
    position: 'fixed',
    top: '8px',
    left: '8px',
    zIndex: 20,
    padding: '6px 8px',
    font: '12px/1.35 ui-monospace, Menlo, monospace',
    color: '#d8e4ff',
    background: 'rgba(5, 8, 16, 0.72)',
    borderRadius: '4px',
    pointerEvents: 'none',
    whiteSpace: 'pre',
  });
  el.textContent = 'measuring…';
  document.body.appendChild(el);

  const stats = { fps: 0, avgMs: 0, worstMs: 0, calls: 0, triangles: 0 };
  let frames = 0;
  let sumMs = 0;
  let worstMs = 0;
  let windowStart = performance.now();
  let last = windowStart;

  function begin() {
    renderer.info.reset();
  }

  function end() {
    const now = performance.now();
    const dt = now - last;
    last = now;
    // A gap this long means the tab was hidden or paused, not a slow frame.
    if (dt > 250) {
      frames = 0;
      sumMs = 0;
      worstMs = 0;
      windowStart = now;
      return;
    }
    frames++;
    sumMs += dt;
    worstMs = Math.max(worstMs, dt);

    if (now - windowStart >= 500) {
      stats.fps = (frames * 1000) / (now - windowStart);
      stats.avgMs = sumMs / frames;
      stats.worstMs = worstMs;
      stats.calls = renderer.info.render.calls;
      stats.triangles = renderer.info.render.triangles;
      el.textContent =
        `${stats.fps.toFixed(0).padStart(3)} fps  ${stats.avgMs.toFixed(1)} ms (worst ${stats.worstMs.toFixed(1)})\n` +
        `${stats.calls} draws  ${(stats.triangles / 1000).toFixed(1)}k tris  ` +
        `dpr ${renderer.getPixelRatio().toFixed(2)}`;
      frames = 0;
      sumMs = 0;
      worstMs = 0;
      windowStart = now;
    }
  }

  return { begin, end, stats };
}
