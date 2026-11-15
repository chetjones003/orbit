// Renders the screenshots the fake GitHub's issue and pull request bodies link to. Run once with
// `node scripts/fake-github/make-assets.mjs`; the PNGs are committed so the fake needs no image tooling.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'assets');
mkdirSync(OUT, { recursive: true });

const W = 1280;
const H = 800;

/** A window-shaped screenshot: title bar, then lines of text on a dark surface. */
function screen(title, lines) {
  const rows = lines
    .map(
      (line, i) =>
        `<text x="48" y="${150 + i * 34}" font-family="Consolas, monospace" font-size="22" fill="${line.color ?? '#e9eaf3'}">${escape(line.text)}</text>`
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#14161d"/>
  <rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="14" fill="#191b24" stroke="#2b2e3b" stroke-width="2"/>
  <rect x="24" y="24" width="${W - 48}" height="56" rx="14" fill="#14161d"/>
  <circle cx="60" cy="52" r="7" fill="#ef9eaa"/><circle cx="84" cy="52" r="7" fill="#e6c88e"/><circle cx="108" cy="52" r="7" fill="#82d2bc"/>
  <text x="140" y="60" font-family="Segoe UI, sans-serif" font-size="20" fill="#a7aabe">${escape(title)}</text>
  ${rows}
</svg>`;
}

function escape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const shots = {
  'crash-dialog.png': screen('Atlas CAD has stopped responding', [
    { text: 'Atlas CAD stopped working.', color: '#ef9eaa' },
    { text: '' },
    { text: 'Exception  EXCEPTION_ACCESS_VIOLATION_READ' },
    { text: 'Address    0x00007FF7A21C0F18' },
    { text: 'Module     atlas-cad.exe  (no symbols)' },
    { text: 'Thread     4812 (renderer)' },
    { text: '' },
    { text: '[ Send report ]   [ Restart ]   [ Details ]', color: '#b5a4ff' }
  ]),
  'import-log.png': screen('Import log: survey_0412.csv', [
    { text: '12:04:11  read 1,204 rows' },
    { text: '12:04:11  parsed 1,203 points' },
    { text: '12:04:11  WARN  row 88: name "Chaussée-14" skipped (encoding)', color: '#e6c88e' },
    { text: '12:04:11  expected 1,204 points, imported 1,203', color: '#ef9eaa' },
    { text: '' },
    { text: 'Tip: re-export the file as UTF-8 with BOM.', color: '#82d2bc' }
  ]),
  'symbolicate-report.png': screen('Crash report: symbolicated', [
    { text: 'EXCEPTION_ACCESS_VIOLATION_READ  thread 4812 (renderer)' },
    { text: '' },
    { text: '#0  resolvePdb        src/main/symbolicate.ts:43', color: '#82d2bc' },
    { text: '#1  symbolicateDump  src/main/symbolicate.ts:71' },
    { text: '#2  exportBlocks     src/io/dxf/blocks.ts:18' },
    { text: '#3  renderFrame      src/renderer/src/canvas.ts:204' },
    { text: '' },
    { text: 'Symbols: atlas-cad-0.2.1.pdb (matched)', color: '#82d2bc' }
  ])
};

for (const [name, svg] of Object.entries(shots)) {
  await sharp(Buffer.from(svg)).png().toFile(join(OUT, name));
  console.log(`wrote assets/${name}`);
}
