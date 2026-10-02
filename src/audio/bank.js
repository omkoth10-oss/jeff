import { rng, white, pink, brown, filter, normalize, add, curve, renderOffline, bufferFrom, loopify, loopifyArray, yieldFrame } from './dsp.js';

// Every sound in KAGE, synthesised once at startup (original, no recordings): looping
// beds (wind, pine-needle rustle, three kinds of insects, river, waterfall, torch fire),
// footsteps for five surfaces, night creatures (owl, the thin whistle of a White's
// thrush, kajika frogs), village sounds (wind chimes, timber creaks, a sliding shoji,
// the night watch's clappers), a temple bell, a fish jumping, a jump's whoosh, koto-like
// plucked strings for the music and the reverb's impulse response. Beds render in
// OfflineAudioContexts (off the main thread); the rest is short JS synthesis, done in
// small pieces so the page keeps drawing.
//
// Each bed is many seconds long and folded into a seamless loop; insects come as three
// loops of unrelated lengths, so the texture never repeats as a whole. One-shots come in
// several variants, and are further varied in pitch and level when played.

const SURFACES = ['stone', 'dirt', 'grass', 'wood', 'water'];

export async function createBank(ctx, onProgress = () => {}) {
  const r = rng(20261001);
  const bank = { steps: {}, lands: {}, events: {}, plucks: new Map() };
  const jobs = [
    ['wind', async () => (bank.wind = await windBed(ctx, r))],
    ['leaves', async () => (bank.leaves = await leavesBed(ctx, r))],
    ['river', async () => (bank.river = await riverBed(ctx, r))],
    ['waterfall', async () => (bank.waterfall = await waterfallBed(ctx, r))],
    ['fire', () => (bank.fire = fireBed(ctx, r))],
    ['insects', () => (bank.insects = insectBeds(ctx, r))],
    ['steps', () => {
      for (const s of SURFACES) {
        bank.steps[s] = Array.from({ length: 6 }, () => bufferFrom(ctx, [step(s, r, 0)], 24000));
        bank.lands[s] = Array.from({ length: 2 }, () => bufferFrom(ctx, [step(s, r, 1)], 24000));
      }
    }],
    ['creatures', () => {
      bank.events.owl = [owl(r, 0), owl(r, 1)].map((a) => bufferFrom(ctx, [a], 22050));
      bank.events.thrush = [thrush(r, 0), thrush(r, 1)].map((a) => bufferFrom(ctx, [a], 22050));
      bank.events.frog = [frog(r), frog(r), frog(r)].map((a) => bufferFrom(ctx, [a], 22050));
      bank.events.splash = [splash(r), splash(r)].map((a) => bufferFrom(ctx, [a], 22050));
    }],
    ['village', () => {
      bank.events.chime = [chime(r), chime(r), chime(r)].map((a) => bufferFrom(ctx, [a], 32000));
      bank.events.creak = [creak(r), creak(r), creak(r)].map((a) => bufferFrom(ctx, [a], 22050));
      bank.events.shoji = [shoji(r), shoji(r)].map((a) => bufferFrom(ctx, [a], 22050));
      bank.events.clappers = [bufferFrom(ctx, [clappers(r)], 22050)];
      bank.events.whoosh = [whoosh(r), whoosh(r)].map((a) => bufferFrom(ctx, [a], 22050));
    }],
    ['bell', () => (bank.events.bell = [bufferFrom(ctx, [bell(r)], 16000)])],
    ['reverb', () => (bank.reverb = impulse(ctx, r))],
    ['noise', () => (bank.breath = bufferFrom(ctx, [white(22050 * 2, r)], 22050))],
  ];
  bank.timings = {};
  for (let i = 0; i < jobs.length; i++) {
    const t0 = performance.now();
    await jobs[i][1]();
    bank.timings[jobs[i][0]] = Math.round(performance.now() - t0);
    onProgress((i + 1) / jobs.length);
    await yieldFrame();
  }
  // koto-like plucks, made on demand by the music and kept
  bank.pluck = (freq) => {
    const k = Math.round(freq * 10);
    if (!bank.plucks.has(k)) bank.plucks.set(k, bufferFrom(ctx, [pluck(freq, r)], 22050));
    return bank.plucks.get(k);
  };
  return bank;
}

