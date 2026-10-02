import * as THREE from 'three';

// Grass and undergrowth around the camera, placed entirely on the GPU.
//
// A fixed grid of tufts (one per cell, cells `spacing` metres apart) follows the camera,
// snapped to the cells, so each tuft keeps its place in the world as the grid slides.
// The vertex shader finds its cell from gl_InstanceID, jitters it by a hash of the
// world cell, reads the ground height from a height map rendered once from the terrain,
// and decides whether a tuft grows there: dense on the valley's grass, sparse on worn
// verges, none on flagstones, in houses (the lamp map's building mask), in the river or
// on steep rock; a looser undergrowth on the forest floor beyond the valley. Tufts
// shrink away toward the edge of the field, so its rim never shows. Blades are cut out
// of crossed cards in the fragment shader (as world/banks.js does for the bank grass).

export function createGroundCover({ renderer, terrainRoot, rect, splat, splatMin, splatSize, lampMap, lampRect, time, radius = 40, spacing = 0.85 }) {
  const height = renderHeightMap(renderer, terrainRoot, rect);
  const grid = Math.ceil((radius * 2) / spacing);
  const count = grid * grid;

  const cards = [];
  const W = 0.9, H = 0.5;
  for (let k = 0; k < 3; k++) cards.push(new THREE.PlaneGeometry(W, H).translate(0, H / 2, 0).rotateY((k * Math.PI) / 3));
  const merged = mergeGeometries(cards);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = merged.index;
  geo.setAttribute('position', merged.attributes.position);
  geo.setAttribute('uv', merged.attributes.uv);
  geo.setAttribute('normal', merged.attributes.normal);
  geo.instanceCount = count;

  const uniforms = {
    uTime: time,
    uHeight: { value: height.texture },
    uHRect: { value: new THREE.Vector4(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]) },
    uHSize: { value: new THREE.Vector2(height.width, height.height) },
    uSplat: { value: splat },
    uSplatRect: { value: new THREE.Vector4(splatMin.x, splatMin.y, splatSize.x, splatSize.y) },
    uLamp: lampMap, // shared uniforms from the fog (building mask in B)
    uLampRect: lampRect,
    uCamCell: { value: new THREE.Vector2() },
    uCamPos: { value: new THREE.Vector3() },
    uSpacing: { value: spacing },
    uGrid: { value: grid },
    uRadius: { value: radius },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0x26331f, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime, uSpacing, uRadius;
        uniform int uGrid;
        uniform vec2 uCamCell, uHSize;
        uniform vec3 uCamPos;
        uniform vec4 uHRect, uSplatRect, uLampRect;
        uniform sampler2D uHeight, uSplat, uLamp;
        varying vec2 vBladeUv;
        varying float vSeed;
        varying float vDry;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float heightAt(vec2 xz) {
          vec2 uv = vec2((xz.x - uHRect.x) / uHRect.z, (uHRect.y + uHRect.w - xz.y) / uHRect.w);
          vec2 t = uv * uHSize - 0.5, f = fract(t), b = (floor(t) + 0.5) / uHSize, o = 1.0 / uHSize;
          float a = texture2D(uHeight, b).r, c = texture2D(uHeight, b + vec2(o.x, 0.0)).r;
          float d = texture2D(uHeight, b + vec2(0.0, o.y)).r, e = texture2D(uHeight, b + o).r;
          return mix(mix(a, c, f.x), mix(d, e, f.x), f.y);
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `int gi = gl_InstanceID % uGrid, gj = gl_InstanceID / uGrid;
        vec2 cell = uCamCell + vec2(float(gi), float(gj)) - float(uGrid / 2);
        float r1 = h21(cell), r2 = h21(cell + 17.3), r3 = h21(cell + 41.9), r4 = h21(cell + 73.1);
        vec2 wp = (cell + vec2(r1, r2)) * uSpacing;
        float y = heightAt(wp);
        // where it grows
        vec2 suv = (wp - uSplatRect.xy) / uSplatRect.zw;
        float inValley = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
        vec4 sp = texture2D(uSplat, suv) * inValley;
        // (forest floor wherever the valley map paints nothing else)
        float dens = 0.42 * max(0.0, 1.0 - dot(sp, vec4(1.0))) + sp.a * 0.95 + sp.b * 0.25;
        dens *= (1.0 - smoothstep(0.05, 0.3, sp.r)) * (1.0 - smoothstep(0.2, 0.6, sp.g));   // nothing on streets and trodden earth
        vec2 luv = (wp - uLampRect.xy) / uLampRect.zw;
        if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) dens *= 1.0 - smoothstep(0.12, 0.3, texture2D(uLamp, luv).b);
        float slope = length(vec2(heightAt(wp + vec2(0.9, 0.0)) - heightAt(wp - vec2(0.9, 0.0)), heightAt(wp + vec2(0.0, 0.9)) - heightAt(wp - vec2(0.0, 0.9)))) / 1.8;
        dens *= 1.0 - smoothstep(0.55, 0.9, slope);
        dens *= step(0.25, y);                                   // not in the river
        vec2 hr = (wp - uHRect.xy) / uHRect.zw;
        dens *= step(0.01, hr.x) * step(hr.x, 0.99) * step(0.01, hr.y) * step(hr.y, 0.99);
        float d = length(wp - uCamPos.xz);
        float grow = step(r3, dens) * smoothstep(uRadius, uRadius * 0.7, d);
        float s = grow * (0.55 + 0.8 * r4) * mix(1.0, 1.35, max(0.0, 1.0 - dot(sp, vec4(1.0))));
        vBladeUv = uv;
        vSeed = r4;
        vDry = r1 * (1.0 - sp.a * 0.6);
        vec3 transformed = position * vec3(s, s * (0.75 + 0.5 * r1), s);
        float a = r2 * 6.2832, ca = cos(a), sa = sin(a);
        transformed.xz = mat2(ca, -sa, sa, ca) * transformed.xz;
        // wind: stronger toward the tips, gusts rolling across the valley
        float sway = sin(uTime * 1.3 + wp.x * 0.15 + wp.y * 0.1) * 0.6 + sin(uTime * 3.1 + r4 * 20.0) * 0.25;
        transformed.x += sway * 0.06 * uv.y * uv.y * s;
        transformed += vec3(wp.x, y - 0.04, wp.y);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBladeUv;\nvarying float vSeed;\nvarying float vDry;')
      .replace(
        '#include <alphatest_fragment>',
        `{
          float a = 0.0, shade = 0.0;
          for (int i = 0; i < 10; i++) {
            float fi = float(i);
            float h = fract(sin(fi * 91.3 + vSeed * 37.0) * 4375.5);
            float x0 = 0.1 + 0.8 * fract(h * 7.1 + fi * 0.37);
            float lean = (h - 0.5) * 1.3;
            float top = 0.45 + 0.55 * fract(h * 3.3);
            float yy = vBladeUv.y / top;
            float w = 0.05 * (1.0 - yy) + 0.004;
            float blade = step(abs(vBladeUv.x - x0 - lean * yy * yy), w) * step(yy, 1.0);
            a = max(a, blade);
            shade = max(shade, blade * yy);
          }
          diffuseColor.a = a;
          diffuseColor.rgb *= mix(0.5, 1.3, shade) * mix(vec3(1.0), vec3(1.35, 1.2, 0.8), vDry * 0.6);
        }
        #include <alphatest_fragment>`,
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'ground-cover';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'GroundCover';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;

  const cam = new THREE.Vector3();
  return {
    mesh,
    count,
    update(dt, camera) {
      camera.getWorldPosition(cam);
      uniforms.uCamPos.value.copy(cam);
      uniforms.uCamCell.value.set(Math.floor(cam.x / spacing), Math.floor(cam.z / spacing));
      // only near the ground: from high viewpoints the field would be beyond the fog anyway
      mesh.visible = cam.y - 0 < 400;
    },
  };
}

// The terrain's height seen from above, as a float texture over rect [x0, z0, x1, z1]
// (u along x, v from z1 at the bottom to z0 at the top).
function renderHeightMap(renderer, terrainRoot, [x0, z0, x1, z1], texel = 0.4) {
  const width = Math.min(2048, Math.ceil((x1 - x0) / texel)), height = Math.min(2048, Math.ceil((z1 - z0) / texel));
  const rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  rt.texture.minFilter = rt.texture.magFilter = THREE.NearestFilter;
  rt.texture.generateMipmaps = false;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const cam = new THREE.OrthographicCamera(x0 - cx, x1 - cx, -(z0 - cz), -(z1 - cz), 1, 3000);
  cam.position.set(cx, 1500, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, 0, cz);
  cam.updateMatrixWorld();
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying float vY; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying float vY; void main() { gl_FragColor = vec4(vY, 0.0, 0.0, 1.0); }',
    side: THREE.DoubleSide,
  });
  const saved = [];
  terrainRoot.traverse((o) => {
    if (o.isMesh) {
      saved.push([o, o.material]);
      o.material = mat;
    }
  });
  const prevTarget = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  terrainRoot.updateMatrixWorld(true);
  renderer.render(terrainRoot, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  for (const [o, m] of saved) o.material = m;
  mat.dispose();
  return { texture: rt.texture, width, height };
}

function mergeGeometries(list) {
  const pos = [], uv = [], nor = [], idx = [];
  for (const g of list) {
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    uv.push(...g.attributes.uv.array);
    nor.push(...g.attributes.normal.array);
    for (const i of g.index.array) idx.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
