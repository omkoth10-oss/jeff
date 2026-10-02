// Dev-only: named viewpoints for the comparison screenshots and the critic rounds, so
// every round shoots exactly the same frames.
//   app.view('bridge')                      put the camera there (fly mode)
//   app.view('ledge')                       back to the ninja camera
//   await app.shots('ws1-r0', ['ledge', 'village', 'bridge'])   saves screenshots/ws1-r0-<name>.png
export const VIEWPOINTS = {
  ledge: null, // the ninja camera from the reference
  village: { from: [-16, 9, -96], to: [12, 4, -190] }, // above the left street, looking up the valley
  bridge: { from: [-6, 3.4, -150], to: [30, 2.5, -140] }, // at the bridge end, eye height
  waterfall: { from: [-4, 5, -226], to: [-24, 17, -284] }, // the main waterfall from the upper village
  river: { from: [20, 4, -50], to: [30, 2, -140] }, // over the water near the left bank, upstream
  castle: { from: [91, 16.2, -255.5], to: [118, 36, -292] }, // landing of the pagoda stairs, up at the keep
  pool: { from: [-8, 3.2, -250], to: [-24, 9, -281] }, // eye height beside the plunge pool of the main waterfall
  rapids: { from: [-26, 6, -218], to: [-4, 0, -186] }, // above the left bank, down onto the upper river
  cliff: { from: [-30, 44, -8], to: [-86, 42, -160] }, // ledge plateau edge toward the escarpment
  forest: { from: [-26, 30, -34], to: [0, 10, -110] }, // on the switchback trail in the trees
  street: { from: [47.5, 3.1, -200], to: [52, 2.2, -222] }, // eye height in the right street
  quay: { from: [8, 3.2, -168], to: [-6, 0.5, -205] }, // along the stone river walls
};

export function createViewpoints(app, fly, shot) {
  function view(name) {
    const v = VIEWPOINTS[name];
    if (v === undefined) throw new Error(`unknown viewpoint ${name}`);
    if (v === null) {
      fly.toggle(false);
      return;
    }
    fly.toggle(true);
    app.camera.position.set(...v.from);
    app.camera.lookAt(...v.to);
    app.camera.updateMatrixWorld();
  }
  async function shots(prefix, names = Object.keys(VIEWPOINTS)) {
    const files = [];
    for (const name of names) {
      view(name);
      for (let i = 0; i < 20; i++) app.tick(1 / 60); // LOD selection, near trees, mist drift
      files.push(await shot(`${prefix}-${name}`));
    }
    view('ledge');
    return files;
  }
  return { view, shots };
}
