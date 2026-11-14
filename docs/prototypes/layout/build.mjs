import { build } from 'esbuild';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
mkdirSync('generated', { recursive: true });
execFileSync(process.execPath, ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'theme.css', '-o', 'generated/theme.css', '--minify'], { stdio: 'inherit' });
const result = await build({ entryPoints: ['prototype.jsx'], bundle: true, minify: true, write: false, define: { 'process.env.NODE_ENV': '"production"', '__ORBIT_PROTOTYPE__': process.env.ORBIT_PROTOTYPE === '0' ? 'false' : 'true' } });
// daisyUI includes unused viewport-height rules; use fixed equivalents for the auto-sizing visualizer.
const css = readFileSync('generated/theme.css', 'utf8').replace(/([\d.]+)(?:d|s|l)?vh\b/g, (_, n) => `${Number(n) * 7}px`);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit · layout prototype</title><style>${css}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
writeFileSync('generated/orbit-layout-prototype.html', html);
console.log('Built generated/orbit-layout-prototype.html');
