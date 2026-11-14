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

**Unscheduled tray**: The visible collection of a custom Gantt or Calendar view's items that lack the scheduling values needed to place them on its dates.
_Avoid_: Backlog (items may already be in progress)

**No value group**: The group in a custom Kanban or grouped Table view for items without a value in the field used to group them.
_Avoid_: Unscheduled (this group is not specific to dates)