// ---------------------------------------------------------------- beds

async function windBed(ctx, r) {
  // low wind over the mountains: brown noise, the lowpass opening in slow gusts
  const sr = 8000, L = 46, X = 4, T = L + X;
  const gust = curve(T * 4, r, 0, 1, { fMin: 3, fMax: 14, parts: 5, gamma: 1.8 });
  const buf = await renderOffline(T, sr, 2, (oc) => {
    const m = oc.createChannelMerger(2);
    m.connect(oc.destination);
    for (let c = 0; c < 2; c++) {
      const s = oc.createBufferSource();
      s.buffer = bufferFrom(oc, [normalize(brown(T * sr, r), 0.9)], sr);
      const lp = oc.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.8;
      lp.frequency.setValueCurveAtTime(gust.map((g) => 110 + 420 * g), 0, T);
      const g = oc.createGain();
      g.gain.setValueCurveAtTime(gust.map((g2, i) => 0.35 + 0.65 * (0.85 * g2 + 0.15 * Math.sin(i * 0.37 + c))), 0, T);
      s.connect(lp).connect(g).connect(m, 0, c);
      s.start();
    }
  });
  return loopify(ctx, buf, L, X);
}

async function leavesBed(ctx, r) {
  // wind in pine needles and leaves: high, airy, rustling with the gusts
  const sr = 16000, L = 38, X = 3, T = L + X;
  const gust = curve(T * 40, r, 0, 1, { fMin: 4, fMax: 18, parts: 5, gamma: 2.2 });
  const flutter = curve(T * 40, r, 0.55, 1, { fMin: T * 2, fMax: T * 7, parts: 6 });
  const buf = await renderOffline(T, sr, 2, (oc) => {
    const m = oc.createChannelMerger(2);
    m.connect(oc.destination);
    for (let c = 0; c < 2; c++) {
      const s = oc.createBufferSource();
      s.buffer = bufferFrom(oc, [white(T * sr, r)], sr);
      const hp = oc.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1400;
      const lp = oc.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6500;
      const g = oc.createGain();
      g.gain.setValueCurveAtTime(gust.map((v, i) => (0.12 + 0.88 * v) * flutter[(i + c * 37) % flutter.length] * 0.5), 0, T);
      s.connect(hp).connect(lp).connect(g).connect(m, 0, c);
      s.start();
    }
  });
  return loopify(ctx, buf, L, X);
}

async function riverBed(ctx, r) {
  // flowing water: a pink-noise body, airy hiss, and countless small bubbles
  const sr = 16000, L = 37, X = 3, T = L + X;
  const bubbles = new Float32Array(T * sr);
  for (let t = 0; t < T; t += -Math.log(1 - r()) / 55) {
    const f0 = 380 * Math.pow(4.5, r()), dur = 0.012 + r() * 0.05, amp = Math.pow(r(), 2.2) * 0.5;
    const s0 = Math.floor(t * sr), n = Math.floor(dur * sr);
    let ph = 0;
    for (let i = 0; i < n && s0 + i < bubbles.length; i++) {
      const u = i / n;
      ph += (2 * Math.PI * f0 * (1 + 0.9 * u)) / sr;
      bubbles[s0 + i] += Math.sin(ph) * amp * Math.exp(-4 * u) * Math.min(1, i / 20);
    }
  }
  const swell = curve(T * 10, r, 0.7, 1, { fMin: 6, fMax: 30, parts: 5 });
  const buf = await renderOffline(T, sr, 1, (oc) => {
    const out = oc.createBiquadFilter();
    out.type = 'lowpass';
    out.frequency.value = 6000;
    out.connect(oc.destination);
    const body = oc.createBufferSource();
    body.buffer = bufferFrom(oc, [normalize(pink(T * sr, r))], sr);
    const bp = oc.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.55;
    const bg = oc.createGain();
    bg.gain.setValueCurveAtTime(swell.map((v) => v * 1.4), 0, T);
    body.connect(bp).connect(bg).connect(out);
    const hiss = oc.createBufferSource();
    hiss.buffer = bufferFrom(oc, [white(T * sr, r)], sr);
    const hp = oc.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 2400;
    hp.Q.value = 0.7;
    const hg = oc.createGain();
    hg.gain.value = 0.12;
    hiss.connect(hp).connect(hg).connect(out);
    const bub = oc.createBufferSource();
    bub.buffer = bufferFrom(oc, [bubbles], sr);
    bub.connect(out);
    for (const s of [body, hiss, bub]) s.start();
  });
  normalize(buf.getChannelData(0), 0.9);
  return loopify(ctx, buf, L, X);
}

