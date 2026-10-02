// Dev-only: records the ninja's movement as contact sheets (a grid of frames taken at a
// fixed rate) for judging the procedural animation. Each scenario puts him somewhere,
// drives the virtual stick on a timed script, films him with a camera that follows at a
// fixed angle (side, three-quarter front or behind) and saves screenshots/motion-<name>.jpg.
// Studio lights and a grey outfit make the black-clad figure readable against the night.
//   await app.motion.record('run')          one scenario
//   await app.motion.all()                  every scenario
//   app.motion.scenarios                    the list
import * as THREE from 'three';

const H = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]); // heading from a to b (0 = +z)

export function createMotionSheet(app) {
  const { game, camera, THREE: T = THREE } = app;
  const { player } = game;
  const inp = game.input.state;

  // name: { at: [x, z], to: [x, z] (heading), script: [[time, stick]], from, to, every, view }
  // stick: { y: forward, x: right, walk, sprint, jump }; times in seconds from the start
  const scenarios = {
    idle: { at: [-37, -181], to: [-37, -160], script: [[0, {}]], from: 0.5, until: 12.5, every: 30, view: 'front' },
    walk: { at: [-37, -191], to: [-37, -160], script: [[0, { y: 1, walk: true }]], from: 2.0, until: 3.25, every: 3, view: 'side' },
    walkFront: { at: [-37, -191], to: [-37, -160], script: [[0, { y: 1, walk: true }]], from: 2.0, until: 3.25, every: 3, view: 'front' },
    run: { at: [-37, -191], to: [-37, -160], script: [[0, { y: 1 }]], from: 1.6, until: 2.4, every: 2, view: 'side' },
    runBack: { at: [-37, -186], to: [-37, -160], script: [[0, { y: 1 }]], from: 1.6, until: 2.4, every: 2, view: 'back' },
    sprint: { at: [-37, -191], to: [-37, -160], script: [[0, { y: 1, sprint: true }]], from: 1.8, until: 2.45, every: 2, view: 'side' },
    startStop: { at: [-37, -191], to: [-37, -160], script: [[0, {}], [0.5, { y: 1 }], [2.2, {}]], from: 0.4, until: 3.5, every: 6, view: 'side' },
    turn: { at: [-37, -181], to: [-37, -160], script: [[0, {}], [0.6, { y: -1, walk: true }], [0.75, {}]], from: 0.5, until: 2.3, every: 4, view: 'front' },
    stairsUp: { at: [77.2, -236.9], to: [88.8, -252.4], script: [[0, { y: 1, walk: true }]], from: 1.5, until: 2.75, every: 3, view: 'side' },
    stairsRun: { at: [77.2, -236.9], to: [88.8, -252.4], script: [[0, { y: 1 }]], from: 0.9, until: 1.7, every: 2, view: 'side' },
    stairsDown: { at: [88.3, -251.7], to: [78, -238], script: [[0, { y: 1, walk: true }]], from: 1.5, until: 2.75, every: 3, view: 'side' },
    slope: { at: [-9.7, -25.6], to: [-37.5, -36.8], script: [[0, { y: 1, walk: true }]], from: 1.5, until: 2.75, every: 3, view: 'side' },
    slopeUp: { at: [-34, -35.4], to: [-6, -24], script: [[0, { y: 1, walk: true }]], from: 1.5, until: 2.75, every: 3, view: 'side' },
    jump: { at: [-37, -181], to: [-37, -160], script: [[0, {}], [0.5, { jump: true }]], from: 0.45, until: 2.05, every: 2, view: 'side' },
    runJump: { at: [-37, -191], to: [-37, -160], script: [[0, { y: 1 }], [1.5, { y: 1, jump: true }]], from: 1.45, until: 2.6, every: 2, view: 'side' },
    fall: { at: [-37, -181], to: [-37, -160], drop: 5, script: [[0, {}]], from: 0, until: 1.8, every: 2, view: 'side', trackY: 0.5, tall: 3 },
    wade: { at: [4.5, -186], to: [-8, -186], script: [[0, { y: 1, walk: true }]], from: 1.0, until: 2.9, every: 5, view: 'front', camY: 1.1 },
  };

  const studio = {
    on(model) {
      this.amb = new T.AmbientLight(0xdfe6ff, 0.7);
      this.key = new T.DirectionalLight(0xffffff, 1.4);
      app.scene.add(this.amb, this.key, this.key.target);
      this.mats = [];
      model.traverse((o) => {
        if (o.isMesh) {
          this.mats.push([o.material, o.material.emissive.clone(), o.material.color.clone()]);
          o.material.emissive.setRGB(0.13, 0.135, 0.15);
          o.material.color.setRGB(2.2, 2.2, 2.3);
        }
      });
    },
    off() {
      app.scene.remove(this.amb, this.key, this.key.target);
      for (const [m, e, c] of this.mats) {
        m.emissive.copy(e);
        m.color.copy(c);
      }
    },
  };

  // studio: false films him as he looks in the game (black outfit, night lighting)
  async function record(name, { cols = 6, cell = [240, 320], quality = 0.85, studio: lit = true, suffix = '' } = {}) {
    const sc = scenarios[name];
    const dt = 1 / 60;
    const heading = H(sc.at, sc.to);
    // place him, standing, facing the way he'll go
    const g = game.physics.world.castRay(new game.physics.RAPIER.Ray({ x: sc.at[0], y: 80, z: sc.at[1] }, { x: 0, y: -1, z: 0 }), 200, true,
      game.physics.RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, (0x0008 << 16) | 0x0001);
    const y = 80 - (g?.timeOfImpact ?? 80) + (sc.drop ?? 0);
    player.teleport(new T.Vector3(sc.at[0], y, sc.at[1]));
    player.state.facing = heading;
    game.state.driving = true;
    game.rig.state.yaw = heading + Math.PI; // camera forward = heading
    inp.virtual = { x: 0, y: 0 };
    // settle (feet re-plant under him) unless he's meant to be falling
    if (!sc.drop) for (let i = 0; i < 30; i++) app.tick(dt);

    const model = game.ninjaModel;
    if (lit) studio.on(model);
    const fov = camera.fov;
    camera.fov = 30;
    camera.updateProjectionMatrix();
    const side = new T.Vector3(Math.cos(heading), 0, -Math.sin(heading)); // his left
    const fwd = new T.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const views = {
      side: side.clone().negate(), sideL: side.clone(), front: fwd.clone().multiplyScalar(0.8).addScaledVector(side, -0.6).normalize(),
      back: fwd.clone().negate().addScaledVector(side, -0.35).normalize(),
    };
    // the preferred view, or the first one with a clear line of sight to him (stairs run
    // between walls)
    // (rendered meshes: not everything that blocks the view is a collider)
    const caster = new T.Raycaster();
    caster.far = 5.2;
    caster.camera = camera;
    // (anything drawn that hides him, foliage included; not mist, glows or water)
    const solidHit = (hits) => hits.some((h) => h.object.isMesh && h.object.material.depthWrite !== false && !/water|mist|fall/i.test(h.object.name) && !game.ninjaModel.getObjectById(h.object.id));
    // checked from where he starts and from a few metres along his way
    const along = [0, 2, 4].map((k) => {
      const q = player.state.feet.clone().addScaledVector(fwd, k);
      const hit = game.physics.world.castRay(new game.physics.RAPIER.Ray({ x: q.x, y: q.y + 6, z: q.z }, { x: 0, y: -1, z: 0 }), 14, true,
        game.physics.RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, (0x0008 << 16) | 0x0001);
      if (hit) q.y += 6 - hit.timeOfImpact;
      return q;
    });
    const clear = (d) => along.every((q) => [0.3, 0.9, 1.5].every((h) => {
      caster.set(q.clone().add(new T.Vector3(0, h, 0)), d);
      return !solidHit(caster.intersectObjects(app.scene.children, true));
    }));
    const want = sc.view ?? 'side';
    const viewName = [want, ...{ side: ['sideL', 'back', 'front'], sideL: ['side', 'back'], front: ['side', 'sideL'], back: ['side', 'sideL'] }[want]].find((n) => clear(views[n])) ?? want;
    const dir = views[viewName];
    const focus = new T.Vector3(), camPos = new T.Vector3();
    const tall = sc.tall ?? 2.5; // metres of height in each frame
    const groundY = player.state.feet.y - (sc.drop ?? 0);
    const frames = [];
    const canvas = app.renderer.domElement;
    let t = 0, k = 0, si = 0, lastJump = -1;
    const endT = sc.until;
    focus.copy(player.state.feet);
    while (t <= endT + 1e-6) {
      while (si + 1 < sc.script.length && sc.script[si + 1][0] <= t + 1e-6) si++;
      const s = sc.script[si][1];
      inp.virtual.x = s.x ?? 0;
      inp.virtual.y = s.y ?? 0;
      inp.virtual.sprint = !!s.sprint;
      inp.virtual.walk = !!s.walk;
      if (s.jump && lastJump !== si) {
        inp.virtual.jump = true;
        lastJump = si;
      }
      app.tick(dt);
      // follow smoothly (a steady camera shows the bob), at hip height
      const f = player.state.feet;
      focus.x += (f.x - focus.x) * 0.25;
      focus.z += (f.z - focus.z) * 0.25;
      focus.y = sc.trackY ? Math.max(groundY + tall / 2 - 0.85, focus.y + (f.y - focus.y) * sc.trackY) : sc.tall ? groundY + tall / 2 - 0.85 : focus.y + (f.y - focus.y) * 0.08;
      if (t >= sc.from - 1e-6 && k % sc.every === 0) {
        camPos.copy(focus).addScaledVector(dir, 5.2 * (tall / 2.5));
        camPos.y = sc.camY ?? focus.y + 1.0;
        camera.position.copy(camPos);
        camera.lookAt(focus.x, focus.y + 0.85, focus.z);
        camera.updateMatrixWorld();
        if (lit) {
          studio.key.position.copy(camPos).addScaledVector(side, 3).add(new T.Vector3(0, 4, 0));
          studio.key.target.position.copy(focus);
        }
        app.render();
        // crop the middle: 2.5 m tall around him
        const hPx = canvas.height * (tall / (2 * 5.2 * (tall / 2.5) * Math.tan((15 * Math.PI) / 180)));
        const wPx = hPx * (cell[0] / cell[1]);
        const c = document.createElement('canvas');
        c.width = cell[0];
        c.height = cell[1];
        c.getContext('2d').drawImage(canvas, (canvas.width - wPx) / 2, (canvas.height - hPx) / 2 - hPx * 0.04, wPx, hPx, 0, 0, cell[0], cell[1]);
        frames.push({ c, t: t - sc.from, speed: player.state.speed, grounded: player.state.grounded });
      }
      if (t >= sc.from - 1e-6) k++;
      t += dt;
    }
    inp.virtual.x = inp.virtual.y = 0;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    if (lit) studio.off();
    game.state.driving = false;
    inp.virtual = null;

    // the sheet
    const rows = Math.ceil(frames.length / cols);
    const out = document.createElement('canvas');
    out.width = cols * cell[0];
    out.height = rows * cell[1] + 28;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#10131a';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.font = '14px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#d8e4ff';
    ctx.fillText(`${name}  (${viewName} view, ${Math.round(60 / sc.every)} frames/s, left to right, top to bottom)`, 8, 19);
    frames.forEach((fr, i) => {
      const x = (i % cols) * cell[0], y = 28 + Math.floor(i / cols) * cell[1];
      ctx.drawImage(fr.c, x, y);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(x + 0.5, y + 0.5, cell[0] - 1, cell[1] - 1);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x + 2, y + 2, 118, 18);
      ctx.fillStyle = '#d8e4ff';
      ctx.fillText(`${fr.t.toFixed(2)}s ${fr.speed.toFixed(1)}m/s${fr.grounded ? '' : ' air'}`, x + 5, y + 15);
    });
    const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', quality));
    const res = await fetch(`/__shot?name=motion-${name}${suffix}&ext=jpg`, { method: 'POST', body: blob });
    return { file: await res.text(), frames: frames.length };
  }

  // numbers instead of pictures: per sampled frame, pelvis height over the capsule's feet,
  // which feet are planted (P) or swinging (S), each ankle's position (forward, up)
  // relative to the feet, knee flexion, and upper arm / thigh angles from vertical
  // (+ forward), steady-state after `settle` frames on the flat meadow
  function trace(stick, { n = 60, every = 3, settle = 70 } = {}) {
    const A = game.animator, B = A.rig.bones, V = (b) => b.getWorldPosition(new T.Vector3());
    player.teleport(new T.Vector3(-37, 1.6, -191));
    player.state.facing = 0;
    game.state.driving = true;
    game.rig.state.yaw = Math.PI;
    inp.virtual = { x: 0, y: 0 };
    for (let i = 0; i < 30; i++) app.tick(1 / 60);
    Object.assign(inp.virtual, stick);
    for (let i = 0; i < settle; i++) app.tick(1 / 60);
    const sag = (a, b) => {
      const d = V(b).sub(V(a));
      return Math.round((Math.atan2(d.z, -d.y) * 180) / Math.PI);
    };
    const knee = (a, b, c) => Math.round((V(b).sub(V(a)).angleTo(V(c).sub(V(b))) * 180) / Math.PI);
    const rows = [];
    for (let i = 0; i < n; i++) {
      app.tick(1 / 60);
      if (i % every) continue;
      const f = player.state.feet;
      const aL = V(B.footL).sub(f), aR = V(B.footR).sub(f);
      rows.push([i, 'hip', (V(B.hip).y - f.y).toFixed(3), A.gait.feet.map((ft) => (ft.planted ? 'P' : 'S')).join(''),
        'L', aL.z.toFixed(2), aL.y.toFixed(2), 'k' + knee(B.thighL, B.calfL, B.footL), 'R', aR.z.toFixed(2), aR.y.toFixed(2), 'k' + knee(B.thighR, B.calfR, B.footR),
        'arm', sag(B.armL, B.foreL), sag(B.armR, B.foreR), 'thigh', sag(B.thighL, B.calfL), sag(B.thighR, B.calfR), 'trunk', 180 - sag(B.hip, B.neck1)].join(' '));
    }
    inp.virtual = null;
    game.state.driving = false;
    return rows.join('\n');
  }

  return {
    scenarios,
    record,
    trace,
    async all(names = Object.keys(scenarios)) {
      const out = {};
      for (const n of names) out[n] = await record(n);
      return out;
    },
  };
}
