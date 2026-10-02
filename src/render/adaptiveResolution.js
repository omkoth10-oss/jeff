// Keeps the frame rate at the display's refresh rate by trading resolution: when too
// many frames in a window take noticeably longer than a refresh interval (the GPU fell
// behind, e.g. a fanless MacBook Air warming up), the pixel ratio steps down; after a
// long stretch of smooth frames it steps back up. A step up that immediately causes a
// drop is not retried for a while (longer each time), so it doesn't oscillate.
const STEP = 0.125;
const WINDOW = 90;          // frames per verdict
const SLOW_SHARE = 0.08;    // share of slow frames that triggers a step down
const UPGRADE_AFTER = 10;   // seconds of smooth frames before trying a step up
const RETRY_BLOCK = 60;     // seconds to wait after a failed step up (doubles each time)

export function createAdaptiveResolution(renderer, onChange, { max, min = 1.0, start = max }) {
  let ratio = start;
  let block = RETRY_BLOCK;
  let interval = 1 / 60;    // estimated frame interval to hold (the fastest recent frames, >= 60 Hz)
  let frames = 0, slow = 0, smoothFor = 0, blockedFor = 0, sinceUp = Infinity;

  function set(r) {
    ratio = Math.min(max, Math.max(min, r));
    renderer.setPixelRatio(ratio);
    onChange(ratio);
    frames = slow = 0;
  }

  set(start);
  return {
    get ratio() {
      return ratio;
    },
    // a new ceiling (the quality setting); drops to it at once, climbs back on its own
    setMax(m) {
      max = m;
      if (ratio > max) set(max);
    },
    update(dt) {
      if (dt <= 0 || dt > 0.25) return;                 // paused, hidden tab, hitch
      // the target is 60 fps: on faster displays, missing 120 Hz is not a reason to drop resolution
      interval = Math.min(interval * 1.002, Math.max(dt, 1 / 61));
      frames++;
      if (dt > interval * 1.4) slow++;
      smoothFor += dt;
      sinceUp += dt;
      blockedFor = Math.max(0, blockedFor - dt);
      if (frames < WINDOW) return;
      if (slow / frames > SLOW_SHARE) {
        if (sinceUp < 5) {                               // the last step up was too much
          blockedFor = block;
          block *= 2;
        }
        smoothFor = 0;
        if (ratio > min) set(ratio - STEP);
      } else if (slow / frames > 0.01) {
        smoothFor = 0;
      }
      if (smoothFor > UPGRADE_AFTER && ratio < max && blockedFor === 0) {
        smoothFor = 0;
        sinceUp = 0;
        set(ratio + STEP);
      }
      frames = slow = 0;
    },
  };
}
