// Renders the app icon from its vector source. electron-builder converts build/icon.png into the
// .ico and .icns formats per platform. The in-app mark is docs/assets/orbit-mark.svg.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'build/icon.svg');
const output = resolve(root, 'build/icon.png');
const SIZE = 1024;

mkdirSync(dirname(output), { recursive: true });
await sharp(source, { density: 300 }).resize(SIZE, SIZE).png().toFile(output);
console.log(`Wrote ${output}`);
