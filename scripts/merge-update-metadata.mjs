#!/usr/bin/env node
// Merges the per-architecture latest-mac.yml files from the macOS release builds into one file, so a
// single GitHub Release describes both the Apple Silicon and Intel DMGs.
//
// Usage: node scripts/merge-update-metadata.mjs <out.yml> <in1.yml> [in2.yml ...]

import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';

/** Combines parsed latest-mac.yml documents. Every input must describe the same version. */
export function mergeMacMetadata(documents) {
  if (documents.length === 0) throw new Error('No metadata to merge');
  const version = documents[0].version;
  const files = [];
  const seen = new Set();
  for (const doc of documents) {
    if (doc.version !== version) {
      throw new Error(`Metadata version mismatch: ${doc.version} differs from ${version}`);
    }
    for (const file of doc.files ?? []) {
      if (seen.has(file.url)) continue;
      seen.add(file.url);
      files.push(file);
    }
  }
  return {
    version,
    files,
    // Legacy top-level fields point at the first DMG so older readers still find a valid file.
    path: files[0].url,
    sha512: files[0].sha512,
    releaseDate: documents[0].releaseDate
  };
}

function main(argv) {
  const [out, ...inputs] = argv;
  if (!out || inputs.length === 0) {
    throw new Error('Usage: merge-update-metadata.mjs <out.yml> <in1.yml> [in2.yml ...]');
  }
  const merged = mergeMacMetadata(inputs.map((path) => parse(readFileSync(path, 'utf8'))));
  writeFileSync(out, stringify(merged));
}

if (process.argv[1]?.endsWith('merge-update-metadata.mjs')) {
  main(process.argv.slice(2));
}
