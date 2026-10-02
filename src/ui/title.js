import '@fontsource/shippori-mincho/400.css';
import '@fontsource/shippori-mincho/500.css';
import '@fontsource/shippori-mincho/700.css';

// KAGE title screen. The backdrop is the game itself: renders of the valley taken from
// the live scene (public/title/, made with dev/titleShots.js), shown full screen as slow
// camera drifts that dissolve into one another, under drifting mist, a few motes of
// moonlit dust and fine film grain. The title floats in the night sky above the village;
// the menu sits at the foot of the frame. It doubles as the loading screen: START and
// EXPLORE wake up once the valley is ready.
//
//   const title = createTitle({ onStart, onExplore, onSettings })
//   title.progress(0..1); title.ready(); title.hide('live' | 'tour'); title.show()
//   title.place(name)   place-name card during the flyover

const SLIDES = [
  { file: '1-hero', jp: '月影の谷', en: 'Tsukikage Valley', from: [1.03, 0, 1.8], to: [1.1, -1.2, 1.9], origin: '64% 6%' },
  { file: '2-valley', jp: '影の里', en: 'The Hidden Village', from: [1.1, 1.5, 0.5], to: [1.03, -1, -0.5] },
  { file: '3-bridge', jp: '朱橋', en: 'The Vermilion Bridge', from: [1.03, -1, 0.8], to: [1.11, 1.2, -0.8] },
  { file: '4-falls', jp: '白糸の滝', en: 'Shiraito Falls', from: [1.09, 0, -1.2], to: [1.02, 0.6, 0.6] },
  { file: '5-castle', jp: '黒影城', en: 'Kurokage Castle', from: [1.02, 0, 1.6], to: [1.1, 0, -0.4] },
  { file: '6-shrine', jp: '月見の社', en: 'Shrine of the Moon', from: [1.1, 0.6, -1], to: [1.03, -0.4, 0.8] },
];
const HOLD = 9.5, FADE = 3.2; // seconds on screen, crossfade

