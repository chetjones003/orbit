import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Token material held by main. Never sent to the renderer or logs. */
export interface StoredCredentials {
  login: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  accessExpiresAt: number;
  /** Epoch milliseconds. */
  refreshExpiresAt: number;
}

/** The subset of Electron's safeStorage this store uses. Injected so tests need no Electron. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(plain: string): Buffer;
  decryptString(data: Buffer): string;
}

export type CipherKind = 'os' | 'local-key';

/** Stored credentials exist but cannot be read or trusted. The user must sign in again. */
export class CredentialUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialUnavailableError';
  }
}

interface Cipher {
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

interface Envelope {
  version: 1;
  cipher: CipherKind;
  data: string;
}

/** Backends that do not provide real protection; Orbit uses its own key instead. */
const WEAK_BACKENDS = new Set(['basic_text', 'unknown']);

export interface CredentialStoreOptions {
  /** Directory for the credentials file and the local key (the app's userData path). */
  dir: string;
  /** Electron safeStorage in production. Omit to force the local-key fallback. */
  safeStorage?: SafeStorageLike;
}

export class CredentialStore {
  readonly cipherKind: CipherKind;
  private readonly dir: string;
  private readonly safeStorage: SafeStorageLike | undefined;

  constructor(options: CredentialStoreOptions) {
    this.dir = options.dir;
    this.safeStorage = options.safeStorage;
    this.cipherKind = this.osEncryptionUsable() ? 'os' : 'local-key';
  }

  /** Writes credentials atomically: a temp file is renamed over the real file. */
  async save(creds: StoredCredentials): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const cipher = await this.cipherFor(this.cipherKind);
    const envelope: Envelope = {
      version: 1,
      cipher: this.cipherKind,
      data: cipher.encrypt(JSON.stringify(creds)).toString('base64')
    };
    const target = this.credentialsPath();
    const temp = `${target}.tmp`;
    await writeFile(temp, JSON.stringify(envelope), { mode: 0o600 });
    await rename(temp, target);
  }

  /** Returns null when nothing is stored. Throws CredentialUnavailableError when stored data cannot be trusted. */
  async load(): Promise<StoredCredentials | null> {
    let raw: string;
    try {
      raw = await readFile(this.credentialsPath(), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new CredentialUnavailableError('Stored sign-in could not be read');
    }

    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      throw new CredentialUnavailableError('Stored sign-in is corrupt');
    }
    if (envelope.version !== 1 || (envelope.cipher !== 'os' && envelope.cipher !== 'local-key')) {
      throw new CredentialUnavailableError('Stored sign-in is corrupt');
    }

    // Read with the cipher that wrote the data. Never fall back to a weaker one.
    try {
      const cipher = await this.cipherFor(envelope.cipher);
      return JSON.parse(cipher.decrypt(Buffer.from(envelope.data, 'base64'))) as StoredCredentials;
    } catch (error) {
      if (error instanceof CredentialUnavailableError) throw error;
      throw new CredentialUnavailableError('Stored sign-in could not be decrypted');
    }
  }

  async clear(): Promise<void> {
    await rm(this.credentialsPath(), { force: true });
    await rm(`${this.credentialsPath()}.tmp`, { force: true });
  }

  private credentialsPath(): string {
    return join(this.dir, 'credentials.json');
  }

  private osEncryptionUsable(): boolean {
    const ss = this.safeStorage;
    if (!ss || !ss.isEncryptionAvailable()) return false;
    const backend = ss.getSelectedStorageBackend?.();
    return !(backend && WEAK_BACKENDS.has(backend));
  }

  private async cipherFor(kind: CipherKind): Promise<Cipher> {
    if (kind === 'os') {
      const ss = this.safeStorage;
      if (!ss || !this.osEncryptionUsable()) {
        throw new CredentialUnavailableError('OS credential encryption is unavailable');
      }
      return {
        encrypt: (plain) => ss.encryptString(plain),
        decrypt: (data) => ss.decryptString(data)
      };
    }
    return localKeyCipher(await this.loadOrCreateLocalKey());
  }

  private async loadOrCreateLocalKey(): Promise<Buffer> {
    const keyPath = join(this.dir, 'local.key');
    try {
      return Buffer.from(await readFile(keyPath, 'utf8'), 'base64');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new CredentialUnavailableError('Local encryption key could not be read');
      }
    }
    await mkdir(this.dir, { recursive: true });
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString('base64'), { mode: 0o600 });
    await chmod(keyPath, 0o600).catch(() => undefined);
    return key;
  }
}

/** AES-256-GCM with a random 12-byte IV per message. Output layout: iv | tag | ciphertext. */
function localKeyCipher(key: Buffer): Cipher {
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decrypt(data) {
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}
