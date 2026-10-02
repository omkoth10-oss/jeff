// The night's music, composed as it plays. Three voices in D (miyako-bushi: D Eb G A Bb),
// all deep in reverb so they seem to come from somewhere across the valley:
//   breath  a bamboo-flute-like tone: a sine with breath noise around its pitch, notes
//           scooping up into pitch and growing a slow vibrato, phrases that fall to rest
//   strings a few soft plucked notes, like a koto played in a house far off
//   air     slow, low chord swells under it all (open fifths and a close minor second)
// Phrases are a random walk over the scale, mostly by step, ending on D or A. In the game
// it plays in sections, a minute or two of music and then as long with only the night;
// on the title screen and the flyover it stays, but leaves space between phrases.

const SCALE = [0, 1, 5, 7, 8];
const hz = (semi) => 146.832 * Math.pow(2, semi / 12); // semitones from D3
const pitches = (lo, hi) => {
  const out = [];
  for (let s = lo; s <= hi; s++) if (SCALE.includes(((s % 12) + 12) % 12)) out.push(s);
  return out;
};
const FLUTE = pitches(12, 31); // D4 .. A5
const STRINGS = pitches(0, 19); // D3 .. A4
const CHORDS = [[-12, -5, 5], [-12, -5, 1], [-17, -12, -5, -4], [-11, -4, 5], [-12, -5, 0, 7]];

