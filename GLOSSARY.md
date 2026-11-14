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
