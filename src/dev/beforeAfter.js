// Dev-only: stacks two saved screenshots side by side ("Before" | "After") and saves the
// result to screenshots/<name>.png, for the end-of-workstream comparisons.
//   await app.beforeAfter('base-ledge', 'ws1-r4-ledge', 'ws1-ledge-before-after')
export async function beforeAfter(before, after, name, { jpeg = false, width = 0 } = {}) {
  const load = (n) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `/screenshots/${n}.png?${Date.now()}`;
    });
  const [a, b] = await Promise.all([load(before), load(after)]);
  const w = width ? Math.round((width - 12) / 2) : Math.min(a.width, b.width), h = Math.round((w / a.width) * a.height);
  const out = document.createElement('canvas');
  out.width = w * 2 + 12;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#05080f';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(a, 0, 0, w, h);
  ctx.drawImage(b, w + 12, 0, w, h);
  ctx.font = `bold ${Math.round(h / 22)}px ui-monospace, Menlo, monospace`;
  for (const [text, x] of [['BEFORE', 16], ['AFTER', w + 28]]) {
    const m = ctx.measureText(text);
    ctx.fillStyle = 'rgba(5,8,16,0.75)';
    ctx.fillRect(x - 8, 12, m.width + 16, h / 22 + 16);
    ctx.fillStyle = '#ffd9a0';
    ctx.fillText(text, x, 12 + h / 22 + 4);
  }
  const blob = await new Promise((r) => out.toBlob(r, jpeg ? 'image/jpeg' : 'image/png', 0.86));
  const res = await fetch(`/__shot?name=${encodeURIComponent(name)}${jpeg ? '&ext=jpg' : ''}`, { method: 'POST', body: blob });
  return res.text();
}
