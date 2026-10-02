// Keyboard and mouse for the player. The mouse orbits the camera while the pointer is
// locked (click the canvas to lock, Esc releases it, as browsers require). All state is
// cleared when the window loses focus, so no key gets stuck.
//
// The walk test (dev/walkTest.js) drives the same fields through `virtual`.
export function createInput(dom) {
  const keys = new Set();
  const state = {
    move: { x: 0, y: 0 }, // x right, y forward, from the keys or the virtual stick
    sprint: false,
    walk: false,
    jumpPressed: false, // one-shot: consumed by the player
    lookX: 0, // accumulated mouse movement since the last frame (px)
    lookY: 0,
    locked: false,
    virtual: null, // { x, y, sprint, jump } set by the walk test
  };

  const onKey = (down) => (e) => {
    if (e.code === 'Space' && down && !e.repeat) state.jumpPressed = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (down) keys.add(e.code);
    else keys.delete(e.code);
  };
  addEventListener('keydown', onKey(true));
  addEventListener('keyup', onKey(false));
  addEventListener('blur', () => keys.clear());
  dom.addEventListener('click', () => {
    if (!state.locked) dom.requestPointerLock?.()?.catch?.(() => {});
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === dom;
    if (!state.locked) keys.clear();
  });
  addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookX += e.movementX;
    state.lookY += e.movementY;
  });

  return {
    state,
    // resolve keys (or the virtual stick) into state.move for this frame
    poll() {
      const v = state.virtual;
      if (v) {
        state.move.x = v.x;
        state.move.y = v.y;
        state.sprint = !!v.sprint;
        state.walk = !!v.walk;
        if (v.jump) {
          state.jumpPressed = true;
          v.jump = false;
        }
        return state;
      }
      const k = (c) => (keys.has(c) ? 1 : 0);
      let x = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
      let y = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      state.move.x = x;
      state.move.y = y;
      state.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      state.walk = keys.has('AltLeft') || keys.has('AltRight');
      return state;
    },
    consumeLook() {
      const l = [state.lookX, state.lookY];
      state.lookX = state.lookY = 0;
      return l;
    },
  };
}
