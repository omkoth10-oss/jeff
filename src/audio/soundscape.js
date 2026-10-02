import { createBank } from './bank.js';
import { createMusic } from './music.js';
import { SAMPLES } from './samples.js';

// KAGE's sound. One AudioContext, a handful of always-running layers and short sounds
// that come and go:
//
//   beds      wind (stronger up high), wind in the pines (stronger in the trees), three
//             insect loops, the river (from its nearest point), both waterfalls (from
//             their plunge pools), and fire from the nearest torch
//   events    owls and a thrush's whistle in the forest, kajika frogs and a fish along
//             the river, wind chimes, creaking timber, a sliding screen and the night
//             watch's clappers in the village, a temple bell near the shrine and castle
//   player    footsteps on stone, earth, grass, wood or water, jumps and landings (from
//             the game: game.onEvent)
//   music     generative, sparse (music.js)
//
// Where the listener is decides the mix, re-evaluated ten times a second and always
// eased (setTargetAtTime, seconds), never switched: how many houses are near, how far
// the river, the falls and the nearest torch are, the trees around, the altitude, and
// whether it's the shrine or the castle court (quieter, more reverberant, the bell).
// Sources are panned by direction (equal-power panners, no HRTF) and their distance is
// modelled here: level, plus a lowpass that closes with distance (air absorption), so
// a distant fall is a soft rumble and a near one a roar. Loud water masks quieter
// layers, as it does outdoors.
//
// Modes: 'title' (heard from the ledge, music on, slightly muffled), 'tour' (from the
// flyover camera, music on), 'game' (from the player; the title music finishes its
// phrase and then music comes in sections between long stretches of night). Audio
// starts with the first click or key (browser autoplay rules) and pauses while the tab
// is hidden.

const smooth = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const SURFACE_GAIN = { stone: 0.55, dirt: 0.75, grass: 0.6, wood: 0.85, water: 1 };
const SHRINES = [[78, 9, -117, 26], [112, 30, -282, 34], [-87, 47, -171, 20]]; // shrine terrace, castle court, cliff torii

