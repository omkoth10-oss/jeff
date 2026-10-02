import * as THREE from 'three';
import { CAMERA } from '../config.js';

// The opening, the first time START is pressed (never on a new loop): about twenty-four
// seconds in the game's own camera, skippable with any key or click.
//   black; the night's sound fades in, then one distant bell
//   a slow fade into the cliff overlook: Ren in silhouette, the white moon, the village
//   glowing below, the camera drifting in toward his back
//   a whisper, "Again…" (a caption, with a placeholder voice), then "11:00 PM"
//   the camera settles into the gameplay framing and the player has control: no
//   tutorial text, no menus
// The camera is the game's own rig (cameraRig.js): held in the opening shot, dollied
// back and turned a little, then eased into the gameplay framing.

// seconds from START
const T = {
  ambience: [0.8, 4.6],      // black: the night's sound fades in
  bell: 3.6,                 // one distant bell
  reveal: [5.6, 10.2],       // a slow fade from black onto the cliff overlook
  drift: [5.6, 19.4],        // the camera drifts in toward Ren's back
  whisper: [9.4, 13.8, 1.4], // "Again…": from, to, fade
  voice: 9.7,                // the whisper's sound
  hour: [14.6, 19.6, 1.5],   // "11:00 PM"
  settle: [19.4, 23.6],      // into the gameplay framing
  music: 21.0,               // the music comes in
  control: 22.0,             // the player takes over
};
// as the drift begins: metres further back, at the same height (so Ren stands against
// the lit valley, not the dark rock below it) and off to the right (clear of the crag on
// the left), turned back toward him and up a little toward the moon
const DOLLY = 7, SIDE = 0.45;
const YAW = 0.15, PITCH = 0.1;
const SKIP = 1.3; // seconds from a skip to the end

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (t, [a, b]) => clamp01((t - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);
// a caption's visibility: fades in, holds, fades out
const card = (t, [a, b, f]) => smooth(clamp01((t - a) / f)) * smooth(clamp01((b - t) / f));

export function createOpening({ rig, screen, phases }) {
  // the night's sound held back while the screen is black (an overlay on the moon's look)
  const quiet = { values: phases.prepare({ hush: 1 }), k: 0 };
  let t = 0, active = false, skipAt = -1, from = null, fired = {}, handlers = {};
  const once = (name, at, fn) => {
    if (t >= at && !fired[name]) {
      fired[name] = true;
      fn?.();
    }
  };

  const onInput = () => skip();
  function finish() {
    active = false;
    quiet.k = 0;
    rig.state.dolly = 0;
    screen.veil('#000', 0);
    screen.caption('whisper', 0);
    screen.caption('hour', 0);
    once('music', 0, handlers.music);
    once('control', 0, handlers.control);
    removeEventListener('keydown', onInput, true);
    removeEventListener('pointerdown', onInput, true);
    handlers.end?.();
  }
  function skip() {
    if (!active || skipAt >= 0 || t < 0.4) return;
    skipAt = t;
    const s = rig.state;
    from = {
      dolly: s.dolly, yaw: s.yaw, pitch: s.pitch, quiet: quiet.k, veil: screen.veilOpacity,
      whisper: Math.max(0, screen.shown.whisper), hour: Math.max(0, screen.shown.hour),
    };
    // settle into the gameplay framing now, and hand over at once
    s.blend = Math.max(s.blend, 0);
    s.blendTime = SKIP + 0.3;
    fired.bell = fired.voice = true;
    once('music', 0, handlers.music);
    once('control', 0, handlers.control);
  }

  return {
    overlays: [quiet],
    get active() {
      return active;
    },
    get time() {
      return t;
    },
    skip,
    // h: { bell, voice, music, control, end }
    start(h) {
      handlers = h;
      active = true;
      t = 0;
      skipAt = -1;
      fired = {};
      quiet.k = 1;
      screen.veil('#000', 1);
      rig.reset({ yaw: CAMERA.yaw + YAW, pitch: CAMERA.pitch + PITCH, hold: T.settle[0], ease: T.settle[1] - T.settle[0] });
      rig.state.dolly = DOLLY;
      rig.state.dollySide = SIDE;
      addEventListener('keydown', onInput, true);
      addEventListener('pointerdown', onInput, true);
    },
    update(dt) {
      if (!active) return;
      t += dt;
      const s = rig.state;
      if (skipAt < 0) {
        const d = smoother(span(t, T.drift));
        s.dolly = DOLLY * (1 - d);
        s.yaw = CAMERA.yaw + YAW * (1 - d);
        s.pitch = CAMERA.pitch + PITCH * (1 - d);
        quiet.k = 1 - span(t, T.ambience);
        screen.veil('#000', 1 - smooth(span(t, T.reveal)));
        screen.caption('whisper', card(t, T.whisper));
        screen.caption('hour', card(t, T.hour));
        once('bell', T.bell, handlers.bell);
        once('voice', T.voice, handlers.voice);
        once('music', T.music, handlers.music);
        once('control', T.control, handlers.control);
        if (t >= T.settle[1]) finish();
      } else {
        // skipped: everything eases out together
        const k = clamp01((t - skipAt) / SKIP), e = smooth(k), quick = smooth(clamp01(k * 2.5));
        s.dolly = from.dolly * (1 - e);
        s.yaw = THREE.MathUtils.lerp(from.yaw, CAMERA.yaw, e);
        s.pitch = THREE.MathUtils.lerp(from.pitch, CAMERA.pitch, e);
        quiet.k = from.quiet * (1 - quick);
        screen.veil('#000', from.veil * (1 - smooth(clamp01(k * 1.8))));
        screen.caption('whisper', from.whisper * (1 - quick));
        screen.caption('hour', from.hour * (1 - quick));
        if (k >= 1) finish();
      }
    },
  };
}
