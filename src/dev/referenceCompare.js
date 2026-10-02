// Dev-only tool for comparing the render against the reference images.
//   R        cycle: off -> side by side (main) -> side by side (village) -> overlay
//   [ / ]    overlay opacity
//   ?ref=main | village | overlay   start in that mode
import mainRef from '../../reference/main-reference.png?url';
import villageRef from '../../reference/village-reference.png?url';
import { REFERENCE_ASPECT } from '../config.js';

const MODES = ['off', 'main', 'village', 'overlay'];

const css = `
body.ref-split #stage, body.ref-overlay #stage {
  inset: auto; left: 0; top: 50%; transform: translateY(-50%);
  width: var(--pane-w); height: calc(var(--pane-w) / ${REFERENCE_ASPECT});
}
body.ref-overlay #stage { left: 50%; transform: translate(-50%, -50%); }
#ref-pane {
  position: fixed; z-index: 10; display: none; pointer-events: none;
  top: 50%; transform: translateY(-50%);
  width: var(--pane-w); height: calc(var(--pane-w) / ${REFERENCE_ASPECT});
}
#ref-pane img { width: 100%; height: 100%; display: block; }
body.ref-split #ref-pane { display: block; left: var(--pane-w); }
body.ref-overlay #ref-pane { display: block; left: 50%; transform: translate(-50%, -50%); }
.ref-label {
  position: fixed; z-index: 11; display: none; bottom: 8px; padding: 2px 6px;
  font: 12px ui-monospace, Menlo, monospace; color: #d8e4ff; background: rgba(5,8,16,.72);
}
body.ref-split .ref-label { display: block; }
`;

export function initReferenceCompare() {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const pane = document.createElement('div');
  pane.id = 'ref-pane';
  const img = document.createElement('img');
  pane.appendChild(img);
  document.body.appendChild(pane);

  const labels = ['Render', 'Reference'].map((text, i) => {
    const el = document.createElement('div');
    el.className = 'ref-label';
    el.textContent = text;
    el.style.left = i === 0 ? '8px' : 'calc(var(--pane-w) + 8px)';
    document.body.appendChild(el);
    return el;
  });

  let mode = new URLSearchParams(location.search).get('ref') ?? 'off';
  let opacity = 0.5;

  function layout() {
    const split = mode === 'main' || mode === 'village';
    const maxW = split ? innerWidth / 2 : innerWidth;
    const paneW = Math.min(maxW, innerHeight * REFERENCE_ASPECT);
    document.body.style.setProperty('--pane-w', `${paneW}px`);
  }

  function apply() {
    if (!MODES.includes(mode)) mode = 'off';
    document.body.classList.toggle('ref-split', mode === 'main' || mode === 'village');
    document.body.classList.toggle('ref-overlay', mode === 'overlay');
    img.src = mode === 'village' ? villageRef : mainRef;
    pane.style.opacity = mode === 'overlay' ? opacity : 1;
    labels[1].textContent = mode === 'village' ? 'Village reference' : 'Main reference';
    layout();
  }

  addEventListener('resize', layout);
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    else if (e.code === 'BracketLeft') opacity = Math.max(0, opacity - 0.1);
    else if (e.code === 'BracketRight') opacity = Math.min(1, opacity + 0.1);
    else return;
    apply();
  });

  apply();
  return {
    setMode: (m) => {
      mode = m;
      apply();
    },
  };
}
