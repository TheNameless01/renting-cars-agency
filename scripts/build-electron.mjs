import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';

const outRoot = path.resolve('dist-electron');
fs.mkdirSync(path.join(outRoot, 'main'), { recursive: true });
fs.mkdirSync(path.join(outRoot, 'preload'), { recursive: true });

// Ensure Node/Electron loads compiled CJS entrypoints cleanly despite root "type": "module"
fs.writeFileSync(
  path.join(outRoot, 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n'
);

await esbuild.build({
  entryPoints: ['electron/main/index.ts'],
  outfile: path.join(outRoot, 'main', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  packages: 'external',
});

await esbuild.build({
  entryPoints: ['electron/preload/index.ts'],
  outfile: path.join(outRoot, 'preload', 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  packages: 'external',
});

console.log('[build:electron] Compiled main and preload bundles into dist-electron/');