export function createMusic(ctx, out, send, bank) {
  const r = Math.random;
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);
  const wet = ctx.createGain();
  wet.gain.value = 0.85;
  level.connect(wet).connect(send);
  const fluteTone = ctx.createBiquadFilter();
  fluteTone.type = 'lowpass';
  fluteTone.frequency.value = 3200;
  fluteTone.connect(level);
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 520;
  padFilter.Q.value = 0.4;
  const padGain = ctx.createGain();
  padGain.gain.value = 0.045;
  padFilter.connect(padGain).connect(level);

  let mode = 'off', section = 'rest', sectionEnd = 0, nextPhrase = 0, nextDrop = 0, nextChord = 0, chordIdx = 0, last = 14;

  function flute(t, f, dur, vel, final) {
    const att = 0.16 + r() * 0.18, rel = final ? 0.9 : 0.35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.8, t + att);
    g.gain.linearRampToValueAtTime(vel, t + dur * 0.6);
    g.gain.setTargetAtTime(0, t + dur, rel / 3);
    g.connect(fluteTone);
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.type = 'triangle';
    g2.gain.value = 0.07;
    for (const [osc, mul] of [[o, 1], [o2, 2]]) {
      // a scoop up into the note, and a fall at the end of a phrase
      osc.frequency.setValueAtTime(f * mul * Math.pow(2, -55 / 1200), t);
      osc.frequency.exponentialRampToValueAtTime(f * mul, t + 0.22);
      osc.frequency.setValueAtTime(f * mul, t + dur);
      if (final) osc.frequency.exponentialRampToValueAtTime(f * mul * Math.pow(2, -80 / 1200), t + dur + rel);
    }
    o.connect(g);
    o2.connect(g2).connect(g);
    // vibrato grows in through the note
    const lfo = ctx.createOscillator(), lg = ctx.createGain(), lg2 = ctx.createGain();
    lfo.frequency.value = 4.8 + r() * 0.8;
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + dur * 0.35);
    lg.gain.linearRampToValueAtTime(f * 0.007, t + dur * 0.85);
    lg2.gain.value = 0;
    lfo.connect(lg).connect(o.frequency);
    // breath: noise around the pitch, strongest at the attack
    const b = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), bg = ctx.createGain();
    b.buffer = bank.breath;
    b.loop = true;
    bp.type = 'bandpass';
    bp.frequency.value = f * 1.02;
    bp.Q.value = 3.5;
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(vel * 0.9, t + 0.06);
    bg.gain.linearRampToValueAtTime(vel * 0.32, t + att + 0.1);
    bg.gain.setTargetAtTime(0, t + dur, rel / 3);
    b.connect(bp).connect(bg).connect(fluteTone);
    const end = t + dur + rel * 2 + 0.2;
    for (const n of [o, o2, lfo]) {
      n.start(t);
      n.stop(end);
    }
    b.start(t, r() * 1.5);
    b.stop(end);
    o.onended = () => [g, g2, lg, lg2, bp, bg].forEach((n) => n.disconnect());
  }

  function strings(t, f, vel) {
    const s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = bank.pluck(f);
    g.gain.value = vel;
    s.connect(g).connect(level);
    s.start(t);
    s.onended = () => g.disconnect();
  }

  function chord(t, notes, dur) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 7);
    g.gain.setValueAtTime(1, t + dur - 8);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(padFilter);
    const oscs = [];
    for (const n of notes) {
      for (const cents of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(n) * Math.pow(2, cents / 1200);
        const og = ctx.createGain();
        og.gain.value = 1 / (notes.length * 2);
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + dur + 0.1);
        oscs.push(o, og);
      }
    }
    oscs[0].onended = () => [g, ...oscs].forEach((n) => n.disconnect());
    // the pad's filter breathes open and closed with each chord
    padFilter.frequency.setTargetAtTime(380 + r() * 380, t, dur / 3);
  }

  // a phrase from time t; returns when it ends
  function phrase(t, title) {
    const len = 2 + Math.floor(r() * (title ? 3 : 4));
    let k = FLUTE.indexOf(last);
    if (k < 0) k = 4;
    const vel = 0.085 + r() * 0.04;
    for (let i = 0; i < len; i++) {
      const finalNote = i === len - 1;
      if (i > 0) {
        const step = [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)] - (i > len / 2 ? 0.6 : 0); // falling toward the end
        k = Math.max(0, Math.min(FLUTE.length - 1, Math.round(k + step)));
      }
      if (finalNote) {
        // come to rest on D or A
        while ([0, 7].indexOf(((FLUTE[k] % 12) + 12) % 12) < 0) k = Math.max(0, k - 1);
      }
      const dur = i === 0 ? 2.2 + r() * 1.8 : finalNote ? 3 + r() * 2 : 0.9 + r() * 1.4;
      flute(t, hz(FLUTE[k]), dur, vel * (finalNote ? 0.85 : 1), finalNote);
      last = FLUTE[k];
      t += dur + 0.06 + r() * 0.3;
    }
    return t;
  }

  function drop(t) {
    // two or three plucked notes falling, unhurried
    let k = Math.floor(STRINGS.length * (0.4 + r() * 0.6));
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      strings(t, hz(STRINGS[k]), 0.09 + r() * 0.06);
      k = Math.max(0, k - 1 - Math.floor(r() * 2));
      t += 0.45 + r() * 0.7;
    }
  }

  function setSection(s, now, fade) {
    section = s;
    level.gain.cancelScheduledValues(now);
    level.gain.setTargetAtTime(s === 'play' ? 1 : 0, now, fade / 3);
    if (s === 'play') {
      sectionEnd = now + (mode === 'game' ? 70 + r() * 50 : 1e9);
      nextPhrase = now + 4 + r() * 4;
      nextDrop = now + 9 + r() * 10;
      nextChord = now;
    } else sectionEnd = now + 55 + r() * 70;
  }

  return {
    get mode() {
      return mode;
    },
    // 'title' | 'tour': music stays; 'game': sections come and go; 'off'
    setMode(m) {
      const now = ctx.currentTime;
      if (m === mode) return;
      const prev = mode;
      mode = m;
      if (m === 'off') setSection('rest', now, 4);
      else if (m === 'game') {
        // after the title the music finishes its thought, then the night takes over
        if (prev === 'title' || prev === 'tour') {
          sectionEnd = now + 22 + r() * 10;
          section = 'play';
        } else setSection('rest', now, 6);
      } else if (section !== 'play' || prev === 'game') setSection('play', now, 5);
    },
    // a new loop begins (src/loop): the music comes back in with it
    restart() {
      if (mode === 'game') setSection('play', ctx.currentTime, 8);
    },
    update() {
      if (mode === 'off') return;
      const now = ctx.currentTime;
      if (now >= sectionEnd) {
        if (section === 'play') setSection('rest', now, 12);
        else setSection('play', now, 6);
      }
      if (section !== 'play' || now > sectionEnd - 8) return;
      const title = mode !== 'game';
      if (now >= nextChord - 0.5) {
        const dur = 28 + r() * 12;
        chord(Math.max(now, nextChord), CHORDS[chordIdx++ % CHORDS.length], dur);
        nextChord = Math.max(now, nextChord) + dur - 7;
      }
      if (now >= nextPhrase - 0.3) {
        const end = phrase(Math.max(now + 0.05, nextPhrase), title);
        nextPhrase = end + (title ? 6 + r() * 8 : 9 + r() * 14);
      }
      if (now >= nextDrop - 0.3) {
        drop(Math.max(now + 0.05, nextDrop));
        nextDrop = now + 11 + r() * 20;
      }
    },
  };
}
