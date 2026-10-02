import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only endpoint for the comparison screenshots: the page POSTs an image to
// /__shot?name=<file>[&ext=jpg] and it is saved to screenshots/<file>.png|jpg (see src/dev/shots.js).
function saveShots() {
  return {
    name: 'save-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const params = new URL(req.url, 'http://x').searchParams;
        const name = params.get('name') ?? 'shot';
        const ext = params.get('ext') === 'jpg' ? 'jpg' : 'png';
        if (req.method !== 'POST' || !/^[\w-]+$/.test(name)) {
          res.statusCode = 400;
          res.end();
          return;
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const dir = path.resolve('screenshots');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${name}.${ext}`);
          fs.writeFileSync(file, Buffer.concat(chunks));
          res.end(file);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [saveShots()],
});
