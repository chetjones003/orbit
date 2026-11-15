import { CUSTOM_THEME_NAME_LENGTH, type CoreColors } from '../../shared/themes';
import type {
  ThemeImportDraft,
  ThemeImportRef,
  ThemeSearchRequest,
  ThemeSearchResult
} from '../../shared/themes';
import { readZipEntries } from './zip';
import { coreColorsFromVsCode, isDarkUiTheme, parseVsCodeTheme, type VsCodeThemeFile } from './vscode-theme';

const BASE = 'https://open-vsx.org';
const RESULT_LIMIT = 20;
const QUERY_LIMIT = 80;
const TIMEOUT_MS = 20_000;
/** Largest extension package read. Themes are a few kilobytes; this leaves room for big packages. */
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_THEME_FILES = 8;
const MAX_ICON_BYTES = 256 * 1024;
/** The image type of PNG, JPEG and WebP data, from its first bytes. Anything else, including SVG, is null. */
function sniffImageType(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
/** A namespace or extension name: letters, digits, dots, dashes and underscores. Nothing that could change a URL. */
const SAFE_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Searches Open VSX for colour themes and reads the colours of one. Installing an extension is never done: the
 * package is only unzipped far enough to read its theme files, which are JSON. No code from it runs.
 */
export class OpenVsxClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** Colour themes, matching the query if there is one, otherwise the most used ones. */
  async search(request: ThemeSearchRequest): Promise<ThemeSearchResult[]> {
    const text = request.query.trim().slice(0, QUERY_LIMIT);
    const params = new URLSearchParams({
      category: 'Themes',
      size: String(RESULT_LIMIT),
      sortBy: request.sort === 'timestamp' ? 'timestamp' : 'downloadCount',
      sortOrder: 'desc'
    });
    if (text.length > 0) params.set('query', text);
    const body = await this.getJson(`${BASE}/api/-/search?${params.toString()}`);
    const list = Array.isArray(body['extensions']) ? (body['extensions'] as unknown[]) : [];
    const found = list.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const record = entry as Record<string, unknown>;
      const namespace = record['namespace'];
      const name = record['name'];
      if (!isSafePart(namespace) || !isSafePart(name)) return [];
      const files =
        record['files'] && typeof record['files'] === 'object'
          ? (record['files'] as Record<string, unknown>)
          : {};
      const result = {
        namespace,
        name,
        displayName: stringOr(record['displayName'], name).slice(0, CUSTOM_THEME_NAME_LENGTH),
        description: stringOr(record['description'], '').slice(0, 200),
        downloads: typeof record['downloadCount'] === 'number' ? record['downloadCount'] : 0,
        verified: record['verified'] === true
      };
      return [{ result, iconUrl: typeof files['icon'] === 'string' ? files['icon'] : null }];
    });
    // Icons are fetched here, not by the renderer, so the renderer's image policy stays as it is.
    return Promise.all(
      found.map(async ({ result, iconUrl }) => ({ ...result, icon: await this.fetchIcon(iconUrl) }))
    );
  }

  /** An icon as a data URL, when it is a PNG, JPEG or WebP under the size limit. Anything else gives null. */
  private async fetchIcon(url: string | null): Promise<string | null> {
    if (!url || !isOpenVsxUrl(url)) return null;
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: 'image/*', 'User-Agent': 'Orbit' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_ICON_BYTES) return null;
      // Open VSX often labels icons as application/octet-stream, so the type comes from the file's own signature.
      const type = sniffImageType(bytes);
      if (!type) return null;
      return `data:${type};base64,${bytes.toString('base64')}`;
    } catch {
      return null;
    }
  }

  async import(ref: ThemeImportRef): Promise<ThemeImportDraft> {
    if (!isSafePart(ref.namespace) || !isSafePart(ref.name))
      throw new Error('That is not an Open VSX extension.');
    const meta = await this.getJson(`${BASE}/api/${ref.namespace}/${ref.name}`);
    const download =
      meta['files'] && typeof meta['files'] === 'object'
        ? (meta['files'] as Record<string, unknown>)['download']
        : undefined;
    if (typeof download !== 'string' || !isOpenVsxUrl(download)) {
      throw new Error('Open VSX did not give a package this app will download.');
    }

    const archive = await this.getBytes(download, MAX_PACKAGE_BYTES);
    const manifestEntries = readZipEntries(archive, (name) => name === 'extension/package.json');
    const manifestText = manifestEntries.get('extension/package.json');
    if (!manifestText) throw new Error('The extension has no package.json.');
    const manifest = JSON.parse(manifestText.toString('utf8')) as Record<string, unknown>;
    const contributes = manifest['contributes'] as Record<string, unknown> | undefined;
    const declared = Array.isArray(contributes?.['themes']) ? (contributes?.['themes'] as unknown[]) : [];
    const themePaths = declared
      .flatMap((entry) => {
        const path = (entry as Record<string, unknown> | null)?.['path'];
        return typeof path === 'string' ? [extensionPath(path)] : [];
      })
      .filter((path): path is string => path !== null)
      .slice(0, MAX_THEME_FILES);
    if (themePaths.length === 0) throw new Error('This extension does not contribute a colour theme.');

    const wanted = new Set(themePaths);
    const files = readZipEntries(archive, (name) => wanted.has(name));
    const themes: { file: VsCodeThemeFile; base: VsCodeThemeFile | null }[] = [];
    for (const path of themePaths) {
      const text = files.get(path);
      if (!text) continue;
      const file = parseVsCodeTheme(text.toString('utf8'));
      const base = file.include ? this.readInclude(archive, path, file.include) : null;
      themes.push({ file, base });
    }

    const dark = pickVariant(themes, true);
    const light = pickVariant(themes, false);
    if (!dark && !light) throw new Error('This extension has no theme Orbit can read.');
    const name = stringOr(meta['displayName'], stringOr(meta['name'], ref.name)).slice(
      0,
      CUSTOM_THEME_NAME_LENGTH
    );
    return { name, source: `${ref.namespace}.${ref.name}`, dark, light };
  }

  private readInclude(archive: Buffer, themePath: string, include: string): VsCodeThemeFile | null {
    // The include is relative to the theme file, and must stay inside the extension folder.
    const base = joinRelative(themePath, include);
    if (!base.startsWith('extension/') || base.split('/').includes('..')) return null;
    const text = readZipEntries(archive, (name) => name === base).get(base);
    return text ? parseVsCodeTheme(text.toString('utf8')) : null;
  }

  private async getJson(url: string): Promise<Record<string, unknown>> {
    const bytes = await this.getBytes(url, MAX_JSON_BYTES);
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null)
      throw new Error('Open VSX sent something Orbit did not expect.');
    return parsed as Record<string, unknown>;
  }

  private async getBytes(url: string, limit: number): Promise<Buffer> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: '*/*', 'User-Agent': 'Orbit' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch {
      throw new Error('Open VSX could not be reached. Check the connection and try again.');
    }
    if (!response.ok) throw new Error(`Open VSX answered ${response.status}.`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > limit) throw new Error('That download is larger than Orbit reads.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error('That download is larger than Orbit reads.');
    return bytes;
  }
}

