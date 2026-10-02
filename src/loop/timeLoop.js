import * as THREE from 'three';
import { createClock } from './clock.js';
import { createMoonPhases } from './moonPhases.js';
import { createPulse } from './pulse.js';
import { createClockHud } from './clockHud.js';
import { SHRINE_PLAZA } from '../config.js';

// The time loop, KAGE's core: the hour from 11:00 PM to midnight, over and over.
//   clock.js       the one clock everything reads and subscribes to
//   moonPhases.js  the moon tells the time: White Moon, Silver Mist, Blood Moon, Silence
//   pulse.js       midnight: the pillar of light, white, black, the bell
//   clockHud.js    "11:42 PM · Loop 3"
// At midnight the pulse plays; in the dark the clock goes back to 11:00, the loop count
// goes up and Ren wakes on the cliff overlook again.
//
// Debug keys (dev server, or ?debug): T time x10 (toggle), J jump to 11:55,
// L force a reset (the midnight pulse now; Shift+L resets at once).

export function createTimeLoop({ scene, camera, game, audio, look, debug = false }) {
  const clock = createClock();
  const phases = createMoonPhases(clock, look, { onHush: audio.hush });
  const pulse = createPulse({ phases });
  scene.add(pulse.root);
  const hud = createClockHud();

  const aim = new THREE.Vector3();
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function midnight() {
    if (pulse.active) return;
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
      // in the dark: 11:00 again, back on the cliff (the opening shot holds until control
      // returns, then eases into the gameplay framing), and the bell
      reset(T) {
        clock.reset();
        game.restartAtLedge({ hold: T.control - T.reset });
        audio.toll();
      },
      fadeIn: () => audio.newLoop(),
      control: () => (game.state.cinematic = false),
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
      if (e.repeat || pulse.active || !game.state.started) return;
      if (e.code === 'KeyT') clock.scale = clock.scale === 1 ? 10 : 1;
      else if (e.code === 'KeyJ') clock.set('23:55');
      else if (e.code === 'KeyL') (e.shiftKey ? resetNow : midnight)();
    });
  }

  return {
    clock,
    phases,
    pulse,
    hud,
    midnight,
    resetNow,
    // live: someone is playing (the clock and the pulse run); hud: the clock is shown
    update(dt, { live, hud: hudOn }) {
      if (live) {
        if (pulse.active) pulse.update(dt);
        else clock.update(dt);
      }
      phases.apply(clock.minutes, pulse.overlays);
      hud.show(hudOn);
      hud.update(clock.label, clock.loop, look.moon.material.color, clock.scale !== 1);
    },
  };
}
