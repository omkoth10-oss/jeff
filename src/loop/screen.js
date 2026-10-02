// What the time loop lays over the game: a full-screen veil (the white of the midnight
// pulse, the black the opening comes out of) and centred captions in the title screen's
// type, Shippori Mincho: the whisper ("Again…") and the hour ("11:00 PM", with the
// title's thin rule and red diamond). Under the title screen, over the HUD. Everything is
// driven per frame from the cutscenes' timelines (not CSS transitions), so it pauses and
// skips with them.

const CSS = `
#loop-veil { position: fixed; inset: 0; z-index: 40; pointer-events: none; display: none; }
#loop-caption { position: fixed; inset: 0; z-index: 41; pointer-events: none; display: flex; align-items: center; justify-content: center;
  font-family: 'Shippori Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif; -webkit-font-smoothing: antialiased; text-align: center; }
#loop-caption > div { position: absolute; opacity: 0; will-change: opacity, transform, filter; }
#loop-caption .whisper { font-size: clamp(18px, 2.7vh, 27px); font-weight: 400; letter-spacing: .36em; margin-right: -.36em;
  color: rgba(214,224,244,.86); text-shadow: 0 0 18px rgba(140,170,255,.28), 0 0 40px rgba(3,5,12,.9), 0 1px 3px rgba(0,0,0,.9); }
#loop-caption .hour { display: flex; flex-direction: column; align-items: center; gap: 1.9vh; }
#loop-caption .hour b { font-weight: 500; font-size: clamp(30px, 5.2vh, 52px); letter-spacing: .4em; margin-right: -.4em; line-height: 1;
  color: #eef2fa; text-shadow: 0 0 26px rgba(140,170,255,.22), 0 0 50px rgba(3,5,12,.85), 0 2px 3px rgba(0,0,0,.8); }
#loop-caption .hour i { position: relative; width: min(300px, 40vw); height: 9px; }
#loop-caption .hour i::before, #loop-caption .hour i::after { content: ''; position: absolute; top: 4px; height: 1px; width: calc(50% - 16px);
  background: linear-gradient(to var(--d), rgba(232,237,246,0), rgba(232,237,246,.55)); }
#loop-caption .hour i::before { left: 0; --d: right; } #loop-caption .hour i::after { right: 0; --d: left; }
#loop-caption .hour i em { position: absolute; left: 50%; top: 0; width: 7px; height: 7px; margin-left: -3.5px; transform: rotate(45deg);
  background: #c8432f; box-shadow: 0 0 12px rgba(255,90,50,.55); }
`;

export function createScreen(parent = document.body) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const veil = document.createElement('div');
  veil.id = 'loop-veil';
  const captions = document.createElement('div');
  captions.id = 'loop-caption';
  captions.innerHTML = '<div class="whisper">Again…</div><div class="hour"><b>11:00 PM</b><i><em></em></i></div>';
  parent.append(veil, captions);
  const lines = { whisper: captions.children[0], hour: captions.children[1] };
  const shown = { veil: -1, color: '', whisper: -1, hour: -1 };

  return {
    // colour (CSS), opacity 0..1
    veil(color, opacity) {
      const o = Math.round(opacity * 1000) / 1000;
      if (o === shown.veil && color === shown.color) return;
      shown.veil = o;
      shown.color = color;
      veil.style.display = o > 0 ? 'block' : 'none';
      veil.style.background = color;
      veil.style.opacity = o;
    },
    get veilOpacity() {
      return Math.max(0, shown.veil);
    },
    // a caption at k (0 hidden .. 1 shown): it surfaces out of a soft blur, rising a little
    caption(name, k) {
      const v = Math.round(k * 1000) / 1000;
      if (v === shown[name]) return;
      shown[name] = v;
      const el = lines[name];
      el.style.opacity = v;
      el.style.filter = v < 1 ? `blur(${((1 - v) * 7).toFixed(2)}px)` : 'none';
      el.style.transform = `translateY(${((1 - v) * 8).toFixed(2)}px)`;
    },
    shown,
  };
}