async function waterfallBed(ctx, r) {
  // a falling river: dense broadband roar over a deep rumble, gently surging
  const sr = 16000, L = 22, X = 3, T = L + X;
  const surge = curve(T * 30, r, 0.82, 1, { fMin: T * 0.4, fMax: T * 3, parts: 6 });
  const buf = await renderOffline(T, sr, 1, (oc) => {
    const g = oc.createGain();
    g.gain.setValueCurveAtTime(surge, 0, T);
    g.connect(oc.destination);
    const roar = oc.createBufferSource();
    roar.buffer = bufferFrom(oc, [normalize(pink(T * sr, r))], sr);
    const lp = oc.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2800;
    lp.Q.value = 0.5;
    roar.connect(lp).connect(g);
    const rumble = oc.createBufferSource();
    rumble.buffer = bufferFrom(oc, [normalize(brown(T * sr, r))], sr);
    const lp2 = oc.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 150;
    const rg = oc.createGain();
    rg.gain.value = 1.6;
    rumble.connect(lp2).connect(rg).connect(g);
    const spray = oc.createBufferSource();
    spray.buffer = bufferFrom(oc, [white(T * sr, r)], sr);
    const bp = oc.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 0.4;
    const sg = oc.createGain();
    sg.gain.value = 0.18;
    spray.connect(bp).connect(sg).connect(g);
    for (const s of [roar, rumble, spray]) s.start();
  });
  normalize(buf.getChannelData(0), 0.9);
  return loopify(ctx, buf, L, X);
}

function fireBed(ctx, r) {
  // a torch: low breathy roar, flickering, with crackles and the odd pop
  const sr = 22050, L = 23, X = 1.5, n = Math.floor((L + X) * sr);
  const roar = filter(brown(n, r), 'lowpass', 260, 0.7, sr);
  const flick = curve(Math.ceil((L + X) * 8), r, 0.5, 1, { fMin: (L + X) * 1.5, fMax: (L + X) * 5, parts: 6 });
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = roar[i] * 0.35 * flick[Math.floor((i / n) * flick.length)];
  const cr = new Float32Array(n);
  for (let t = 0; t < L + X; t += -Math.log(1 - r()) / 6) {
    const pop = r() < 0.08;
    const clicks = 1 + Math.floor(r() * 4);
    for (let k = 0; k < clicks; k++) {
      const s0 = Math.floor((t + r() * 0.015) * sr), len = Math.floor((pop ? 3 : 0.4 + r() * 1.2) * sr / 1000);
      const amp = (pop ? 0.9 : 0.15 + 0.5 * Math.pow(r(), 2)) * (r() < 0.5 ? 1 : -1);
      for (let i = 0; i < len && s0 + i < n; i++) cr[s0 + i] += (r() * 2 - 1) * amp * (1 - i / len);
    }
  }
  filter(cr, 'highpass', 700, 0.7, sr);
  const ring = filter(cr.slice(), 'bandpass', 2600, 2.5, sr);
  add(o, cr, 0, 0.5);
  add(o, ring, 0, 0.8);
  return bufferFrom(ctx, [loopifyArray(normalize(o, 0.9), Math.floor(L * sr), Math.floor(X * sr))], sr);
}

