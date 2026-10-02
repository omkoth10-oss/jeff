import * as THREE from 'three';
import { noiseGLSL } from '../shaders/noise.js';

// Night sky dome, drawn at the far plane behind everything: a deep navy gradient,
// twinkling stars, slow drifting clouds lit silver by the moon, and a soft halo
// around the moon. The moon disc itself is a sprite (see main.js); bloom adds glow.
export function createSky(moonDir) {
  const uniforms = {
    uMoonDir: { value: moonDir.clone() },
    uTime: { value: 0 },
    uHorizon: { value: new THREE.Color(0.016, 0.036, 0.08) },
    uZenith: { value: new THREE.Color(0.002, 0.006, 0.018) },
    uHalo: { value: new THREE.Color(0.12, 0.18, 0.36) },
    uCloudDark: { value: new THREE.Color(0.01, 0.018, 0.038) },
    uCloudLit: { value: new THREE.Color(0.11, 0.16, 0.26) },
    uStars: { value: 1 }, // brighter as the moon goes dark at the end of the hour (src/loop)
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        // rotation only: the dome is always centred on the camera, drawn at the far plane
        vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uMoonDir, uHorizon, uZenith, uHalo, uCloudDark, uCloudLit;
      uniform float uTime, uStars;
      varying vec3 vDir;
      ${noiseGLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));

        // moon halo: tight core glow plus a wide soft wash
        float m = max(dot(d, uMoonDir), 0.0);
        float halo = 0.9 * pow(m, 350.0) + 0.35 * pow(m, 40.0) + 0.12 * pow(m, 6.0);

        // stars on a direction grid, twinkling, fading toward the horizon
        vec2 sp = vec2(atan(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0))) * 180.0;
        vec2 cell = floor(sp);
        float rnd = hash12(cell);
        vec2 off = vec2(hash12(cell + 17.3), hash12(cell + 41.7)) - 0.5;
        // a few bright stars, many faint ones; sizes vary; they fade out into the horizon haze
        float mag = hash12(cell + 3.1);
        float size = mix(0.16, 0.42, mag * mag);
        float star = smoothstep(size, 0.0, length(fract(sp) - 0.5 - off * 0.6)) * step(0.975, rnd);
        star *= (0.6 + 0.4 * sin(uTime * (1.5 + rnd * 3.0) + rnd * 60.0)) * smoothstep(0.08, 0.4, d.y);
        star *= mix(0.25, 2.2, mag * mag * mag) * (1.0 - smoothstep(0.9, 0.99, m));

        // clouds on a plane above the valley, drifting; bright rims where the moon backlights them
        vec2 cp = d.xz / (d.y + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.0015);
        float c = fbm3(cp * 1.2) * 0.65 + fbm3(cp * 3.7 + 11.0) * 0.35;
        float cover = smoothstep(0.46, 0.72, c) * smoothstep(0.03, 0.2, d.y);
        float thin = smoothstep(0.46, 0.58, c) - smoothstep(0.58, 0.8, c);   // edges
        // thin cloud edges catch the moon: a bright silver rim near it, a faint one everywhere
        vec3 cloud = mix(uCloudDark, uCloudLit, 0.08 + 0.92 * pow(m, 12.0)) + uCloudLit * thin * (pow(m, 6.0) * 3.0 + 0.05);
        col = mix(col + uHalo * halo, cloud + uHalo * halo * 0.4, cover * 0.92);
        col += vec3(0.85, 0.9, 1.0) * star * uStars * (1.0 - cover);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.name = 'Sky';
  return { mesh: sky, uniforms };
}
