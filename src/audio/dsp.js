// Small offline DSP toolkit for synthesising the game's sounds once at startup:
// seeded random numbers, noise colours, RBJ biquad filters run over Float32Arrays,
// random smooth control curves, seamless loop folding, and rendering node graphs in an
// OfflineAudioContext (which runs off the main thread).

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function white(n, r) {
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = r() * 2 - 1;
  return o;
}
export function pink(n, r) {
  const o = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    o[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }
  return o;
}
export function brown(n, r) {
  const o = new Float32Array(n);
  let b = 0;
  for (let i = 0; i < n; i++) {
    b = (b + 0.02 * (r() * 2 - 1)) / 1.02;
    o[i] = b * 3.5;
  }
  return o;
}

function coeffs(type, f, q, sr) {
  const w = (2 * Math.PI * Math.min(f, sr * 0.49)) / sr, cw = Math.cos(w), sw = Math.sin(w), a = sw / (2 * q);
  let b0, b1, b2;
  const a0 = 1 + a, a1 = -2 * cw, a2 = 1 - a;
  if (type === 'lowpass') [b0, b1, b2] = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
  else if (type === 'highpass') [b0, b1, b2] = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
  else [b0, b1, b2] = [a, 0, -a]; // bandpass, 0 dB at the centre
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
// filter x in place (type: lowpass | highpass | bandpass); f may be a function of the
// sample index for a sweep (coefficients updated every 32 samples)
export function filter(x, type, f, q, sr, from = 0, to = x.length) {
  let c = coeffs(type, typeof f === 'function' ? f(from) : f, q, sr);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = from; i < to; i++) {
    if (typeof f === 'function' && (i & 31) === 0) c = coeffs(type, f(i), q, sr);
    const v = x[i];
    const y = c[0] * v + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}
export function normalize(x, peak = 0.9) {
  let m = 1e-9;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  const k = peak / m;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}
export function add(dst, src, at = 0, gain = 1) {
  const n = Math.min(src.length, dst.length - at);
  for (let i = 0; i < n; i++) dst[at + i] += src[i] * gain;
  return dst;
}

// a random smooth curve over n points in [lo, hi]: summed slow sines (cycles over the
// curve between fMin and fMax), shaped by gamma (> 1 makes it peaky, like gusts)
export function curve(n, r, lo, hi, { fMin = 1, fMax = 8, parts = 4, gamma = 1 } = {}) {
  const c = new Float32Array(n);
  const waves = Array.from({ length: parts }, () => [fMin + r() * (fMax - fMin), r() * 6.283, 0.4 + r()]);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const [f, ph, a] of waves) v += Math.sin((i / n) * f * 6.283 + ph) * a;
    c[i] = v;
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
  }
  // (clamped: c was rounded to float32 after mn and mx were taken)
  for (let i = 0; i < n; i++) c[i] = lo + (hi - lo) * Math.pow(Math.min(1, Math.max(0, (c[i] - mn) / (mx - mn || 1))), gamma);
  return c;
}

// render a node graph offline: build(offlineContext) wires sources to its destination
export async function renderOffline(seconds, sr, channels, build) {
  const oc = new OfflineAudioContext(channels, Math.ceil(seconds * sr), sr);
  build(oc);
  return oc.startRendering();
}
export function bufferFrom(ctx, chans, sr) {
  const b = ctx.createBuffer(chans.length, chans[0].length, sr);
  chans.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}

// fold a rendered stretch of `loop + fade` seconds into a seamless loop of `loop`
// seconds: the tail crossfades (equal power) into the head
export function loopify(ctx, src, loop, fade) {
  const sr = src.sampleRate, L = Math.floor(loop * sr), X = Math.floor(fade * sr);
  const chans = [];
  for (let c = 0; c < src.numberOfChannels; c++) {
    const a = src.getChannelData(c), o = new Float32Array(L);
    o.set(a.subarray(0, L));
    for (let i = 0; i < X; i++) {
      const t = i / X;
      o[i] = a[i] * Math.sqrt(t) + a[L + i] * Math.sqrt(1 - t);
    }
    chans.push(o);
  }
  return bufferFrom(ctx, chans, sr);
}
export function loopifyArray(a, loopN, fadeN) {
  const o = a.slice(0, loopN);
  for (let i = 0; i < fadeN; i++) {
    const t = i / fadeN;
    o[i] = a[i] * Math.sqrt(t) + a[loopN + i] * Math.sqrt(1 - t);
  }
  return o;
}

// let the main thread breathe between pieces of synthesis
export const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