function insectBeds(ctx, r) {
  const sr = 22050;
  const make = (len, fn) => {
    const n = Math.floor((len + 1) * sr), o = new Float32Array(n);
    fn(o, n);
    return bufferFrom(ctx, [loopifyArray(normalize(o, 0.9), Math.floor(len * sr), sr)], sr);
  };
  // field crickets: chirps of 3-4 pulses, now and then falling silent
  const field = make(19.7, (o, n) => {
    let t = r() * 0.5;
    const f0 = 4500 + r() * 300;
    while (t < n / sr) {
      if (r() < 0.06) t += 1.5 + r() * 3; // a pause
      const pulses = 3 + (r() < 0.4 ? 1 : 0), amp = 0.6 + 0.4 * r();
      for (let p = 0; p < pulses; p++) {
        const s0 = Math.floor((t + p * 0.034) * sr), len = Math.floor(0.017 * sr);
        let ph = 0;
        for (let i = 0; i < len && s0 + i < n; i++) {
          const u = i / len;
          ph += (2 * Math.PI * f0 * (1 - 0.012 * u)) / sr;
          o[s0 + i] += Math.sin(ph) * Math.sin(Math.PI * u) ** 2 * amp;
        }
      }
      t += 0.42 + r() * 0.3;
    }
  });
  // bell crickets: ringing trills, "riiin", in irregular bursts
  const bellC = make(23.3, (o, n) => {
    let t = r();
    const f0 = 4100 + r() * 200;
    while (t < n / sr) {
      const dur = 0.25 + r() * 0.4, amp = 0.5 + 0.5 * r(), s0 = Math.floor(t * sr), len = Math.floor(dur * sr);
      const am = 32 + r() * 8;
      let ph = 0;
      for (let i = 0; i < len && s0 + i < n; i++) {
        const tt = i / sr;
        ph += (2 * Math.PI * f0) / sr;
        const e = Math.min(1, tt / 0.03) * Math.min(1, (dur - tt) / 0.12);
        o[s0 + i] += Math.sin(ph) * Math.abs(Math.sin(Math.PI * am * tt)) * e * amp;
      }
      t += dur + 0.35 + r() * (r() < 0.2 ? 3 : 1.2);
    }
  });
  // a distant chorus: many trilling insects far off, softly swelling
  const chorus = make(17.9, (o, n) => {
    for (let k = 0; k < 7; k++) {
      const f0 = 2800 + r() * 2200, rate = 18 + r() * 40, swell = curve(64, r, 0.15, 1, { fMin: 2, fMax: 7 }), ph0 = r() * 6;
      let ph = 0;
      for (let i = 0; i < n; i++) {
        ph += (2 * Math.PI * f0) / sr;
        const s = swell[Math.floor((i / n) * 64)];
        o[i] += Math.sin(ph) * Math.max(0, Math.sin(2 * Math.PI * rate * (i / sr) + ph0)) ** 3 * s * 0.25;
      }
    }
    filter(o, 'lowpass', 5200, 0.7, sr);
  });
  return { field, bell: bellC, chorus };
}

// ---------------------------------------------------------------- footsteps

