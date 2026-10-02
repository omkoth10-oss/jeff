import * as THREE from 'three';
import { createLoaders } from './loaders.js';
import { CAMERA, NINJA, MOON_NDC, REFERENCE_ASPECT } from './config.js';
import { createPerfHud } from './dev/perfHud.js';
import { createTerrain } from './world/terrain.js';
import { createWater } from './world/water.js';
import { createSky } from './world/sky.js';
import { createVillage } from './world/village.js';
import { createVegetation } from './world/vegetation.js';
import { createFlyCamera } from './dev/flyCamera.js';
import { createHeightFog } from './render/fog.js';
import { createPost } from './render/post.js';
import { buildLampMap } from './world/lamps.js';
import { createReflection } from './render/reflection.js';
import { createMist } from './world/mist.js';
import { MIST_BANKS } from './world/mistBanks.js';
import { createGlows } from './world/glows.js';
import { createAdaptiveResolution } from './render/adaptiveResolution.js';
import { createLightPool } from './render/lightPool.js';
import { createAmbient } from './world/ambient.js';
import { createReeds, createBankGrass, postFoamSpots } from './world/banks.js';
import { createEmbankments } from './world/embankments.js';
import { createGroundCover } from './world/groundCover.js';
import { createStreetProps } from './world/streetProps.js';
import { createTitle, loadSettings } from './ui/title.js';
import { createSoundscape } from './audio/soundscape.js';
import { createTour } from './ui/tour.js';

const params = new URLSearchParams(location.search);
const UP = new THREE.Vector3(0, 1, 0);

const stage = document.getElementById('stage');
const canvas = document.getElementById('scene');

// --- KAGE title screen (also the loading screen; ?notitle skips it for dev work) ---
const QUALITY = { performance: 1.0, balanced: 1.25, cinematic: 1.5 };
let tour = null;
const title = params.has('notitle') ? null : createTitle({
  onStart() {
    canvas.requestPointerLock?.()?.catch?.(() => {}); // (inside the click: the game starts on pointer lock)
    title.hide('live');
  },
  onExplore() {
    if (!game) return;
    tour ??= createTour(camera, (x, z, top) => {
      const { RAPIER, world } = game.physics;
      const hit = world.castRay(new RAPIER.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }), top + 50, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, (0x0008 << 16) | 0x0001);
      return hit ? top - hit.timeOfImpact : 0;
    });
    tour.start();
    title.hide('tour');
  },
  onSettings: applySettings,
});
// the soundscape (src/audio): starts making its sounds at once, plays from the first click
const audio = createSoundscape({ settings: title?.settings ?? loadSettings() });
function applySettings(s) {
  if (!s) return;
  audio.setVolumes(s);
  adaptive?.setMax(Math.min(devicePixelRatio, QUALITY[s.quality] ?? 1.25));
  game?.rig.configure({ sensitivity: s.sensitivity, invertY: s.invertY });
}
addEventListener('keydown', (e) => {
  if (!title) return;
  if (tour?.active && (e.code === 'Escape' || e.code === 'Enter')) {
    tour.stop();
    title.show();
  } else if (e.code === 'KeyM' && game?.state.started && !game.input.state.locked && !title.covering) title.show(); // back to the title from pause
});

// Anti-aliasing is done by the post-processing composer (MSAA on its render target).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
// Retina at full DPR is too expensive on an M1 Air: the pixel ratio stays within 1.0-1.5,
// set by the adaptive resolution further down.
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMappingExposure = 1.35;

const scene = new THREE.Scene();
// Enables fog in every material; the actual fog is the height fog in render/fog.js.
scene.fog = new THREE.FogExp2(0x000000, 0);

const camera = new THREE.PerspectiveCamera(CAMERA.fov, REFERENCE_ASPECT, CAMERA.near, CAMERA.far);

