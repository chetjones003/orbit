import type { PersonalRepo } from '../../shared/ipc';
import type { AuthService } from './auth-service';
import { GitHubClient } from './github-client';

interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  default_branch: string;
  updated_at: string;
  html_url: string;
  owner: { login: string };
}

export interface RepoServiceOptions {
  auth: Pick<AuthService, 'getStatus' | 'getAccessToken'>;
  apiBaseUrl: string;
  /** Shared client, so ETags are reused across refreshes. Created internally when omitted. */
  client?: GitHubClient;
  fetch?: typeof fetch;
}

/** Fetches the signed-in user's own repositories without persisting GitHub data. */
export class RepoService {
  private readonly auth: RepoServiceOptions['auth'];
  private readonly client: GitHubClient;
  /** Last complete list for one session, held in memory only. */
  private snapshot: { sessionId: number; repos: PersonalRepo[] } | null = null;

  constructor(options: RepoServiceOptions) {
    this.auth = options.auth;
    this.client =
      options.client ?? new GitHubClient({ apiBaseUrl: options.apiBaseUrl, fetch: options.fetch });
  }

  /** The list to show: the last complete one for this session, otherwise a fresh fetch. */
  async current(): Promise<PersonalRepo[]> {
    const status = this.auth.getStatus();
    if (status.kind === 'signed-in' && this.snapshot?.sessionId === status.sessionId) {
      return this.snapshot.repos;
    }
    return this.listPersonalRepos();
  }

  async listPersonalRepos(): Promise<PersonalRepo[]> {
    const status = this.auth.getStatus();
    if (status.kind !== 'signed-in') throw new Error('Sign in to GitHub to load repositories.');
    const sessionId = status.sessionId;
    const token = await this.auth.getAccessToken();
    const scope = String(sessionId);
    const repos: PersonalRepo[] = [];
    for (let page = 1; ; page++) {
      const body = await this.client.get<unknown>(
        `/user/repos?type=owner&sort=updated&per_page=100&page=${page}`,
        { token, scope }
      );
      if (!Array.isArray(body)) throw new Error('GitHub returned an invalid repository list.');
      const latestStatus = this.auth.getStatus();
      if (latestStatus.kind !== 'signed-in' || latestStatus.sessionId !== sessionId) {
        throw new Error('The signed-in account changed. Reload repositories.');
      }
      for (const item of body as GitHubRepoResponse[]) {
        if (!item || item.owner?.login.toLowerCase() !== status.login.toLowerCase()) continue;
        repos.push({
          id: item.id,
          name: item.name,
          fullName: item.full_name,
          description: item.description,
          isPrivate: item.private,
          isFork: item.fork,
          isArchived: item.archived,
          defaultBranch: item.default_branch,
          updatedAt: item.updated_at,
          htmlUrl: item.html_url
        });
      }
      if (body.length < 100) {
        this.snapshot = { sessionId, repos };
        return repos;
      }
    }
  }
}
