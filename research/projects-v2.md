# Projects v2 API surface for Orbit

Research for [#9](https://github.com/chetjones003/orbit/issues/9). Sources were read on 2026-11-14. Scope: projects **owned by the user** only.

How claims are marked:
- **[V-doc]**: verified against a docs.github.com page or a github.blog changelog post.
- **[V-schema]**: verified by introspecting the live GraphQL schema on 2026-11-14 (`__type` queries made with the owner's `gho_` OAuth token, which has the `project` scope). docs.github.com's GraphQL reference is generated from this schema.
- **[V-live]**: verified by a read-only call against the owner's project `chetjones003` #2 ("GoSurvey Development", 188 items, 5 views, 18 to 20 fields).
- **[Inferred]**: reasoning or design advice that no source states outright.

This research made no writes. Every mutation claim below comes from the schema or the docs. A prototype should exercise the mutations before anyone relies on them.

This builds on the [GitHub API research](https://github.com/chetjones003/orbit/blob/research/github-api/research/github-api.md), which recommends GraphQL reads, conditional REST polling with in-memory ETags, about 60 s polling, and `octokit`.

## Answer in brief

- **Read with GraphQL. Detect changes with conditional REST.**
  - GraphQL: `viewer.projectsV2` → `projectV2(number)` with `fields`, `views`, and `items(first: 100, query: <filter>)`.
  - REST (Projects REST API, Sept 2025): it has `If-None-Match`. A 304 costs no rate-limit points. [V-live]
- **Orbit doesn't need to re-implement GitHub's filter language.** Both `ProjectV2.items(query:)` (GraphQL) and the REST `q=` parameter accept the project filter syntax and filter on the server. That includes the 2026 `AND`/`OR` advanced search. [V-schema][V-live]
  - REST also has `GET …/views/{view_number}/items`, which applies a saved view's filter for you. [V-doc]
  - **Orbit does have to apply sort, group-by, and "column" grouping itself.** The API returns them as configuration (`sortByFields`, `groupByFields`, `verticalGroupByFields`). Items come back only in manual `POSITION` order. [V-schema]
- **Writes:**
  - `updateProjectV2ItemFieldValue` covers text, number, date, single-select, multi-select (new), and iteration. One field per call.
  - `clearProjectV2ItemFieldValue` clears a value.
  - Assignees, labels, milestone, and repository are **issue/PR properties**, so change them with the issue mutations instead.
  - Add an item with `addProjectV2ItemById` and remove it with `deleteProjectV2Item`. `archiveProjectV2Item` is the soft alternative.
  - Reorder with `updateProjectV2ItemPosition(afterId)`.
  - [V-schema][V-doc]
- **Cost:**
  - A well-shaped page of 100 items costs **about 3 GraphQL points**. A naive "every union member with nested connections" query cost **31**. [V-live]
  - Loading the 50,000-item maximum would take about 500 pages. That is around 1,500 points when the query is shaped well, and only about 2 pages for the owner's real project.
- **Gantt/Calendar:**
  - Date fields are plain `Date` values (no time).
  - An iteration value carries `startDate` and `duration` in days, so end = start + duration − 1 [Inferred].
  - An unset field has **no** value node at all; the API does not return null placeholders. [V-live]
  - The roadmap view's start and target date fields are **not exposed** by the API. Orbit must ask the user, or guess. [V-schema]

## 1. Listing projects and saved views

| Need | Call | Notes |
|---|---|---|
| The user's projects | `viewer { projectsV2(first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) }` | Args: `query`, `orderBy` (`TITLE`, `NUMBER`, `UPDATED_AT`, `CREATED_AT`), `minPermissionLevel` (default `READ`). `User.recentProjects` also exists. [V-schema] |
| One project | `viewer { projectV2(number: N) }` → `id`, `title`, `shortDescription`, `readme`, `closed`, `public`, `updatedAt`, `url`, `viewerCanUpdate` | `id` is the `projectId` that every mutation needs. [V-schema] |
| Fields | `projectV2.fields(first: 50)` returns the union `ProjectV2FieldConfiguration` = `ProjectV2Field` \| `ProjectV2SingleSelectField` (`options{id name color description}`) \| `ProjectV2IterationField` (`configuration{duration startDay iterations{…} completedIterations{…}}`) \| **`ProjectV2MultiSelectField`** (`multiSelectOptions`). A project can have at most 50 fields, so a single `first: 50` page always covers them. [V-schema][V-doc about-projects] |
| Views | `projectV2.views(first: 50)` → `number name layout filter fields(first:50) groupByFields verticalGroupByFields sortByFields{direction field} updatedAt` | `layout` is one of `BOARD_LAYOUT`, `TABLE_LAYOUT`, or `ROADMAP_LAYOUT`. `groupBy`, `sortBy`, `verticalGroupBy`, and `visibleFields` are deprecated; use the `…Fields` forms. [V-schema] |

What a view looks like on the owner's project [V-live]:
- "Backlog" is a `BOARD_LAYOUT` with columns from `verticalGroupByFields`=Status, `sortByFields`=Priority ASC, and filter `""`.
- "My items" is a `TABLE_LAYOUT` with filter `assignee:@me`.
- `filter` can be `""` or `null`. Treat both as "no filter".

What the API does **not** expose about a view [V-schema]: the roadmap's start and target date fields, zoom level, markers, field sums, slice-by, the hierarchy toggle (hierarchy view became generally available on 2026-03-19 [cl-hier]), column limits, and per-view column widths. Orbit's custom views therefore need their own settings, such as "which date field is start".

Views can now be written as well as read: `createProjectV2View`, `updateProjectV2View` (name, layout, filter, `configuration.visibleFieldIds`), and `deleteProjectV2View`. REST has `POST /users/{user_id}/projectsV2/{n}/views`, which also takes `sort_by`, `group_by`, and `vertical_group_by`. [V-schema][V-doc rest-views] The GraphQL `ProjectV2ViewConfigurationInput` takes only `visibleFieldIds`. Changing grouping or sort needs REST, and REST only documents *creating* a view. [V-schema][V-doc rest-views] Orbit v1 doesn't need to write views. This is noted here for later.

### Can Orbit apply a saved view's filter itself?

**Yes. Pass the view's `filter` string to the server.**
- GraphQL `ProjectV2.items(query: String = "")` is described as "Search query for filtering items". [V-schema]
- REST `GET /users/{u}/projectsV2/{n}/items?q=…` uses the same syntax ("see Filtering projects"). [V-doc rest-items]
- REST `GET /users/{u}/projectsV2/{n}/views/{view_number}/items` is "List items in a user project with the saved view's filter applied." [V-doc rest-items]

Live checks on project #2 [V-live]:

| query | totalCount |
|---|---|
| `""` | 188 |
| `assignee:@me` | 3 (matches the REST view-5 endpoint: 3) |
| `status:Done` | 65 (REST `q=status:Done`: 65) |
| `status:Done OR status:Backlog` / `status:Done,Backlog` | 186 / 186 |
| `(status:Done OR priority:P0) is:issue` | 36 (parentheses and OR work) |
| `-status:Done priority:P1`, `no:priority`, `is:pr`, `target-date:>=@today`, `updated:>@today-7d` | 20, 57, 31, 106, 185 |
| `cad-category:3D` (a multi-word field name, hyphenated) | 22 |
| `"cad category":3D`, `foo:bar`, `status:Nonexistent` | **0, with no error** |

Caveats:
- **An unknown qualifier or a bad field name returns an empty result, not an error.** If a user types a filter, Orbit can't tell "no matches" from "typo". [V-live]
- Advanced search (`AND`/`OR`) in project filters became generally available on 2026-07-16, which also added a `reviews:` filter. [cl-adv] The changelog doesn't say whether the API supports it. The live test shows that it does. [V-live]
- The full qualifier set is documented in [filtering]: `field:value`, comma OR, `-` negation, `has:`/`no:`, `is:open|closed|merged|issue|pr|draft`, `reason:`, comparisons and `..` ranges, `@me`, `@today±N`, `@current/@next/@previous` iterations, `updated:`, `parent-issue:`, `type:`, `repo:`, and free text.
- **Sorting is not server-side.** `items(orderBy:)` only accepts `POSITION` (the manual order). Apply `sortByFields` on the client, using the same values Orbit already holds. [V-schema]
- [Inferred] Orbit's own Kanban, Calendar, Gantt, and Table views can reuse this. They store a filter string, send it as `query`, and group, sort, and lay out the items locally.

## 2. Reading items and field values

```graphql
query($n: Int!, $after: String, $q: String) {
  viewer { projectV2(number: $n) {
    items(first: 100, after: $after, query: $q) {   # archivedStates defaults to [NOT_ARCHIVED]
      totalCount pageInfo { hasNextPage endCursor }
      nodes { id type isArchived updatedAt
        content { __typename
          ... on Issue { id number title state url updatedAt issueType { name }
                         assignees(first: 10) { nodes { login avatarUrl } }
                         labels(first: 20) { nodes { name color } }
                         milestone { title dueOn } repository { nameWithOwner } }
          ... on PullRequest { id number title state isDraft url updatedAt /* same built-ins */ }
          ... on DraftIssue { id title body } }
        fieldValues(first: 20) { nodes { __typename
          ... on ProjectV2ItemFieldValueCommon { field { ... on ProjectV2FieldCommon { id } } }
          ... on ProjectV2ItemFieldTextValue { text }
          ... on ProjectV2ItemFieldNumberValue { number }
          ... on ProjectV2ItemFieldDateValue { date }
          ... on ProjectV2ItemFieldSingleSelectValue { optionId name color }
          ... on ProjectV2ItemFieldMultiSelectValue { options { id name } }
          ... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration } } } } }
  } }
  rateLimit { cost remaining }
}
```

Unions and types [V-schema]:
- **`ProjectV2ItemFieldValue`** = Date, Iteration, Label, Milestone, **MultiSelect**, Number, PullRequest, Repository, Reviewer, SingleSelect, Text, User, and **`ProjectV2ItemIssueFieldValue`** (organization "issue fields", generally available 2026-07-02 [cl-issuefields]).
  - Only the custom-value types implement `ProjectV2ItemFieldValueCommon` (`id`, `field`, `updatedAt`, `creator`).
  - The built-in types (User, Label, PullRequest, Reviewer, Milestone, Repository) expose only `field` plus their nested connection.
- **`ProjectV2FieldType`** = `ASSIGNEES`, `LINKED_PULL_REQUESTS`, `REVIEWERS`, `LABELS`, `MILESTONE`, `REPOSITORY`, `TITLE`, `TEXT`, `SINGLE_SELECT`, `MULTI_SELECT`, `NUMBER`, `DATE`, `ITERATION`, `TRACKS`, `TRACKED_BY`, `ISSUE_TYPE`, `PARENT_ISSUE`, `SUB_ISSUES_PROGRESS`, `CREATED`, `UPDATED`, `CLOSED`.
- **Status** is not special. It's an ordinary `ProjectV2SingleSelectField` named "Status". [V-live] Find it by name and let the user re-map it if renamed [Inferred].
- `ProjectV2ItemType` = `ISSUE`, `PULL_REQUEST`, `DRAFT_ISSUE`, `REDACTED`. `REDACTED` means the viewer can't see the item. [V-doc api-guide]

Observed on project #2 [V-live]:
- **Only set values are returned.** Item #120 had 9 field values. Unset Estimate and dates, and the Milestone it didn't have, were simply absent. Treat a missing field ID as "no value".
- `TITLE` comes back as a `ProjectV2ItemFieldTextValue`, and `REPOSITORY` and `LABELS` appear on every item (as an empty label set when there are none).
- **Some built-in fields never come back as field values.** `PARENT_ISSUE` and `SUB_ISSUES_PROGRESS` have no member in the value union. The `ISSUE_TYPE` project field ("Type") appears in REST `GET …/fields`, but GraphQL `fields` leaves it out, and `field(name:"Type")` returns NOT_FOUND. Read these from `content` instead: `Issue.issueType`, `parent`, `subIssuesSummary`.
- `ProjectV2ItemFieldMultiSelectValue.value` is a comma-joined string. Use `options{id name}` instead.

Pagination and limits:
- `first`/`last` accept 1–100, a query can touch at most 500,000 nodes, and the timeout is 10 s. [gql-limits]
- A project holds **at most 50,000 items, counting archived ones**. [V-doc adding-items] The limit was 1,200 until it was raised to 50,000 (public preview 2025-02, generally available 2025-04). [cl-items]
- A project can have at most 50 fields. [V-doc about-projects]
- Archived items are excluded by default. Use `archivedStates: [ARCHIVED]` for an archive view. [V-schema]

## 3. Writes

| Action | Mutation (GraphQL) | Input |
|---|---|---|
| Add an issue or PR | `addProjectV2ItemById` | `projectId`, `contentId` (the issue or PR node ID). Adding an item that is already in the project returns the existing item ID. [V-doc api-guide] |
| Add a draft | `addProjectV2DraftIssue` | `projectId`, `title`, `body`, … |
| Remove | `deleteProjectV2Item` | `projectId`, `itemId` → `deletedItemId` |
| Archive / unarchive | `archiveProjectV2Item` / `unarchiveProjectV2Item` | `projectId`, `itemId` |
| Set a value | `updateProjectV2ItemFieldValue` | `projectId`, `itemId`, `fieldId`, `value: ProjectV2FieldValue` = exactly one of `text`, `number` (Float), `date` (ISO 8601 Date), `singleSelectOptionId`, `multiSelectOptionIds`, `iterationId` ("Only 1 value can be updated at a time"). Supported field types: "single-select, multi-select, text, number, date, and iteration." [V-schema] |
| Clear a value | `clearProjectV2ItemFieldValue` | `projectId`, `itemId`, `fieldId`. Supported: "text, number, date, assignees, labels, single-select, multi-select, iteration and milestone." [V-schema] |
| Reorder | `updateProjectV2ItemPosition` | `projectId`, `itemId`, `afterId` ("If omitted or set to null the item will be moved to top"). The position "represents the priority of an item." [V-schema] |
| Assignees, labels, milestone | `addAssigneesToAssignable`/`remove…`, `addLabelsToLabelable`/`remove…`, `updateIssue`/`updatePullRequest` (`milestoneId`) | "You cannot use `updateProjectV2ItemFieldValue` to change `Assignees`, `Labels`, `Milestone`, or `Repository`," because they belong to the issue or PR. [V-doc api-guide] |
| Repository | `transferIssue` | Out of scope for v1 [Inferred]. |
| Title and body | `updateIssue` / `updatePullRequest`, or `updateProjectV2DraftIssue` for drafts | |
| Draft → issue | `convertProjectV2DraftIssueItemToIssue` | |

Notes:
- "You cannot add and update an item in the same call." [V-doc api-guide] To add an item and set its Status, call `addProjectV2ItemById`, then `updateProjectV2ItemFieldValue` with the returned `item.id`. That costs two mutations, or one request with two aliased mutations; aliased mutations run in order, but whether that is safe here is [Inferred].
- Read-only built-ins: Linked PRs, Reviewers, Parent issue, Sub-issues progress, Created, Updated, Closed, and Tracks/Tracked-by. Change them through the issue or PR, or not at all.
- For a single-select, set the option `id` from `field.options`. For an iteration, use an `iterations[].id` or a `completedIterations[].id` ("either an active or completed iteration"). [V-doc api-guide]
- REST alternative: `PATCH /users/{u}/projectsV2/{n}/items/{item_id}` with `{"fields":[{"id":<int field id>,"value":…}]}`. A `null` value clears the field. REST uses **integer** field IDs (for example Status = `404218212`), and passing a node ID returns `400 invalid_ids`. [V-doc rest-items][V-live] Pick one ID space. GraphQL node IDs are simpler because the reads already return them [Inferred].
- Board drag between columns (Status) is one `updateProjectV2ItemFieldValue`. Drag within a column is `updateProjectV2ItemPosition`. That only shows if the view has no `sortByFields`, because a sorted view ignores manual position [Inferred, which matches GitHub's UI].
- Budget [github-api]: each mutation counts 5 secondary points. Run them one at a time, at least 1 s apart, through Orbit's write queue.

## 4. Project memberships from an issue or PR detail view

`Issue.projectItems(first: 10, includeArchived: true)` and `PullRequest.projectItems` return `ProjectV2Item` nodes. Each carries `project { id title number }`, `fieldValues`, and `fieldValueByName(name: "Status")`. [V-schema][V-live]

This slots into the existing detail-view query at about 1 point, and it gives the sidebar the `projectId` and `itemId` its edits need. Filter to `project.owner.login == viewer` to stay in scope [Inferred]. Note that `includeArchived` defaults to **true** here, while `ProjectV2.items` defaults to non-archived only. [V-schema]

## 5. Rate-limit cost and change detection

Measured with `rateLimit { cost }` [V-live]:

| Query shape (100 items) | cost |
|---|---|
| `items { id updatedAt }` | 1 |
| plus `fieldValues(first:20)` with scalar fragments only | 1 |
| plus `content` with `assignees(first:5)` and `labels(first:10)` | 3 |
| Every union member, each with nested connections (`users`, `labels`, `pullRequests`, `reviewers` inside `fieldValues`) | **31** |

- **Read built-ins (assignees, labels, milestone, linked PRs) from `content`, not from `fieldValues`.** The nested connections inside the value union multiply the cost by about 10. [V-live]
- [Inferred] Full load cost is about 3 points per 100 items:

  | Project size | Calls | Points |
  |---|---|---|
  | 188 items (the owner's project #2) | 2 | ~6 |
  | 5,000 items | 50 | ~150 |
  | 50,000 items (the cap) | 500 | ~1,500 |

  All of these fit the 5,000-point hourly budget, but a 50k reload every minute would not. Use `query:` to load only what a view needs.

**Change detection.** GraphQL has no ETags. REST does:
- `GET /users/{u}/projectsV2/{n}/items?per_page=100` returned `Etag: W/"…"` and `Cache-Control: private, max-age=60`. Repeating it with `If-None-Match` returned **`304 Not Modified`, and `x-ratelimit-used` did not increase**. The `views/{n}/items` endpoint returns ETags too. [V-live]
  - This matches the 60 s polling plan exactly (`max-age=60`).
- `ProjectV2.updatedAt`, `ProjectV2Item.updatedAt`, and the `updatedAt` on each custom value all exist. [V-schema]
  - On #2, the project's `updatedAt` (16:59:25Z) was later than the newest item `updatedAt` (16:58:36Z). That suggests it bumps when items change, but it isn't documented [Inferred].
  - Item `updatedAt` tracked its content's `updatedAt` within a second. [V-live]
- Recommended loop [Inferred]:
  1. While a project view is open, send a conditional REST `GET …/items?per_page=100&q=<view filter>` for page 1 every 60 s. A 304 means nothing changed and costs nothing.
  2. On a 200, refetch the view with the GraphQL query above (a few points).
  3. For large projects, poll each page conditionally, or poll the cheap GraphQL `projectV2 { updatedAt }` (1 point) as the trigger. Prototype whether `updatedAt` and the ETag change on every field edit and on edits to the underlying issue.
- Webhooks (`projects_v2_item`) are not an option. They need a server, as the earlier research found. They are also believed to be organization-only, but that wasn't re-checked here [Inferred].

## 6. Gantt and Calendar pitfalls

- **Dates:** `ProjectV2ItemFieldDateValue.date` is a GraphQL `Date` (ISO 8601, no time or zone), and you write it with `value: { date: "YYYY-MM-DD" }`. [V-schema] Treat it as a calendar date, not an instant. Never pass it through `new Date()` in local time, or it may shift by a day [Inferred].
- **No end date is built in.** A Gantt bar needs two fields, such as the user's "Start date" and "Target date". GitHub's roadmap lets the user pick a date or iteration field for each [V-doc roadmap], but the API doesn't say which ones a view uses. Orbit must store this per view, defaulting to field names like "Start date" and "Target date" [Inferred].
- **Missing values:** an item with no date has no value node. The roadmap docs don't say how GitHub draws items with only one date [V-doc roadmap]. Orbit needs its own rule, for example a one-day marker for one date and an "unscheduled" lane for none [Inferred].
- **Iterations:**
  - A value gives `iterationId`, `title`, `startDate`, and `duration` in **days**. [V-schema]
  - The field's `configuration` gives `duration`, `startDay` (day of the week), `iterations` (active and upcoming), and `completedIterations`. [V-schema]
  - Iterations can have **breaks**, meaning gaps between them. They can be edited to any start and end, so don't assume they are back to back or equally long. [V-doc iterations]
  - An item can point at a completed iteration. Look up both lists.
  - An iteration field can also serve as a roadmap start or target [V-doc roadmap]. Its span is `startDate` to `startDate + duration − 1` [Inferred].
- **Milestones** are a built-in with `dueOn` (a DateTime), read through `content.milestone`. They make useful Calendar and Gantt markers [Inferred].
- **Single values only:** `ProjectV2FieldValue` accepts one field per mutation. Dragging a whole Gantt bar costs two mutations, one for start and one for target, so make the update optimistic and roll it back if either fails [Inferred].

## 7. Recent changes (as of 2026-11-14)

- 2025-02 / 2025-04: the item limit went from 1,200 to 50,000. [cl-items]
- 2025-09-11: the **Projects REST API** shipped (list projects, fields, and items; add and delete items; update values). [cl-rest] The docs now show `X-GitHub-Api-Version: 2026-03-10`. [V-doc rest-projects]
- 2026-03-19: hierarchy view became generally available. It isn't exposed in the view API. [cl-hier]
- 2026-07-02: issue fields became generally available for organizations, and they appear in projects as `ProjectV2ItemIssueFieldValue`. [cl-issuefields] They are organization-centric, so they're unlikely to matter for a user-owned v1, but handle the union member gracefully.
- 2026-07-16: advanced search (`AND`/`OR`) in project filters became generally available, along with the `reviews:` qualifier. [cl-adv]
- In the schema now: the `MULTI_SELECT` field type, view create/update/delete mutations, and `ProjectV2View.fields`. `databaseId` is deprecated in favour of `fullDatabaseId`. [V-schema]

## Sources

- [V-schema] Live GraphQL introspection of `ProjectV2`, `ProjectV2View`, `ProjectV2Item`, `ProjectV2ItemFieldValue`, `ProjectV2FieldConfiguration`, `ProjectV2FieldValue`, the mutation inputs, `Issue`, `PullRequest`, and `User`, run 2026-11-14. The reference pages are https://docs.github.com/en/graphql/reference/objects#projectv2, https://docs.github.com/en/graphql/reference/objects#projectv2view, https://docs.github.com/en/graphql/reference/objects#projectv2item, https://docs.github.com/en/graphql/reference/unions#projectv2itemfieldvalue, https://docs.github.com/en/graphql/reference/input-objects#projectv2fieldvalue, and https://docs.github.com/en/graphql/reference/mutations
- [api-guide] https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
- [filtering] https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/filtering-projects
- [about-projects] https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects
- [adding-items] https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-items-in-your-project/adding-items-to-your-project
- [iterations] https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-iteration-fields
- [roadmap] https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-roadmap-layout
- [rest-items] https://docs.github.com/en/rest/projects/items
- [rest-views] https://docs.github.com/en/rest/projects/views
- [rest-projects] https://docs.github.com/en/rest/projects/projects
- [gql-limits] https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
- [github-api] https://github.com/chetjones003/orbit/blob/research/github-api/research/github-api.md
- [cl-items] https://github.blog/changelog/2025-02-26-increased-items-in-github-projects-now-in-public-preview and https://github.blog/changelog/2025-04-09-evolving-github-issues-and-projects/
- [cl-rest] https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/
- [cl-hier] https://github.blog/changelog/2026-03-19-hierarchy-view-in-github-projects-is-now-generally-available/
- [cl-issuefields] https://github.blog/changelog/2026-07-02-issue-fields-are-now-generally-available
- [cl-adv] https://github.blog/changelog/2026-07-16-advanced-search-for-projects-is-generally-available/
