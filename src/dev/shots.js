// Dev-only: saves the current frame, side by side with the reference image shown by the
// compare tool (if any), to screenshots/<name>.png through the dev server (vite.config.js).
export function createShots(renderFrame, canvas) {
  return async (name) => {
    const ref = document.querySelector('#ref-pane img');
    const showRef = document.body.classList.contains('ref-split') && ref?.complete;
    renderFrame();
    const w = canvas.width, h = canvas.height;
    const out = document.createElement('canvas');
    out.width = showRef ? w * 2 : w;
    out.height = h;
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0);                        // same task as the render: buffer still valid
    if (showRef) ctx.drawImage(ref, w, 0, w, h);
    ctx.font = `${Math.round(h / 40)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = 'rgba(5,8,16,0.7)';
    const label = (text, x) => {
      const m = ctx.measureText(text);
      ctx.fillRect(x + 8, h - h / 40 - 20, m.width + 12, h / 40 + 12);
      ctx.fillStyle = '#d8e4ff';
      ctx.fillText(text, x + 14, h - 16);
      ctx.fillStyle = 'rgba(5,8,16,0.7)';
    };
    label('Render', 0);
    if (showRef) label(document.querySelectorAll('.ref-label')[1]?.textContent ?? 'Reference', w);
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    const res = await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    return res.text();
  };
}