// one footfall (or a landing, heavy = 1) on a surface: heel, then the roll to the toes
function step(surface, r, heavy) {
  const sr = 24000, n = Math.floor(sr * (0.34 + 0.3 * heavy)), o = new Float32Array(n);
  const burst = (at, ms, amp, shape = 2) => {
    const s0 = Math.floor(at * sr), len = Math.floor((ms * sr) / 1000), b = new Float32Array(len);
    for (let i = 0; i < len; i++) b[i] = (r() * 2 - 1) * amp * Math.pow(1 - i / len, shape) * Math.min(1, i / 24);
    return [b, s0];
  };
  const put = ([b, s0], type, f, q) => add(o, type ? filter(b, type, f, q, sr) : b, s0);
  const thud = (at, f, ms, amp) => {
    const s0 = Math.floor(at * sr), len = Math.floor((ms * sr) / 1000);
    let ph = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      ph += (2 * Math.PI * f * (1 - 0.3 * (i / len))) / sr;
      o[s0 + i] += Math.sin(ph) * amp * Math.exp((-5 * i) / len) * Math.min(1, i / 40);
    }
  };
  const k = 1 + heavy * 0.8;
  const toe = 0.028 + r() * 0.04;
  for (const [at, a] of [[0, 1], [toe, 0.55]]) {
    if (surface === 'stone') {
      put(burst(at, 2.5, 0.9 * a * k, 3), 'highpass', 1800, 0.7);
      put(burst(at, 26, 0.7 * a * k), 'bandpass', 900 + r() * 700, 1.4);
      for (let g = 0; g < 4 + 8 * r(); g++) put(burst(at + r() * 0.04, 0.6, 0.25 * a * r()), 'bandpass', 3200, 1);
      thud(at, 85, 40, 0.35 * a * k);
    } else if (surface === 'dirt') {
      put(burst(at, 70 + 60 * heavy, 0.9 * a * k, 2.5), 'lowpass', 650, 0.8);
      for (let g = 0; g < 12 + 18 * r() + 20 * heavy; g++) put(burst(at + r() * 0.08, 0.5, (0.08 + 0.2 * r()) * a), 'bandpass', 2400 + r() * 1200, 0.9);
    } else if (surface === 'grass') {
      const sw = burst(at, 150, 0.6 * a * k, 1.5);
      for (let i = 0; i < Math.min(sw[0].length, 360); i++) sw[0][i] *= i / 360; // brushed, not struck
      put(sw, 'bandpass', 3200 + r() * 1200, 0.7);
      put(burst(at, 50, 0.5 * a * k), 'lowpass', 190, 0.8);
      for (let g = 0; g < 5 + 6 * r(); g++) put(burst(at + 0.01 + r() * 0.1, 0.4, 0.12 * a * r()), 'bandpass', 4200, 1);
    } else if (surface === 'wood') {
      thud(at, 105 + r() * 30, 80 + 40 * heavy, 0.9 * a * k);
      put(burst(at, 12, 0.8 * a * k, 2), 'bandpass', 330 + r() * 60, 7);
      put(burst(at, 9, 0.5 * a * k, 2), 'bandpass', 760 + r() * 120, 6);
      put(burst(at, 1.5, 0.35 * a * k, 3), 'highpass', 2000, 0.7);
    } else if (surface === 'water') {
      put(burst(at, 200 + 120 * heavy, 0.8 * a * k, 1.8), 'bandpass', 1300 + r() * 500, 0.6);
      put(burst(at, 160, 0.7 * a * k), 'lowpass', 320, 0.8);
      for (let g = 0; g < 6 + 10 * r(); g++) {
        const s0 = Math.floor((at + r() * 0.25) * sr), f0 = 500 * Math.pow(4, r()), len = Math.floor((0.01 + r() * 0.03) * sr), amp = 0.2 * r() * a;
        let ph = 0;
        for (let i = 0; i < len && s0 + i < n; i++) {
          ph += (2 * Math.PI * f0 * (1 + i / len)) / sr;
          o[s0 + i] += Math.sin(ph) * amp * (1 - i / len);
        }
      }
    }
  }
  filter(o, 'lowpass', surface === 'stone' ? 7500 : 9000, 0.7, sr);
  filter(o, 'highpass', 60, 0.7, sr);
  return normalize(o, 0.9);
}