const CSS = `
#kage { position: fixed; inset: 0; z-index: 50; overflow: hidden; background: #03050a; color: #e8edf6;
  font-family: 'Shippori Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', serif; -webkit-font-smoothing: antialiased;
  transition: opacity 1.6s cubic-bezier(.4,0,.2,1), visibility 0s linear 0s; user-select: none; }
#kage.gone { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 1.6s cubic-bezier(.4,0,.2,1), visibility 0s linear 1.6s; }
#kage.tour { background: transparent; }
#kage .slides, #kage .fx { position: absolute; inset: 0; }
#kage .slide { position: absolute; inset: -2%; opacity: 0; transition: opacity ${FADE}s cubic-bezier(.45,0,.25,1); will-change: opacity; }
#kage .slide.on { opacity: 1; }
#kage .slide img { width: 100%; height: 100%; object-fit: cover; display: block; will-change: transform; transform-origin: 50% 45%;
  filter: saturate(1.06) contrast(1.04); }
#kage.tour .slides, #kage.tour .shade, #kage.tour .mist, #kage.tour .dust { opacity: 0; transition: opacity 1.4s ease; }
#kage .shade { position: absolute; inset: 0; pointer-events: none; transition: opacity 1.4s ease;
  background:
    radial-gradient(120% 85% at 50% 42%, rgba(3,5,10,0) 45%, rgba(3,5,10,.55) 82%, rgba(3,5,10,.9) 100%),
    linear-gradient(to bottom, rgba(3,5,12,.38) 0%, rgba(3,5,12,.12) 26%, rgba(3,5,12,0) 42%, rgba(3,5,12,0) 56%, rgba(3,5,10,.66) 80%, rgba(2,3,8,.94) 100%); }
#kage .mist { position: absolute; left: 0; right: 0; bottom: 0; height: 70%; pointer-events: none; mix-blend-mode: screen; opacity: .2;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 45%, #000 80%, transparent);
          mask-image: linear-gradient(to bottom, transparent, #000 45%, #000 80%, transparent);
  transition: opacity 1.4s ease; }
#kage .mist i { position: absolute; inset: 0 -100% 0 0; background-size: 50% 100%; background-repeat: repeat-x; }
#kage .mist i:nth-child(1) { animation: kage-drift 140s linear infinite; }
#kage .mist i:nth-child(2) { animation: kage-drift 90s linear infinite reverse; opacity: .6; transform: scaleY(-1); }
@keyframes kage-drift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
#kage .dust { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; transition: opacity 1.4s ease; }
#kage .grain { position: absolute; inset: -50%; pointer-events: none; opacity: .055; mix-blend-mode: overlay; animation: kage-grain .9s steps(5) infinite; }
@keyframes kage-grain { 0% { transform: translate(0,0); } 20% { transform: translate(-3%,2%); } 40% { transform: translate(2%,-3%); }
  60% { transform: translate(-1%,3%); } 80% { transform: translate(3%,1%); } 100% { transform: translate(0,0); } }

/* title */
#kage .title { position: absolute; left: 50%; top: 11.5vh; transform: translateX(-50%); text-align: center; pointer-events: none;
  transition: opacity 1.2s ease, transform 1.6s cubic-bezier(.2,.7,.2,1); }
#kage.tour .title, #kage.tour .menu, #kage.tour .foot, #kage.panel .menu { opacity: 0; pointer-events: none; }
#kage .title::before { content: ''; position: absolute; left: 50%; top: 46%; width: 190%; height: 260%; transform: translate(-50%, -50%); z-index: -1;
  background: radial-gradient(closest-side, rgba(3,5,12,.5), rgba(3,5,12,.28) 55%, rgba(3,5,12,0)); }
#kage .kanji { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -54%); font-size: clamp(160px, 30vh, 330px); font-weight: 400;
  color: rgba(170,190,230,.085); filter: blur(1.5px); letter-spacing: 0; line-height: 1; white-space: nowrap; }
#kage .name { position: relative; font-weight: 500; font-size: clamp(54px, 10.5vh, 124px); line-height: 1; letter-spacing: .62em;
  margin-right: -.62em; /* the tracking after the last letter */
  filter: drop-shadow(0 0 28px rgba(140,170,255,.2)) drop-shadow(0 2px 3px rgba(0,0,0,.7)); }
#kage .name span { display: inline-block; opacity: 0; transform: translateY(.14em); filter: blur(10px);
  background: linear-gradient(to bottom, #f7f9fd 18%, #cfd9ee 60%, #8a99b9 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: kage-letter 2.4s cubic-bezier(.2,.7,.2,1) forwards; }
@keyframes kage-letter { to { opacity: 1; transform: none; filter: blur(0); } }
#kage .rule { position: relative; margin: 2.6vh auto 0; width: min(380px, 46vw); height: 9px; opacity: 0; animation: kage-in 2s ease 1.6s forwards; }
#kage .rule::before, #kage .rule::after { content: ''; position: absolute; top: 4px; height: 1px; width: calc(50% - 16px);
  background: linear-gradient(to var(--d), rgba(232,237,246,0), rgba(232,237,246,.55)); }
#kage .rule::before { left: 0; --d: right; } #kage .rule::after { right: 0; --d: left; }
#kage .rule b { position: absolute; left: 50%; top: 0; width: 7px; height: 7px; margin-left: -3.5px; transform: rotate(45deg);
  background: #c8432f; box-shadow: 0 0 12px rgba(255,90,50,.55); }
#kage .sub { margin-top: 2.2vh; font-size: clamp(11px, 1.45vh, 14px); letter-spacing: .58em; margin-right: -.58em; text-transform: uppercase;
  color: rgba(226,233,246,.78); text-shadow: 0 0 10px rgba(3,5,12,.95), 0 0 22px rgba(3,5,12,.8), 0 1px 2px rgba(0,0,0,.9);
  opacity: 0; animation: kage-in 2s ease 2s forwards; }
#kage .sub em { font-style: normal; letter-spacing: .3em; color: rgba(220,228,244,.48); }
@keyframes kage-in { to { opacity: 1; } }

/* menu */
#kage .menu { position: absolute; left: 50%; bottom: 13vh; transform: translateX(-50%); display: flex; gap: clamp(28px, 6vw, 84px);
  transition: opacity .8s ease; }
#kage .menu button { all: unset; position: relative; cursor: pointer; padding: 10px 2px 14px; font-size: clamp(13px, 1.7vh, 16px); font-weight: 500;
  letter-spacing: .5em; margin-right: -.5em; color: rgba(226,232,244,.62); text-shadow: 0 1px 12px rgba(0,0,0,.9);
  opacity: 0; transform: translateY(10px); animation: kage-rise 1.4s cubic-bezier(.2,.7,.2,1) forwards;
  transition: color .5s ease, text-shadow .5s ease, letter-spacing .7s cubic-bezier(.2,.7,.2,1); }
#kage .menu button:nth-child(1) { animation-delay: 2.5s; } #kage .menu button:nth-child(2) { animation-delay: 2.7s; } #kage .menu button:nth-child(3) { animation-delay: 2.9s; }
@keyframes kage-rise { to { opacity: 1; transform: none; } }
#kage .menu button::after { content: ''; position: absolute; left: 50%; bottom: 4px; height: 1px; width: 0; transform: translateX(calc(-50% - .25em));
  background: linear-gradient(to right, rgba(200,67,47,0), rgba(214,90,64,.95), rgba(200,67,47,0)); transition: width .7s cubic-bezier(.2,.7,.2,1); }
#kage .menu button::before { content: ''; position: absolute; left: calc(50% - .25em); top: -6px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%;
  background: #e2694f; box-shadow: 0 0 10px #ff6a40; opacity: 0; transform: scale(.3); transition: opacity .5s ease, transform .5s ease; }
#kage .menu button:hover, #kage .menu button:focus-visible { color: #f7f9fd; text-shadow: 0 0 18px rgba(170,195,255,.45), 0 1px 12px rgba(0,0,0,.9); letter-spacing: .56em; }
#kage .menu button:hover::after, #kage .menu button:focus-visible::after { width: 120%; }
#kage .menu button:hover::before, #kage .menu button:focus-visible::before { opacity: 1; transform: none; }
#kage .menu button[disabled] { cursor: default; color: rgba(226,232,244,.3); }
#kage .menu button[disabled]:hover { letter-spacing: .5em; text-shadow: 0 1px 12px rgba(0,0,0,.9); }
#kage .menu button[disabled]:hover::after, #kage .menu button[disabled]:hover::before { width: 0; opacity: 0; }
#kage .loading { position: absolute; left: 50%; bottom: calc(13vh - 26px); transform: translateX(-50%); width: min(260px, 50vw); text-align: center;
  font-size: 10px; letter-spacing: .5em; text-transform: uppercase; color: rgba(220,228,244,.45); transition: opacity 1.2s ease; }
#kage .loading .bar { margin: 0 auto 8px; height: 1px; background: rgba(232,237,246,.12); overflow: hidden; }
#kage .loading .bar i { display: block; height: 100%; width: 0; background: linear-gradient(to right, rgba(232,237,246,.2), rgba(232,237,246,.8));
  transition: width .6s ease; }
#kage.ready .loading { opacity: 0; }

/* place card and slide counter */
#kage .foot { position: absolute; left: 0; right: 0; bottom: 0; height: 0; transition: opacity .8s ease; }
#kage .place, #kage .tourplace { position: absolute; left: clamp(22px, 3.4vw, 54px); bottom: clamp(22px, 4.2vh, 46px); display: flex; align-items: baseline; gap: 14px;
  transition: opacity 1.4s ease, transform 1.4s cubic-bezier(.2,.7,.2,1); }
#kage .place.out, #kage .tourplace.out { opacity: 0; transform: translateY(6px); }
#kage .place .jp, #kage .tourplace .jp { font-size: 15px; letter-spacing: .25em; color: rgba(236,240,248,.82); writing-mode: horizontal-tb; }
#kage .place .en, #kage .tourplace .en { font-size: 10px; letter-spacing: .42em; text-transform: uppercase; color: rgba(220,228,244,.5); }
#kage .place::before, #kage .tourplace::before { content: ''; width: 3px; height: 3px; align-self: center; transform: rotate(45deg); background: #c8432f; }
#kage .count { position: absolute; right: clamp(22px, 3.4vw, 54px); bottom: clamp(26px, 4.6vh, 50px); display: flex; gap: 8px; }
#kage .count i { position: relative; width: 22px; height: 1px; background: rgba(232,237,246,.18); overflow: hidden; }
#kage .count i b { position: absolute; inset: 0; width: 0; background: rgba(232,237,246,.75); }
#kage .tourplace { display: none; }
#kage.tour .tourplace { display: flex; }
#kage .tourhint { position: absolute; right: clamp(22px, 3.4vw, 54px); bottom: clamp(26px, 4.6vh, 50px); font-size: 10px; letter-spacing: .45em;
  text-transform: uppercase; color: rgba(220,228,244,.55); display: none; }
#kage.tour .tourhint { display: block; }
#kage .tourbars { position: absolute; inset: 0; pointer-events: none; display: none; }
#kage.tour .tourbars { display: block; }
#kage .tourbars::before, #kage .tourbars::after { content: ''; position: absolute; left: 0; right: 0; height: 7vh; background: #000; }
#kage .tourbars::before { top: 0; } #kage .tourbars::after { bottom: 0; }

/* settings */
#kage .settings { position: absolute; left: 50%; top: 52%; transform: translate(-50%, -46%); width: min(460px, 86vw); padding: 34px 38px 30px;
  background: linear-gradient(to bottom, rgba(10,14,24,.78), rgba(6,9,16,.86)); border: 1px solid rgba(232,237,246,.1);
  box-shadow: 0 30px 80px rgba(0,0,0,.6); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  opacity: 0; pointer-events: none; transition: opacity .6s ease, transform .8s cubic-bezier(.2,.7,.2,1); }
#kage.panel .settings { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%); }
#kage .settings h2 { margin: 0 0 26px; text-align: center; font-weight: 500; font-size: 13px; letter-spacing: .6em; margin-right: -.6em; color: rgba(236,240,248,.86); }
#kage .row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 11px 0; border-top: 1px solid rgba(232,237,246,.07); }
#kage .row > span { font-size: 11px; letter-spacing: .32em; text-transform: uppercase; color: rgba(220,228,244,.66); }
#kage .seg { display: flex; gap: 4px; }
#kage .seg button, #kage .back { all: unset; cursor: pointer; padding: 6px 10px; font-size: 10px; letter-spacing: .26em; text-transform: uppercase;
  color: rgba(220,228,244,.5); border: 1px solid transparent; transition: color .3s, border-color .3s, background .3s; }
#kage .seg button:hover, #kage .back:hover { color: #f2f5fa; }
#kage .seg button.on { color: #f2f5fa; border-color: rgba(214,90,64,.6); background: rgba(200,67,47,.12); }
#kage input[type=range] { -webkit-appearance: none; appearance: none; width: 150px; height: 1px; background: rgba(232,237,246,.25); outline: none; }
#kage input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 9px; height: 9px; transform: rotate(45deg); background: #d6604a; cursor: pointer; border: none; }
#kage input[type=range]::-moz-range-thumb { width: 9px; height: 9px; background: #d6604a; border: none; border-radius: 0; }
#kage .val { width: 34px; text-align: right; font-size: 11px; color: rgba(220,228,244,.6); }
#kage .back { display: block; margin: 22px auto 0; text-align: center; letter-spacing: .5em; }
body.kage-on #hud-prompt { opacity: 0 !important; }
#kage.gone *, #kage.tour .grain, #kage.tour .mist i { animation-play-state: paused !important; }
@media (max-width: 640px) { #kage .menu { flex-direction: column; align-items: center; gap: 6px; bottom: 9vh; } #kage .count { display: none; } }
@media (prefers-reduced-motion: reduce) { #kage .mist i, #kage .grain { animation: none; } }
`;

