# How should a single-user desktop app authenticate to GitHub?

Research for [#3](https://github.com/chetjones003/orbit/issues/3). Sources checked 2026-11-14. This note sets out facts and trade-offs. It does not pick an option; that decision belongs to [#6](https://github.com/chetjones003/orbit/issues/6).

Context: Orbit is a single-user Electron client that reads, comments on, reviews, approves, merges, and creates issues and PRs, on the owner's personal repos only.

## The four options at a glance

| | OAuth App, device flow | GitHub App user token (device flow or web+PKCE) | Fine-grained PAT pasted in | Reuse the `gh` CLI token |
|---|---|---|---|---|
| Permission model | Broad scopes. `repo` = full access to all public and private repos [S1] | Fine-grained permissions, limited to repos where the app is installed [S4][S5] | Fine-grained permissions, limited to selected repos [S7] | Whatever `gh` was granted (classic-scope OAuth token, minimum `repo`, `read:org`, `gist` for PAT login) [S9] |
| Client secret needed? | No for device flow [S2] | No for device flow, including refresh [S3][S6]. Yes for web flow, even with PKCE [S3] | No app registration at all | No |
| Token lifetime | Long-lived by default. Optional 8 h access + 6 month refresh [S2] | 8 h access + 6 month refresh by default (opt-out possible) [S3][S6] | Owner sets expiry. Default 30 days; unused tokens auto-removed after a year [S7] | Managed by `gh`. `gh auth token` refreshes if needed [S8] |
| Who registers what | Owner registers an OAuth App, enables device flow [S2] | Owner registers a GitHub App, installs it on their account, picks repos [S4][S5] | Nothing to register; owner creates the token in settings | Nothing; depends on `gh` being installed and logged in |
| Sign-in UX | Show a code, user enters it at github.com/login/device [S2] | Same as OAuth device flow, or a browser redirect to a loopback port | User copies a token from GitHub settings into Orbit | Zero UX if `gh` is logged in |
| REST rate limit | 5,000 req/h, shared with the user's other tokens [S10] | 5,000 req/h, shared [S10] | 5,000 req/h, shared [S10] | 5,000 req/h, shared [S10] |
| GitHub's guidance | "consider using a GitHub App instead of an OAuth app" [S12] | Preferred over OAuth Apps [S11][S12] | Recommended over classic PATs [S7] | Not a documented integration path for third-party apps |

Rate limits do not separate the options: all user-attributed tokens share one 5,000/h budget [S10].

## Option 1: OAuth App with the device flow

- Flow: `POST https://github.com/login/device/code` with `client_id` (and scopes), show the `user_code`, open `https://github.com/login/device`, then poll `POST https://github.com/login/oauth/access_token` no faster than the returned `interval`. Device codes expire after 900 seconds. `slow_down` adds 5 s to the interval. Other errors: `authorization_pending`, `expired_token`, `access_denied`, `device_flow_disabled` [S2].
- Device flow must be enabled in the app settings, otherwise `device_flow_disabled` [S2].
- "The `client_secret` is not needed for the device flow" [S2].
- Scopes for the full-client actions on private personal repos: `repo`. No narrower scope covers private-repo issues and PRs. `public_repo` covers public repos only. `repo` "Grants full access to public and private repositories", so it also reaches every other repo the user can access [S1].
- `workflow` scope is needed to add or update GitHub Actions workflow files [S1]. Whether merging a PR that touches workflow files needs it is not stated in the docs; worth testing if it matters.
- Tokens are long-lived unless the app opts into expiring tokens (or requests `offline_access`), in which case access tokens last 8 h and refresh tokens 6 months [S2]. Non-expiring OAuth tokens persist "until the person who authorized the OAuth app revokes the token" [S11].

## Option 2: GitHub App user access token

- What it can reach: the intersection of what the user can access, what the app has permission for, and the accounts where the app is installed. "An app does not need to be installed in order for a user to authorize the app", but it can only act in accounts where it is installed [S5]. For Orbit, the owner installs the app on their own account and selects which repos it can see [S11].
- Device flow: send only `client_id`; no client secret [S3]. Refresh: `client_secret` is "Required unless the user access token was generated using the device flow" [S6]. So the device-flow path needs no secret at any point.
- Web flow (browser redirect): supports PKCE (`S256` only), but the code exchange marks `client_secret` as **Required** even with `code_verifier` [S3][S2]. A desktop app would have to ship the secret. GitHub's own docs say a public client "cannot secure your client secret" and must ship it in code [S12][S13].
- Loopback redirects (documented for OAuth Apps): the `redirect_uri` port does not need to match the registered callback port, and `127.0.0.1` or `::1` is recommended over `localhost` [S2]. The GitHub App page does not document loopback handling separately [S3].
- Token lifetimes: user access tokens (`ghu_`) expire after 8 h (`expires_in` 28800); refresh tokens (`ghr_`) after 6 months (`refresh_token_expires_in` 15897600). Expiry is on by default and can be turned off under Optional Features, "User-to-server token expiration" [S3][S6].
- Minimum repository permissions for Orbit's actions, per GitHub's endpoint-to-permission table [S4]:

  | Action | Endpoint | Permission |
  |---|---|---|
  | List and read issues | `GET /repos/{o}/{r}/issues` | Issues: read |
  | Create issue, comment | `POST .../issues`, `POST .../issues/{n}/comments` | Issues: write |
  | Create PR | `POST .../pulls` | Pull requests: write |
  | Review, approve (submit review) | `POST .../pulls/{n}/reviews`, `.../reviews/{id}/events` | Pull requests: write |
  | Merge PR | `PUT .../pulls/{n}/merge` | Contents: write |
  | Read file contents and diffs | `GET .../contents/{path}` | Contents: read |
  | List the user's repos | `GET /user/repos` | Metadata: read |

  Set: **Issues: write, Pull requests: write, Contents: write, Metadata: read**. Some endpoints need more than one permission; the `X-Accepted-GitHub-Permissions` response header reports what a call needs [S4]. Checks or Actions status on PRs would need further read permissions (not researched here).

## Option 3: Fine-grained PAT pasted into the app

- Can be limited to specific repositories, but always includes read-only access to all public repos [S7].
- Permissions are the same model as GitHub Apps, so the set from Option 2 applies.
- Expiry: owner picks it. The default is 30 days; the docs say infinite lifetimes are allowed unless a policy blocks them. GitHub auto-removes tokens unused for a year [S7].
- Known gaps: fine-grained PATs cannot be used for the **Checks API**, Packages, user-owned Projects, multiple orgs at once, or repos where the user is only a collaborator. Some REST endpoints work only with classic PATs. GitHub says "These feature gaps are not permanent" [S7]. For Orbit, the Checks API gap matters if PR views should show check runs.
- No app registration, no OAuth flow to build. The cost is manual: create, paste, and rotate on expiry, with no refresh.

## Option 4: Reuse the `gh` CLI token

- `gh auth token` "outputs the authentication token for an account on a given GitHub host", and refreshes an expiring token before printing it unless `--no-refresh` is passed [S8].
- `gh` stores the token in the system credential store, but "will fallback to writing the token to a plain text file" if no store is available [S9].
- The token's scopes are whatever `gh` was granted; the minimum for PAT login is `repo`, `read:org`, `gist` [S9], which is broader than Orbit needs.
- Trade-offs: zero sign-in work and nothing to register. But Orbit then depends on `gh` being installed and logged in, the token belongs to `gh`'s OAuth app (revoking one revokes both), and GitHub does not document this as an integration path for third-party apps.

## Client secrets in a desktop app

- Desktop apps are public clients: "you cannot secure your client secret", and you "do have to ship the client secret in the application's code" [S12][S13].
- Device flow (OAuth App or GitHub App) needs no secret for sign-in, and for GitHub App device-flow tokens, none for refresh either [S2][S3][S6].
- The web flow needs `client_secret` at code exchange even with PKCE [S2][S3]. A desktop app using it ships the secret; PKCE then protects the redirect step.
- GitHub's view of device flow: both best-practice pages advise against enabling it unless needed, because "an attacker can use the device flow to remotely impersonate your app" in phishing. They suggest it for constrained environments (CLIs, IoT, headless) and say "It is preferable to use the authorization code with PKCE over the device flow" [S12][S13]. For a single-user app whose client ID only the owner uses, the phishing risk is lower in practice, but it is GitHub's stated position.
- If a browser flow is used, RFC 8252 says native apps must use an external user-agent (the system browser) rather than an embedded web view [S15]. In Electron that means `shell.openExternal` plus a loopback listener, not a `BrowserWindow` on github.com.

## Storing and refreshing the token in Electron

- `safeStorage` encrypts strings with OS-backed keys: macOS Keychain, Windows DPAPI, Linux secret store (kwallet or gnome-libsecret) [S14].
- **The sync API is deprecated**: `isEncryptionAvailable`, `encryptString`, `decryptString` "will be removed in Electron 46". Use `isAsyncEncryptionAvailable()`, `encryptStringAsync()`, `decryptStringAsync()`. The async decrypt returns `{ result, shouldReEncrypt }`; when `shouldReEncrypt` is true, encrypt the value again and store it [S14].
- Use it only after the app `ready` event [S14].
- Protection varies by platform. Windows DPAPI protects from other users "but not from other apps running in the same userspace". macOS Keychain stops other apps "without user override" [S14].
- Linux pitfall: with no secret store, the backend is `basic_text`, and items are "encrypted via hardcoded plaintext password", which means no real protection. Detect it with `safeStorage.getSelectedStorageBackend() === 'basic_text'` and warn the user or refuse to store the token [S14].
- Keep encryption and the token in the main process. Store the encrypted blob in the app's userData, and send the renderer only API results, never the token.
- Refresh pattern for expiring tokens (GitHub App, or OAuth App with expiry on): store the access token, refresh token, and both expiry times. Before a call, or on a 401, `POST /login/oauth/access_token` with `grant_type=refresh_token`, `client_id`, `refresh_token` (no secret for device-flow tokens) [S6]. A refresh returns a new refresh token, so save both. If the refresh token has expired (6 months without use), run the device flow again.
- PAT: nothing to refresh. Track the expiry the user enters, if any, and prompt for a new token when a 401 arrives.

## Sources

- [S1] Scopes for OAuth apps: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
- [S2] Authorizing OAuth apps (web flow, device flow, loopback redirects): https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- [S3] Generating a user access token for a GitHub App: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- [S4] Permissions required for GitHub Apps: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
- [S5] Authenticating with a GitHub App on behalf of a user: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user
- [S6] Refreshing user access tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
- [S7] Managing your personal access tokens: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- [S8] `gh auth token` manual: https://cli.github.com/manual/gh_auth_token
- [S9] `gh auth login` manual: https://cli.github.com/manual/gh_auth_login
- [S10] Rate limits for the REST API: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- [S11] Deciding when to build a GitHub App: https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app
- [S12] Best practices for creating an OAuth app: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app
- [S13] Best practices for creating a GitHub App: https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app
- [S14] Electron `safeStorage`: https://www.electronjs.org/docs/latest/api/safe-storage
- [S15] RFC 8252, OAuth 2.0 for Native Apps, section 8.12: https://www.rfc-editor.org/rfc/rfc8252#section-8.12

## Open questions

- Does merging a PR that changes `.github/workflows/*` need the `workflow` scope or the Workflows permission? The docs do not say [S1][S4]. Test it if Orbit will merge such PRs.
- Does GitHub App web flow accept loopback redirects with any port, as OAuth Apps do? Only the OAuth App page documents this [S2][S3].
- Which extra read permissions (Checks, Actions, Commit statuses) do PR views need? That depends on the PR-view scope decided elsewhere.
