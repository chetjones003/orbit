import { inflateRawSync } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

/** The largest file read out of an archive. Theme files are small; anything bigger is refused. */
export const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

/**
 * Reads the wanted files out of a zip archive, and nothing else. Only stored and deflated entries are supported,
 * which covers every extension package. Sizes are checked before anything is decompressed.
 */
export function readZipEntries(archive: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  const directory = findEndOfCentralDirectory(archive);
  const count = archive.readUInt16LE(directory + 10);
  let offset = archive.readUInt32LE(directory + 16);
  const entries = new Map<string, Buffer>();

  for (let index = 0; index < count; index++) {
    ensure(offset + 46 <= archive.length && archive.readUInt32LE(offset) === CENTRAL_HEADER);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (!wanted(name) || name.endsWith('/')) continue;
    ensure(uncompressedSize <= MAX_ENTRY_BYTES && compressedSize <= archive.length);
    ensure(localOffset + 30 <= archive.length && archive.readUInt32LE(localOffset) === LOCAL_HEADER);
    const dataStart =
      localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
    ensure(dataStart + compressedSize <= archive.length);
    const raw = archive.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.set(name, Buffer.from(raw));
    } else if (method === 8) {
      entries.set(name, inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }));
    } else {
      throw new Error('This archive uses a compression method Orbit does not read.');
    }
  }
  return entries;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  // The directory record sits within the last 64 KiB plus its 22-byte fixed part (the comment can be that long).
  const earliest = Math.max(0, archive.length - 22 - 0xffff);
  for (let at = archive.length - 22; at >= earliest; at--) {
    if (archive.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  throw new Error('This file is not a zip archive.');
}

function ensure(condition: boolean): asserts condition {
  if (!condition) throw new Error('This archive is damaged or not a zip file.');
}
