import { LOOP_DURATION } from '../config.js';

// The world clock: the hour every loop replays, 11:00 PM to midnight, played over
// LOOP_DURATION real seconds. Anything that depends on the time of night reads it here
// or subscribes to it, so there is one notion of "now" for the whole valley.
//
//   clock.minutes       in-game minutes past 11:00 PM (0..60, fractional)
//   clock.progress      0..1 through the hour
//   clock.loop          which loop this is (1 = the first night)
//   clock.label         "11:42 PM"
//   clock.scale         time multiplier (1; the debug keys set 10)
//   clock.on(type, fn)  'minute'   each in-game minute
//                       'phase'    the moon changes (src/loop/moonPhases.js): { name }
//                       'midnight' the hour is up (the clock stops until reset)
//                       'loop'     a new loop began (after reset)
//                       'jump'     time was skipped: { from, to }
//                       returns a function that unsubscribes
//   clock.at(time, fn)  once per loop, when the clock passes `time` ('23:40', '00:00', or
//                       minutes past 11 PM). Skipping past it still fires, with
//                       { skipped: true }, so a system can snap to where it would be.
//   clock.update(dt)    advance by real seconds (times clock.scale)
//   clock.set(time)     jump to a time (debug; later, meditating at a shrine)
//   clock.reset()       back to 11:00 PM, loop + 1
//
// Every event gets { minutes, loop, skipped } plus its own fields.

export const HOUR = 60;
const START = 23 * 60; // 11:00 PM, in minutes after midnight

// '23:40' -> 40, '00:00' / '24:00' -> 60; numbers are already minutes past 11 PM
export function toMinutes(time) {
  if (typeof time === 'number') return time;
  const [h, m] = time.split(':').map(Number);
  return (((h * 60 + m - START) % 1440) + 1440) % 1440;
}

// minutes past 11 PM -> "11:42 PM" (the minute shown is the one that has begun)
export function formatTime(minutes) {
  const total = START + Math.floor(minutes + 1e-6);
  const h24 = Math.floor(total / 60) % 24, m = total % 60;
  return `${h24 % 12 || 12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function createClock({ duration = LOOP_DURATION } = {}) {
  const listeners = new Map();
  const marks = []; // { at, fn, done }, sorted by time
  let minutes = 0, loop = 1, stopped = false;

  const emit = (type, fields = {}) => {
    const e = { minutes, loop, skipped: false, ...fields };
    for (const fn of listeners.get(type) ?? []) fn(e);
  };
  function fireMarks(skipped) {
    for (const m of marks) {
      if (m.at > minutes) break;
      if (m.done) continue;
      m.done = true;
      m.fn({ minutes, loop, skipped: skipped && m.at < minutes });
    }
  }
  function advance(to, skipped = false) {
    const prev = minutes;
    minutes = Math.min(HOUR, Math.max(0, to));
    if (Math.floor(minutes) !== Math.floor(prev)) emit('minute', { skipped });
    fireMarks(skipped);
    if (minutes >= HOUR && !stopped) {
      stopped = true;
      emit('midnight');
    }
  }

  const clock = {
    duration,
    scale: 1,
    get minutes() {
      return minutes;
    },
    get progress() {
      return minutes / HOUR;
    },
    get loop() {
      return loop;
    },
    get label() {
      return formatTime(minutes);
    },
    get midnight() {
      return stopped;
    },
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
    emit,
    at(time, fn) {
      const at = toMinutes(time);
      const mark = { at, fn, done: at < minutes };
      const i = marks.findIndex((m) => m.at > at);
      marks.splice(i < 0 ? marks.length : i, 0, mark);
      return () => {
        const k = marks.indexOf(mark);
        if (k >= 0) marks.splice(k, 1);
      };
    },
    update(dt) {
      if (!stopped) advance(minutes + (dt * clock.scale * HOUR) / duration);
    },
    set(time) {
      const to = Math.min(HOUR, Math.max(0, toMinutes(time)));
      const from = minutes;
      if (to < from) {
        // going back: what lies ahead happens again
        for (const m of marks) if (m.at >= to) m.done = false;
        stopped = false;
      }
      emit('jump', { from, to, skipped: true });
      advance(to, true);
    },
    reset() {
      minutes = 0;
      stopped = false;
      loop++;
      for (const m of marks) m.done = false;
      emit('loop');
      fireMarks(false);
    },
  };
  return clock;
}