// ---------------------------------------------------------------- creatures

function tone(o, sr, at, dur, f, { glide = 0, vib = 0, vibRate = 5, amp = 1, attack = 0.08, release = 0.15, harm = 0, noise = 0, r }) {
  const s0 = Math.floor(at * sr), n = Math.floor(dur * sr);
  let ph = 0;
  for (let i = 0; i < n && s0 + i < o.length; i++) {
    const t = i / sr, u = i / n;
    const fi = f * (1 + glide * u) * (1 + vib * Math.sin(2 * Math.PI * vibRate * t));
    ph += (2 * Math.PI * fi) / sr;
    const e = Math.min(1, t / attack) * Math.min(1, (dur - t) / release);
    o[s0 + i] += (Math.sin(ph) + harm * Math.sin(2 * ph) + (noise ? noise * (r() * 2 - 1) : 0)) * e * amp;
  }
}

function owl(r, kind) {
  // "hoo ... ho-hoo": soft, round, a little breathy
  const sr = 22050, o = new Float32Array(sr * 3.4), f = 360 + r() * 50;
  const hoots = kind === 0 ? [[0, 0.55, 1], [1.25, 0.25, 0.8], [1.6, 0.6, 0.9]] : [[0, 0.75, 1], [1.35, 0.3, 0.75], [1.75, 0.3, 0.7], [2.15, 0.8, 0.85]];
  for (const [at, d, a] of hoots) tone(o, sr, at, d, f, { glide: -0.07, vib: 0.006, amp: a, attack: 0.07, release: d * 0.5, harm: 0.12, noise: 0.04, r });
  filter(o, 'lowpass', 1400, 0.7, sr);
  return normalize(o, 0.9);
}
function thrush(r, kind) {
  // the White's thrush: a thin, eerie whistle in the dark
  const sr = 22050, o = new Float32Array(sr * 2.2);
  if (kind === 0) tone(o, sr, 0.05, 1.6, 2380 + r() * 120, { glide: -0.035, vib: 0.002, vibRate: 7, attack: 0.35, release: 0.5, r });
  else tone(o, sr, 0.05, 1.5, 2050 + r() * 100, { glide: -0.11, vib: 0.002, vibRate: 6, attack: 0.25, release: 0.6, r });
  return normalize(o, 0.9);
}
function frog(r) {
  // a kajika frog: rising notes speeding into a trill ("fi fi fi firururu")
  const sr = 22050, o = new Float32Array(sr * 2.6);
  let t = 0.02;
  const notes = 3 + Math.floor(r() * 4), base = 1500 + r() * 300;
  for (let k = 0; k < notes; k++) {
    tone(o, sr, t, 0.07, base * (1 + 0.04 * k), { glide: 0.18, amp: 0.5 + 0.1 * k, attack: 0.01, release: 0.03, r });
    t += 0.24 - k * 0.025;
  }
  const trill = 8 + Math.floor(r() * 8);
  for (let k = 0; k < trill; k++) {
    tone(o, sr, t, 0.035, base * 1.35 * (1 - 0.01 * k), { glide: 0.1, amp: 0.9 - k * 0.03, attack: 0.006, release: 0.015, r });
    t += 0.05;
  }
  return normalize(o, 0.9);
}
function splash(r) {
  // a fish breaking the surface: a plop and falling droplets
  const sr = 22050, o = new Float32Array(sr * 0.9);
  tone(o, sr, 0, 0.07, 170 + r() * 60, { glide: 1.4, attack: 0.004, release: 0.05, r });
  const b = white(Math.floor(sr * 0.16), r).map((v, i, a) => v * Math.pow(1 - i / a.length, 2));
  add(o, filter(b, 'bandpass', 1300, 0.7, sr), 0, 0.7);
  for (let k = 0; k < 8; k++) tone(o, sr, 0.12 + r() * 0.5, 0.025, 900 * Math.pow(3, r()), { glide: 0.8, amp: 0.25 * r(), attack: 0.002, release: 0.015, r });
  return normalize(o, 0.9);
}

