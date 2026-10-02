import * as THREE from 'three';

// EXPLORE on the title screen: a slow camera flight around the valley through the live
// game. A closed spline through hand-placed waypoints (and a second spline for where the
// camera looks), travelled at constant speed; it eases in, and it never dips into the
// ground or a roof (a clearance floor is sampled along the path once, from the physics).
// Waypoints may carry a place name, shown as the camera passes.

export const TOUR = [
  { p: [1.5, 52.3, 3.3], look: [12, 8, -150], name: ['月影の谷', 'Tsukikage Valley'] },
  { p: [-12, 40, -48], look: [10, 6, -170] },
  { p: [-14, 26, -98], look: [18, 4, -165] },
  { p: [13, 7, -110], look: [15, 3, -145], name: ['朱橋', 'The Vermilion Bridge'] },
  { p: [15, 11, -140], look: [8, 6, -200] },
  { p: [10, 13, -178], look: [-20, 14, -280] },
  { p: [1, 10, -220], look: [-24, 15, -284], name: ['白糸の滝', 'Shiraito Falls'] },
  { p: [26, 30, -256], look: [114, 34, -284] },
  { p: [70, 40, -232], look: [114, 34, -284], name: ['黒影城', 'Kurokage Castle'] },
  { p: [96, 46, -172], look: [50, 6, -110] },
  { p: [60, 30, -96], look: [75, 10, -118], name: ['月見の社', 'Shrine of the Moon'] },
  { p: [34, 50, -30], look: [0, 28, -100] },
];

export function createTour(camera, groundAt, { speed = 6.5, clearance = 4 } = {}) {
  const pos = new THREE.CatmullRomCurve3(TOUR.map((w) => new THREE.Vector3(...w.p)), true, 'centripetal');
  const look = new THREE.CatmullRomCurve3(TOUR.map((w) => new THREE.Vector3(...w.look)), true, 'centripetal');
  const length = pos.getLength();
  // clearance floor along the path (u = 0..1)
  const N = 360;
  const floor = new Float32Array(N);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    pos.getPointAt(i / N, tmp);
    floor[i] = groundAt(tmp.x, tmp.z, tmp.y + 60) + clearance;
  }
  const smooth = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = -Infinity;
    for (let k = -6; k <= 6; k++) m = Math.max(m, floor[(i + k + N) % N]);
    smooth[i] = m;
  }
  const floorAt = (u) => {
    const f = u * N, i = Math.floor(f), t = f - i;
    return smooth[i % N] * (1 - t) + smooth[(i + 1) % N] * t;
  };
  // named waypoints (waypoint i sits at spline parameter t = i / count)
  const marks = TOUR.map((w, i) => (w.name ? { k: i, name: w.name } : null)).filter(Boolean);

  let s = 0, run = 0, active = false;
  const p = new THREE.Vector3(), l = new THREE.Vector3(), lookSmooth = new THREE.Vector3();
  return {
    get active() {
      return active;
    },
    start() {
      active = true;
      s = 0;
      run = 0;
      lookSmooth.copy(look.getPoint(0));
    },
    stop() {
      active = false;
    },
    // returns the place name to show (or null)
    update(dt) {
      if (!active) return null;
      run += dt;
      const ease = THREE.MathUtils.smoothstep(run, 0, 4);
      s = (s + speed * ease * dt) % length;
      const u = s / length;
      const t = pos.getUtoTmapping(u);
      pos.getPoint(t, p);
      p.y = Math.max(p.y, floorAt(u));
      look.getPoint(t, l);
      lookSmooth.lerp(l, 1 - Math.exp(-2.5 * dt));
      camera.position.copy(p);
      camera.lookAt(lookSmooth);
      camera.updateMatrixWorld();
      // a place name while the camera is near its waypoint
      const n = TOUR.length, k = t * n;
      const near = marks.find((m) => Math.abs((((k - m.k) % n) + n * 1.5) % n - n * 0.5) < 0.7);
      return near ? near.name : null;
    },
  };
}
