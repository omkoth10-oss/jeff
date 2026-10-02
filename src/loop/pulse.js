import * as THREE from 'three';
import { noiseGLSL } from '../shaders/noise.js';
import { SHRINE_PLAZA } from '../config.js';

// The midnight pulse. At 12:00 a pillar of light rises from the shrine plaza into the
// sky, light floods the valley and a wall of it sweeps outward; the screen goes white and
// holds there while a single bell rings; the world resets behind the white, and the next
// loop fades in out of it on the cliff, Ren rising sharply as if gasping awake.
//
// The first midnight is the full moment (about eleven seconds: the camera turns to the
// shrine, the white holds through the bell). Every one after is quick (FAST, about four
// seconds): the player has seen it, and the loop is the game. Real seconds (the debug
// time scale doesn't hurry it).
//
// The pillar and the wave are two additive meshes drawn only while the pulse plays. The
// light on the valley is not a real light (adding one would recompile every material):
// it is an overlay on the moon's look (moonPhases.apply) that drives the existing
// lights, sky, fog and mist toward white-hot. The white is the screen's veil (screen.js).

// seconds from midnight
const FULL = {
  turn: 2.6,            // the camera turns to the shrine
  rise: [0.5, 2.1],     // the pillar grows from the plaza into the sky
  flash: [1.4, 4.6],    // light floods the valley
  wave: [2.0, 5.0],     // a wall of light sweeps out across the valley
  white: [3.3, 4.9],    // the screen fades to white
  reset: 5.0,           // behind the white: back to 11:00 on the cliff
  bell: 5.3,            // one bell, in the white
  fadeIn: [8.6, 10.9],  // out of the white, onto the cliff
  wake: [9.25, 9.65],   // Ren gasps awake
  control: 9.9,         // the player has control again
};
const FAST = {
  turn: 0,
  rise: [0, 0.45],
  flash: [0.15, 1.3],
  wave: [0.25, 1.45],
  white: [0.55, 1.45],
  reset: 1.5,
  bell: 1.6,
  fadeIn: [2.5, 4.3],
  wake: [2.9, 3.25],
  control: 3.4,
};
const PILLAR_HEIGHT = 900, WAVE_REACH = 240;

// white-hot: what the flash pushes the moon's look toward (channels of moonPhases.js)
const FLASH = {
  moonLight: [1, 0.97, 0.92], moonLightI: 3.4, rim: [1, 0.97, 0.92], rimI: 1.8,
  hemiSky: [1, 0.97, 0.93], hemiGround: [0.45, 0.43, 0.41], hemiI: 2.2,
  horizon: [0.6, 0.58, 0.55], zenith: [0.26, 0.26, 0.28], halo: [0.7, 0.68, 0.64],
  cloudDark: [0.3, 0.3, 0.3], cloudLit: [0.85, 0.83, 0.8],
  fogColor: [0.64, 0.62, 0.59], fogGlow: [0.5, 0.48, 0.45], fogDensity: 0.0062,
  mistColor: [0.72, 0.7, 0.67], mistGlow: [0.5, 0.48, 0.45], spray: [0.72, 0.7, 0.67],
  water: [2.2, 2.2, 2.2], shadow: [1, 1, 1], saturation: 0.55, bloom: 3.2,
};

const span = (t, [a, b]) => THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
const smooth = (x) => x * x * (3 - 2 * x);

