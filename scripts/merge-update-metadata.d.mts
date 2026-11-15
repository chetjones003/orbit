export interface MacUpdateFile {
  url: string;
  sha512: string;
  size: number;
}

export interface MacUpdateMetadata {
  version: string;
  files: MacUpdateFile[];
  path: string;
  sha512: string;
  releaseDate?: string;
}

export function mergeMacMetadata(documents: Partial<MacUpdateMetadata>[]): MacUpdateMetadata;
