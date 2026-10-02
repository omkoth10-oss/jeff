import * as THREE from 'three';
import { noiseGLSL } from '../shaders/noise.js';

// Terrain material: MeshStandardMaterial with albedo, normal and roughness replaced.
// Inside the walkable valley a ground-texture map (valley_splat) picks flagstone
// streets and stairs, the dirt trail, muddy banks and grass; everywhere else it is
// forest floor. Rock follows slope and the cliff mask, snow follows height and slope.
// Vertex colours from Blender: R = cliff rock, B = snow allowed.
export async function createTerrain(loaders, layout) {
  const names = [
    'dark_rock_color', 'dark_rock_normal', 'forrest_ground_03_color', 'leafy_grass_color',
    'leafy_grass_normal', 'stone_pathway_color', 'stone_pathway_normal',
  ];
  const [gltf, splat, ...tex] = await Promise.all([
    loaders.loadModel('terrain.glb'),
    loaders.loadTexture('valley_splat.ktx2'),
    ...names.map((n) => loaders.loadTexture(`${n}.ktx2`)),
  ]);
  const t = Object.fromEntries(names.map((n, i) => [n, tex[i]]));
  for (const x of tex) {
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.anisotropy = loaders.maxAnisotropy;
  }
  splat.anisotropy = loaders.maxAnisotropy;

  const [x0, x1, z0, z1] = layout.valleyRect;
  const uniforms = {
    uRockColor: { value: t.dark_rock_color },
    uRockNormal: { value: t.dark_rock_normal },
    uGroundColor: { value: t.forrest_ground_03_color },
    uGrassColor: { value: t.leafy_grass_color },
    uGrassNormal: { value: t.leafy_grass_normal },
    uStoneColor: { value: t.stone_pathway_color },
    uStoneNormal: { value: t.stone_pathway_normal },
    uSplat: { value: splat },
    uValleyMin: { value: new THREE.Vector2(x0, z0) },
    uValleySize: { value: new THREE.Vector2(x1 - x0, z1 - z0) },
    uSnowColor: { value: new THREE.Color(0.46, 0.53, 0.64) },
    uSnowLine: { value: 155 },
    // waterfalls (top x, y, z, half width at the lip), for the wet rock around them
    uFalls: { value: layout.waterfalls.map((f) => new THREE.Vector4(f.top[0], f.top[1], f.top[2], (f.widthTop ?? 8) / 2)) },
  };

  const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 color;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        varying vec4 vMask;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);
        vMask = color;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uRockColor, uRockNormal, uGroundColor;
        uniform sampler2D uGrassColor, uGrassNormal, uStoneColor, uStoneNormal, uSplat;
        uniform vec2 uValleyMin, uValleySize;
        uniform vec3 uSnowColor;
        uniform float uSnowLine;
        uniform vec4 uFalls[2];
        varying vec3 vWPos;
        varying vec3 vWNormal;
        varying vec4 vMask;
        ${noiseGLSL}
        vec3 gTerrainNormal;
        float gTerrainRough;

        // Samples inside branches use explicit gradients so mip selection stays
        // correct where neighbouring pixels take different branches.
        vec4 sampleG(sampler2D s, vec2 uv, vec2 dx, vec2 dy) { return textureGrad(s, uv, dx, dy); }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
        vec3 n = normalize(vWNormal);
        vec3 p = vWPos;
        vec3 dpx = dFdx(p), dpy = dFdy(p);
        float dist = length(p - cameraPosition);
        float detail = 1.0 - smoothstep(350.0, 900.0, dist);     // texture detail fades out far away
        float macro = vnoise(p.xz / 55.0) * 0.65 + vnoise(p.xz / 21.0) * 0.35;
        float slope = 1.0 - n.y;

        // valley ground-texture weights: R stone path, G dirt, B wet mud, A grass
        vec2 suv = (p.xz - uValleyMin) / uValleySize;
        vec4 sp = texture2D(uSplat, suv);
        sp *= step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);

        // forest floor everywhere: fine tiling up close, a coarser one in the middle distance
        float groundNear = 1.0 - smoothstep(40.0, 140.0, dist);
        vec3 forest = texture2D(uGroundColor, p.xz / 19.0).rgb;
        if (groundNear > 0.0) forest = mix(forest, sampleG(uGroundColor, p.xz / 2.5, dpx.xz / 2.5, dpy.xz / 2.5).rgb, groundNear);
        forest = mix(vec3(0.05, 0.06, 0.04), forest * 0.62, detail) * mix(vec3(0.34, 0.42, 0.30), vec3(0.45, 0.48, 0.34), macro);
        vec3 albedo = forest;
        vec3 tn = vec3(0.0, 0.0, 1.0);          // ground detail normal, top-down projection
        float rough = 0.95;

        if (sp.a > 0.01) {                      // grass, with a second noise scale against tiling
          vec2 uv = p.xz / 2.2;
          vec3 g = sampleG(uGrassColor, uv, dpx.xz / 2.2, dpy.xz / 2.2).rgb * (0.7 + 0.6 * fbm3(p.xz / 9.0));
          albedo = mix(albedo, g * vec3(0.37, 0.44, 0.38), sp.a);   // night grass: dark, desaturated
          tn = mix(tn, sampleG(uGrassNormal, uv, dpx.xz / 2.2, dpy.xz / 2.2).xyz * 2.0 - 1.0, sp.a * groundNear);
        }
        if (sp.g > 0.01) {                      // packed dirt: trail and worn verges
          vec3 d = forest * vec3(1.3, 1.08, 0.86) + vec3(0.035, 0.028, 0.02);
          // trodden earth: patchy, with grit and small stones up close
          d *= 0.72 + 0.56 * fbm3(p.xz * 0.9);
          if (groundNear > 0.0) {
            vec2 cell = floor(p.xz * 3.0);
            vec2 jit = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) * 0.5 - 0.25;
            float pebble = step(0.93, hash12(cell)) * smoothstep(0.22, 0.08, length(fract(p.xz * 3.0) - 0.5 - jit));
            d = mix(d, d * 0.62, pebble * groundNear);
            tn = mix(tn, sampleG(uStoneNormal, p.xz / 0.9, dpx.xz / 0.9, dpy.xz / 0.9).xyz * 2.0 - 1.0, sp.g * groundNear * 0.6);
          }
          albedo = mix(albedo, d, sp.g);
          rough = mix(rough, 0.9, sp.g);
        }
        if (sp.r > 0.01) {                      // flagstone streets and stairs
          vec2 uv = p.xz / 2.0;
          vec3 st = sampleG(uStoneColor, uv, dpx.xz / 2.0, dpy.xz / 2.0).rgb * vec3(0.4, 0.42, 0.47);   // dark, dewy flagstones
          albedo = mix(albedo, st, sp.r);
          tn = mix(tn, sampleG(uStoneNormal, uv, dpx.xz / 2.0, dpy.xz / 2.0).xyz * 2.0 - 1.0, sp.r * groundNear);
          rough = mix(rough, 0.86, sp.r);
        }
        if (sp.b > 0.01) {                      // wet stones and gravel along the banks
          vec2 uv = p.xz / 1.3;
          vec3 st = sampleG(uRockColor, uv, dpx.xz / 1.3, dpy.xz / 1.3).rgb * vec3(2.2, 2.3, 2.5);   // dark wet river pebbles
          albedo = mix(albedo, st * 0.75, sp.b * 0.85);
          tn = mix(tn, sampleG(uRockNormal, uv, dpx.xz / 1.3, dpy.xz / 1.3).xyz * 2.0 - 1.0, sp.b * groundNear);
        }
        rough = mix(rough, 0.82, sp.b);
        vec3 groundN = normalize(vec3(tn.x + n.x, abs(tn.z) * n.y, tn.y + n.z));

        // rock: triplanar near, one large-scale planar sample far (mountain striations)
        float rockW = max(smoothstep(0.30, 0.45, slope + (macro - 0.5) * 0.12) * (1.0 - sp.r), vMask.r);   // cliff faces and their ledges are rock
        vec3 rockN = n;
        if (rockW > 0.01) {
          vec2 fuv = vec2(p.x + p.z, p.y * 2.2) / 90.0;
          vec3 rock = sampleG(uRockColor, fuv, vec2(dpx.x + dpx.z, dpx.y * 2.2) / 90.0, vec2(dpy.x + dpy.z, dpy.y * 2.2) / 90.0).rgb * vec3(0.8, 0.85, 1.0);
          if (detail > 0.0) {                   // triplanar detail only where it can be seen
            vec3 w = pow(abs(n), vec3(4.0));
            w /= (w.x + w.y + w.z);
            float rs = 1.0 / 4.0;
            vec3 rockNear = sampleG(uRockColor, p.zy * rs, dpx.zy * rs, dpy.zy * rs).rgb * w.x
                          + sampleG(uRockColor, p.xz * rs, dpx.xz * rs, dpy.xz * rs).rgb * w.y
                          + sampleG(uRockColor, p.xy * rs, dpx.xy * rs, dpy.xy * rs).rgb * w.z;
            // a second, coarser scale in patches, so the 4 m tile doesn't repeat like masonry
            // (one planar sample, on the face's own plane)
            float rs2 = 1.0 / 11.0;
            vec2 hz0 = normalize(n.xz + vec2(1e-4));
            vec2 mq = vec2(dot(p.xz, vec2(-hz0.y, hz0.x)), p.y) * rs2 + 0.37;
            vec3 rockMid = sampleG(uRockColor, mq, vec2(dot(dpx.xz, vec2(-hz0.y, hz0.x)), dpx.y) * rs2, vec2(dot(dpy.xz, vec2(-hz0.y, hz0.x)), dpy.y) * rs2).rgb;
            rockNear = mix(rockNear, rockMid, smoothstep(0.35, 0.65, vnoise(p.xz / 17.0 + p.y / 13.0)) * (1.0 - w.y));
            rock = mix(rock, rockNear, detail);
            // rock detail normal (whiteout triplanar blend)
            vec3 tx = sampleG(uRockNormal, p.zy * rs, dpx.zy * rs, dpy.zy * rs).xyz * 2.0 - 1.0;
            vec3 ty = sampleG(uRockNormal, p.xz * rs, dpx.xz * rs, dpy.xz * rs).xyz * 2.0 - 1.0;
            vec3 tz = sampleG(uRockNormal, p.xy * rs, dpx.xy * rs, dpy.xy * rs).xyz * 2.0 - 1.0;
            tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
            ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
            tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
            rockN = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
          }
          // Rock structure on the big faces (they are smooth planes in the mesh): wavy
          // strata a couple of metres apart with lit lips and shadowed undercuts, and
          // fracture facets that turn the surface toward and away from the moon.
          vec2 hz = normalize(n.xz + vec2(1e-4));
          vec3 faceT = vec3(-hz.y, 0.0, hz.x);                     // along the face
          float fa = dot(p, faceT);
          float sy = p.y / 2.7 + vnoise(vec2(fa / 16.0, p.y / 40.0)) * 1.6;
          float band = fract(sy);
          float seam = smoothstep(0.12, 0.0, band) + smoothstep(0.9, 1.0, band) * 0.4;
          // fracture facets: the rock normal map blown up to ~9 m on the face's plane
          float faceness = smoothstep(0.25, 0.6, slope) * detail;
          vec2 fq = vec2(fa, p.y * 1.3) / 9.0 + 0.21;
          vec3 fN = sampleG(uRockNormal, fq, vec2(dot(dpx, faceT), dpx.y * 1.3) / 9.0, vec2(dot(dpy, faceT), dpy.y * 1.3) / 9.0).xyz * 2.0 - 1.0;
          float f0 = 0.5 + 0.5 * fN.x;
          rockN = normalize(rockN + (faceT * fN.x + vec3(0.0, 1.0, 0.0) * fN.y) * 0.9 * faceness
                          + vec3(0.0, 0.55 * smoothstep(0.1, 0.0, band) - 0.25 * smoothstep(0.85, 1.0, band), 0.0) * faceness);
          // vertical joints and cracks (they show even where the face is in shadow)
          float crack = smoothstep(0.035, 0.0, abs(vnoise(vec2(fa / 3.2, p.y / 22.0)) - 0.5));
          rock *= mix(1.0, 0.4, seam * faceness) * mix(1.0, 0.45, crack * faceness) * (0.7 + 0.6 * f0);
          // moss and lichen on ledges, and where seepage and spray keep the rock damp
          float moss = smoothstep(0.45, 0.8, n.y) * smoothstep(0.4, 0.75, vnoise(p.xz / 3.0 + 4.0))
                     + seam * faceness * 0.35 * smoothstep(0.5, 0.8, vnoise(vec2(fa / 4.0, p.y / 9.0)));
          rock = mix(rock, vec3(0.012, 0.016, 0.009) * (0.7 + 0.6 * vnoise(p.xz * 1.3)), clamp(moss, 0.0, 0.85) * detail);
          // the rock texture is near-black, reddish basalt (average ~0.015): mostly
          // desaturated and scaled up to a neutral grey stone (reddish rock under blue
          // moonlight reads violet)
          vec3 rockGrey = mix(vec3(dot(rock, vec3(0.3, 0.59, 0.11))), rock, 0.3);
          // tonal variation so big faces aren't one flat grey: broad lighter and darker
          // patches, and darker vertical water stains running down the cliffs
          float stain = vnoise(vec2((p.x + p.z) / 5.0, p.y / 32.0));
          float tone = (0.62 + 0.5 * macro) * mix(0.6, 1.12, smoothstep(0.25, 0.75, stain));
          // distant rock stays darker so the moonlit snow on the peaks reads against it
          albedo = mix(albedo, rockGrey * vec3(4.8, 5.1, 5.5) * tone * mix(0.5, 1.0, detail), rockW);
        }

        // snow settles on ledges, gullies and gentler faces; steep faces and crests stay
        // dark rock, which is what gives the range its craggy read from a distance
        float snowW = 0.0;
        if (vMask.b > 0.01 && p.y > uSnowLine - 60.0) {   // only the high mountains can hold snow
          float snowNoise = fbm3(p.xz / 140.0) - 0.5;
          float snowLine = uSnowLine + snowNoise * 90.0;
          float streak = fbm3(vec2((p.x + p.z) / 45.0, p.y / 9.0));      // vertical couloir streaks
          snowW = vMask.b * smoothstep(snowLine, snowLine + 50.0, p.y)
                * smoothstep(0.40, 0.24, slope + snowNoise * 0.25 + (streak - 0.5) * 0.35 - (p.y - snowLine) * 0.0006);
          albedo = mix(albedo, uSnowColor * (0.85 + 0.15 * macro), snowW);
        }
        // the ledge the ninja stands on is dark basalt: the foreground frames the lit valley
        albedo *= mix(0.5, 1.0, smoothstep(8.0, 30.0, length(p.xz)));
        // wet ground along the water line of the river: darker and glossier
        float wet = smoothstep(1.1, 0.05, p.y) * smoothstep(-0.9, -0.25, p.y) * step(-400.0, p.z) * step(p.z, 60.0);
        // cliffs around the waterfalls are soaked by the spray: darker, glinting
        for (int i = 0; i < 2; i++) {
          vec4 f = uFalls[i];
          float spray = smoothstep(f.w + 9.0, f.w + 1.0, length(p.xz - f.xz)) * step(p.y, f.y + 0.6);
          wet = max(wet, spray);
        }
        albedo *= mix(1.0, 0.35, wet);
        rough = mix(rough, 0.84, wet);
        // under the river the bed is seen through the water: darker, and matte (the
        // water surface, not the stones, reflects the moon)
        float under = smoothstep(0.0, -0.9, p.y) * step(-400.0, p.z) * step(p.z, 60.0);
        albedo *= mix(1.0, 0.45, under);
        rough = mix(rough, 1.0, under);
        #ifdef USE_FOG
        {
          // contact darkening around the buildings (B channel of the lamp map, world/lamps.js)
          vec2 aoUv = (p.xz - uFogLightRect.xy) / uFogLightRect.zw;
          if (aoUv.x > 0.0 && aoUv.x < 1.0 && aoUv.y > 0.0 && aoUv.y < 1.0) albedo *= 1.0 - 0.6 * texture2D(uFogLight, aoUv).b;
        }
        #endif
        diffuseColor.rgb *= albedo;

        vec3 nGround = normalize(mix(n, groundN, detail));
        gTerrainNormal = normalize(mix(nGround, rockN, rockW * (1.0 - snowW) * detail * 0.9));
        gTerrainRough = mix(mix(rough, 0.92, rockW), 0.7, snowW);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = gTerrainRough;',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `normal = normalize((viewMatrix * vec4(gTerrainNormal, 0.0)).xyz);`,
      );
  };

  const root = gltf.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = material;
    fitBoundsIgnoringSentinel(o.geometry);
  });
  return { root, material, uniforms };
}

// Each chunk contains one zero-area triangle through two far-away corner points (see
// blender/scripts/build_terrain.py) so all chunks share Draco's quantization grid.
// Leave those points out of the bounds, or frustum culling would never cull a chunk.
function fitBoundsIgnoringSentinel(geometry) {
  const pos = geometry.attributes.position;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (Math.abs(v.x) < 5250 && Math.abs(v.z) < 5250) box.expandByPoint(v);
  }
  geometry.boundingBox = box;
  geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
}