export function createPulse({ phases, screen }) {
  const time = { value: 0 };
  const root = new THREE.Group();
  root.name = 'MidnightPulse';
  root.position.copy(SHRINE_PLAZA);
  root.visible = false;

  // the pillar: a soft outer column and a narrow white-hot core
  const column = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true).translate(0, 0.5, 0);
  const outer = pillarMaterial(time, 1.3, new THREE.Color(0.75, 0.85, 1.0));
  const core = pillarMaterial(time, 3.0, new THREE.Color(1.0, 0.97, 0.92));
  const outerMesh = new THREE.Mesh(column, outer);
  const coreMesh = new THREE.Mesh(column, core);
  outerMesh.renderOrder = coreMesh.renderOrder = 5;
  outerMesh.frustumCulled = coreMesh.frustumCulled = false;
  root.add(outerMesh, coreMesh);

  // the wave: a ring-shaped wall of light, brightest at its foot and its rim
  const wave = waveMaterial(time);
  const waveMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true).translate(0, 0.5, 0), wave);
  waveMesh.position.y = -6;
  waveMesh.renderOrder = 4;
  waveMesh.frustumCulled = false;
  root.add(waveMesh);

  const flash = { values: phases.prepare(FLASH), k: 0 };
  const quiet = { values: phases.prepare({ hush: 1 }), k: 0 };
  let t = 0, T = FULL, active = false, fired = {}, handlers = {};
  const once = (name, at, fn) => {
    if (t >= at && !fired[name]) {
      fired[name] = true;
      fn();
    }
  };

  return {
    root,
    // the look overlays for moonPhases.apply (flash toward white; the hush held through
    // the white until the new loop fades in)
    overlays: [flash, quiet],
    get active() {
      return active;
    },
    get time() {
      return t;
    },
    // compile the shaders with the rest of the scene (no hitch at midnight)
    warm(on) {
      root.visible = on;
    },
    // h: { begin(T), turn(dt), reset(T), bell, fadeIn, wake(k), control, end };
    // fast: the short version, for every midnight after the first
    start(h, { fast = false } = {}) {
      handlers = h;
      T = fast ? FAST : FULL;
      active = true;
      t = 0;
      fired = {};
      root.visible = true;
      handlers.begin?.(T);
    },
    update(dt) {
      if (!active) return;
      t += dt;
      time.value += dt;
      const before = t < T.reset;

      if (t < T.turn) handlers.turn?.(dt);
      // pillar: rises, then swells as the light takes over
      const rise = smooth(span(t, T.rise));
      const swell = smooth(span(t, T.flash));
      for (const [m, radius] of [[outerMesh, 7], [coreMesh, 1.6]]) {
        const r = radius * (0.35 + 0.65 * rise + 1.4 * swell);
        m.scale.set(r, PILLAR_HEIGHT, r);
        m.material.uniforms.uRise.value = rise * 1.03;
        m.material.uniforms.uPower.value = before ? Math.min(1, t / 0.4) * (1 + 1.5 * swell) : 0;
      }
      // the wave: out from the plaza, fading as it goes
      const w = span(t, T.wave);
      waveMesh.visible = before && w > 0;
      waveMesh.scale.set(4 + WAVE_REACH * smooth(w), 70 + 40 * w, 4 + WAVE_REACH * smooth(w));
      wave.uniforms.uPower.value = Math.sin(Math.PI * Math.min(1, w * 1.15)) * (1 - 0.5 * w);

      flash.k = before ? span(t, T.flash) : 0;
      quiet.k = t < T.fadeIn[0] ? (t >= T.reset ? 1 : 0) : 1 - span(t, T.fadeIn);

      // white, held through the bell, then the new loop out of it
      screen.veil('#fff', t < T.fadeIn[0] ? smooth(span(t, T.white)) : 1 - smooth(span(t, T.fadeIn)));

      once('reset', T.reset, () => {
        root.visible = false;
        handlers.reset?.(T);
      });
      once('bell', T.bell, () => handlers.bell?.());
      once('fadeIn', T.fadeIn[0], () => handlers.fadeIn?.());
      if (t >= T.reset) handlers.wake?.(span(t, T.wake));
      once('control', T.control, () => handlers.control?.());
      if (t >= T.fadeIn[1]) {
        active = false;
        flash.k = quiet.k = 0;
        screen.veil('#fff', 0);
        handlers.end?.();
      }
    },
  };
}

// The pillar's shader: brightest down the middle of the column (where it faces the
// camera), white-hot at its foot, streaks racing upward, fading into the sky; it grows
// to uRise (fraction of its height) with a bright leading tip.
function pillarMaterial(time, sharpness, color) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uRise: { value: 0 }, uPower: { value: 0 }, uColor: { value: color } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN, vW;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uRise, uPower;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vN, vW;
      ${noiseGLSL}
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float facing = abs(dot(normalize(vN), V));
        float body = pow(facing, ${sharpness.toFixed(2)});
        float h = vUv.y;
        float grown = 1.0 - smoothstep(uRise - 0.03, uRise, h);
        float tip = exp(-pow((h - uRise) / 0.012, 2.0)) * step(uRise, 0.99) * 3.0;
        // streaks racing up the column
        float a = atan(vN.x, vN.z);
        float streak = 0.6 + 0.8 * fbm3(vec2(a * 3.0, h * 40.0 - uTime * 2.4));
        float foot = 1.0 + 3.0 * exp(-h * 400.0);       // white-hot where it leaves the ground
        float fade = mix(1.0, 0.25, smoothstep(0.0, 0.6, h));
        vec3 col = uColor * body * (grown * streak * fade * foot + tip * body) * uPower;
        gl_FragColor = vec4(col, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    fog: false,
  });
}

// The wave: a translucent shell (bright at its rim and foot) that sweeps outward.
function waveMaterial(time) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: time, uPower: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN, vW;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uPower;
      varying vec2 vUv;
      varying vec3 vN, vW;
      ${noiseGLSL}
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float f = abs(dot(normalize(vN), V));
        float rim = pow(1.0 - f, 1.5) * smoothstep(0.0, 0.3, f);   // (soft at the very silhouette: no hard edge)
        float h = vUv.y;
        float a = atan(vN.x, vN.z);
        float n = 0.65 + 0.7 * fbm3(vec2(a * 9.0, h * 3.0 - uTime * 1.5));
        float body = (exp(-h * 4.0) * n + rim * 0.5 * (1.0 - h)) * smoothstep(0.0, 0.12, f);
        gl_FragColor = vec4(vec3(0.95, 0.96, 1.0) * body * uPower * 0.9, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}
