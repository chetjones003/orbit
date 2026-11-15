import { describe, expect, it, vi } from 'vitest';
import { UpdateService, type RemoteRelease } from '../../../src/main/updates/update-service';
import { UPDATE_CHECK_INTERVAL_MS } from '../../../src/shared/updates';

const release = (version: string): RemoteRelease => ({
  version,
  releaseNotes: `Notes for ${version}`,
  files: []
});

function setup(overrides: { check?: () => Promise<RemoteRelease | null> } = {}) {
  const check = vi.fn(overrides.check ?? (async (): Promise<RemoteRelease | null> => null));
  const apply = vi.fn(async () => undefined);
  const prepare = vi.fn(async (r: RemoteRelease) => ({
    status: { kind: 'ready', version: r.version, releaseNotes: r.releaseNotes } as const,
    install: apply
  }));
  const service = new UpdateService({
    currentVersion: '0.1.0',
    check,
    prepare
  });
  return { service, check, prepare, apply };
}

describe('UpdateService', () => {
  it('reports up-to-date when no release is offered', async () => {
    const { service } = setup();
    const status = await service.checkNow();
    expect(status.kind).toBe('up-to-date');
  });

  it('never offers a release that is the same, older, or a prerelease', async () => {
    for (const version of ['0.1.0', '0.0.9', '0.2.0-beta.1']) {
      const { service, prepare } = setup({ check: async () => release(version) });
      const status = await service.checkNow();
      expect(status.kind).toBe('up-to-date');
      expect(prepare).not.toHaveBeenCalled();
    }
  });

  it('offers an eligible release and downloads it only when asked', async () => {
    const { service, prepare } = setup({ check: async () => release('0.2.0') });
    const offered = await service.checkNow();
    expect(offered).toEqual({ kind: 'available', version: '0.2.0', releaseNotes: 'Notes for 0.2.0' });
    expect(prepare).not.toHaveBeenCalled();
    const ready = await service.download();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(ready).toEqual({ kind: 'ready', version: '0.2.0', releaseNotes: 'Notes for 0.2.0' });
    expect(service.getStatus()).toEqual(ready);
  });

  it('does nothing when asked to download without an offered release', async () => {
    const { service, prepare } = setup();
    await service.checkNow();
    expect(await service.download()).toEqual({ kind: 'up-to-date', checkedAt: expect.any(Number) });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('turns a failed download into an error status that names no details', async () => {
    const { service } = setup({ check: async () => release('0.2.0') });
    const failing = new UpdateService({
      currentVersion: '0.1.0',
      check: async () => release('0.2.0'),
      prepare: async () => {
        throw new Error('https://github.com/secret-token');
      }
    });
    await failing.checkNow();
    const status = await failing.download();
    expect(status).toEqual({ kind: 'error', message: 'Orbit could not download the update.' });
    expect(JSON.stringify(status)).not.toContain('secret-token');
    expect(service).toBeDefined();
  });

  it('does not check again while an update is already prepared', async () => {
    const { service, check } = setup({ check: async () => release('0.2.0') });
    await service.checkNow();
    await service.download();
    await service.checkNow();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight check when checks overlap', async () => {
    let release_: (r: RemoteRelease | null) => void = () => undefined;
    const { service, check } = setup({ check: () => new Promise((resolve) => (release_ = resolve)) });
    const first = service.checkNow();
    const second = service.checkNow();
    release_(null);
    await Promise.all([first, second]);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('turns a failed check into an error status without throwing', async () => {
    const { service } = setup({
      check: async () => {
        throw new Error('ENOTFOUND github.com');
      }
    });
    const status = await service.checkNow();
    expect(status.kind).toBe('error');
    expect(service.getStatus()).toEqual(status);
  });

  it('applies the prepared update only when the user confirms', async () => {
    const { service, apply } = setup({ check: async () => release('0.2.0') });
    await expect(service.install()).rejects.toThrow('No update is ready');
    await service.checkNow();
    await expect(service.install()).rejects.toThrow('No update is ready');
    await service.download();
    await service.install();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('checks at start and every four hours while running, and stops on stop()', async () => {
    vi.useFakeTimers();
    try {
      const { service, check } = setup();
      service.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(check).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
      expect(check).toHaveBeenCalledTimes(2);
      service.stop();
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies listeners of each status change', async () => {
    const { service } = setup({ check: async () => release('0.2.0') });
    const seen: string[] = [];
    service.onChange((status) => seen.push(status.kind));
    await service.checkNow();
    await service.download();
    expect(seen).toEqual(['checking', 'available', 'downloading', 'ready']);
  });
});
