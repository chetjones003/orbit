/**
 * Merge conflicts on a pull request. Orbit compares the git trees of the merge base, the pull request's head and the
 * base branch, path by path. Paths both branches changed carry the text of each version, and the renderer merges them.
 * The commit that resolves the conflicts is built here too, with the base branch as its second parent.
 */

/** The text of one path's three versions. A null side means the file is absent on that side. */
export interface PathTexts {
  ancestor: string | null;
  head: string | null;
  base: string | null;
}

/** One path that the base branch changed since the merge base. Blob ids and modes come from git, not file text. */
export interface ConflictPath {
  path: string;
  /** The head changed this path too. */
  changedOnHead: boolean;
  /** Always true: only paths the base changed are listed. */
  changedOnBase: boolean;
  /** Why Orbit cannot edit this path's text (binary, larger than 25 MB, submodule). Null when it can. */
  unsupported: string | null;
  ancestorBlob: string | null;
  headBlob: string | null;
  headMode: string | null;
  baseBlob: string | null;
  baseMode: string | null;
  /** Set only for paths both sides changed. */
  texts: PathTexts | null;
}

export interface ConflictSet {
  headRef: string;
  headSha: string;
  /** True when the head branch lives in the same repo, so Orbit can push to it. */
  headInRepo: boolean;
  baseRef: string;
  baseSha: string;
  mergeBaseSha: string;
  paths: ConflictPath[];
}

/** One change written into the resolving commit. A null content or sha deletes the file. */
export type ResolvedFile =
  | { kind: 'text'; path: string; content: string | null; mode: string }
  | { kind: 'blob'; path: string; sha: string | null; mode: string };

export interface ConflictCommitInput {
  expectedHeadSha: string;
  expectedBaseSha: string;
  files: ResolvedFile[];
}

export interface ConflictCommitResult {
  sha: string;
}
