import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, Effect,
} from 'postprocessing';

// Colour grade applied after tone mapping: moonlit blue in the shadows and mid-tones,
// warm orange kept in the lantern light, a touch of contrast and saturation.
const gradeShader = /* glsl */ `
uniform vec3 uShadow;
uniform vec3 uHighlight;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uLift;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // lantern light (warm hues) keeps and gains warmth; everything else cools toward moonlit blue
  float warmth = clamp((c.r - c.b) * 4.0, 0.0, 1.0);
  vec3 cool = c * mix(uShadow, vec3(1.0), smoothstep(0.35, 0.9, l));   // bright moonlit things stay near white
  c = mix(cool, c * uHighlight, warmth);
  c = mix(vec3(l), c, uSaturation);
  // contrast as a power curve around linear mid-grey: this runs on linear values, where a
  // 0.5 pivot would push every night-time dark below zero
  c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(uContrast));
  // lifted blacks: the darkest shadows stay a readable blue-grey, as in the reference
  c = max(c, 0.0) + uLift * (1.0 - c);
  outputColor = vec4(c, inputColor.a);
}`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeShader, {
      uniforms: new Map([
        ['uShadow', new THREE.Uniform(new THREE.Vector3(0.78, 0.95, 1.12))],
        ['uHighlight', new THREE.Uniform(new THREE.Vector3(1.05, 0.97, 0.88))],
        ['uContrast', new THREE.Uniform(1.14)],
        ['uSaturation', new THREE.Uniform(1.08)],
        ['uLift', new THREE.Uniform(new THREE.Vector3(0.0038, 0.0043, 0.0052))],
      ]),
    });
  }
}

export function createPost(renderer, scene, camera) {
  renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the effect pass
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 2 });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 0.85,
    luminanceSmoothing: 0.25,
    intensity: 1.35,
    radius: 0.72,
    resolutionScale: 0.4,
  });
  bloom.mipmapBlurPass.levels = 6;
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const grade = new GradeEffect();
  const vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
  composer.addPass(new EffectPass(camera, bloom, toneMapping, grade, vignette));
  return { composer, bloom, toneMapping, grade, vignette };
}
