import * as THREE from 'three';

// The moon tells the time. Four phases over the hour, each easing in from the one
// before (never a cut), carried by every part of the night's look: the moon disc, the
// moonlight and the sky fill, the sky dome and its clouds, the height fog, the mist
// banks, the moon's glints on the river, the colour grade, and the sound.
//
//   11:00  White Moon   the valley as it was built (the values are read from the live scene)
//   11:20  Silver Mist  the moon pales, the light turns silver, mist thickens over the river
//   11:40  Blood Moon   moon and moonlight shift to deep red; red haze, red glints on the water
//   11:55  Silence      the red moon darkens toward an eclipse, stars come out, music and
//                       ambient sound fade away
//
// Everything here is a uniform or a light value: changing phase costs nothing on the GPU.

// at: minutes past 11 PM; ramp: in-game minutes to ease all the way in
export const PHASES = [
  { name: 'white', at: 0, ramp: 0, values: {} },
  {
    name: 'silver', at: 20, ramp: 4,
    values: {
      moon: [1.75, 1.85, 2.05], moonLight: [0.74, 0.79, 0.86], moonLightI: 1.55, rim: [0.78, 0.82, 0.9], rimI: 0.5,
      hemiSky: [0.2, 0.26, 0.34], hemiI: 0.5,
      halo: [0.16, 0.19, 0.27], cloudLit: [0.15, 0.17, 0.21],
      fogColor: [0.078, 0.095, 0.122], fogGlow: [0.1, 0.115, 0.14], fogDensity: 0.0052,
      mistColor: [0.11, 0.135, 0.17], mistGlow: [0.13, 0.15, 0.19], spray: [0.21, 0.25, 0.31], riverMist: 1,
      waterMoon: [0.86, 0.9, 0.98], water: [0.96, 0.98, 1.0], shadow: [0.86, 0.95, 1.05], saturation: 0.9,
    },
  },
  {
    name: 'blood', at: 40, ramp: 3,
    values: {
      // (kept below the tone curve's shoulder, where a bright red would wash out to pink)
      moon: [1.45, 0.11, 0.06], moonLight: [0.95, 0.26, 0.17], moonLightI: 1.7, rim: [0.95, 0.3, 0.22], rimI: 0.55,
      hemiSky: [0.24, 0.06, 0.06], hemiGround: [0.035, 0.008, 0.01], hemiI: 0.42,
      horizon: [0.05, 0.011, 0.013], zenith: [0.009, 0.002, 0.004], halo: [0.42, 0.05, 0.03],
      cloudDark: [0.024, 0.006, 0.008], cloudLit: [0.22, 0.04, 0.03],
      fogColor: [0.085, 0.03, 0.033], fogGlow: [0.22, 0.05, 0.035], fogDensity: 0.0046,
      mistColor: [0.11, 0.04, 0.042], mistGlow: [0.2, 0.05, 0.035], spray: [0.2, 0.08, 0.08], riverMist: 0.75,
      waterMoon: [1.0, 0.24, 0.16], water: [1.0, 0.42, 0.36], shadow: [1.08, 0.86, 0.9], saturation: 1.1,
    },
  },
  {
    name: 'silence', at: 55, ramp: 4,
    values: {
      moon: [0.24, 0.025, 0.018], moonLightI: 0.6, rimI: 0.18, hemiI: 0.3,
      halo: [0.09, 0.014, 0.01], cloudLit: [0.07, 0.016, 0.014], stars: 1.9,
      fogGlow: [0.06, 0.016, 0.012], fogDensity: 0.004,
      mistGlow: [0.06, 0.016, 0.012], waterMoon: [0.3, 0.06, 0.04], water: [0.55, 0.24, 0.22], saturation: 0.86,
      hush: 1,
    },
    // the sound goes first: silent within two in-game minutes
    ramps: { hush: 2 },
  },
];

