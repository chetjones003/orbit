# Fake GitHub

A local stand-in for GitHub for debugging and testing Orbit. It serves the OAuth device flow, the REST
API, and the GraphQL API the app uses, from an in-memory store of invented data. Nothing here talks to
GitHub, and no credentials are needed.

The account is `demo-dev`. It owns:

- **atlas-cad** (public): 12 issues and 6 pull requests in every state. Labels, milestones, assignees,
  comments with `@mentions`, task lists, Mermaid flowchart and sequence diagrams, screenshots, a video
  clip, and a table. Pull requests have reviews (approved, changes requested), inline review threads
  (resolved, unresolved, outdated), check runs, workflow runs, a merged PR, a closed PR, a draft, and a
  PR with merge conflicts.
- **field-notes** (private): issues and pull requests, with an open PR whose checks are queued.
- **pdal-tools** (fork) and **orbit-docs** (archived, read-only): one issue each, and two for the archive.
- **Projects v2**: _Atlas roadmap_ (open) with Status, Priority, Size, Estimate, Start and Target dates,
  Sprint iterations, and Notes; three views (a board and two tables with filters) and 12 items, including
  a draft issue. _Field notes plan_ (closed) with one board view.
- **Notifications**: two unread threads, a mention and a review request.

Writes change the store, so the next read returns them: issues, comments, labels, assignees, milestones,
open and close, pull request creation, merges, auto-merge, drafts, review comments, review threads,
submitting reviews, re-running workflows, project items, and field values. Uploads are kept in memory
and served back.

## Run it

```sh
npm run fake-app           # builds Orbit, starts the fake, and launches the app against it
npm run fake-app -- --cdp 9333   # the same, with Chromium DevTools on 127.0.0.1:9333 for scripted checks
npm run fake-github        # only the server, on 127.0.0.1:4010 (use with ORBIT_GITHUB_URL)
npm run fake-assets        # regenerate the screenshots in assets/
```

`fake-app` runs Orbit with its own profile (kept in your temp folder between runs), so a real install and its
saved sign-in are left alone, and the repositories you track are remembered. Click **Sign in with GitHub**: the fake approves the device code on the first poll.

Set `ORBIT_GITHUB_URL` to the server's origin to point any build of Orbit at it. The override is accepted
only for a bare loopback origin, so tokens cannot be sent to a remote host.

## Debugging endpoints

- `GET /__fake/state`: a summary of repos, items, projects, and unread notifications.
- `GET /__fake/log`: the last 200 requests, with status codes and any GraphQL fields the fake does not model.
- `POST /__fake/reset`: discards every write and reseeds the account.

## What it does not do

- It does not check tokens. Any `Authorization: Bearer` value is accepted.
- It sends no ETags, so every refresh is a full read.
- Search understands the qualifiers the inbox uses (`is:`, `author:`, `assignee:`, `review-requested:`,
  `mentions:`, `user:`). Other qualifiers are ignored.
- GraphQL covers the types and fields the app queries. A field it does not model returns `null` and is
  listed in the log under `graphql:`.
- Video clips are WebM. Chromium plays them; GitHub's MP4 uploads are not reproduced.

## Files

- `server.mjs`: HTTP routes, OAuth device flow, writes, and debug endpoints.
- `graphql.mjs`: a small GraphQL parser and executor.
- `graphql-resolvers.mjs`: the GraphQL types, fields, and mutations for Repository, pull requests, reviews,
  and Projects v2.
- `views.mjs`: store objects in GitHub's REST shapes.
- `markdown.mjs`: GitHub-flavoured Markdown to HTML, built on the same `@lezer/markdown` parser the app uses.
- `data.mjs`: the seed account. Everything in it is invented.
- `launch.mjs`: starts the fake and launches Orbit against it.
- `make-assets.mjs`: renders the screenshots in `assets/`.
