// Dev-only: measures the soundscape where the player stands (the tab may be hidden, so
// this drives the game and the audio itself).
//   await app.audioTest.at('village', 47.5, -200)      teleport, settle 5 s, levels
//   await app.audioTest.walk([[x, z], ...], 'run')      walk a route, the mix over time
//   await app.audioTest.oneShots()                      peak level of each sound type
export function createAudioTest(app) {
  const a = app.audio;
  async function prepare() {
    a.forceRun = true;
    await a.ready;
    await a.ctx.resume();
    document.querySelector('#kage [data-act=start]')?.click();
    await new Promise((r) => setTimeout(r, 300));
  }
  async function run(secs, step = () => {}, until = () => false) {
    const t0 = performance.now(), rms = [], peaks = [];
    let last = t0;
    while (performance.now() - t0 < secs * 1000 && !until()) {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      step(dt);
      app.updateAudio(dt);
      await new Promise((r) => setTimeout(r, 50));
      const m = a.meter();
      rms.push(m.rms);
      peaks.push(m.peak);
    }
    const m = a.meter();
    return { rms: +(rms.reduce((s, v) => s + v, 0) / rms.length).toFixed(1), peak: Math.max(...peaks), layers: m.layers, zone: m.zone };
  }
  function place(x, z) {
    const g = app.game, { RAPIER, world } = g.physics;
    const h = world.castRay(new RAPIER.Ray({ x, y: 120, z }, { x: 0, y: -1, z: 0 }), 300, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, (8 << 16) | 1);
    g.player.teleport(new app.THREE.Vector3(x, h ? 120 - h.timeOfImpact : 0, z));
    g.state.driving = true;
  }
  return {
    prepare,
    async at(name, x, z, secs = 5) {
      place(x, z);
      const o = await run(secs, (dt) => app.tick(dt));
      const zz = o.zone;
      return [name, o.rms, o.peak, o.layers, { v: zz.village, f: zz.forest, r: zz.river, s: zz.shrine, alt: zz.alt }];
    },
    // each kind of one-shot played beside the listener: peak level at the output
    async oneShots() {
      const out = {};
      const peakFor = async (fn, ms = 900) => {
        let pk = -200;
        fn();
        const t0 = performance.now();
        while (performance.now() - t0 < ms) {
          await new Promise((r) => setTimeout(r, 30));
          pk = Math.max(pk, a.meter().peak);
        }
        return pk;
      };
      a.muteEvents = true;
      a.setVolumes({ master: 0.8, music: 0, world: 0.85 });
      await new Promise((r) => setTimeout(r, 1500));
      out.silenceFloor = await peakFor(() => {}, 600);
      for (const surface of ['stone', 'dirt', 'grass', 'wood', 'water']) {
        out['walk-' + surface] = await peakFor(() => a.handle({ type: 'step', surface, side: 1, intensity: 0.45 }), 400);
        out['run-' + surface] = await peakFor(() => a.handle({ type: 'step', surface, side: 1, intensity: 0.8 }), 400);
      }
      out.land = await peakFor(() => a.handle({ type: 'land', surface: 'stone', impact: 12 }), 600);
      a.muteEvents = false;
      a.setVolumes(app.settings ?? {});
      return out;
    },
    // walk a route (virtual stick toward each point), sampling the mix every 0.5 s
    async walk(points, gait = 'walk') {
      const g = app.game, inp = g.input.state;
      place(...points[0]);
      inp.virtual = { x: 0, y: 1, walk: gait === 'walk', sprint: gait === 'sprint' };
      let k = 1;
      const samples = [];
      let acc = 0, steps = 0;
      const prev = g.onEvent;
      g.onEvent = (e) => {
        if (e.type === 'step') steps++;
        prev?.(e);
      };
      await run(38, (dt) => {
        if (k >= points.length) return;
        const f = g.player.state.feet, [tx, tz] = points[k];
        if (Math.hypot(tx - f.x, tz - f.z) < 2) k++;
        g.rig.state.yaw = Math.atan2(-(tx - f.x), -(tz - f.z));
        app.tick(dt);
        acc += dt;
        if (acc > 0.5) {
          acc = 0;
          const m = a.meter();
          samples.push([+f.x.toFixed(0), +f.z.toFixed(0), m.rms, m.layers.river, m.layers.falls, m.layers.insects]);
        }
      }, () => k >= points.length);
      inp.virtual = null;
      g.onEvent = prev;
      return { steps, samples };
    },
  };
}