// The look's channels: a colour/vector (lerped in place) or a number ([object, key]).
// `targets` are the live objects from main.js; `onHush` receives the sound level (0..1).
export function createMoonPhases(clock, targets, { onHush } = {}) {
  const { moon, moonLight, rimLight, hemi, sky, fog, mist, water, post } = targets;
  const grade = post.grade.uniforms;
  const hush = { value: 0 };
  const channels = {
    moon: moon.material.color,
    moonLight: moonLight.color, moonLightI: [moonLight, 'intensity'],
    rim: rimLight.color, rimI: [rimLight, 'intensity'],
    hemiSky: hemi.color, hemiGround: hemi.groundColor, hemiI: [hemi, 'intensity'],
    horizon: sky.uniforms.uHorizon.value, zenith: sky.uniforms.uZenith.value, halo: sky.uniforms.uHalo.value,
    cloudDark: sky.uniforms.uCloudDark.value, cloudLit: sky.uniforms.uCloudLit.value, stars: [sky.uniforms.uStars, 'value'],
    fogColor: fog.uniforms.uFogColor.value, fogGlow: fog.uniforms.uFogGlow.value, fogDensity: [fog.uniforms.uFogDensity, 'value'],
    mistColor: mist.uniforms.uColor.value, mistGlow: mist.uniforms.uGlow.value, spray: mist.uniforms.uSpray.value,
    riverMist: [mist.uniforms.uRiverMist, 'value'],
    waterMoon: water.uniforms.uMoonTint.value, water: water.uniforms.uWaterTint.value,
    shadow: grade.get('uShadow').value, saturation: [grade.get('uSaturation'), 'value'],
    bloom: [post.bloom, 'intensity'],
    hush: [hush, 'value'],
  };

  // the White Moon is the scene as built: snapshot it, then turn every phase's values
  // into the channel's own type
  const keys = Object.keys(channels);
  const isNum = (k) => Array.isArray(channels[k]);
  const base = {}, work = {};
  for (const k of keys) {
    const c = channels[k];
    base[k] = isNum(k) ? c[0][c[1]] : c.clone();
    work[k] = isNum(k) ? base[k] : c.clone();
  }
  const prepare = (values) => {
    const out = {};
    for (const [k, v] of Object.entries(values)) {
      if (!(k in channels)) throw new Error(`moonPhases: unknown channel "${k}"`);
      out[k] = isNum(k) ? v : base[k].clone().fromArray(v);
    }
    return out;
  };
  const phases = PHASES.map((p) => ({ ...p, values: prepare(p.values) }));

  // phase events on the clock, so other systems can follow the moon
  let current = phases[0].name;
  for (const p of phases) {
    clock.at(p.at, (e) => {
      current = p.name;
      clock.emit('phase', { name: p.name, skipped: e.skipped });
    });
  }

  const ease = (x) => x * x * (3 - 2 * x);
  function blend(values, k, ramps, minutes, at) {
    for (const key in values) {
      let w = k;
      if (ramps?.[key] !== undefined) w = ease(THREE.MathUtils.clamp((minutes - at) / ramps[key], 0, 1));
      if (w <= 0) continue;
      if (isNum(key)) work[key] += (values[key] - work[key]) * w;
      else work[key].lerp(values[key], w);
    }
  }

  let lastMinutes = -1;
  return {
    phases,
    get phase() {
      return current;
    },
    // the look at `minutes`, with overlays ({ values, k }: the midnight pulse's flash)
    // laid over it; skipped while nothing changes
    apply(minutes, overlays = []) {
      const active = overlays.some((o) => o.k > 0);
      if (minutes === lastMinutes && !active) return;
      lastMinutes = active ? -1 : minutes; // (an overlay that ends must be cleared next frame)
      for (const k of keys) {
        if (isNum(k)) work[k] = base[k];
        else work[k].copy(base[k]);
      }
      for (const p of phases) {
        if (minutes <= p.at) continue;
        const k = p.ramp > 0 ? ease(THREE.MathUtils.clamp((minutes - p.at) / p.ramp, 0, 1)) : 1;
        blend(p.values, k, p.ramps, minutes, p.at);
      }
      for (const o of overlays) if (o.k > 0) blend(o.values, ease(Math.min(1, o.k)));
      for (const k of keys) {
        const c = channels[k];
        if (isNum(k)) c[0][c[1]] = work[k];
        else c.copy(work[k]);
      }
      onHush?.(hush.value);
    },
    // a phase-like set of values ({ channel: value }) for apply()'s overlays
    prepare,
  };
}
