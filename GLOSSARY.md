# Glossary

**Orbit**: The desktop app this repo builds. It is a GitHub client for issues and pull requests.

## Language

**Personal repo**: A repository owned by the signed-in GitHub account itself. Repos owned by organizations are not personal repos, even if the user can access them.

**Full client**: Orbit lets the user act on issues and pull requests without opening github.com. This includes reviewing, approving, merging, and creating them, not only viewing.

**Inbox**: The cross-repo view of the issues and pull requests that need the user's attention, split into fixed tabs.
_Avoid_: Dashboard, home feed

**Pinned repo**: A personal repo the user has chosen to keep at the top of the repo list.
_Avoid_: Favourite, starred repo (starring is a separate GitHub feature)

**Project**: A GitHub Projects (v2) project owned by the user's account. Its items are issues and pull requests with field values.
_Avoid_: Board (a board is only one way of showing a project), classic project

**Saved view**: A view of a Project that is defined and stored on GitHub.
_Avoid_: GitHub view

**Custom view**: An Orbit-defined way to show one Project's items: Kanban, Gantt, Calendar, or Table. It exists only in Orbit, not on GitHub.
_Avoid_: Board, layout, saved view

**Sign-in**: Connecting Orbit to the user's GitHub account through the OAuth device flow: Orbit shows a code, the user enters it on GitHub, and Orbit receives tokens.
_Avoid_: Login (ambiguous with the account name), authentication (use for the general concept only)

**Session**: One signed-in GitHub account as held in memory by the main process. A new session starts when the account changes. Re-signing in as the same account keeps the session, so in-memory work survives.
_Avoid_: Connection, login state

**Credential store**: Orbit's encrypted, on-disk storage for the session's tokens. It uses OS-backed encryption when available and otherwise Orbit's own local key. Tokens never leave main.
_Avoid_: Keychain, vault, settings

**Refresh**: Reloading the visible data from GitHub. It runs automatically every minute while signed in, and manually from the Refresh control. Refreshes are not persisted.
_Avoid_: Sync (implies two-way replication), reload

**Connection status**: What the status banner reports: idle before the first refresh, then fresh, stale, offline, or rate-limited, with the last successful refresh and the next retry when known.
_Avoid_: Connection (that word means the session in this glossary), network state

**Stale data**: Data still shown after a refresh failed for a reason other than the network or a rate limit. It stays visible and is marked as possibly out of date.
_Avoid_: Cache, outdated (use only in prose)

**Rate limited**: GitHub has refused requests until a reset time. Orbit waits for that time, shows it, and disables writes until the limit lifts.
_Avoid_: Throttled, blocked

**Refresh cooldown**: The short wait after a manual refresh, and the wait imposed by a rate limit, before another manual refresh runs.

**Diagnostics**: Redacted, bounded, local records of failures and state changes, copied by the user on request. They never contain tokens, GitHub content, or editor text, and they are never uploaded automatically.
_Avoid_: Logs (ambiguous with the log file on disk), telemetry

**Uncertain write**: A GitHub write whose outcome is unknown because the request may not have reached GitHub. Orbit's write helper checks GitHub for the result before retrying, so the write is never applied twice. Comment writes use the helper.
_Avoid_: Failed write (it may have succeeded)

**Issue view**: Detail of one issue: its metadata, body, and comments. From it the user can add comments and edit or delete their own, and for their own issues, edit the title and body, change the issue fields and state, and tick task checkboxes. It opens in the details panel, and can be expanded to fill the main view.
_Avoid_: Issue page, issue modal

**Pull diff**: The changed files of a pull request, with a file navigator and each file's diff. Unified in the details panel; the expanded view can also show a split diff. A file's diff loads only when the reader opens it if it is large.
_Avoid_: Patch view, changes tab

**Review thread**: A line-anchored discussion on a pull request's diff, with its replies. It can be resolved, and it is outdated once the code it was written against has changed. An outdated thread keeps its original diff context.
_Avoid_: Review comment (a single comment within a thread), inline comment
**Partial list**: An issue or comment list that Orbit could not fully load or read. It is shown with a notice that it may be incomplete, never as the full result.
_Avoid_: Partial page (a list can be partial without being paged)

**Owner repo link**: A link in an issue body that points to an issue or pull request in one of the signed-in owner's personal repos. It opens inside Orbit. Other http(s) and mailto links open through the controlled external open.

**Draft**: Unsent comment text (a new comment or an edit), held in memory only and keyed by account, repo, item, and target. It survives navigation. It is dropped when the account changes or the user signs out, and warned about before it is discarded, on sign-out, or when the window closes.
_Avoid_: Autosave, saved text (drafts are never written to disk)

**Own comment**: A comment whose author is the signed-in account. Only own comments can be edited or deleted.

**Edit conflict**: An edit started from a comment version that GitHub has since replaced. Orbit keeps the user's own text and lets them view GitHub's version, overwrite it, or copy their text to the clipboard. Nothing is overwritten silently. An issue title and body edit with a conflict is not overwritten either: the user keeps their text and loads GitHub's latest version.

**New issue**: An issue the user creates in one of their personal repos from that repo's issue list. Like other writes, an uncertain failure is checked against GitHub before retrying, so the issue is never created twice.

**Issue fields**: An issue's labels, assignees, and milestone. A change shows at once and is undone if GitHub refuses it. Each list is saved in full, replacing GitHub's list.
_Avoid_: Metadata (too broad, and it includes the title and body)

**Task checkbox**: A checkbox that comes from a task-list item (`- [ ]` or `- [x]`) in an issue body. Ticking one changes only that line of the body's source, and only when the body on GitHub is still the version the user saw. If it changed, nothing is written and the issue is reloaded.
_Avoid_: Checklist item (the rendered list item is not the checkbox)

**Attachment**: An image (PNG, JPG, GIF, WebP, SVG) or video (MP4, MOV, WebM) the user adds to a comment or issue body in one of their personal repos. Orbit uploads it through main, and its link goes into the Markdown in place of an uploading placeholder. Images are limited to 10 MB; videos to 10 MB on a free plan and 100 MB on a paid one.
_Avoid_: Upload (the act, not the thing), file, asset (GitHub's word for the hosted file)

**Public-upload notice**: The one-time warning shown before the first attachment to a public repo, because an attachment becomes public on GitHub as soon as it uploads. Once the user accepts it, it is not shown again.

**GitHub fallback**: When an attachment cannot be uploaded (refused, rejected, or failed), Orbit offers Retry, Open on GitHub, and Remove. Open on GitHub opens the item on GitHub and copies the draft, so the file can be attached there.
