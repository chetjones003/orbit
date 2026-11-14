// Generates placeholder app icons from the single logo reference image.
// electron-builder converts build/icon.png into the .ico and .icns formats per platform.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'docs/assets/orbit-logo-reference.png');
const output = resolve(root, 'build/icon.png');
const SIZE = 1024;

mkdirSync(dirname(output), { recursive: true });
await sharp(source)
  .resize({
    width: Math.round(SIZE * 0.8),
    height: Math.round(SIZE * 0.8),
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .extend({
    top: Math.round(SIZE * 0.1),
    bottom: Math.round(SIZE * 0.1),
    left: Math.round(SIZE * 0.1),
    right: Math.round(SIZE * 0.1),
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .png()
  .toFile(output);
console.log(`Wrote ${output}`);
