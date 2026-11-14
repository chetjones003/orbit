import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type DiagnosticLevel = 'info' | 'warn' | 'error';

export interface DiagnosticEntry {
  level: DiagnosticLevel;
  /** Area of the app, such as `auth`, `refresh`, or `write`. */
  scope: string;
  /** Short stable identifier, such as `rate-limited`. Never free-form user content. */
  code: string;
  /** Human-readable detail. Redacted before it is stored. */
  message: string;
}

export interface DiagnosticsOptions {
  dir: string;
  maxEntries?: number;
  maxFileBytes?: number;
}

const TOKEN_PATTERNS: RegExp[] = [
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\bgh[pousr]_[A-Za-z0-9_]+/g,
  /\bBearer\s+\S+/gi,
  /\b(?:access_token|refresh_token|client_secret)=\S+/gi
];

/** Removes anything that looks like a credential. Keep this conservative: over-redaction is fine. */
export function redact(text: string): string {
  let result = text;
  for (const pattern of TOKEN_PATTERNS) result = result.replace(pattern, '[redacted]');
  return result;
}

/**
 * Bounded, rotating, redacted local diagnostics. The file lives beside the
 * settings in userData and is never uploaded automatically. Entries describe
 * what happened, not GitHub content or editor text.
 */
export class Diagnostics {
  private readonly dir: string;
  private readonly maxEntries: number;
  private readonly maxFileBytes: number;
  private readonly entries: string[] = [];
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(options: DiagnosticsOptions) {
    this.dir = options.dir;
    this.maxEntries = options.maxEntries ?? 500;
    this.maxFileBytes = options.maxFileBytes ?? 512 * 1024;
  }

  record(entry: DiagnosticEntry): Promise<void> {
    const line = `${new Date().toISOString()} ${entry.level.toUpperCase()} ${entry.scope} ${entry.code} ${redact(entry.message)}`;
    this.entries.push(line);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    const write = this.writeChain.then(() => this.append(line));
    this.writeChain = write.catch(() => undefined);
    return write.catch(() => undefined);
  }

  /** Text for "Copy diagnostics". Built from the redacted in-memory entries only. */
  report(): string {
    return this.entries.join('\n');
  }

  flush(): Promise<void> {
    return this.writeChain.then(() => undefined) as Promise<void>;
  }

  private async append(line: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, 'diagnostics.log');
    const size = await stat(file).then(
      (s) => s.size,
      () => 0
    );
    if (size + line.length + 1 > this.maxFileBytes && size > 0) {
      await rename(file, join(this.dir, 'diagnostics.1.log'));
    }
    await appendFile(file, `${line}\n`, 'utf8');
  }
}
