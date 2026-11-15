import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { OpenVsxClient } from '../../../src/main/themes/open-vsx';
import { readZipEntries } from '../../../src/main/themes/zip';
import {
  coreColorsFromVsCode,
  hexFromVsCodeColor,
  stripJsonComments
} from '../../../src/main/themes/vscode-theme';

/** A zip archive with deflated entries, built in memory. */
function buildZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(content));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(Buffer.byteLength(content), 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(Buffer.byteLength(content), 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const DARK_THEME = `{
  // The base theme this one builds on.
  "type": "dark",
  "colors": {
    "editor.background": "#282a36",
    "editor.foreground": "#f8f8f2",
    "focusBorder": "#bd93f9aa", // a comment, and a trailing comma below
  },
}`;

describe('stripJsonComments', () => {
  it('removes comments and trailing commas but keeps slashes inside strings', () => {
    const cleaned = stripJsonComments('{ "url": "https://x.test/a", /* note */ "b": [1, 2,], }');
    expect(JSON.parse(cleaned)).toEqual({ url: 'https://x.test/a', b: [1, 2] });
  });
});

describe('hexFromVsCodeColor', () => {
  it('reads six-digit, eight-digit and short colours, and drops anything else', () => {
    expect(hexFromVsCodeColor('#ABCDEF')).toBe('#abcdef');
    expect(hexFromVsCodeColor('#bd93f9aa')).toBe('#bd93f9');
    expect(hexFromVsCodeColor('#abc')).toBe('#aabbcc');
    expect(hexFromVsCodeColor('rgba(0,0,0,1)')).toBeNull();
  });
});

describe('coreColorsFromVsCode', () => {
  it('needs a background and a text colour, and falls back for the rest', () => {
    expect(coreColorsFromVsCode({ 'editor.background': '#000000' }, true)).toBeNull();
    const core = coreColorsFromVsCode(
      { 'editor.background': '#000000', 'editor.foreground': '#ffffff' },
      true
    );
    expect(core).toEqual({ canvas: '#000000', surface: '#000000', text: '#ffffff', accent: '#b5a4ff' });
  });
});

describe('readZipEntries', () => {
  it('reads only the wanted files', () => {
    const archive = buildZip({ 'extension/package.json': '{}', 'extension/readme.md': 'hi' });
    const entries = readZipEntries(archive, (name) => name === 'extension/package.json');
    expect([...entries.keys()]).toEqual(['extension/package.json']);
    expect(entries.get('extension/package.json')?.toString()).toBe('{}');
  });

  it('refuses something that is not a zip', () => {
    expect(() => readZipEntries(Buffer.from('not a zip at all'), () => true)).toThrow(/not a zip/);
  });
});

describe('OpenVsxClient', () => {
  it('searches and keeps only entries with safe names', async () => {
    const client = new OpenVsxClient(async () =>
      jsonResponse({
        extensions: [
          {
            namespace: 'nszihan',
            name: 'dracula',
            displayName: 'Dracula',
            downloadCount: 10,
            verified: true
          },
          { namespace: '../evil', name: 'x', displayName: 'Nope' }
        ]
      })
    );
    const results = await client.search({ query: 'dracula', sort: 'downloadCount' });
    expect(results).toEqual([
      {
        namespace: 'nszihan',
        name: 'dracula',
        displayName: 'Dracula',
        description: '',
        downloads: 10,
        verified: true,
        icon: null
      }
    ]);
  });

  it('passes an icon through as a data URL and drops anything that is not a small image', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const client = new OpenVsxClient(async (url) => {
      if (String(url).endsWith('icon.png')) {
        return new Response(png, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      }
      if (String(url).endsWith('icon.svg')) {
        return new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } });
      }
      return jsonResponse({
        extensions: [
          { namespace: 'a', name: 'good', files: { icon: 'https://open-vsx.org/api/a/good/icon.png' } },
          { namespace: 'b', name: 'svg', files: { icon: 'https://open-vsx.org/api/b/svg/icon.svg' } }
        ]
      });
    });
    const [good, svg] = await client.search({ query: 'x', sort: 'downloadCount' });
    expect(good?.icon).toBe('data:image/png;base64,' + png.toString('base64'));
    expect(svg?.icon).toBeNull();
  });

  it('lists the most used themes when the query is empty', async () => {
    const urls: string[] = [];
    const client = new OpenVsxClient(async (url) => {
      urls.push(String(url));
      return jsonResponse({ extensions: [] });
    });
    await client.search({ query: '', sort: 'downloadCount' });
    expect(urls[0]).toContain('category=Themes');
    expect(urls[0]).not.toContain('query=');
    expect(urls[0]).toContain('sortBy=downloadCount');
  });

  it('reads the colours of a theme, following its base theme, and never runs the package', async () => {
    const vsix = buildZip({
      'extension/package.json': JSON.stringify({
        contributes: { themes: [{ label: 'Dracula', uiTheme: 'vs-dark', path: './themes/dracula.json' }] }
      }),
      'extension/themes/base.json': JSON.stringify({ colors: { 'sideBar.background': '#21222c' } }),
      'extension/themes/dracula.json': DARK_THEME.replace(
        '"type": "dark"',
        '"type": "dark", "include": "./base.json"'
      )
    });
    const client = new OpenVsxClient(async (url) => {
      if (String(url).endsWith('/api/nszihan/dracula')) {
        return jsonResponse({
          displayName: 'Dracula Colorful',
          name: 'dracula',
          files: { download: 'https://open-vsx.org/api/nszihan/dracula/1.0.0/file/x.vsix' }
        });
      }
      return new Response(vsix, { status: 200 });
    });
    const draft = await client.import({ namespace: 'nszihan', name: 'dracula' });
    expect(draft.name).toBe('Dracula Colorful');
    expect(draft.source).toBe('nszihan.dracula');
    expect(draft.dark).toEqual({ canvas: '#282a36', surface: '#21222c', text: '#f8f8f2', accent: '#bd93f9' });
    expect(draft.light).toBeNull();
  });

  it('refuses a download from any host other than Open VSX', async () => {
    const client = new OpenVsxClient(async () =>
      jsonResponse({ name: 'x', files: { download: 'https://example.test/x.vsix' } })
    );
    await expect(client.import({ namespace: 'a', name: 'x' })).rejects.toThrow(/did not give a package/);
  });

  it('refuses theme paths that leave the extension folder', async () => {
    const vsix = buildZip({
      'extension/package.json': JSON.stringify({
        contributes: { themes: [{ label: 'Escape', uiTheme: 'vs-dark', path: '../../secret.json' }] }
      }),
      'secret.json': DARK_THEME
    });
    const client = new OpenVsxClient(async (url) =>
      String(url).endsWith('/api/a/x')
        ? jsonResponse({ name: 'x', files: { download: 'https://open-vsx.org/api/a/x/1/file/x.vsix' } })
        : new Response(vsix, { status: 200 })
    );
    await expect(client.import({ namespace: 'a', name: 'x' })).rejects.toThrow(
      /does not contribute a colour theme/
    );
  });

  it('refuses names that could change the request URL', async () => {
    const client = new OpenVsxClient(async () => jsonResponse({}));
    await expect(client.import({ namespace: '../admin', name: 'x' })).rejects.toThrow(
      /not an Open VSX extension/
    );
  });
});