export function createSoundscape({ settings = {} } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });

  // ---- mixing graph
  const master = ctx.createGain();
  const tone = ctx.createBiquadFilter(); // muffled on the title, opens as the game starts
  tone.type = 'lowpass';
  tone.frequency.value = 3400;
  tone.Q.value = 0.5;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.3;
  master.connect(tone).connect(limiter).connect(ctx.destination);
  const reverb = ctx.createConvolver();
  reverb.connect(master);
  const worldVol = ctx.createGain(), worldSend = ctx.createGain(), musicVol = ctx.createGain(), musicSend = ctx.createGain();
  worldVol.connect(master);
  musicVol.connect(master);
  worldSend.connect(reverb);
  musicSend.connect(reverb);
  const worldMode = ctx.createGain(); // title: a little quieter
  worldMode.connect(worldVol);
  const worldModeSend = ctx.createGain();
  worldModeSend.connect(worldSend);

  function setVolumes(s = {}) {
    const v = (x, d) => Math.pow(Math.min(1, Math.max(0, x ?? d)), 2);
    const now = ctx.currentTime;
    master.gain.setTargetAtTime(v(s.master, 0.8) * 1.25, now, 0.05);
    musicVol.gain.setTargetAtTime(v(s.music, 0.7) * 1.4, now, 0.05);
    musicSend.gain.setTargetAtTime(v(s.music, 0.7) * 1.4, now, 0.05);
    worldVol.gain.setTargetAtTime(v(s.world, 0.85) * 1.4, now, 0.05);
    worldSend.gain.setTargetAtTime(v(s.world, 0.85) * 1.4, now, 0.05);
  }
  setVolumes(settings);

  // ---- starting (autoplay rules) and pausing with the tab
  let unlocked = false;
  const api = { ctx, forceRun: false, log: [] };
  const unlock = () => {
    unlocked = true;
    if (document.visibilityState === 'visible' || api.forceRun) ctx.resume();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (api.forceRun) return;
    if (document.visibilityState === 'hidden') ctx.suspend();
    else if (unlocked) ctx.resume();
  });

  // ---- sources
  const loop = (buffer, dest, rate = 1) => {
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(dest);
    s.start(0, Math.random() * buffer.duration);
    return s;
  };
  const gainNode = (v, dest) => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(dest);
    return g;
  };
  // a source somewhere in the world: level -> air absorption -> direction
  function spatial(sendLevel = 0) {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter(), pan = ctx.createPanner(), send = ctx.createGain();
    g.gain.value = 0;
    lp.type = 'lowpass';
    lp.frequency.value = 18000;
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'inverse';
    pan.rolloffFactor = 0; // distance is modelled by g and lp
    send.gain.value = sendLevel;
    g.connect(lp).connect(pan).connect(worldMode);
    pan.connect(send).connect(worldModeSend);
    return {
      input: g,
      send,
      set(pos, level, dist, now, tau = 0.6) {
        setPos(pan, pos, now);
        g.gain.setTargetAtTime(level, now, tau);
        lp.frequency.setTargetAtTime(Math.max(500, 17000 / (1 + dist / 30)), now, tau);
      },
    };
  }
  // glide = false: jump there (a new sound), true: slide there (a moving source)
  function setPos(pan, [x, y, z], now, glide = true) {
    if (!pan.positionX) return pan.setPosition(x, y, z);
    for (const [param, v] of [[pan.positionX, x], [pan.positionY, y], [pan.positionZ, z]]) {
      if (glide) param.setTargetAtTime(v, now, 0.08);
      else param.value = v;
    }
  }

  let bank = null, music = null, beds = null, world = null, mode = 'title', started = false;
  const zone = { village: 0, forest: 0.5, river: 0, falls: [], fire: 0, shrine: 0, alt: 0.6, bridge: 0, wading: 0 };
  const listener = { pos: [0, 50, 0], fwd: [0, 0, -1] };

  api.ready = createBank(ctx).then(async (b) => {
    bank = b;
    await loadSamples(ctx, bank);
    reverb.buffer = bank.reverb;
    music = createMusic(ctx, musicVol, musicSend, bank);
    const insectBus = gainNode(0, worldMode);
    beds = {
      wind: gainNode(0, worldMode),
      leaves: gainNode(0, worldMode),
      insects: insectBus,
      river: spatial(0.08),
      falls: [spatial(0.12), spatial(0.12)],
      fire: spatial(0.05),
    };
    loop(bank.wind, beds.wind);
    loop(bank.leaves, beds.leaves);
    for (const [buf, lvl, p] of [[bank.insects.field, 0.17, -0.55], [bank.insects.bell, 0.14, 0.6], [bank.insects.chorus, 0.3, 0.05]]) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = p;
      loop(buf, gainNode(lvl, sp));
      sp.connect(insectBus);
    }
    loop(bank.river, beds.river.input);
    loop(bank.waterfall, beds.falls[0].input, 1);
    loop(bank.waterfall, beds.falls[1].input, 1.18); // the smaller fall: higher, thinner
    loop(bank.fire, beds.fire.input);
    setMode(mode, true);
    started = true;
    return bank;
  });

  // ---- world (from the game, once loaded)
  api.attachWorld = ({ layout, village, torches = [], trunks = [] }) => {
    const rivers = [];
    for (const [key, w] of [['main', 1], ['upper', 1.25], ['stream2', 0.9]]) {
      for (const p of layout.rivers[key] ?? []) rivers.push([p[0], p[3] ?? 0, p[1], (p[2] ?? 6) / 2, w]);
    }
    // (each fall as loud as it is wide)
    const falls = layout.waterfalls.map((f) => [f.foot[0], f.foot[1] + (f.top[1] - f.foot[1]) * 0.25, f.foot[2], (f.widthTop ?? 8) / 2, Math.min(1, (f.widthTop ?? 8) / 13)]);
    const deck = village.bridgeDeck ?? [];
    world = {
      rivers, falls, deck,
      houses: village.houses.map((h) => [h.x, h.y, h.z]),
      torches: torches.map((t) => [t[0], t[1] + 1.6, t[2]]),
      trunks: trunks.map((t) => [t[0], t[2]]),
    };
  };

  // ---- the mix, from where the listener is
  function evaluate() {
    const [x, y, z] = listener.pos;
    if (!world) return;
    let vs = 0;
    for (const h of world.houses) {
      const d2 = (h[0] - x) ** 2 + (h[2] - z) ** 2;
      if (d2 < 3600) vs += Math.exp(-d2 / (2 * 15 * 15));
    }
    zone.village = 1 - Math.exp(-vs * 0.3);
    let ts = 0;
    for (const t of world.trunks) {
      const d2 = (t[0] - x) ** 2 + (t[1] - z) ** 2;
      if (d2 < 1600) ts += Math.exp(-d2 / 450);
    }
    zone.alt = smooth(y, 6, 55);
    zone.forest = Math.min(1, (1 - zone.village) * 0.65 + ts * 0.12 + zone.alt * 0.25);
    // river: nearest point of any channel
    let best = Infinity, bp = null, bw = 1;
    for (const p of world.rivers) {
      const d = Math.hypot(p[0] - x, p[2] - z) - p[3];
      if (d < best) {
        best = d;
        bp = p;
        bw = p[4];
      }
    }
    const dv = bp ? Math.abs(y - bp[1]) : 0;
    const dr = Math.max(0, best) + dv * 0.6;
    zone.river = bp ? Math.max(zone.wading, bw / (1 + Math.pow(dr / 7, 1.5))) : 0;
    zone.riverPoint = bp ? [bp[0], bp[1] + 0.3, bp[2]] : [x, y, z];
    zone.riverDist = dr;
    zone.falls = world.falls.map((f) => {
      const d = Math.max(0, Math.hypot(f[0] - x, f[1] - y, f[2] - z) - f[3]);
      return { g: f[4] / (1 + Math.pow(d / 22, 1.8)), d, pos: [f[0], f[1], f[2]] };
    });
    let fd = Infinity, fp = null;
    for (const t of world.torches) {
      const d = Math.hypot(t[0] - x, t[1] - y, t[2] - z);
      if (d < fd) {
        fd = d;
        fp = t;
      }
    }
    zone.fire = fp ? 1 / (1 + Math.pow(fd / 3.5, 2)) : 0;
    zone.firePos = fp ?? [x, y, z];
    zone.fireDist = fd;
    zone.shrine = Math.max(...SHRINES.map(([sx, sy, sz, rr]) => 1 - smooth(Math.hypot(sx - x, (sy - y) * 0.7, sz - z), rr * 0.5, rr)));
    zone.bridge = world.deck.length ? 1 - smooth(Math.min(...world.deck.map((p) => Math.hypot(p[0] - x, p[2] - z))), 4, 14) : 0;
  }

  function mix(now) {
    if (!beds) return;
    const fallsNear = Math.max(0, ...zone.falls.map((f) => f.g));
    const mask = 1 - 0.6 * smooth(fallsNear, 0.15, 0.7) - 0.25 * smooth(zone.river, 0.4, 1);
    const quiet = 1 - 0.4 * zone.shrine;
    const tau = 0.7;
    beds.wind.gain.setTargetAtTime((0.05 + 0.2 * zone.alt) * (1 - 0.3 * zone.shrine) * (0.6 + 0.4 * mask), now, tau);
    beds.leaves.gain.setTargetAtTime((0.02 + 0.07 * zone.forest + 0.05 * zone.alt) * mask * quiet, now, tau);
    beds.insects.gain.setTargetAtTime(
      (0.45 + 0.4 * zone.forest) * (1 - 0.55 * zone.alt) * (1 - 0.35 * zone.village) * quiet * mask, now, tau);
    // (at the plunge pool, the fall is the water you hear)
    beds.river.set(zone.riverPoint ?? listener.pos, 0.42 * zone.river * (1 - 0.65 * smooth(fallsNear, 0.2, 0.6)), zone.riverDist ?? 50, now);
    zone.falls.forEach((f, i) => beds.falls[i]?.set(f.pos, 1.15 * f.g, f.d, now));
    beds.fire.set(zone.firePos ?? listener.pos, 0.6 * zone.fire, zone.fireDist ?? 50, now, 0.4);
    // the shrine and castle court ring a little longer
    const send = 1 + 1.5 * zone.shrine;
    worldModeSend.gain.setTargetAtTime(send, now, 1);
  }

  // ---- events
  const EVENTS = {
    owl: { every: [26, 64], w: () => zone.forest * (1 - 0.7 * zone.village), far: [45, 110], up: 12, gain: 0.3, send: 0.6 },
    thrush: { every: [34, 85], w: () => (0.6 * zone.forest + 0.5 * zone.alt) * (1 - 0.6 * zone.village), far: [60, 140], up: 15, gain: 0.1, send: 0.7 },
    frog: { every: [9, 24], w: () => smooth(zone.river, 0.08, 0.5) * (1 - zone.alt), at: 'river', gain: 0.09, send: 0.3 },
    splash: { every: [30, 75], w: () => smooth(zone.river, 0.1, 0.6), at: 'river', gain: 0.13, send: 0.25 },
    chime: { every: [12, 32], w: () => zone.village, at: 'house', gain: 0.09, send: 0.35 },
    creak: { every: [11, 28], w: () => Math.max(zone.village * 0.8, zone.bridge), at: 'houseOrBridge', gain: 0.12, send: 0.25 },
    shoji: { every: [28, 70], w: () => zone.village, at: 'house', gain: 0.08, send: 0.25 },
    clappers: { every: [75, 160], w: () => 0.25 + 0.6 * zone.village, at: 'farHouse', gain: 0.17, send: 0.6 },
    bell: { every: [70, 150], w: () => 0.12 + 0.88 * zone.shrine, at: 'shrine', gain: 0.2, send: 0.85 },
  };
  const next = {};
  for (const [k, e] of Object.entries(EVENTS)) next[k] = rand(e.every[0] * 0.3, e.every[1] * 0.6);

  function placeEvent(e) {
    const [x, y, z] = listener.pos;
    const nearHouse = (min, max) => {
      if (!world) return null;
      const list = world.houses.filter((h) => {
        const d = Math.hypot(h[0] - x, h[2] - z);
        return d > min && d < max;
      });
      const h = list.length ? pick(list) : null;
      return h ? [h[0], h[1] + 2.5, h[2]] : null;
    };
    if (e.at === 'river') {
      if (!zone.riverPoint) return null;
      const a = Math.random() * 6.283, d = rand(2, 12);
      return [zone.riverPoint[0] + Math.cos(a) * d, zone.riverPoint[1], zone.riverPoint[2] + Math.sin(a) * d];
    }
    if (e.at === 'house') return nearHouse(4, 38);
    if (e.at === 'farHouse') return nearHouse(40, 120) ?? nearHouse(10, 200);
    if (e.at === 'houseOrBridge') {
      if (zone.bridge > 0.5 && world?.deck.length) {
        const p = pick(world.deck);
        return [p[0], p[1], p[2]];
      }
      return nearHouse(3, 30);
    }
    if (e.at === 'shrine') {
      const s = SHRINES.slice(0, 2).sort((a, b) => Math.hypot(a[0] - x, a[2] - z) - Math.hypot(b[0] - x, b[2] - z))[0];
      return [s[0], s[1] + 6, s[2]];
    }
    const a = Math.random() * 6.283, d = rand(...e.far);
    return [x + Math.cos(a) * d, y + e.up, z + Math.sin(a) * d];
  }

  function play(buffer, { pos = null, pan = 0, gain = 1, rate = 1, send = 0.2, dest = worldMode, sendDest = worldModeSend } = {}) {
    if (!buffer) return;
    const now = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    const g = ctx.createGain();
    let tail;
    if (pos) {
      const d = Math.hypot(pos[0] - listener.pos[0], pos[1] - listener.pos[1], pos[2] - listener.pos[2]);
      g.gain.value = gain / (1 + d / 18);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(600, 17000 / (1 + d / 28));
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.rolloffFactor = 0;
      setPos(p, pos, now, false);
      s.connect(g).connect(lp).connect(p);
      tail = p;
    } else {
      g.gain.value = gain;
      const sp = ctx.createStereoPanner();
      sp.pan.value = pan;
      s.connect(g).connect(sp);
      tail = sp;
    }
    tail.connect(dest);
    if (send > 0) {
      const sg = ctx.createGain();
      sg.gain.value = send;
      tail.connect(sg).connect(sendDest);
      s.onended = () => sg.disconnect();
    }
    s.start(now);
  }

  function events(now) {
    if (api.muteEvents) return;
    for (const [k, e] of Object.entries(EVENTS)) {
      if (now < next[k]) continue;
      next[k] = now + rand(...e.every);
      if (Math.random() > e.w()) continue;
      const pos = placeEvent(e);
      if (!pos) continue;
      play(pick(bank.events[k]), { pos, gain: e.gain * rand(0.75, 1.1), rate: rand(0.94, 1.06), send: e.send });
      api.log.push([k, +now.toFixed(1)]);
      if (api.log.length > 60) api.log.shift();
    }
  }

  // ---- the player (game.onEvent)
  api.handle = (e) => {
    if (!bank || ctx.state !== 'running') return;
    const shrineSend = 0.06 + 0.25 * zone.shrine;
    if (e.type === 'step') {
      const list = bank.steps[e.surface] ?? bank.steps.dirt;
      play(pick(list), {
        pan: e.side * 0.14, gain: 0.32 * SURFACE_GAIN[e.surface] * e.intensity * rand(0.82, 1.1), rate: rand(0.92, 1.08), send: shrineSend,
      });
    } else if (e.type === 'land') {
      const k = Math.min(1, Math.max(0.3, e.impact / 10));
      play(pick(bank.lands[e.surface] ?? bank.lands.dirt), { gain: 0.42 * SURFACE_GAIN[e.surface] * k, rate: rand(0.9, 1.02), send: shrineSend });
    } else if (e.type === 'jump') {
      play(pick(bank.events.whoosh), { gain: 0.07, rate: rand(0.9, 1.1), send: 0.05 });
      play(pick(bank.steps[e.surface] ?? bank.steps.dirt), { gain: 0.22 * SURFACE_GAIN[e.surface], rate: 1.1, send: shrineSend });
    }
  };

  // ---- modes
  function setMode(m, force = false) {
    if (m === mode && !force) return;
    mode = m;
    const now = ctx.currentTime;
    tone.frequency.cancelScheduledValues(now);
    tone.frequency.setTargetAtTime(m === 'title' ? 3400 : m === 'tour' ? 12000 : 19000, now, m === 'title' ? 0.8 : 1.4);
    worldMode.gain.setTargetAtTime(m === 'title' ? 0.75 : 1, now, 1.2);
    music?.setMode(m);
    // on the title, the bell rings once across the valley soon after the sound starts
    if (m === 'title') titleBell = now + rand(4, 8);
  }

  let acc = 0, titleBell = null;
  api.update = (dt, { mode: m, pos, fwd }) => {
    if (pos) listener.pos = pos;
    if (fwd) listener.fwd = fwd;
    if (!started) {
      mode = m;
      return;
    }
    if (m !== mode) setMode(m);
    const now = ctx.currentTime;
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = listener.pos[0];
      L.positionY.value = listener.pos[1];
      L.positionZ.value = listener.pos[2];
      L.forwardX.value = listener.fwd[0];
      L.forwardY.value = listener.fwd[1];
      L.forwardZ.value = listener.fwd[2];
    } else {
      L.setPosition(...listener.pos);
      L.setOrientation(...listener.fwd, 0, 1, 0);
    }
    acc += dt;
    if (acc < 0.1) return;
    acc = 0;
    if (ctx.state !== 'running') return;
    evaluate();
    mix(now);
    events(now);
    if (titleBell && now > titleBell) {
      titleBell = null;
      if (mode === 'title') play(bank.events.bell[0], { pos: [112, 36, -282], gain: 0.75, send: 0.9 });
    }
    music.update();
  };
  api.setWading = (w) => (zone.wading = w);
  api.setVolumes = setVolumes;
  api.zone = zone;
  // dev: levels at the output (dBFS RMS over ~0.2 s) and the mix targets
  let analyser = null;
  api.meter = () => {
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;
      limiter.connect(analyser);
    }
    const a = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(a);
    let s = 0, pk = 0;
    for (const v of a) {
      s += v * v;
      pk = Math.max(pk, Math.abs(v));
    }
    const db = (v) => +(20 * Math.log10(v + 1e-9)).toFixed(1);
    // each layer's level at the output (dBFS RMS, before panning and the tone filter)
    const rmsOf = (buf) => (buf.__rms ??= (() => {
      let t = 0, n = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i += 5) {
          t += d[i] * d[i];
          n++;
        }
      }
      return Math.sqrt(t / n);
    })());
    const out = worldMode.gain.value * worldVol.gain.value * master.gain.value;
    const layers = beds && {
      wind: db(rmsOf(bank.wind) * beds.wind.gain.value * out),
      leaves: db(rmsOf(bank.leaves) * beds.leaves.gain.value * out),
      insects: db(Math.hypot(rmsOf(bank.insects.field) * 0.17, rmsOf(bank.insects.bell) * 0.14, rmsOf(bank.insects.chorus) * 0.3) * beds.insects.gain.value * out),
      river: db(rmsOf(bank.river) * beds.river.input.gain.value * out),
      falls: db(rmsOf(bank.waterfall) * Math.hypot(beds.falls[0].input.gain.value, beds.falls[1].input.gain.value) * out),
      fire: db(rmsOf(bank.fire) * beds.fire.input.gain.value * out),
    };
    return {
      layers, tone: Math.round(tone.frequency.value), music: music?.mode,
      state: ctx.state, mode, rms: db(Math.sqrt(s / a.length)), peak: db(pk),
      beds: beds && Object.fromEntries(Object.entries({ wind: beds.wind.gain.value, leaves: beds.leaves.gain.value, insects: beds.insects.gain.value, river: beds.river.input.gain.value, fall0: beds.falls[0].input.gain.value, fall1: beds.falls[1].input.gain.value, fire: beds.fire.input.gain.value }).map(([k, v]) => [k, +v.toFixed(3)])),
      zone: Object.fromEntries(Object.entries(zone).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, +v.toFixed(2)])),
    };
  };
  return api;
}

// recordings named in samples.js replace the synthesised sounds (failures keep them)
async function loadSamples(ctx, bank) {
  const load = async (url) => ctx.decodeAudioData(await (await fetch(`${import.meta.env.BASE_URL}${url}`)).arrayBuffer());
  const many = async (v) => Promise.all((Array.isArray(v) ? v : [v]).map(load));
  const beds = { wind: 'wind', leaves: 'leaves', river: 'river', waterfall: 'waterfall', fire: 'fire' };
  for (const [key, url] of Object.entries(SAMPLES)) {
    if (!url) continue;
    try {
      if (beds[key]) bank[beds[key]] = (await many(url))[0];
      else if (key.startsWith('insects')) bank.insects[key.slice(7).toLowerCase()] = (await many(url))[0];
      else if (key.startsWith('step_')) bank.steps[key.slice(5)] = await many(url);
      else bank.events[key] = await many(url);
    } catch (err) {
      console.warn('[audio] could not load', url, err);
    }
  }
}
