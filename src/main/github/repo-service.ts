import type { PersonalRepo } from '../../shared/ipc';
import type { AuthService } from './auth-service';

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
  fetch?: typeof fetch;
}

/** Fetches the signed-in user's own repositories without persisting GitHub data. */
export class RepoService {
  private readonly auth: RepoServiceOptions['auth'];
  private readonly apiBaseUrl: string;
  private readonly apiFetch: typeof fetch;

  constructor(options: RepoServiceOptions) {
    this.auth = options.auth;
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '');
    this.apiFetch = options.fetch ?? fetch;
  }

  async listPersonalRepos(): Promise<PersonalRepo[]> {
    const status = this.auth.getStatus();
    if (status.kind !== 'signed-in') throw new Error('Sign in to GitHub to load repositories.');
    const sessionId = status.sessionId;
    const token = await this.auth.getAccessToken();
    const repos: PersonalRepo[] = [];
    for (let page = 1; ; page++) {
      const response = await this.apiFetch(
        `${this.apiBaseUrl}/user/repos?type=owner&sort=updated&per_page=100&page=${page}`,
        { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } }
      );
      if (!response.ok) throw new Error(`GitHub could not load repositories (${response.status}).`);
      const body = (await response.json()) as unknown;
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
      if (body.length < 100) return repos;
    }
  }
}
