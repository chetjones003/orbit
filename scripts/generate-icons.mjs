// Renders the app icon from its vector source. electron-builder converts build/icon.png into the
// .icns format for macOS and the executable's own icon. build/icon.ico holds several sizes for the
// Windows window and tray, because a single 1024 px bitmap is not drawn reliably in the taskbar.
// The in-app mark is docs/assets/orbit-mark.svg.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'build/icon.svg');
const output = resolve(root, 'build/icon.png');
const icoOutput = resolve(root, 'build/icon.ico');
const SIZE = 1024;
/** Sizes packed into the ICO: taskbar, title bar, Alt+Tab, and high-DPI versions. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

mkdirSync(dirname(output), { recursive: true });
await sharp(source, { density: 300 }).resize(SIZE, SIZE).png().toFile(output);
console.log(`Wrote ${output}`);

const frames = await Promise.all(
  ICO_SIZES.map((size) =>
    sharp(source, { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
  )
);
writeFileSync(icoOutput, encodeIco(ICO_SIZES, frames));
console.log(`Wrote ${icoOutput}`);

/**
 * ICO container with PNG-compressed frames (supported since Windows Vista). Layout: a 6-byte header,
 * one 16-byte directory entry per frame, then the frame data. A width or height of 256 is stored as 0.
 */
function encodeIco(sizes, pngs) {
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + 16 * index;
    const dimension = size === 256 ? 0 : size;
    header.writeUInt8(dimension, entry);
    header.writeUInt8(dimension, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(pngs[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += pngs[index].length;
  });
  return Buffer.concat([header, ...pngs]);
}
