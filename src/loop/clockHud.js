// The clock in the corner: "11:42 PM · Loop 3", set like the title screen's place card and
// where it stood (Shippori Mincho, wide tracking, bottom left; not top right, where the moon
// rides in the opening shot), with a small moon before it that takes the moon's colour:
// white, silver, red, then nearly gone. The new loop's number lights up for a moment when
// the night begins again. "×10" shows while time is sped up.

const CSS = `
#loop-hud { position: fixed; left: clamp(22px, 3.4vw, 54px); bottom: clamp(22px, 4.2vh, 46px); z-index: 21;
  display: flex; align-items: baseline; gap: 12px; pointer-events: none; user-select: none; white-space: nowrap;
  font-family: 'Shippori Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif; -webkit-font-smoothing: antialiased;
  color: rgba(236,240,248,.84); text-shadow: 0 0 10px rgba(3,5,12,.95), 0 0 22px rgba(3,5,12,.8), 0 1px 2px rgba(0,0,0,.9);
  opacity: 0; transform: translateY(6px); transition: opacity 1.4s ease, transform 1.4s cubic-bezier(.2,.7,.2,1); }
#loop-hud.on { opacity: 1; transform: none; }
#loop-hud .moon { align-self: center; width: 6px; height: 6px; border-radius: 50%; flex: none; }
#loop-hud .time { font-size: 15px; font-weight: 500; letter-spacing: .25em; font-variant-numeric: tabular-nums; }
#loop-hud .sep { font-size: 12px; color: rgba(220,228,244,.38); }
#loop-hud .loop { font-size: 12px; letter-spacing: .32em; color: rgba(220,228,244,.6); transition: color 2.4s ease, text-shadow 2.4s ease; }
#loop-hud .loop.new { color: #f7f9fd; text-shadow: 0 0 14px rgba(170,195,255,.65), 0 1px 2px rgba(0,0,0,.9); transition: none; }
#loop-hud .fast { display: none; font-size: 10px; letter-spacing: .3em; color: #e2694f; }
#loop-hud.fast .fast { display: inline; }
/* narrow windows: above the controls prompt, which then reaches the corner */
@media (max-width: 1000px) { #loop-hud { bottom: calc(clamp(22px, 4.2vh, 46px) + 64px); } }
`;

export function createClockHud(parent = document.body) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'loop-hud';
  el.innerHTML = '<i class="moon"></i><span class="time"></span><span class="sep">·</span><span class="loop"></span><span class="fast">×10</span>';
  parent.appendChild(el);
  const [moon, time, , loopEl] = el.children;
  let shownLabel = '', shownLoop = 0, glow = 0;
  const shownMoon = { r: -1, g: -1, b: -1 };

  return {
    el,
    show(on) {
      el.classList.toggle('on', on);
    },
    // label "11:42 PM", loop number, the moon sprite's (HDR) colour, sped up?
    update(label, loop, moonColor, fast) {
      if (label !== shownLabel) time.textContent = shownLabel = label;
      if (loop !== shownLoop) {
        loopEl.textContent = `Loop ${loop}`;
        if (shownLoop) {
          // the new loop's number lights up, then settles
          loopEl.classList.add('new');
          clearTimeout(glow);
          glow = setTimeout(() => loopEl.classList.remove('new'), 2600);
        }
        shownLoop = loop;
      }
      el.classList.toggle('fast', fast);
      // the moon: its hue at full brightness, dimmed as it darkens toward the eclipse
      const { r, g, b } = moonColor;
      if (Math.abs(r - shownMoon.r) + Math.abs(g - shownMoon.g) + Math.abs(b - shownMoon.b) < 0.01) return;
      Object.assign(shownMoon, { r, g, b });
      const peak = Math.max(r, g, b, 1e-4);
      const a = Math.min(1, peak / 1.6);
      const [cr, cg, cb] = [r, g, b].map((v) => Math.round(255 * Math.min(1, (v / peak) * 0.94 + 0.06)));
      moon.style.background = `rgba(${cr},${cg},${cb},${(0.25 + 0.75 * a).toFixed(2)})`;
      moon.style.boxShadow = `0 0 ${(4 + 8 * a).toFixed(1)}px rgba(${cr},${cg},${cb},${(0.7 * a).toFixed(2)})`;
    },
  };
}