/** The colours of the first dark or light theme an extension offers, with any base theme's colours underneath. */
function pickVariant(
  themes: { file: VsCodeThemeFile; base: VsCodeThemeFile | null }[],
  dark: boolean
): CoreColors | null {
  for (const { file, base } of themes) {
    if (isDarkUiTheme(file.uiTheme) !== dark) continue;
    const colors = { ...(base?.colors ?? {}), ...(file.colors ?? {}) };
    const core = coreColorsFromVsCode(colors, dark);
    if (core) return core;
  }
  return null;
}

/** The archive path of a file the manifest names. Paths must stay inside the extension folder. */
function extensionPath(path: string): string | null {
  const cleaned = path.replace(/^\.\//, '');
  if (cleaned.length === 0 || cleaned.startsWith('/') || cleaned.split('/').includes('..')) return null;
  return `extension/${cleaned}`;
}

/** Resolves an include path against the directory of the theme file that names it. */
function joinRelative(themePath: string, include: string): string {
  const directory = themePath.split('/').slice(0, -1).join('/');
  return (directory ? `${directory}/${include}` : include).replace(/\/\.\//g, '/');
}

function isSafePart(value: unknown): value is string {
  return typeof value === 'string' && SAFE_PART.test(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function isOpenVsxUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'open-vsx.org';
  } catch {
    return false;
  }
}
