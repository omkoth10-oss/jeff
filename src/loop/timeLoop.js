import * as THREE from 'three';
import { createClock } from './clock.js';
import { createMoonPhases } from './moonPhases.js';
import { createPulse } from './pulse.js';
import { createClockHud } from './clockHud.js';
import { createScreen } from './screen.js';
import { createOpening } from './opening.js';
import { SHRINE_PLAZA } from '../config.js';

// The time loop, KAGE's core: the hour from 11:00 PM to midnight, over and over.
//   clock.js       the one clock everything reads and subscribes to
//   moonPhases.js  the moon tells the time: White Moon, Silver Mist, Blood Moon, Silence
//   pulse.js       midnight: the pillar of light, the white, the bell
//   opening.js     the opening cutscene, the first time START is pressed
//   screen.js      the veil and the captions over the game
//   clockHud.js    "11:42 PM · Loop 3"
// At midnight the pulse plays; behind the white the clock goes back to 11:00, the loop
// count goes up, and Ren gasps awake on the cliff overlook again.
//
// Debug keys (dev server, or ?debug): T time x10 (toggle), J jump to 11:55,
// L force a reset (the midnight pulse now; Shift+L resets at once), O the opening again.

export function createTimeLoop({ scene, camera, game, audio, look, debug = false }) {
  const clock = createClock();
  // the sound's hush: the moon's (Silence, and held through the white) for everything;
  // the opening also holds the music back until the player takes over
  let ambientHush = 0, musicHold = 0;
  const pushHush = () => audio.hush(ambientHush, Math.max(ambientHush, musicHold));
  const phases = createMoonPhases(clock, look, {
    onHush: (h) => {
      ambientHush = h;
      pushHush();
    },
  });
  const screen = createScreen();
  const pulse = createPulse({ phases, screen });
  scene.add(pulse.root);
  const opening = createOpening({ rig: game.rig, screen, phases });
  const overlays = [...pulse.overlays, ...opening.overlays];
  const hud = createClockHud();

  function giveControl() {
    game.state.cinematic = false;
    if (!game.input.state.locked) game.hud.locked(false); // ("click to resume", if the pointer isn't held)
  }
  // Ren on the ledge at the start of a loop: k = 0 slumped (the camera low with him) .. 1
  // upright, risen sharply (ease-out), the camera rising with him and a touch past
  function wake(k) {
    const up = 1 - Math.pow(1 - k, 3);
    const over = k > 0 ? 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2) : 0;
    game.state.wake = 1 - up;
    game.rig.state.lift = -0.34 * (1 - over);
  }

  const aim = new THREE.Vector3();
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // midnight: the first is the full moment; every one after is quick (pulse.js)
  function midnight() {
    if (pulse.active || opening.active) return;
    let gasped = false;
    pulse.start({
      begin(T) {
        game.state.cinematic = true; // no moving or looking until the next loop
        audio.swell(T.white[1]);
      },
      // the camera turns to the pillar as it rises
      turn(dt) {
        const rig = game.rig.state;
        aim.copy(SHRINE_PLAZA).setY(SHRINE_PLAZA.y + 45).sub(camera.position);
        const yaw = Math.atan2(-aim.x, -aim.z);
        const pitch = THREE.MathUtils.clamp(Math.atan2(aim.y, Math.hypot(aim.x, aim.z)), -0.45, 0.5);
        const k = 1 - Math.exp(-dt * 2.4);
        rig.yaw += wrap(yaw - rig.yaw) * k;
        rig.pitch += (pitch - rig.pitch) * k;
      },
      // behind the white: 11:00 again, back on the cliff, slumped (the opening shot holds
      // until control returns, then eases into the gameplay framing)
      reset(T) {
        clock.reset();
        game.restartAtLedge({ hold: T.control - T.reset, ease: 1.8 });
        wake(0);
        gasped = false;
      },
      bell: () => audio.toll(),
      fadeIn: () => audio.newLoop(),
      wake(k) {
        if (k > 0 && !gasped) {
          gasped = true;
          audio.gasp();
        }
        wake(k);
      },
      control: giveControl,
      end: () => wake(1),
    }, { fast: clock.loop > 1 });
  }

  // the first START: the opening cutscene, then the first loop begins
  function playOpening() {
    if (opening.active || pulse.active) return;
    game.start(); // (the pointer lock may come a moment later, or not at all)
    game.state.cinematic = true;
    game.hud.hide();
    game.restartAtLedge();
    musicHold = 1;
    pushHush();
    opening.start({
      bell: () => audio.distantBell(),
      voice: () => audio.whisper(),
      music: () => {
        musicHold = 0;
        pushHush();
        audio.newLoop();
      },
      control: giveControl,
    });
  }
  clock.on('midnight', midnight);

  function resetNow() {
    clock.reset();
    game.restartAtLedge({ hold: 0 });
    audio.newLoop();
  }

  if (debug) {
    addEventListener('keydown', (e) => {
      if (e.repeat || pulse.active || opening.active || !game.state.started) return;
      if (e.code === 'KeyT') clock.scale = clock.scale === 1 ? 10 : 1;
      else if (e.code === 'KeyJ') clock.set('23:55');
      else if (e.code === 'KeyL') (e.shiftKey ? resetNow : midnight)();
      else if (e.code === 'KeyO') {
        clock.set(0);
        playOpening();
      }
    });
  }

  return {
    clock,
    phases,
    pulse,
    opening,
    hud,
    midnight,
    resetNow,
    playOpening,
    // live: someone is playing (the clock and the pulse run); hud: the clock may show.
    // The opening plays whatever the pointer does (it's a cutscene); the clock waits for it.
    update(dt, { live, hud: hudOn }) {
      if (opening.active) opening.update(dt);
      else if (live) {
        if (pulse.active) pulse.update(dt);
        else clock.update(dt);
      }
      phases.apply(clock.minutes, overlays);
      hud.show(hudOn && !opening.active);
      hud.update(clock.label, clock.loop, look.moon.material.color, clock.scale !== 1);
    },
  };
}
