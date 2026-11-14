# GitHub API surface for Orbit

Research for [#4](https://github.com/chetjones003/orbit/issues/4). Sources were read on 2026-11-14. Each claim cites the page it came from. GitHub says that its rate limits "may change without notice", so check the numbers again before you tune the poller.

## Answer in brief

- **Use both APIs.** Use GraphQL for reads that gather many things at once: the inbox list, and the issue and PR detail views. Use REST for anything that depends on the diff, for merging, for conditional polling, and for the few writes where REST is simpler.
- **Budget.** A user token gets 5,000 REST requests per hour and, separately, 5,000 GraphQL points per hour. Secondary limits: at most 100 concurrent requests; 900 points per minute per REST endpoint and 2,000 points per minute for GraphQL; about 80 content-creating requests per minute and 500 per hour.
- **Freshness without a cache.** Use conditional REST polling. A `304` response costs nothing. You only need an in-memory ETag map for the session. Poll one cheap "has anything changed?" endpoint, and refetch a view with GraphQL only when it says yes or the user opens the view. Webhooks are not a practical option for a desktop app.
- **Library.** Use `octokit` (octokit.js). It bundles the REST methods, GraphQL, pagination, throttling, and retry.

## 1. Listing repos, issues, and PRs

| Need | REST | GraphQL | Pick |
|---|---|---|---|
| The owner's personal repos | `GET /user/repos?affiliation=owner`. `per_page` can be at most 100. You can't combine `type` with `affiliation` or `visibility`; doing so returns a 422 error. [repos] | `viewer.repositories(ownerAffiliations: OWNER, first: 100)` | Either. GraphQL can fetch open issue and PR counts in the same call. |
| Issues and PRs across every repo | `GET /search/issues?q=user:<me> is:open is:issue` (or `is:pull-request`). Search allows 30 requests per minute, returns at most 1,000 results, and `per_page` can be at most 100. [search] | `search(type: ISSUE, query: …)`, which also caps at 1,000 results across all types. [gql-search] | **GraphQL search.** One call can return each item's labels, review decision, and CI rollup. |
| Alternative without Search | `GET /issues?filter=all` lists "all issues you can see". Every PR counts as an issue and carries a `pull_request` key. It supports `since=`. [issues] | none | Good for polling changes with `since` and ETags. |
| One repo | `GET /repos/{o}/{r}/issues` (PRs included) and `GET /repos/{o}/{r}/pulls` [issues][pulls] | `repository { issues / pullRequests }` | GraphQL |

Search caveats:
- With a GitHub App user token, one search query can't mix issues and PRs. A query without `is:issue` or `is:pull-request` returns a 422 error. [search]
- A query can be at most 256 characters and use at most five AND/OR/NOT operators. [search]
- If a search times out, the response sets `incomplete_results: true`. [search]
- Advanced search (nested boolean logic) is **opt-in**: pass `advanced_search=true` in REST or use `type: ISSUE_ADVANCED` in GraphQL. In legacy search, a space means OR. [cl-2025-07]
- Semantic and hybrid search (`search_type=semantic|hybrid`, `ISSUE_SEMANTIC`/`ISSUE_HYBRID`) became generally available in April 2026. They are limited to 10 requests per minute. Lexical search is still the default. [cl-2026-04][search]

Orbit only covers personal repos, so `user:<login>` handles the whole scope, and the 1,000-result cap is unlikely to matter.

## 2. Issue and PR detail

GraphQL can fetch everything a detail view needs in one query. The PR fields are `timelineItems`, `comments`, `labels`, `assignees`, `milestone`, `reviewRequests`, `reviews`, `latestReviews`, `reviewDecision`, `reviewThreads`, `files`, `commits`, `isDraft`, `autoMergeRequest`, `mergeable`, `mergeStateStatus`, and `statusCheckRollup` (on the head commit). [gql-pulls] Issue `timelineItems` replaces the deprecated `timeline`. [gql-issues]

Getting the same data from REST takes about six calls:
- `GET …/issues/{n}/timeline` covers labels, assignment, state, comments, review events, and commits. [timeline]
- Separate calls for PR reviews and review comments. [reviews][comments]
- `GET …/commits/{ref}/check-runs`, which only returns runs from the 1,000 most recent suites. [checks]
- The commit-status endpoint. Checks and commit statuses are separate systems. [checks-guide]

**Pick GraphQL.** `statusCheckRollup` already combines checks and statuses.

Mergeability:
- REST `mergeable` can be `true`, `false`, or `null`. `null` means GitHub has started a background job, so request the PR again later. [pulls]
- GraphQL `mergeable` can be `MERGEABLE`, `CONFLICTING`, or `UNKNOWN`.
- GraphQL `mergeStateStatus` can be `BEHIND`, `BLOCKED`, `CLEAN`, `DIRTY`, `HAS_HOOKS`, `UNKNOWN`, or `UNSTABLE`. Its `DRAFT` value is deprecated; use `isDraft` instead. [gql-pulls]
- **The UI must handle `UNKNOWN`/`null` and re-poll a few seconds later.**

## 3. Writes

Each write has an equivalent in both APIs:

| Action | REST | GraphQL mutation [gql-issues][gql-pulls] |
|---|---|---|
| Comment | `POST …/issues/{n}/comments` | `addComment` |
| Edit a comment | `PATCH …/issues/comments/{id}` | `updateIssueComment` |
| Create an issue | `POST …/issues` (title required; labels, assignees, and milestone require push access) [issues] | `createIssue` |
| Edit, close, or reopen an issue | `PATCH …/issues/{n}` with `state` and `state_reason` (`completed`, `not_planned`, `duplicate`, `reopened`). `labels` and `assignees` **replace the whole set**. [issues] | `updateIssue`, `closeIssue`, `reopenIssue` |
| Add or remove labels and assignees | `POST`/`DELETE …/issues/{n}/labels`, `…/assignees` | `addLabelsToLabelable`/`removeLabelsFromLabelable`, `addAssigneesToAssignable`/`removeAssigneesFromAssignable` |
| Create a PR | `POST …/pulls` (`head`, `base`, and `title` or `issue`) [pulls] | `createPullRequest` |
| Edit, close, or reopen a PR, or mark it ready | `PATCH …/pulls/{n}` | `updatePullRequest`, `closePullRequest`, `reopenPullRequest`, `markPullRequestReadyForReview` |
| Request reviewers | `POST …/pulls/{n}/requested_reviewers` | `requestReviews` |

**Pick:** Orbit can use either API, so use the one the screen already has IDs for. GraphQL wants node IDs; REST wants numbers. Use REST for label and assignee changes, because its add and remove endpoints avoid PATCH's replace-the-whole-set behaviour.

Every write costs 5 secondary-limit points, and content creation is limited to about 80 per minute and 500 per hour. [rest-limits] GitHub recommends making writes one at a time and waiting at least 1 second between mutating requests. [best-practices]

## 4. PR review and merge

- **Diff.** Request `GET …/pulls/{n}` with `Accept: application/vnd.github.diff` (REST only). [pulls]
  - GitHub caps a diff at 300 files, 20,000 lines, or 1 MB in total, and 500 KB per file. [repo-limits]
  - When a diff is too large, the API returns a 406 error. On github.com this is seen in the field rather than documented: the docs state only the limits, and the 406 is reported in issue threads.
  - When that happens, fall back to `GET …/pulls/{n}/files`. It is paginated, returns at most 3,000 files, and includes a `patch` for each file. That field can be missing for binary or very large files. [pulls]
  - **Use REST for the diff.** GraphQL `files` has no patch text.
- **Inline comments.** REST `POST …/pulls/{n}/comments` takes `commit_id`, `path`, `line`, `side` (`LEFT`/`RIGHT`), and optionally `start_line`/`start_side` for a range. It also accepts `subject_type: file`. `position` is "closing down". [comments]
- **Threaded replies.** Use `POST …/pulls/{n}/comments/{id}/replies`. The `id` must be a top-level comment, because "replies to replies are not supported". [comments]
- **Resolving threads.** Only GraphQL can do this, with `resolveReviewThread` and `unresolveReviewThread`. [gql-pulls] That alone makes GraphQL the right choice for the review panel.
- **Submitting a review.**
  - REST: `POST …/pulls/{n}/reviews` with `event` set to `APPROVE`, `REQUEST_CHANGES`, or `COMMENT`. Leave `event` out to create a PENDING review. `body` is required for `REQUEST_CHANGES` and `COMMENT`. The request can include a `comments[]` batch. [reviews]
  - GraphQL: `addPullRequestReview`, then `addPullRequestReviewThread` and `addPullRequestReviewThreadReply`, then `submitPullRequestReview`. `addPullRequestReviewComment` is deprecated. [gql-pulls]
  - **Pick:** use the GraphQL pending-review flow so the UI can stage comments and submit them once. The REST batch is a fine fallback.
  - GitHub does not let you approve or request changes on your own PR. Orbit is single-user, so the owner's own PRs will usually only support COMMENT reviews. (This is GitHub UI behaviour; the REST page does not state it, so check it in the prototype.)
- **Merge.**
  - REST `PUT …/pulls/{n}/merge` with `merge_method` set to `merge`, `squash`, or `rebase`. Pass `sha` as an optimistic lock; a mismatch returns 409.
  - The docs now **recommend the asynchronous `PUT …/merge-async`**, because the synchronous endpoint does not support merge queues or stacked PRs. GraphQL `mergePullRequest` carries the same advice.
  - To update a branch, use `PUT …/update-branch` (202, with `expected_head_sha`) or GraphQL `updatePullRequestBranch`. Auto-merge is `enablePullRequestAutoMerge`. [pulls][gql-pulls]
  - **Use REST `merge-async`.**

## 5. Rate limits

| Limit | Value | Source |
|---|---|---|
| REST primary (user token: PAT, OAuth, or GitHub App user token) | 5,000 requests/hour, shared across all of the user's tokens | [rest-limits] |
| GraphQL primary | 5,000 points/hour, counted separately from REST | [gql-limits] |
| GraphQL query cost | Count the requests each connection needs at its `first`/`last`, divide by 100, and round; the minimum is 1. `first`/`last` must be 1–100, and a call can request at most 500,000 nodes. Queries time out after 10 s, and a timeout costs extra points. | [gql-limits] |
| Search | 30 requests/minute (code search 10, semantic/hybrid 10) | [search] |
| Concurrency | 100, shared between REST and GraphQL | [rest-limits] |
| Points per minute | 900 per REST endpoint, 2,000 for GraphQL. GET counts 1, writes count 5, a GraphQL query 1, a mutation 5. | [rest-limits] |
| CPU | 90 s of CPU per 60 s of real time, of which at most 60 s can be GraphQL | [rest-limits] |
| Content creation | about 80/minute and 500/hour | [rest-limits] |
| Headers | `x-ratelimit-limit/remaining/used/reset/resource`. These are more reliable than `GET /rate_limit`. Secondary-limit status can't be queried. | [rest-limits] |

How to handle limit errors:
- **Primary limit.** REST returns 403 or 429 with `remaining=0`, and GraphQL returns 200 with `remaining=0`. Wait until `x-ratelimit-reset`.
- **Secondary limit.** Honour `retry-after`. If it's missing, wait at least 60 seconds, then back off exponentially. "Continuing … may result in the banning of your integration." [rest-limits][gql-limits]

## 6. Freshness without a local cache

- **Conditional requests.** Send `If-None-Match` (ETag) or `If-Modified-Since`. A 304 response is free when the request is authorized. Keep the query parameters identical on every poll, because a different page or filter gives a different ETag. [best-practices]
  - The ETag map lives only in memory. That fits "no local cache", since nothing is written to disk.
  - GitHub documents conditional requests only for REST. GraphQL POSTs have no ETag, so every GraphQL poll costs points.
- **`x-poll-interval`.** If a response carries this header, wait at least that many seconds before polling again. [best-practices]
- **Notifications.** `GET /notifications` (default `X-Poll-Interval: 60`, with `Last-Modified`/`If-Modified-Since` and a free 304) would be the ideal change feed. But **these endpoints only support classic PATs** (scope `notifications` or `repo`). [notifications] Feed this into #3/#6: if Orbit uses a fine-grained PAT or a GitHub App, it can't use notifications.
- **Recommended loop.**
  1. Every 60 s or so, while the window has focus, send a conditional `GET /issues?filter=all&state=all&sort=updated&since=<last>` (or `/user/repos?sort=pushed`). A 304 costs nothing.
  2. When that poll returns 200, refetch the changed items, or the visible list, with one GraphQL query.
  3. While a detail view is open, refetch it with GraphQL every 30–60 s, and again right after every write.
  4. When the window is in the background, slow polling down or pause it.
  - Rough worst case: one list query and one detail query a minute is about 120 GraphQL queries an hour. That is well inside 5,000 points, even at 10 or more points per query.
- **Webhooks.** A webhook needs a reachable payload URL. GitHub's local-testing path relays through smee.io, ngrok, and similar tools. GitHub says smee "is intended for development and testing only" and that its channels "are not authenticated or secure". [webhooks-test] Webhooks are configured per repo, per org, or per App. [webhooks] **Webhooks are not suitable for an online-only desktop client with no server.** Revisit them only if Orbit ever gains a relay backend.

## 7. Client libraries

- **`octokit`** (octokit.js): "all-batteries-included GitHub SDK for Browsers, Node.js, and Deno".
  - It includes `octokit.rest.*` (endpoint methods), `octokit.graphql`, REST pagination, and `plugin-paginate-graphql`.
  - Throttling (`@octokit/plugin-throttling`) and retry (`@octokit/plugin-retry`) are on by default. With the default settings, a request is retried once when it hits a rate limit or secondary rate limit, and a warning is logged.
  - It needs Node 18 or later for built-in fetch. TypeScript needs `moduleResolution: node16`. [octokit]
- **`@octokit/plugin-throttling`** requires `onRateLimit` and `onSecondaryRateLimit` handlers. It honours `retry-after` and `x-ratelimit-reset`, and falls back to a 60 s wait for secondary limits. It does not document a fixed gap between writes, so Orbit should run writes through its own one-at-a-time queue. [throttling]
- Use `@octokit/plugin-paginate-graphql` for cursor loops (`pageInfo.endCursor`/`hasNextPage`). [gql-pagination]
- Architecture note for #7: run Octokit in the Electron main process, behind IPC, so the token never reaches the renderer. This is a design suggestion, not something a source states.

## Sources

- [rest-limits] https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- [gql-limits] https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
- [best-practices] https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
- [search] https://docs.github.com/en/rest/search/search
- [gql-search] https://docs.github.com/en/graphql/reference/search
- [cl-2025-07] https://github.blog/changelog/2025-07-17-duplicate-issues-create-from-anywhere-and-more/
- [cl-2026-04] https://github.blog/changelog/2026-04-02-improved-search-for-github-issues-is-now-generally-available/
- [repos] https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user
- [issues] https://docs.github.com/en/rest/issues/issues
- [timeline] https://docs.github.com/en/rest/issues/timeline
- [pulls] https://docs.github.com/en/rest/pulls/pulls
- [reviews] https://docs.github.com/en/rest/pulls/reviews
- [comments] https://docs.github.com/en/rest/pulls/comments
- [checks] https://docs.github.com/en/rest/checks/runs
- [checks-guide] https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks
- [repo-limits] https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits
- [gql-pulls] https://docs.github.com/en/graphql/reference/pulls
- [gql-issues] https://docs.github.com/en/graphql/reference/issues
- [gql-pagination] https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api
- [notifications] https://docs.github.com/en/rest/activity/notifications
- [webhooks] https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks
- [webhooks-test] https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/testing-webhooks
- [octokit] https://github.com/octokit/octokit.js
- [throttling] https://github.com/octokit/plugin-throttling.js
