// The small on-screen prompt: "click to explore" over the opening shot, the controls
// for a few seconds after that, and "click to resume" whenever the pointer is released.
const css = `
#hud-prompt {
  position: fixed; left: 50%; bottom: max(28px, env(safe-area-inset-bottom)); transform: translateX(-50%);
  z-index: 20; pointer-events: none; text-align: center;
  font: 500 13px/1.6 ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
  letter-spacing: .08em; color: #e6ecf7; text-shadow: 0 1px 8px rgba(0,0,0,.8);
  transition: opacity .8s ease;
}
#hud-prompt .title { font-size: 15px; letter-spacing: .18em; text-transform: uppercase; }
#hud-prompt .keys { opacity: .78; font-size: 12px; }
#hud-prompt kbd {
  font: inherit; padding: 1px 6px; margin: 0 2px; border: 1px solid rgba(230,236,247,.35);
  border-radius: 3px; background: rgba(8,12,22,.45);
}
`;

const KEYS = '<kbd>W A S D</kbd> move &nbsp; <kbd>Shift</kbd> sprint &nbsp; <kbd>Alt</kbd> walk &nbsp; <kbd>Space</kbd> jump &nbsp; mouse look &nbsp; <kbd>Esc</kbd> release';

export function createHud(parent) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'hud-prompt';
  parent.appendChild(el);
  let started = false, timer = 0;
  const show = (title, keys = true) => {
    el.innerHTML = `<div class="title">${title}</div>${keys ? `<div class="keys">${KEYS}</div>` : ''}`;
    el.style.opacity = 1;
  };
  show('Click to explore');
  return {
    started() {
      started = true;
    },
    locked(isLocked) {
      clearTimeout(timer);
      if (isLocked) {
        show('', true);
        timer = setTimeout(() => (el.style.opacity = 0), 5000);
      } else if (started) show('Click to resume');
    },
    hide() {
      el.style.opacity = 0;
    },
  };
}