// ---------------------------------------------------------------- village

function chime(r) {
  // a glass wind chime (furin) struck by the breeze once to a few times
  const sr = 32000, o = new Float32Array(sr * 2.8), f0 = 2300 + r() * 600;
  const strikes = 1 + Math.floor(r() * 3);
  let t = 0;
  for (let s = 0; s < strikes; s++) {
    const a = s === 0 ? 1 : 0.35 + 0.4 * r();
    for (const [ratio, amp, dec] of [[1, 1, 1.9], [2.76, 0.45, 1.0], [5.4, 0.2, 0.55], [8.93, 0.08, 0.3]]) {
      const f = f0 * ratio;
      if (f > sr * 0.45) continue;
      const s0 = Math.floor(t * sr);
      let ph = r() * 6;
      for (let i = s0; i < o.length; i++) {
        ph += (2 * Math.PI * f) / sr;
        o[i] += Math.sin(ph) * amp * a * Math.exp(-((i - s0) / sr) / (dec * 0.4)) * Math.min(1, (i - s0) / 30);
      }
    }
    t += 0.12 + r() * 0.35;
  }
  return normalize(o, 0.9);
}
function creak(r) {
  // timber under strain: stick-slip ticks through the wood's resonances
  const sr = 22050, dur = 0.5 + r() * 0.5, n = Math.floor(sr * (dur + 0.2)), ex = new Float32Array(n);
  let t = 0;
  const r0 = 25 + r() * 15, r1 = 60 + r() * 50;
  while (t < dur) {
    const u = t / dur, rate = r0 + (r1 - r0) * Math.sin(Math.PI * u), s0 = Math.floor(t * sr), amp = Math.sin(Math.PI * u) * (0.6 + 0.4 * r());
    for (let i = 0; i < 40 && s0 + i < n; i++) ex[s0 + i] += (r() * 2 - 1) * amp * (1 - i / 40);
    t += 1 / rate;
  }
  const o = new Float32Array(n);
  add(o, filter(ex.slice(), 'bandpass', 380 + r() * 120, 8, sr), 0, 1);
  add(o, filter(ex.slice(), 'bandpass', 950 + r() * 200, 6, sr), 0, 0.6);
  add(o, filter(ex.slice(), 'bandpass', 1750, 5, sr), 0, 0.3);
  return normalize(o, 0.9);
}
function shoji(r) {
  // a paper screen sliding in its wooden track, then a soft tap as it closes
  const sr = 22050, dur = 0.45 + r() * 0.3, o = new Float32Array(Math.floor(sr * (dur + 0.25)));
  const fr = white(Math.floor(sr * dur), r), jitter = curve(64, r, 0.3, 1, { fMin: 6, fMax: 20 });
  for (let i = 0; i < fr.length; i++) fr[i] *= jitter[Math.floor((i / fr.length) * 64)] * Math.sin((Math.PI * i) / fr.length);
  add(o, filter(fr, 'bandpass', 1700, 1.1, sr), 0, 0.8);
  const tap = white(Math.floor(sr * 0.04), r).map((v, i, a) => v * (1 - i / a.length) ** 3);
  add(o, filter(tap, 'bandpass', 880, 6, sr), Math.floor(sr * dur), 1.2);
  return normalize(o, 0.9);
}
function clappers(r) {
  // the night watch's wooden clappers (hyoshigi): two sharp clacks
  const sr = 22050, o = new Float32Array(sr * 1.4);
  for (const [at, a] of [[0, 0.8], [0.62, 1]]) {
    const b = white(Math.floor(sr * 0.003), r);
    const ex = new Float32Array(Math.floor(sr * 0.2));
    ex.set(b);
    add(o, filter(ex.slice(), 'bandpass', 1650, 22, sr), Math.floor(at * sr), 3 * a);
    add(o, filter(ex.slice(), 'bandpass', 2650, 18, sr), Math.floor(at * sr), 2 * a);
    add(o, filter(ex.slice(), 'bandpass', 3900, 14, sr), Math.floor(at * sr), 1 * a);
  }
  return normalize(o, 0.9);
}
function whoosh(r) {
  // cloth through the air as he jumps
  const sr = 22050, n = Math.floor(sr * 0.32), o = white(n, r);
  for (let i = 0; i < n; i++) o[i] *= Math.sin((Math.PI * i) / n) ** 1.5;
  filter(o, 'bandpass', (i) => 450 + 1500 * (i / n), 1.2, sr);
  return normalize(o, 0.9);
}