const SETTINGS_KEY = 'kage-settings';
export const DEFAULT_SETTINGS = { quality: 'balanced', sensitivity: 1, invertY: false, master: 0.8, music: 0.7, world: 0.85 };
export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode: settings last for this visit */
  }
}

export function createTitle({ onStart, onExplore, onSettings, base = import.meta.env.BASE_URL }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'kage';
  root.innerHTML = `
    <div class="slides"></div>
    <div class="fx">
      <div class="mist"><i></i><i></i></div>
      <canvas class="dust"></canvas>
      <div class="shade"></div>
      <div class="grain"></div>
    </div>
    <div class="tourbars"></div>
    <div class="title">
      <div class="kanji">影</div>
      <div class="name">${[...'KAGE'].map((c, i) => `<span style="animation-delay:${0.35 + i * 0.22}s">${c}</span>`).join('')}</div>
      <div class="rule"><b></b></div>
      <div class="sub">The village of shadows <em>· 影の里</em></div>
    </div>
    <nav class="menu">
      <button data-act="start" disabled>START</button>
      <button data-act="explore" disabled>EXPLORE</button>
      <button data-act="settings">SETTINGS</button>
    </nav>
    <div class="loading"><div class="bar"><i></i></div>Preparing the valley</div>
    <div class="foot">
      <div class="place out"><span class="jp"></span><span class="en"></span></div>
      <div class="count">${SLIDES.map(() => '<i><b></b></i>').join('')}</div>
    </div>
    <div class="tourplace out"><span class="jp"></span><span class="en"></span></div>
    <div class="tourhint">Esc · return</div>
    <div class="settings">
      <h2>SETTINGS</h2>
      <div class="row"><span>Image</span><div class="seg" data-key="quality">
        <button data-v="performance">Swift</button><button data-v="balanced">Balanced</button><button data-v="cinematic">Cinematic</button></div></div>
      <div class="row"><span>Look speed</span><div style="display:flex;align-items:center;gap:12px">
        <input type="range" min="0.4" max="2" step="0.05" data-key="sensitivity"><span class="val"></span></div></div>
      <div class="row"><span>Invert look</span><div class="seg" data-key="invertY"><button data-v="false">Off</button><button data-v="true">On</button></div></div>
      <div class="row"><span>Volume</span><div style="display:flex;align-items:center;gap:12px">
        <input type="range" min="0" max="1" step="0.01" data-key="master"><span class="val"></span></div></div>
      <div class="row"><span>Music</span><div style="display:flex;align-items:center;gap:12px">
        <input type="range" min="0" max="1" step="0.01" data-key="music"><span class="val"></span></div></div>
      <div class="row"><span>World</span><div style="display:flex;align-items:center;gap:12px">
        <input type="range" min="0" max="1" step="0.01" data-key="world"><span class="val"></span></div></div>
      <button class="back">BACK</button>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('kage-on'); // (the game's own prompts stay hidden meanwhile)
  const $ = (s) => root.querySelector(s);

  // ---- slides: the first loads at once, each next one while the current is showing
  const big = innerWidth * Math.min(devicePixelRatio, 2) > 1500;
  const slidesEl = $('.slides');
  const slides = SLIDES.map((s) => {
    const el = document.createElement('div');
    el.className = 'slide';
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    el.appendChild(img);
    slidesEl.appendChild(el);
    return { ...s, el, img, loaded: null };
  });
  const load = (s) => (s.loaded ??= new Promise((res) => {
    s.img.onload = s.img.onerror = res;
    s.img.src = `${base}title/${s.file}${big ? '' : '-sm'}.jpg`;
  }));
  const counts = [...root.querySelectorAll('.count b')];
  let current = -1, timer = 0, anim = null, running = true;

  function setPlace(el, name) {
    el.classList.add('out');
    setTimeout(() => {
      if (!name) return;
      el.querySelector('.jp').textContent = name[0];
      el.querySelector('.en').textContent = name[1];
      el.classList.remove('out');
    }, 700);
  }
  async function showSlide(i) {
    const s = slides[i];
    await load(s);
    const prev = slides[current];
    current = i;
    // a slow drift: scale and pan from one framing to another (per slide), longer than
    // its time on screen so it is still moving as it dissolves
    s.anim?.cancel();
    const [a, b] = [s.from, s.to];
    s.anim = s.img.animate(
      [{ transform: `scale(${a[0]}) translate(${a[1]}%, ${a[2]}%)` }, { transform: `scale(${b[0]}) translate(${b[1]}%, ${b[2]}%)` }],
      { duration: (HOLD + FADE * 2) * 1000, easing: 'cubic-bezier(.35,0,.65,1)', fill: 'forwards' },
    );
    s.img.style.transformOrigin = s.origin ?? '50% 45%';
    s.el.classList.add('on');
    if (prev && prev !== s) prev.el.classList.remove('on');
    setPlace($('.place'), [s.jp, s.en]);
    counts.forEach((c, k) => {
      c.getAnimations().forEach((x) => x.cancel());
      c.style.width = k < i ? '100%' : '0';
    });
    anim = counts[i].animate([{ width: '0%' }, { width: '100%' }], { duration: (HOLD + FADE) * 1000, fill: 'forwards', easing: 'linear' });
    load(slides[(i + 1) % slides.length]);
    clearTimeout(timer);
    if (running) timer = setTimeout(() => showSlide((current + 1) % slides.length), (HOLD + FADE) * 1000);
  }
  showSlide(0);

  // ---- mist texture: soft blobs on a canvas, tiled and drifting
  {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 320;
    const g = c.getContext('2d');
    let seed = 3;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 140; k++) {
      const x = r() * 1024, y = 120 + r() * 200, rad = 40 + r() * 150;
      for (const dx of [-1024, 0, 1024]) {
        const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
        gr.addColorStop(0, `rgba(200,215,240,${0.05 + r() * 0.06})`);
        gr.addColorStop(1, 'rgba(200,215,240,0)');
        g.fillStyle = gr;
        g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
      }
    }
    const url = c.toDataURL();
    root.querySelectorAll('.mist i').forEach((i) => (i.style.backgroundImage = `url(${url})`));
  }
  // ---- film grain
  {
    const c = document.createElement('canvas');
    c.width = c.height = 180;
    const g = c.getContext('2d');
    const d = g.createImageData(180, 180);
    for (let k = 0; k < d.data.length; k += 4) {
      const v = Math.random() * 255;
      d.data[k] = d.data[k + 1] = d.data[k + 2] = v;
      d.data[k + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    $('.grain').style.backgroundImage = `url(${c.toDataURL()})`;
  }
  // ---- dust: a few slow motes of moonlit dust and the odd warm ember
  const dust = $('.dust');
  const dctx = dust.getContext('2d');
  const motes = Array.from({ length: 46 }, (_, k) => ({
    x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, ph: Math.random() * 6.28, warm: k % 9 === 0,
  }));
  let last = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = (dust.width = dust.clientWidth), h = (dust.height = dust.clientHeight);
    dctx.clearRect(0, 0, w, h);
    for (const m of motes) {
      m.x += (0.004 + 0.006 * m.z) * dt * (m.warm ? -0.6 : 1);
      m.y -= (0.002 + 0.007 * m.z) * dt * (m.warm ? 1.6 : 1);
      if (m.y < -0.05) m.y = 1.05;
      if (m.x > 1.05) m.x = -0.05;
      if (m.x < -0.05) m.x = 1.05;
      const tw = 0.5 + 0.5 * Math.sin(now / 1000 * (0.6 + m.z) + m.ph);
      const a = (m.warm ? 0.5 : 0.28) * tw * m.z;
      const r = (m.warm ? 1.4 : 1.0) * (0.6 + m.z * 1.2);
      dctx.fillStyle = m.warm ? `rgba(255,150,90,${a})` : `rgba(205,220,255,${a})`;
      dctx.shadowColor = m.warm ? 'rgba(255,120,60,.8)' : 'rgba(180,200,255,.6)';
      dctx.shadowBlur = m.warm ? 8 : 4;
      dctx.beginPath();
      dctx.arc(m.x * w, m.y * h, r, 0, 6.2832);
      dctx.fill();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- menu
  const buttons = [...root.querySelectorAll('.menu button')];
  root.querySelector('.menu').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act || e.target.closest('button').disabled) return;
    if (act === 'start') onStart?.();
    else if (act === 'explore') onExplore?.();
    else if (act === 'settings') root.classList.add('panel');
  });
  addEventListener('keydown', (e) => {
    if (root.classList.contains('gone') && !root.classList.contains('tour')) return;
    if (e.code === 'Escape' && root.classList.contains('panel')) root.classList.remove('panel');
    if (root.classList.contains('panel') || root.classList.contains('tour')) return;
    const enabled = buttons.filter((b) => !b.disabled);
    const k = enabled.indexOf(document.activeElement);
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown') enabled[(k + 1) % enabled.length].focus();
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') enabled[(k - 1 + enabled.length) % enabled.length].focus();
  });

  // ---- settings
  const settings = loadSettings();
  const sync = () => {
    root.querySelectorAll('.seg').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(settings[seg.dataset.key]) === b.dataset.v));
    });
    root.querySelectorAll('input[type=range]').forEach((range) => {
      const k = range.dataset.key, v = Number(settings[k]);
      range.value = v;
      range.nextElementSibling.textContent = k === 'sensitivity' ? `${v.toFixed(2)}×` : `${Math.round(v * 100)}`;
    });
  };
  root.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const key = seg.dataset.key;
    settings[key] = key === 'invertY' ? b.dataset.v === 'true' : b.dataset.v;
    sync();
    saveSettings(settings);
    onSettings?.(settings);
  }));
  root.querySelectorAll('input[type=range]').forEach((range) => range.addEventListener('input', (e) => {
    settings[range.dataset.key] = Number(e.target.value);
    sync();
    saveSettings(settings);
    onSettings?.(settings);
  }));
  $('.back').addEventListener('click', () => root.classList.remove('panel'));
  sync();

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) {
      last = performance.now();
      requestAnimationFrame(frame);
      showSlide((current + 1) % slides.length);
    } else clearTimeout(timer);
  }

  return {
    root,
    settings,
    // true while the title fully hides the game (the 3D view can idle)
    get covering() {
      return !root.classList.contains('gone') && !root.classList.contains('tour');
    },
    progress(p) {
      $('.loading .bar i').style.width = `${Math.round(Math.min(1, p) * 100)}%`;
    },
    ready() {
      this.progress(1);
      root.classList.add('ready');
      buttons.forEach((b) => (b.disabled = false));
    },
    // 'live': fade out to the game (via the hero shot, which is the game's opening
    // framing); 'tour': keep only the flyover overlay
    hide(mode = 'live') {
      root.classList.remove('panel');
      if (mode === 'tour') {
        root.classList.add('tour');
        setRunning(false);
        return;
      }
      if (current !== 0) showSlide(0);
      setTimeout(() => {
        root.classList.add('gone');
        document.body.classList.remove('kage-on');
        setTimeout(() => setRunning(false), 1700);
      }, current !== 0 ? 900 : 150);
    },
    show() {
      root.classList.remove('gone', 'tour');
      document.body.classList.add('kage-on');
      setPlace($('.tourplace'), null);
      setRunning(true);
    },
    place(name) {
      const el = $('.tourplace');
      const key = name ? name[1] : '';
      if (el.dataset.key === key) return;
      el.dataset.key = key;
      setPlace(el, name);
    },
  };
}
