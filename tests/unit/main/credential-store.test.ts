import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CredentialStore,
  CredentialUnavailableError,
  type SafeStorageLike,
  type StoredCredentials
} from '../../../src/main/github/credential-store';

const SECRET_ACCESS = 'gho_SECRET_ACCESS_TOKEN_123';
const SECRET_REFRESH = 'ghr_SECRET_REFRESH_TOKEN_456';

const creds: StoredCredentials = {
  login: 'chetjones003',
  accessToken: SECRET_ACCESS,
  refreshToken: SECRET_REFRESH,
  accessExpiresAt: 1_900_000_000_000,
  refreshExpiresAt: 1_950_000_000_000
};

/** Stand-in for Electron's safeStorage: reversible, and it never stores plaintext. */
function fakeOsStorage(backend = 'keychain'): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (plain) => Buffer.from(`os:${Buffer.from(plain).toString('base64')}`),
    decryptString: (data) => Buffer.from(data.toString().slice(3), 'base64').toString()
  };
}

const unavailableOsStorage: SafeStorageLike = {
  isEncryptionAvailable: () => false,
  encryptString: () => Buffer.alloc(0),
  decryptString: () => ''
};

describe('CredentialStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orbit-creds-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips credentials through the local-key fallback when no OS store is available', async () => {
    const store = new CredentialStore({ dir, safeStorage: unavailableOsStorage });
    await store.save(creds);
    expect(store.cipherKind).toBe('local-key');
    expect(await new CredentialStore({ dir, safeStorage: unavailableOsStorage }).load()).toEqual(creds);
  });

  it('never writes tokens to disk in plaintext', async () => {
    const store = new CredentialStore({ dir, safeStorage: unavailableOsStorage });
    await store.save(creds);
    for (const file of readdirSync(dir)) {
      const content = readFileSync(join(dir, file), 'utf8');
      expect(content).not.toContain(SECRET_ACCESS);
      expect(content).not.toContain(SECRET_REFRESH);
    }
  });

  it('uses OS-backed encryption when a real backend is available', async () => {
    const store = new CredentialStore({ dir, safeStorage: fakeOsStorage('gnome_libsecret') });
    await store.save(creds);
    expect(store.cipherKind).toBe('os');
    expect(await store.load()).toEqual(creds);
  });

  it('falls back to the local key when the OS reports the weak basic_text backend', () => {
    const store = new CredentialStore({ dir, safeStorage: fakeOsStorage('basic_text') });
    expect(store.cipherKind).toBe('local-key');
  });

  it('refuses to silently downgrade credentials saved with OS encryption', async () => {
    await new CredentialStore({ dir, safeStorage: fakeOsStorage() }).save(creds);
    const later = new CredentialStore({ dir, safeStorage: unavailableOsStorage });
    await expect(later.load()).rejects.toBeInstanceOf(CredentialUnavailableError);
  });

  it('detects tampered ciphertext instead of returning altered tokens', async () => {
    const store = new CredentialStore({ dir, safeStorage: unavailableOsStorage });
    await store.save(creds);
    const file = join(dir, 'credentials.json');
    const envelope = JSON.parse(readFileSync(file, 'utf8')) as { data: string };
    const bytes = Buffer.from(envelope.data, 'base64');
    bytes.writeUInt8(bytes.readUInt8(bytes.length - 1) ^ 0xff, bytes.length - 1);
    envelope.data = bytes.toString('base64');
    writeFileSync(file, JSON.stringify(envelope));
    await expect(store.load()).rejects.toBeInstanceOf(CredentialUnavailableError);
  });

  it('reports a corrupt credentials file as unavailable', async () => {
    writeFileSync(join(dir, 'credentials.json'), '{not json');
    const store = new CredentialStore({ dir, safeStorage: unavailableOsStorage });
    await expect(store.load()).rejects.toBeInstanceOf(CredentialUnavailableError);
  });

  it('returns null when nothing is stored and removes everything on clear', async () => {
    const store = new CredentialStore({ dir, safeStorage: unavailableOsStorage });
    expect(await store.load()).toBeNull();
    await store.save(creds);
    await store.clear();
    expect(await store.load()).toBeNull();
    expect(readdirSync(dir)).not.toContain('credentials.json');
  });

  it('leaves no temporary file behind after a save', async () => {
    const store = new CredentialStore({ dir, safeStorage: unavailableOsStorage });
    await store.save(creds);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('writes the local key with owner-only permissions', async () => {
    const store = new CredentialStore({ dir, safeStorage: unavailableOsStorage });
    await store.save(creds);
    expect(statSync(join(dir, 'local.key')).mode & 0o777).toBe(0o600);
  });
});
