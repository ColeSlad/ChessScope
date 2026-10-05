import { build } from 'esbuild';
await build({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true });
await build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