function bell(r) {
  // a temple bell (bonsho) far away: low, inharmonic, slowly beating partials
  const sr = 16000, o = new Float32Array(sr * 9), f0 = 98 + r() * 8;
  const parts = [[0.5, 0.9, 9], [1, 0.8, 7.5], [1.006, 0.55, 7.5], [1.42, 0.45, 5], [1.98, 0.4, 4.2], [2.007, 0.3, 4.2], [2.72, 0.25, 3], [3.36, 0.18, 2.3], [4.1, 0.12, 1.7], [5.3, 0.07, 1.2]];
  for (const [ratio, amp, dec] of parts) {
    const f = f0 * ratio;
    let ph = r() * 6;
    for (let i = 0; i < o.length; i++) {
      ph += (2 * Math.PI * f) / sr;
      o[i] += Math.sin(ph) * amp * Math.exp(-(i / sr) / (dec * 0.45)) * Math.min(1, i / 200);
    }
  }
  const strike = filter(white(Math.floor(sr * 0.09), r).map((v, i, a) => v * (1 - i / a.length) ** 2), 'lowpass', 280, 0.8, sr);
  add(o, strike, 0, 1.5);
  return normalize(o, 0.9);
}

// ---------------------------------------------------------------- music

// a plucked string (Karplus-Strong with a fractional-delay tuning allpass), dark and soft
function pluck(freq, r, sr = 22050, dur = 3.2, t60 = 2.4) {
  const n = Math.floor(sr * dur), o = new Float32Array(n);
  // loop delay = ring length - 0.5 (the two-point average reading one ahead) + d (allpass)
  const P = sr / freq + 0.5, N = Math.floor(P), d = P - N, C = (1 - d) / (1 + d);
  const ring = new Float32Array(N);
  let prev = 0;
  for (let i = 0; i < N; i++) {
    const w = r() * 2 - 1;
    prev = prev + 0.45 * (w - prev); // a soft pluck: the excitation is lowpassed
    ring[i] = prev;
  }
  const loss = Math.pow(0.001, 1 / (t60 * freq));
  let idx = 0, apX = 0, apY = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const y = ring[idx];
    const nextIdx = (idx + 1) % ring.length;
    const avg = 0.5 * (y + ring[nextIdx]) * loss;
    const ap = C * avg + apX - C * apY; // tuning allpass
    apX = avg;
    apY = ap;
    ring[idx] = ap;
    idx = nextIdx;
    last += 0.6 * (y - last);
    o[i] = last * Math.min(1, i / 30);
  }
  return normalize(o, 0.8);
}

// the reverb: a dark, decaying stereo tail (about 3 s)
function impulse(ctx, r) {
  const sr = ctx.sampleRate, n = Math.floor(sr * 3.2), pre = Math.floor(sr * 0.022);
  const chans = [0, 1].map(() => {
    const o = new Float32Array(n);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const a = 0.85 - 0.75 * Math.min(1, t / 2.6); // darker as it dies away
      lp += a * ((r() * 2 - 1) - lp);
      o[i] = lp * Math.exp(-t / 0.5);
    }
    return normalize(o, 0.5);
  });
  return bufferFrom(ctx, chans, sr);
}