function placeCamera() {
  const offset = CAMERA.offset.clone().applyAxisAngle(UP, CAMERA.yaw);
  camera.position.copy(NINJA.position).add(offset);
  camera.rotation.set(CAMERA.pitch, CAMERA.yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
}
placeCamera();

// Moon direction taken from its position in the main reference, so the moon and
// the moonlight line up with the reference framing regardless of window size.
camera.updateProjectionMatrix();
const moonDir = new THREE.Vector3(MOON_NDC.x, MOON_NDC.y, 0.5).unproject(camera).sub(camera.position).normalize();

const fog = createHeightFog(moonDir);
// Everything added to the scene goes through here so its materials get the height fog.
function add(object) {
  fog.patchObject(object);
  scene.add(object);
  return object;
}

// --- lighting ---
// The visible moon sits low and straight ahead, which would backlight everything.
// Like the reference, the moonlight rakes in from the right and above instead, so
// peaks show lit snow faces and roofs catch a cool rim.
// from the right and slightly behind the scene (as the reference): the foreground stays dark
// with lit edges, cliffs and roofs facing right catch the light, shadows fall to the left
const keyDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(61), THREE.MathUtils.degToRad(97));
// sky fill: shadows stay deep navy but hold detail instead of crushing to black
scene.add(new THREE.HemisphereLight(0x2a4866, 0x080c12, 0.45));
const moonLight = new THREE.DirectionalLight(0xa6c2f0, 1.9);
moonLight.position.copy(NINJA.position).addScaledVector(keyDir, 500);
moonLight.target.position.copy(NINJA.position);
scene.add(moonLight, moonLight.target);

// Moon shadows: one shadow map over the valley, rendered only when parts of the world
// finish loading (nothing in it moves), so each frame pays a texture lookup, not a pass.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
const SHADOW_CENTER = new THREE.Vector3(25, 0, -150);
moonLight.target.position.copy(SHADOW_CENTER);
moonLight.position.copy(SHADOW_CENTER).addScaledVector(keyDir, 700);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(2048, 2048);
Object.assign(moonLight.shadow.camera, { left: -250, right: 250, top: 250, bottom: -250, near: 300, far: 1100 });
moonLight.shadow.camera.updateProjectionMatrix();
moonLight.shadow.bias = -0.0004;
moonLight.shadow.normalBias = 0.4;
function shadows(root, cast) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = true;
    }
  });
  renderer.shadowMap.needsUpdate = true;
}
// A dim light from the real moon behind the scene: it only reaches surfaces turned
// away from the camera, so it draws a cool rim around the ninja, roof ridges and
// tree crowns against the mist.
const rimLight = new THREE.DirectionalLight(0xa8c4f0, 0.45);
rimLight.position.copy(NINJA.position).addScaledVector(moonDir, 500);
rimLight.target.position.copy(NINJA.position);
scene.add(rimLight, rimLight.target);

const sky = createSky(moonDir);
scene.add(sky.mesh);

// --- the ninja: rigged model, animated procedurally by the game (src/game/proc) ---
const ninja = new THREE.Group();
ninja.position.copy(NINJA.position);
ninja.rotation.y = NINJA.yaw + Math.PI; // the model faces +z; the ninja looks down -z into the valley
ninja.scale.setScalar(1.08); // model is 1.66 m in this pose; ~1.8 m reads like the reference
scene.add(ninja);

// --- world ---
const loaders = createLoaders(renderer);

const moon = new THREE.Sprite(
  // bright enough to bloom, not so bright that the maria wash out
  new THREE.SpriteMaterial({ color: new THREE.Color(1.9, 1.95, 2.1), fog: false, depthWrite: false }),
);
const MOON_DISTANCE = 5300; // beyond the far range, inside the far plane
moon.scale.setScalar(170 * (MOON_DISTANCE / 3000));
moon.visible = false;
scene.add(moon);
loaders.loadTexture('moon.ktx2').then((tex) => {
  moon.material.map = tex;
  moon.material.needsUpdate = true;
  moon.visible = true;
});

