import * as THREE from 'three';

// Banks of mist: soft, slowly drifting sheets that always face the camera around the
// vertical axis, standing on the ground so their faded lower edge hides where they
// meet it. They hang at the foot of the waterfalls (rolling upward), along the river
// and between the forest ridges behind the village, where they layer the background
// like the reference. One instanced draw call; the noise comes from a small tiling
// texture baked at load time, so the fill cost stays low.

const NOISE_SIZE = 128;

function bakeNoise() {
  const N = NOISE_SIZE;
  const data = new Uint8Array(N * N * 4);
  const lattice = (period, seed) => {
    const g = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 16807) % 2147483647;
      g[i] = s / 2147483647;
    }
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const at = (i, j) => g[((j % period + period) % period) * period + ((i % period + period) % period)];
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
  };
  const channels = [0, 1].map((ch) => {
    const octaves = [4, 8, 16, 32].map((p, o) => ({ f: lattice(p, 1234 + ch * 777 + o * 31), p }));
    return (x, y) => {
      let v = 0, amp = 0.5, norm = 0;
      for (const { f, p } of octaves) {
        v += f((x / N) * p, (y / N) * p) * amp;
        norm += amp;
        amp *= 0.5;
      }
      return v / norm;
    };
  });
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      data[i] = Math.round(channels[0](x, y) * 255);
      data[i + 1] = Math.round(channels[1](x, y) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// banks: [x, z, width, height, alpha, kind]; kind 0 = drifting bank, 1 = waterfall spray.
// y is looked up from the ground (minus a little, so the faded foot sits in it).
export function createMist(banks, groundHeight, moonDir, fogUniforms) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const n = banks.length;
  const iPos = new Float32Array(n * 4);   // x, y, z, seed
  const iSize = new Float32Array(n * 4);  // width, height, alpha, kind
  banks.forEach(([x, z, w, h, a, kind = 0, dy = 0], i) => {
    // banks on the ground stand on the lowest point under them; lifted ones float
    // above the highest (over the canopy)
    const hs = kind === 1 ? [groundHeight(x, z)] : [groundHeight(x, z), groundHeight(x - w * 0.3, z), groundHeight(x + w * 0.3, z)];
    let y = (dy > 0 ? Math.max(...hs) : Math.min(...hs)) - 2 + dy;
    if (dy > 0) {
      // lifted banks vary in height, size and density, so they read as drifting
      // layers rather than one flat fog plane
      const r1 = (Math.sin(i * 12.9898) * 43758.5453) % 1, r2 = (Math.sin(i * 78.233) * 12543.123) % 1;
      y += r1 * h * 0.45;
      h *= 0.75 + 0.6 * Math.abs(r2);
      w *= 0.7 + 0.6 * Math.abs(r1);
      a *= 0.65 + 0.45 * Math.abs(r2);
    }
    iPos.set([x, y, z, (i * 0.618034) % 1], i * 4);
    iSize.set([w, h, a, kind], i * 4);
  });
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 4));
  geo.instanceCount = n;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const uniforms = {
    uNoise: { value: bakeNoise() },
    uTime: { value: 0 },
    uMoonDir: { value: moonDir.clone() },
    uColor: { value: new THREE.Color(0.07, 0.12, 0.21) },
    uGlow: { value: new THREE.Color(0.08, 0.13, 0.21) },
    uSpray: { value: new THREE.Color(0.17, 0.24, 0.36) },
    uFogLight: fogUniforms.uFogLight,
    uFogLightRect: fogUniforms.uFogLightRect,
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec4 iPos;
      attribute vec4 iSize;
      varying vec2 vUv;
      varying vec4 vSize;
      varying float vSeed;
      varying vec3 vWorld;
      void main() {
        vec3 toCam = cameraPosition - iPos.xyz;
        vec3 flatDir = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), flatDir));
        vec3 wp = iPos.xyz + right * position.x * iSize.x + vec3(0.0, position.y * iSize.y, 0.0);
        // pulled a little toward the camera so the sheet clears the slope it stands on
        wp += flatDir * min(iSize.x * 0.15, 12.0);
        vUv = vec2(position.x + 0.5, position.y);
        vSize = iSize;
        vSeed = iPos.w;
        vWorld = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise;
      uniform float uTime;
      uniform vec3 uMoonDir, uColor, uGlow, uSpray;
      uniform sampler2D uFogLight;
      uniform vec4 uFogLightRect;
      varying vec2 vUv;
      varying vec4 vSize;
      varying float vSeed;
      varying vec3 vWorld;
      void main() {
        float spray = step(0.5, vSize.w);
        // metre-scaled noise coordinates: sheets drift sideways, spray rolls upward
        vec2 m = vec2(vUv.x * vSize.x, vUv.y * vSize.y);
        vec2 drift = spray > 0.5 ? vec2(0.0, -uTime * 2.2) : vec2(uTime * 0.6, 0.0);
        vec2 p1 = (m + drift) / (spray > 0.5 ? 14.0 : 70.0) + vSeed * 7.0;
        vec2 p2 = (m + drift * 1.7) / (spray > 0.5 ? 6.0 : 26.0) - vSeed * 3.0;
        float n = texture2D(uNoise, p1).r * 0.65 + texture2D(uNoise, p2).g * 0.35;
        // soft sheet: fades at the sides, the foot and the (ragged) top
        float ex = smoothstep(0.0, 0.32, vUv.x) * smoothstep(1.0, 0.68, vUv.x);
        float top = mix(0.35, 0.9, n);
        float foot = 0.3 * texture2D(uNoise, p1 * 0.7 + 0.37).g;             // ragged lower edge too
        float ey = smoothstep(foot, foot + 0.3, vUv.y) * smoothstep(top, top * 0.35, vUv.y);
        // a soft veil whose density drifts, not smoke with holes in it
        float a = vSize.z * ex * ey * (0.3 + 0.7 * smoothstep(0.15, 0.7, n));
        a *= mix(1.0, 1.0 - 0.6 * vUv.y, spray);             // spray thins out as it rises

        vec3 fr = vWorld - cameraPosition;
        float d = length(fr);
        a *= mix(smoothstep(10.0, 45.0, d), smoothstep(5.0, 20.0, d), spray);   // no wall of mist in the face
        float toward = pow(max(dot(fr / d, uMoonDir), 0.0), 4.0);
        vec3 col = mix(uColor, uSpray, spray) + uGlow * toward;
        // warm where it hangs over lamp-lit streets
        vec2 luv = (vWorld.xz - uFogLightRect.xy) / uFogLightRect.zw;
        if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) {
          col += vec3(1.0, 0.45, 0.15) * texture2D(uFogLight, luv).r * 0.05;
        }
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'Mist';
  return {
    mesh,
    uniforms,
    update(dt) {
      uniforms.uTime.value += dt;
    },
  };
}
