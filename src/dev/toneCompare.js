// Dev-only: average colour of each cell of a grid, render vs reference, as sRGB 0-255
// triples ("r,g,b render | r,g,b ref"). Used to tune exposure, fog and grading
// numerically instead of by eye. The frame is drawn and read back in the same task.
export function createToneCompare(renderFrame, canvas) {
  const work = document.createElement('canvas');
  const ctx = work.getContext('2d', { willReadFrequently: true });

  function average(source, cols, rows) {
    work.width = cols * 8;
    work.height = rows * 8;
    ctx.drawImage(source, 0, 0, work.width, work.height);
    const px = ctx.getImageData(0, 0, work.width, work.height).data;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sum = [0, 0, 0];
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const i = ((r * 8 + y) * work.width + c * 8 + x) * 4;
            sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2];
          }
        }
        cells.push(sum.map((s) => Math.round(s / 64)));
      }
    }
    return cells;
  }

  return (cols = 6, rows = 4) => {
    const ref = document.querySelector('#ref-pane img');
    renderFrame();
    const a = average(canvas, cols, rows);
    const b = ref?.complete ? average(ref, cols, rows) : null;
    const lines = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        row.push(`${a[i].join(',')}${b ? ` | ${b[i].join(',')}` : ''}`);
      }
      lines.push(row.join('   '));
    }
    return lines.join('\n');
  };
}