// Cool rim along the ninja's silhouette, so the black figure separates from the dark
// rock and valley behind it like in the reference (a game-style fresnel rim light).
function addRim(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev?.call(material, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        // only on the side facing the moon: a thin silver edge, not an outline
        float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
        vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
        rim *= smoothstep(0.0, 0.6, dot(nW, vec3(${moonDir.x.toFixed(3)}, ${moonDir.y.toFixed(3)}, ${moonDir.z.toFixed(3)})));
        totalEmissiveRadiance += vec3(0.16, 0.22, 0.36) * rim * 0.45;
      }`,
    );
  };
  material.customProgramCacheKey = () => 'ninja-rim';
  material.needsUpdate = true;
}

const updaters = [];
const ninjaReady = loaders.loadModel('ninja.glb').then((gltf) => {
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false; // skinned bounds don't follow the pose
      o.material.roughness = 0.68; // a little sheen on the black cloth catches the moonlight
      o.material.metalness = 0;
      addRim(o.material);
    }
  });
  fog.patchObject(gltf.scene);
  shadows(gltf.scene, false); // receives only: it moves, the shadow map is static
  gltf.scene.visible = false; // (in its T-pose until the game poses it)
  ninja.add(gltf.scene);
  return gltf;
});
const layoutReady = fetch(`${import.meta.env.BASE_URL}data/layout.json`).then((r) => r.json());
const terrainReady = layoutReady.then((layout) => createTerrain(loaders, layout)).then((terrain) => {
  add(terrain.root);
  shadows(terrain.root, true);
  return terrain;
});
// Planar reflection for the river; the moon streak on the water uses the moon's
// azimuth with a raised elevation so it lands on the river in view, as in the reference.
const reflection = createReflection(renderer, 0, 1 / 4);
// Its azimuth is turned 4 degrees left of the moon, so from the ledge the glitter path runs
// down the middle of the river rather than along its right bank (art-directed, as in the reference).
const specDir = new THREE.Vector3(moonDir.x, 0, moonDir.z).normalize().applyAxisAngle(UP, THREE.MathUtils.degToRad(4))
  .multiplyScalar(Math.cos(0.5)).setY(Math.sin(0.5));
const waterReady = layoutReady.then((layout) => createWater(loaders, reflection, specDir, layout)).then((water) => {
  add(water.root);
  add(water.falls);
  updaters.push(water.update);
  return water;
});
const villageReady = createVillage(loaders).then((village) => {
  add(village.root);
  shadows(village.root, true);
  updaters.push(village.update);
  return village;
});
// real lights for the lamps nearest the camera (the light map covers the rest)
const lightPool = createLightPool(fog.uniforms.uLampPoints.value);
updaters.push(lightPool.update);
const glowsReady = Promise.all([villageReady, layoutReady]).then(([village, layout]) => {
  const glows = createGlows(village.data, layout);
  add(glows.root);
  updaters.push(glows.update);
  const lampMap = buildLampMap(village.data, layout, glows.torches);
  fog.setLampMap(lampMap);
  lightPool.setPoints(lampMap.points);
  return glows;
});
Promise.all([terrainReady, waterReady]).then(async ([terrain, water]) => {
  const veg = await createVegetation(loaders, renderer, {
    rockColor: terrain.uniforms.uRockColor.value,
    rockNormal: terrain.uniforms.uRockNormal.value,
  });
  add(veg.root);
  shadows(veg.rocks, true);
  renderer.shadowMap.needsUpdate = true; // the billboards cast (vegetation.js sets their flags)
  noReflect.push(veg.near, veg.rocks);
  const layout = await layoutReady;
  const village = await villageReady;
  const reeds = createReeds(layout, village.data, groundHeight, sky.uniforms.uTime);
  add(reeds.mesh);
  const grass = createBankGrass(layout, village.data, groundHeight, sky.uniforms.uTime);
  add(grass.mesh);
  water.addFoam(postFoamSpots(village.data, layout, water.depthAt, water.flowAt));
  const ambient = createAmbient({ ...veg, props: village.data.props }, layout.valleyRect, renderer);
  scene.add(ambient.root);
  noReflect.push(ambient.root);
  updaters.push(ambient.update);
  water.addFoam(veg.foam);
  fog.patchObject(water.root);
  updaters.push(veg.update);
});

// Height of the rendered terrain under (x, z); used by dev tools until the controller
// (step 6) switches to the collision mesh.
const downRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 2000);
let terrainRoot = null;
terrainReady.then((t) => {
  terrainRoot = t.root;
  const mist = createMist(MIST_BANKS, groundHeight, moonDir, fog.uniforms);
  scene.add(mist.mesh);
  noReflect.push(mist.mesh); // the water already sits under the mist; reflected, it doubled up
  updaters.push(mist.update);
  if (window.app) window.app.mist = mist;
});
function groundHeight(x, z) {
  if (!terrainRoot) return 0;
  downRay.ray.origin.set(x, 1000, z);
  const hit = downRay.intersectObject(terrainRoot, true)[0];
  return hit ? hit.point.y : 0;
}

// stone river walls through the village (built from the water map and the terrain)
const embankReady = Promise.all([terrainReady, waterReady, villageReady]).then(([, water, village]) => {
  const deck = village.data.bridgeDeck ?? [];
  const ends = deck.length ? [deck[0], deck[deck.length - 1]].map(([x, , z]) => [x, z, 6]) : [];
  const banks = createEmbankments({
    depthAt: water.depthAt, groundHeight, houses: village.data.houses, material: village.material,
    // (not at the bridge ends, nor the shallow beach below the right street where people
    // wade in)
    rect: [-70, -262, 45, -40], exclude: [...ends, [5, -188, 7]],
  });
  village.root.add(banks.mesh, banks.collider);
  shadows(banks.mesh, true);
  renderer.shadowMap.needsUpdate = true;
  if (window.app) window.app.embankments = banks.stats;
  return banks;
});
// barrels, buckets, firewood, crates, shrubs and benches along the house fronts (their
// boxes join the village's blockers before the physics is built)
const propsReady = Promise.all([terrainReady, waterReady, villageReady, layoutReady]).then(([, water, village, layout]) => {
  const street = createStreetProps({
    houses: village.data.houses, props: village.data.props, torches: village.data.torches, shopLot: layout.pads?.shop_lot,
    depthAt: water.depthAt, groundHeight, material: village.material,
  });
  village.root.add(street.root);
  shadows(street.root, true);
  renderer.shadowMap.needsUpdate = true;
  village.data.blockers.push(...street.blockers);
  if (window.app) window.app.streetProps = street.count;
  return street;
});
// grass and undergrowth around the camera (needs the terrain, its ground map and the
// lamp map's building mask)
Promise.all([terrainReady, layoutReady, glowsReady]).then(([terrain, layout]) => {
  const xs = layout.playArea.map((p) => p[0]), zs = layout.playArea.map((p) => p[1]);
  const cover = createGroundCover({
    renderer, terrainRoot: terrain.root,
    rect: [Math.min(...xs) - 40, Math.min(...zs) - 40, Math.max(...xs) + 40, Math.max(...zs) + 40],
    splat: terrain.uniforms.uSplat.value, splatMin: terrain.uniforms.uValleyMin.value, splatSize: terrain.uniforms.uValleySize.value,
    lampMap: fog.uniforms.uFogLight, lampRect: fog.uniforms.uFogLightRect, time: sky.uniforms.uTime,
  });
  add(cover.mesh);
  noReflect.push(cover.mesh);
  updaters.push(cover.update);
  if (window.app) window.app.groundCover = cover;
});
// --- the game: physics, player, third-person camera (src/game) ---
// Loaded as its own chunk, in parallel with the world (the physics engine is ~1.7 MB),
// so the scene draws while it arrives.
let game = null;
const gameModule = import('./game/game.js');
Promise.all([
  gameModule,
  layoutReady, terrainReady, villageReady, waterReady, glowsReady, ninjaReady, embankReady, propsReady,
  loaders.loadModel('collision.glb'), loaders.loadModel('village_collision.glb'),
  fetch(`${import.meta.env.BASE_URL}data/rocks.json`).then((r) => r.json()),
]).then(async ([{ createGame }, layout, terrain, village, water, glows, gltf, , , collision, villageCollision, rocks]) => {
  game = await createGame({
    scene, camera, dom: canvas, ninja, ninjaModel: gltf.scene, water,
    layout, terrainRoot: terrain.root, villageRoot: village.root, villageCollision: villageCollision.scene,
    collision: collision.scene, blockers: village.data.blockers, rocks, torches: glows.colliders, depthAt: water.depthAt,
  });
  if (window.app) {
    window.app.game = game;
    import('./dev/walkTest.js').then((m) => (window.app.walkTest = m.createWalkTest(window.app, layout, village.data)));
    import('./dev/motionSheet.js').then((m) => (window.app.motion = m.createMotionSheet(window.app)));
  }
  console.info('[game] physics colliders', game.physics.stats);
  applySettings(title?.settings);
  audio.attachWorld({ layout, village: village.data, torches: glows.colliders, trunks: rocks.trunks });
  game.onEvent = audio.handle;
  // a few frames so every shader is compiled before the title lets anyone in
  for (let i = 0; i < 3; i++) {
    update(1 / 60);
    renderReflection();
    post.composer.render(1 / 60);
  }
  title?.ready();
});
if (title) {
  const parts = [layoutReady, terrainReady, villageReady, waterReady, glowsReady, ninjaReady, embankReady, propsReady, gameModule];
  let done = 0;
  parts.forEach((pr) => pr.then(() => title.progress((++done / (parts.length + 1)) * 0.95)));
}

// --- post-processing ---
const post = createPost(renderer, scene, camera);

// --- resize to the stage (the dev compare tool may shrink it to 3:2) ---
function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  post.composer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();
// resolution follows the GPU's headroom (?fixed keeps it at the maximum, for measuring)
// On an M1 Air at full screen, 1.25 holds 60 fps with headroom; 1.5 is tried when smooth.
const adaptive = params.has('fixed') ? null : createAdaptiveResolution(renderer, resize, { max: Math.min(devicePixelRatio, 1.5), start: Math.min(devicePixelRatio, 1.25) });

// --- dev tools ---
const perf = import.meta.env.DEV || params.has('stats') ? createPerfHud(renderer) : null;
let fly = null;
function update(dt) {
  // the game moves and poses the player and places the camera before anything reads
  // the camera
  if (game) game.update(dt, { cameraFree: !!fly?.active || !!tour?.active });
  if (tour?.active) title.place(tour.update(dt));
  for (const u of updaters) u(dt, camera);
  sky.uniforms.uTime.value += dt;
  fog.uniforms.uFogTime.value += dt;
  // Keep the moon at "infinity": it moves with the camera so it never shows parallax.
  moon.position.copy(camera.position).addScaledVector(moonDir, MOON_DISTANCE);
}
if (import.meta.env.DEV) {
  import('./dev/referenceCompare.js').then((m) => m.initReferenceCompare());
  fly = createFlyCamera(camera, canvas, groundHeight);
  updaters.push((dt) => fly.update(dt));
  // tick(dt) runs the per-frame updates (LOD selection etc.) without the animation loop;
  // render() draws one full frame including post-processing
  window.app = {
    THREE, scene, camera, renderer, perf, fly, groundHeight, fog, post, sky, moonLight, rimLight, reflection, moon,
    tick: (dt = 1 / 60) => update(dt),
    // pixel ratio, with the canvas and the post-processing buffers resized to match
    setResolution: (r) => {
      renderer.setPixelRatio(r);
      resize();
    },
    render: () => {
      renderReflection();
      post.composer.render(0);
    },
  };
  // resize first: in a background tab the ResizeObserver doesn't fire, so the canvas can
  // still have the full-window size after the compare tool switched to the 3:2 pane
  const frame = () => {
    resize();
    window.app.render();
  };
  import('./dev/toneCompare.js').then((m) => (window.app.tones = m.createToneCompare(frame, canvas)));
  import('./dev/shots.js').then((m) => (window.app.shot = m.createShots(frame, canvas)));
  import('./dev/mapView.js').then((m) => (window.app.map = m.createMapView(window.app)));
  import('./dev/bench.js').then((m) => (window.app.bench = m.createBench(window.app, resize)));
  import('./dev/titleShots.js').then((m) => (window.app.titleShots = m.createTitleShots(window.app)));
  window.app.audio = audio;
  window.app.updateAudio = (dt) => updateAudio(dt);
  import('./dev/audioTest.js').then((m) => (window.app.audioTest = m.createAudioTest(window.app)));
  import('./dev/beforeAfter.js').then((m) => (window.app.beforeAfter = m.beforeAfter));
  Promise.all([import('./dev/viewpoints.js'), import('./dev/shots.js')]).then(([v, sh]) => {
    const vp = v.createViewpoints(window.app, fly, sh.createShots(frame, canvas));
    Object.assign(window.app, { view: vp.view, shots: vp.shots });
  });
}

// The reflection pass skips what can't be seen in the water (the water itself, small
// props, near trees, the ninja) and renders without height fog: from the mirrored
// camera below the surface the fog integral would be wrong.
const noReflect = [];
waterReady.then((w) => noReflect.push(w.root, w.falls)); // a bright fall mirrored across its whole pool read as a milky slab
function renderReflection() {
  for (const o of noReflect) o.visible = false;
  ninja.visible = false;
  const density = fog.uniforms.uFogDensity.value;
  const ridge = fog.uniforms.uRidgeHaze.value.x;
  fog.uniforms.uFogDensity.value = 0;
  fog.uniforms.uRidgeHaze.value.x = 0;
  reflection.render(scene, camera);
  fog.uniforms.uFogDensity.value = density;
  fog.uniforms.uRidgeHaze.value.x = ridge;
  ninja.visible = true;
  for (const o of noReflect) o.visible = true;
}

let idleFrames = 0;
const timer = new THREE.Timer();
// the listener: the player on the ledge (title) and in the game, the camera on the flyover
const earPos = new THREE.Vector3(), earFwd = new THREE.Vector3();
function updateAudio(dt) {
  const m = tour?.active ? 'tour' : title?.covering ? 'title' : 'game';
  camera.getWorldDirection(earFwd);
  if (game && m !== 'tour') earPos.copy(game.player.state.feet).y += 1.6;
  else earPos.copy(camera.position);
  if (game) audio.setWading(game.player.state.wading);
  audio.update(dt, { mode: m, pos: earPos.toArray(), fwd: earFwd.toArray() });
}
timer.connect(document); // pauses the timer while the tab is hidden
renderer.setAnimationLoop((timestamp) => {
  perf?.begin();
  timer.update(timestamp);
  const raw = timer.getDelta();
  adaptive?.update(raw);
  const dt = Math.min(raw, 0.1);
  updateAudio(dt);
  // while the title screen covers everything the valley only ticks over now and then
  if (title?.covering && (idleFrames = (idleFrames + 1) % 20) !== 0) {
    perf?.end();
    return;
  }
  update(dt);
  renderReflection();
  post.composer.render(dt);
  perf?.end();
});
