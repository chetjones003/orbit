import type { LinkedCommit, LinkedPull } from '../../shared/issues';

/** The part of an issue's timeline that links pull requests and commits to it. */
export interface TimelineLinks {
  /** Pull requests of this repository, newest number first. */
  pulls: LinkedPull[];
  /** Commit ids in the order GitHub recorded them, oldest first, without repeats. */
  commitShas: string[];
}

/** Timeline events that name a pull request as the source of a reference or link. */
const PULL_SOURCE_EVENTS = new Set(['cross-referenced', 'connected']);
/** Timeline events that name the commit which referenced or closed the issue. */
const COMMIT_EVENTS = new Set(['referenced', 'closed']);

/**
 * Reads the pull requests and commits that the timeline links to an issue. A pull request from another
 * repository, or an issue rather than a pull request, is left out. Later events win, since they are newer.
 */
export function linksFromTimeline(events: readonly unknown[], owner: string, repo: string): TimelineLinks {
  const pulls = new Map<number, LinkedPull>();
  const commitShas: string[] = [];
  const repoPrefix = `https://github.com/${owner}/${repo}/`.toLowerCase();

  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const event = raw as Record<string, unknown>;
    const name = event.event;

    if (typeof name === 'string' && PULL_SOURCE_EVENTS.has(name)) {
      const pull = toLinkedPull(event.source, repoPrefix);
      if (pull) pulls.set(pull.number, pull);
    } else if (typeof name === 'string' && COMMIT_EVENTS.has(name)) {
      const sha = event.commit_id;
      if (typeof sha === 'string' && /^[0-9a-f]{7,40}$/i.test(sha) && !commitShas.includes(sha)) {
        commitShas.push(sha);
      }
    }
  }

  return {
    pulls: [...pulls.values()].sort((a, b) => b.number - a.number),
    commitShas
  };
}

/** A pull request from a timeline source, or null when the source is not a pull request of this repo. */
function toLinkedPull(source: unknown, repoPrefix: string): LinkedPull | null {
  if (!source || typeof source !== 'object') return null;
  const issue = (source as { issue?: unknown }).issue as Record<string, unknown> | undefined;
  if (!issue || typeof issue !== 'object') return null;
  const pullRequest = issue.pull_request as Record<string, unknown> | undefined;
  if (!pullRequest || typeof pullRequest !== 'object') return null;
  const htmlUrl = issue.html_url;
  if (typeof htmlUrl !== 'string' || !htmlUrl.toLowerCase().startsWith(repoPrefix)) return null;
  if (typeof issue.number !== 'number' || typeof issue.title !== 'string') return null;
  if (issue.state !== 'open' && issue.state !== 'closed') return null;
  const author = issue.user as { login?: unknown } | null | undefined;
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    merged: typeof pullRequest.merged_at === 'string',
    htmlUrl,
    authorLogin: typeof author?.login === 'string' ? author.login : 'ghost'
  };
}

/** A commit from the commits API, or null when the response is missing what Orbit shows. */
export function toLinkedCommit(raw: unknown): LinkedCommit | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const commit = item.commit as Record<string, unknown> | undefined;
  const author = commit?.author as { name?: unknown; date?: unknown } | undefined;
  const login = (item.author as { login?: unknown } | null | undefined)?.login;
  if (typeof item.sha !== 'string' || typeof item.html_url !== 'string') return null;
  if (typeof commit?.message !== 'string' || typeof author?.date !== 'string') return null;
  return {
    sha: item.sha,
    message: commit.message.split('\n')[0]?.trim() ?? '',
    authorLogin: typeof login === 'string' ? login : null,
    authorName: typeof author.name === 'string' ? author.name : '',
    committedAt: author.date,
    htmlUrl: item.html_url
  };
}
