import * as THREE from 'three';

// Height fog for every material in the scene, replacing three's distance fog.
// Density falls off exponentially with altitude, integrated along each view ray, so
// the valley and the gaps between ridges fill with mist while ridge tops stay
// clearer. Add distance haze so the background fades out, drifting patches so the
// mist isn't uniform, a moonlit glow toward the moon and a warm glow over lamp-lit
// streets (from the light map, when present).
const FOG_PARS = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 uFogColor;
  uniform vec3 uFogGlow;
  uniform vec3 uFogMoonDir;
  uniform float uFogBase;
  uniform float uFogFalloff;
  uniform float uFogDensity;
  uniform float uFogHaze;
  uniform vec4 uRidgeHaze;          // density, falloff, base height, start distance
  uniform float uFogTime;
  uniform sampler2D uFogLight;
  uniform vec4 uFogLightRect;
  uniform float uLampStrength;
  uniform vec4 uLampPoints[4];      // the lamps nearest the camera: position, intensity (render/lightPool.js)
  varying vec3 vFogWorld;
  // those nearest lamps with real N.L shading and distance falloff (a cheap stand-in for
  // point lights: no specular, 12 m reach)
  vec3 lampPoints(vec3 wp, vec3 nw) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      vec4 l = uLampPoints[i];
      vec3 L = l.xyz - wp;
      float d2 = dot(L, L);
      float win = max(1.0 - d2 / 144.0, 0.0);
      sum += vec3(l.w * max(dot(nw, L * inversesqrt(max(d2, 1e-4))), 0.0) * win * win / (d2 + 2.0));
    }
    return vec3(1.0, 0.6, 0.32) * sum;
  }
  // warm light from the lamp map (world/lamps.js), faded above and below the lights
  vec3 lampLight(vec3 wp) {
    vec2 luv = (wp.xz - uFogLightRect.xy) / uFogLightRect.zw;
    if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0) return vec3(0.0);
    vec4 L = texture2D(uFogLight, luv);
    float h = L.g * 60.0;
    // reaches up under the eaves above the lamps (fading within a few metres), and down to the ground
    float v = exp(-max(0.0, wp.y - h - 0.5) / 3.2) * exp(-max(0.0, h - wp.y - 5.0) / 5.0);
    return vec3(1.0, 0.56, 0.26) * L.r * v * uLampStrength;
  }
  float hfHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float hfNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hfHash(i), hfHash(i + vec2(1, 0)), u.x), mix(hfHash(i + vec2(0, 1)), hfHash(i + vec2(1, 1)), u.x), u.y);
  }
#endif
`;

const FOG_FRAG = /* glsl */ `
#ifdef USE_FOG
{
  vec3 fr = vFogWorld - cameraPosition;
  float fd = length(fr);
  vec3 fdir = fr / max(fd, 1e-4);
  float b = uFogFalloff;
  float dy = fr.y;
  float k = abs(b * dy) > 1e-3 ? (1.0 - exp(-b * dy)) / (b * dy) : 1.0;
  vec2 np = vFogWorld.xz * 0.0045 + uFogTime * vec2(0.006, 0.0025);
  // drifting banks: some stretches of the valley nearly clear, others thick
  float patchy = 0.12 + 1.9 * smoothstep(0.3, 0.8, 0.6 * hfNoise(np) + 0.4 * hfNoise(np * 2.7 + 5.0));
  // the first few tens of metres stay clear; the valley mist builds up in the midground
  float heightFog = uFogDensity * exp(-b * (cameraPosition.y - uFogBase)) * fd * k * patchy * smoothstep(35.0, 110.0, fd);
  // haze with a larger scale height that starts beyond the village: the forest behind
  // fades progressively toward the mountains, whose bases sink into it while the
  // peaks stay clearer
  float b2 = uRidgeHaze.y;
  float k2 = abs(b2 * dy) > 1e-3 ? (1.0 - exp(-b2 * dy)) / (b2 * dy) : 1.0;
  float ridge = uRidgeHaze.x * exp(-b2 * (cameraPosition.y - uRidgeHaze.z)) * max(fd - uRidgeHaze.w, 0.0) * k2 * (0.75 + 0.25 * patchy);
  float haze = fd * uFogHaze;
  float fogFactor = clamp(1.0 - exp(-(heightFog + ridge + haze * haze)), 0.0, 1.0);
  vec3 fcol = uFogColor + uFogGlow * pow(max(dot(fdir, uFogMoonDir), 0.0), 5.0);
  vec2 luv = (vFogWorld.xz - uFogLightRect.xy) / uFogLightRect.zw;
  if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) {
    fcol += vec3(1.0, 0.45, 0.15) * texture2D(uFogLight, luv).r * 0.12;   // lamp-lit mist
  }
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fcol, fogFactor);
}
#endif
`;

export function createHeightFog(moonDir) {
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;
  const uniforms = {
    uFogColor: { value: new THREE.Color(0.052, 0.086, 0.138) },
    uFogGlow: { value: new THREE.Color(0.06, 0.09, 0.14) },
    uFogMoonDir: { value: moonDir.clone() },
    uFogBase: { value: 2.0 },
    uFogFalloff: { value: 0.06 },
    uFogDensity: { value: 0.0034 },
    uFogHaze: { value: 0.00012 },
    uRidgeHaze: { value: new THREE.Vector4(0.0019, 1 / 120, 0, 110) },
    uFogTime: { value: 0 },
    uFogLight: { value: blank },
    uFogLightRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uLampStrength: { value: 0.72 },
    uLampPoints: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -1000, 0, 0)) },
  };
  const patched = new WeakSet();

  function patch(material) {
    if (patched.has(material) || material.fog === false || material.isShaderMaterial) return;
    patched.add(material);
    const baseKey = material.customProgramCacheKey(); // includes the original onBeforeCompile
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prev.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\n#ifdef USE_FOG\nvarying vec3 vFogWorld;\n#endif')
        .replace(
          '#include <fog_vertex>',
          // world position from the view-space position works for instanced, skinned and billboard geometry alike
          '#include <fog_vertex>\n#ifdef USE_FOG\nvFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <fog_pars_fragment>', FOG_PARS)
        .replace('#include <fog_fragment>', FOG_FRAG)
        // lit materials also receive the warm lamp light (Basic/Sprite materials have no emissive)
        .replace(
          '#include <emissivemap_fragment>',
          // dark wood and stone still pick up a little warm light instead of staying black
          // (foliage cards take it softer and less saturated: blossoms by a lantern go warm pink, not orange)
          `#include <emissivemap_fragment>
          #ifdef USE_FOG
          {
            vec3 lampC = lampLight(vFogWorld) + lampPoints(vFogWorld, normalize((vec4(normal, 0.0) * viewMatrix).xyz));
            #ifdef USE_ALPHATEST
              lampC = mix(vec3(dot(lampC, vec3(0.33))), lampC, 0.45) * 0.45;
            #endif
            totalEmissiveRadiance += max(diffuseColor.rgb, vec3(0.11)) * lampC;
          }
          #endif`,
        );
    };
    material.customProgramCacheKey = () => `${baseKey}|hfog`;
    material.needsUpdate = true;
  }

  return {
    uniforms,
    patch,
    setLampMap(map) {
      uniforms.uFogLight.value = map.texture;
      uniforms.uFogLightRect.value.copy(map.rect);
    },
    patchObject(root) {
      root.traverse((o) => {
        if (o.material) [].concat(o.material).forEach(patch);
      });
    },
  };
}
