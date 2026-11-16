// Seed data for the fake GitHub account `demo-dev`: three personal repos, issues and pull requests in
// every state, labels, milestones, comments, reviews with inline threads, checks, workflow runs, two
// Projects v2 boards, and unread notifications. Bodies are raw Markdown; the server renders them.
// Everything here is invented. No real person, repository, or service is represented.

export const LOGIN = 'demo-dev';

const BASE = Date.parse('2026-11-02T09:00:00Z');
/** An ISO timestamp `days` and `hours` after the seed's base time. */
export function at(days, hours = 0) {
  return new Date(BASE + (days * 24 + hours) * 3600_000).toISOString();
}

const LABEL_SET = [
  ['bug', 'd73a4a', "Something isn't working"],
  ['enhancement', 'a2eeef', 'New feature or request'],
  ['documentation', '0075ca', 'Improvements or additions to documentation'],
  ['good first issue', '7057ff', 'Good for newcomers'],
  ['help wanted', '008672', 'Extra attention is needed'],
  ['needs review', 'fbca04', 'Waiting on a reviewer'],
  ['ready-for-agent', '0e8a16', 'Scoped and ready to build'],
  ['refactor', '5319e7', 'Restructuring without behaviour change'],
  ['performance', 'c5def5', 'Speed or memory work'],
  ['accessibility', '1d76db', 'Keyboard, screen readers, contrast'],
  ['design', 'f9d0c4', 'Visual or interaction design'],
  ['question', 'd876e3', 'Further information is requested'],
  ['wontfix', 'ffffff', 'This will not be worked on'],
  ['duplicate', 'cfd3d7', 'This issue or pull request already exists'],
  ['invalid', 'e4e669', "This doesn't seem right"]
];

const USERS = {
  [LOGIN]: { login: LOGIN, id: 900001, name: 'Demo Developer', plan: 'free' },
  'alex-reviewer': { login: 'alex-reviewer', id: 900002, name: 'Alex Reviewer', plan: 'free' },
  'sam-contrib': { login: 'sam-contrib', id: 900003, name: 'Sam Contributor', plan: 'free' },
  'jordan-design': { login: 'jordan-design', id: 900004, name: 'Jordan Design', plan: 'free' }
};

function repo(id, name, extra) {
  return {
    id,
    name,
    owner: LOGIN,
    full_name: `${LOGIN}/${name}`,
    html_url: `https://github.com/${LOGIN}/${name}`,
    default_branch: 'main',
    created_at: at(-120),
    updated_at: at(-1),
    private: false,
    fork: false,
    archived: false,
    description: null,
    allow_merge_commit: true,
    allow_squash_merge: true,
    allow_rebase_merge: true,
    allow_auto_merge: true,
    delete_branch_on_merge: true,
    branches: ['main'],
    labels: LABEL_SET.map(([name, color, description], i) => ({
      id: id * 1000 + i + 1,
      name,
      color,
      description
    })),
    milestones: [],
    items: [],
    ...extra
  };
}

/**
 * Creates the seed store. Items are numbered per repo, with issues and pulls sharing the sequence, as
 * GitHub does. `key` is `repo#number` and is how comments, reviews, and project items refer to them.
 */
export function createSeed() {
  const store = {
    login: LOGIN,
    users: USERS,
    repos: [],
    items: new Map(),
    comments: new Map(),
    reviews: new Map(),
    threads: new Map(),
    checks: new Map(),
    runs: new Map(),
    files: new Map(),
    projects: [],
    notifications: [],
    uploads: new Map(),
    nextId: 1000
  };
  const uid = () => (store.nextId += 1);

  const atlas = repo(1, 'atlas-cad', {
    description: 'A fast, modern CAD platform built for surveyors',
    branches: [
      'main',
      'feature/dxf-blocks',
      'fix/crash-symbolicate',
      'feature/clipboard-paste',
      'docs/architecture'
    ],
    milestones: [
      {
        number: 1,
        title: 'v0.2 Surveyor preview',
        description: 'First build for field surveyors.',
        state: 'open',
        due_on: at(43)
      },
      {
        number: 2,
        title: 'v0.3 Field trial',
        description: 'Trial with two survey crews.',
        state: 'open',
        due_on: at(118)
      },
      {
        number: 3,
        title: 'v0.1 Spike',
        description: 'The first prototype.',
        state: 'closed',
        due_on: at(-30)
      }
    ]
  });
  const notes = repo(2, 'field-notes', {
    description: 'Field notes and survey logs',
    private: true,
    branches: ['main', 'feature/export-progress'],
    milestones: [{ number: 1, title: 'Export v1', description: '', state: 'open', due_on: at(20) }]
  });
  const fork = repo(3, 'pdal-tools', {
    description: 'Fork of a point-cloud toolkit, kept for experiments',
    fork: true,
    parent: 'upstream-org/pdal-tools',
    branches: ['main'],
    milestones: []
  });
  const archived = repo(4, 'orbit-docs', {
    description: 'Documentation site source (archived)',
    archived: true,
    branches: ['main'],
    milestones: []
  });
  store.repos.push(atlas, notes, fork, archived);

  /** Adds an issue or pull request to a repo, with its own number and node id. */
  function addItem(r, spec) {
    const number = r.items.length + 1;
    const item = {
      repo: r.name,
      number,
      key: `${r.name}#${number}`,
      rest_id: uid(),
      node_id: `I_${uid()}`,
      kind: spec.kind,
      title: spec.title,
      body: spec.body ?? '',
      state: spec.state ?? 'open',
      state_reason: spec.state_reason ?? null,
      user: spec.user ?? LOGIN,
      labels: spec.labels ?? [],
      assignees: spec.assignees ?? [],
      milestone: spec.milestone ?? null,
      created_at: spec.created_at ?? at(-30 + number),
      updated_at: spec.updated_at ?? at(-20 + number),
      closed_at: spec.closed_at ?? null,
      merged_at: spec.merged_at ?? null,
      merge_commit_sha: spec.merge_commit_sha ?? null,
      draft: spec.draft ?? false,
      head: spec.head ?? null,
      base: spec.base ?? null,
      mergeable: spec.mergeable ?? true,
      mergeable_state: spec.mergeable_state ?? 'clean',
      auto_merge: spec.auto_merge ?? null,
      review_requested: spec.review_requested ?? []
    };
    r.items.push(item);
    store.items.set(item.key, item);
    store.comments.set(item.key, []);
    store.reviews.set(item.key, []);
    store.threads.set(item.key, []);
    store.checks.set(item.key, spec.checks ?? []);
    store.runs.set(item.key, spec.runs ?? []);
    store.files.set(item.key, spec.files ?? []);
    return item;
  }

  /** Adds a comment to an item; `days` and `hours` set when it was posted. */
  function comment(key, user, body, days, hours = 0) {
    const created = at(days, hours);
    const list = store.comments.get(key);
    const c = { id: uid(), user, body, created_at: created, updated_at: created };
    list.push(c);
    return c;
  }

  function reviewOn(key, { user, state, body = '', days, hours = 0 }) {
    const review = {
      id: uid(),
      node_id: `PRR_${uid()}`,
      user,
      state,
      body,
      submitted_at: at(days, hours),
      commit_id: null
    };
    store.reviews.get(key).push(review);
    return review;
  }

  function thread(key, t) {
    const id = uid();
    const thread = {
      node_id: `PRRT_${id}`,
      path: t.path,
      line: t.line ?? null,
      originalLine: t.originalLine ?? t.line ?? null,
      diffSide: t.side ?? 'RIGHT',
      isResolved: t.resolved === true,
      isOutdated: t.outdated === true,
      diffHunk: t.diffHunk ?? '',
      comments: t.comments.map((c) => ({
        id: uid(),
        user: c.user,
        body: c.body,
        createdAt: at(c.days, c.hours ?? 0),
        state: c.state ?? 'SUBMITTED'
      }))
    };
    store.threads.get(key).push(thread);
    return thread;
  }

  // -- Atlas CAD: issues -------------------------------------------------------------------------------

  const docsBody = [
    'We have diagrams in the wiki but they drift from the code. This issue tracks a set of diagrams that live in the repo.',
    '',
    '## Target architecture',
    '',
    '```mermaid',
    'flowchart LR',
    '  UI[Renderer] -->|typed IPC| Main[Main process]',
    '  Main --> GH[(GitHub API)]',
    '  Main --> Store[(Settings file)]',
    '  Main -.-> Tray[Tray and notifications]',
    '```',
    '',
    'Sequence for a merge from the PR view:',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  Owner->>Renderer: Merge (squash)',
    '  Renderer->>Main: pulls.merge(expectedHeadSha)',
    '  Main->>GitHub: PUT /pulls/:n/merge',
    '  GitHub-->>Main: 200 merged',
    '  Main-->>Renderer: merged',
    '```',
    '',
    '## Tasks',
    '',
    '- [x] Main, preload, and renderer diagram',
    '- [x] Sequence for merges',
    '- [ ] Projects v2 sequence',
    '- [ ] Notification flow',
    '',
    'See also the [architecture notes](https://github.com/demo-dev/atlas-cad/blob/main/docs/architecture.md).'
  ].join('\n');
  addItem(atlas, {
    kind: 'issue',
    title: 'Docs: per-system and feature dependency diagrams for the target architecture',
    body: docsBody,
    labels: ['documentation', 'needs review'].map((n) => atlas.labels.find((l) => l.name === n)),
    assignees: ['alex-reviewer'],
    milestone: 1,
    created_at: at(-6),
    updated_at: at(-1, 4)
  });
  comment(
    'atlas-cad#1',
    'alex-reviewer',
    'Could the notification flow get its own diagram? It is the part most people get wrong. @demo-dev you wrote the sequence, can you check it?',
    -3,
    2
  );
  comment(
    'atlas-cad#1',
    LOGIN,
    'Added a placeholder. The sequence diagram covers merges; the notification one is next.',
    -1,
    4
  );

  const crashBody = [
    'Crash reports from the field arrive as raw addresses. Without symbols we cannot tell which function failed.',
    '',
    'Reproduction on the survey laptop:',
    '',
    '1. Open a DXF with 40k entities',
    '2. Trigger *Export → Block definitions*',
    '3. Wait for the crash dialog',
    '',
    '![Crash dialog with raw addresses](/assets/crash-dialog.png)',
    '',
    'Captured exception from the minidump:',
    '',
    '```text',
    'EXCEPTION_ACCESS_VIOLATION_READ at 0x00007FF7A21C0F18',
    '  module: atlas-cad.exe  (no symbols)',
    '  thread: 4812 (renderer)',
    '```',
    '',
    '## Done when',
    '',
    '- [ ] PDBs are published with every release',
    '- [x] Minidumps keep the exception code and thread name',
    '- [ ] Crash reports show function names on Windows',
    '',
    'Related: #14'
  ].join('\n');
  addItem(atlas, {
    kind: 'issue',
    title: 'Crash reports are not symbolicatable: ship PDBs and record exception details',
    body: crashBody,
    labels: ['bug', 'help wanted'].map((n) => atlas.labels.find((l) => l.name === n)),
    assignees: ['sam-contrib'],
    milestone: 1,
    created_at: at(-9),
    updated_at: at(0, 2)
  });
  comment(
    'atlas-cad#2',
    'sam-contrib',
    'I can take the PDB publishing step. Will need the release workflow to upload them.',
    -5,
    3
  );
  comment(
    'atlas-cad#2',
    'alex-reviewer',
    'Please keep the thread name in the report, it is the fastest way to find the renderer hang.',
    -2,
    1
  );
  comment('atlas-cad#2', LOGIN, 'Fix is in #14. Leaving this open until PDBs ship with the release.', 0, 2);

  const gradingBody = [
    'The cut/fill balancing solver iterates on the whole surface every pass. On a 2 ha site that takes 40 s.',
    '',
    '| Surface | Points | Passes | Time today | Target |',
    '| --- | ---: | ---: | ---: | ---: |',
    '| Site A | 120k | 14 | 40 s | < 8 s |',
    '| Site B | 310k | 22 | 3 min | < 25 s |',
    '| Site C | 9k | 4 | 0.6 s | < 0.2 s |',
    '',
    'Idea: start from the previous pass and only re-balance cells whose height changed by more than the tolerance.',
    '',
    '> Keep the result identical to the full solve within 1 cm. Add a regression test that compares both.'
  ].join('\n');
  addItem(atlas, {
    kind: 'issue',
    title: 'Grading optimization: iterative cut/fill balancing solver',
    body: gradingBody,
    labels: ['enhancement', 'performance'].map((n) => atlas.labels.find((l) => l.name === n)),
    milestone: 2,
    created_at: at(-4),
    updated_at: at(-1, 9)
  });

  addItem(atlas, {
    kind: 'issue',
    title: 'DXF export: write block definitions and INSERTs',
    body: 'Block definitions and INSERT references must survive a round trip through the DXF exporter.\n\n- [x] Block definitions\n- [x] INSERT references\n- [x] Paper-space block references (REQ-113)',
    labels: [atlas.labels.find((l) => l.name === 'enhancement')],
    assignees: [LOGIN],
    milestone: 1,
    state: 'closed',
    state_reason: 'completed',
    closed_at: at(-2),
    created_at: at(-14),
    updated_at: at(-2)
  });
  comment('atlas-cad#4', 'alex-reviewer', 'Round trip works in AutoCAD 2026 too. Nice.', -3);
  comment('atlas-cad#4', 'sam-contrib', 'Paper-space blocks are the ones that broke last time.', -3, 4);

  addItem(atlas, {
    kind: 'issue',
    title: 'Clipboard: cut and paste special',
    body: 'Paste special (values only, keep formatting, paste as block) would save a lot of rework on large sheets.',
    labels: [atlas.labels.find((l) => l.name === 'wontfix')],
    state: 'closed',
    state_reason: 'not_planned',
    closed_at: at(-10),
    created_at: at(-20),
    updated_at: at(-10)
  });

  addItem(atlas, {
    kind: 'issue',
    title: 'Add keyboard navigation to the Inbox',
    body: 'Moving between the list and the details panel should work from the keyboard.\n\n- Arrow keys move through items\n- Enter opens the focused item\n- Focus stays visible on every row',
    labels: ['accessibility', 'good first issue'].map((n) => atlas.labels.find((l) => l.name === n)),
    assignees: ['sam-contrib'],
    created_at: at(-5),
    updated_at: at(-1, 6)
  });

  addItem(atlas, {
    kind: 'issue',
    title: 'Survey point import drops rows with Unicode names',
    body: [
      'Points named with accents (`Chaussée-14`) disappear after import. The row count is one short.',
      '',
      '![Import log showing the dropped row](/assets/import-log.png)',
      '',
      '```csv',
      'name,easting,northing,elevation',
      'Chaussée-14,612003.2,5349812.7,71.44',
      '```'
    ].join('\n'),
    labels: [atlas.labels.find((l) => l.name === 'bug')],
    created_at: at(-3),
    updated_at: at(-1, 1)
  });
  comment(
    'atlas-cad#7',
    'sam-contrib',
    'Reproduced with UTF-8 BOM files too. The CSV parser is trimming on the wrong byte.',
    -2,
    5
  );

  addItem(atlas, {
    kind: 'issue',
    title: 'Surface the dark theme toggle in the status bar',
    body: 'The toggle is buried in settings. A status-bar control would make it discoverable.\n\nMockup by design: see the attached board.',
    labels: [atlas.labels.find((l) => l.name === 'design')],
    assignees: ['jordan-design'],
    created_at: at(-2),
    updated_at: at(-2)
  });

  addItem(atlas, {
    kind: 'issue',
    title: 'Investigate triangulation hang on degenerate TIN input',
    body: 'A TIN with three collinear points and one duplicate hangs the triangulator. Reproduced on the attached surface.\n\n```text\ntriangulate: 3 collinear points + 1 duplicate\nstate: spinning after 12 s\n```',
    labels: ['performance', 'help wanted'].map((n) => atlas.labels.find((l) => l.name === n)),
    milestone: 2,
    created_at: at(-7),
    updated_at: at(-4)
  });

  addItem(atlas, {
    kind: 'issue',
    title: 'Ship a short video walkthrough in the README',
    body: 'A 20-second clip of importing points and exporting a DXF would help new surveyors.\n\nDraft clip:\n\n[walkthrough.webm](/assets/walkthrough.webm)',
    labels: [atlas.labels.find((l) => l.name === 'documentation')],
    created_at: at(-1),
    updated_at: at(-1)
  });

  addItem(atlas, {
    kind: 'issue',
    title: 'Remove the legacy Windows 7 code path',
    body: 'Windows 7 is out of support for the field laptops. The legacy path adds two code paths to the installer.',
    labels: [atlas.labels.find((l) => l.name === 'refactor')],
    state: 'closed',
    state_reason: 'completed',
    closed_at: at(-18),
    created_at: at(-25),
    updated_at: at(-18)
  });

  addItem(atlas, {
    kind: 'issue',
    title: 'Unit selector shows "metres" twice',
    body: 'Same as #5 in the previous spike. Closing as a duplicate.',
    labels: [atlas.labels.find((l) => l.name === 'duplicate')],
    state: 'closed',
    state_reason: 'not_planned',
    closed_at: at(-6),
    created_at: at(-8),
    updated_at: at(-6)
  });

  // -- Atlas CAD: pull requests ------------------------------------------------------------------------

  const diffPatch = [
    '@@ -12,7 +12,11 @@ export function renderDiff(file: PullFile) {',
    '   const lines = file.patch.split("\\n");',
    '-  return lines.map(renderLine);',
    '+  const hunks = splitHunks(lines);',
    '+  return hunks.map((hunk) => renderHunk(hunk, { split: state.split }));',
    '+}',
    '+',
    '+function renderHunk(hunk: Hunk, options: HunkOptions) {',
    '+  return hunk.lines.map((line) => renderLine(line, options));',
    ' }'
  ].join('\n');

  addItem(atlas, {
    kind: 'pull',
    title: 'Render PR diffs and existing inline review threads',
    body: 'Adds the unified diff, file navigation, and existing inline threads to the PR details view.\n\n## Checklist\n\n- [x] Unified diff renders\n- [x] Existing threads show on the right line\n- [x] Outdated threads are marked\n- [ ] Split view (follow-up)',
    labels: [atlas.labels.find((l) => l.name === 'enhancement')],
    head: {
      ref: 'feature/dxf-blocks',
      sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      repo: `${LOGIN}/atlas-cad`
    },
    base: { ref: 'main' },
    state: 'closed',
    merged_at: at(-11),
    closed_at: at(-11),
    merge_commit_sha: '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432',
    mergeable: null,
    mergeable_state: 'unknown',
    created_at: at(-16),
    updated_at: at(-11),
    files: [
      {
        filename: 'src/renderer/src/issues/PullDiff.tsx',
        status: 'modified',
        additions: 84,
        deletions: 12,
        patch: diffPatch
      },
      {
        filename: 'src/renderer/src/issues/pull-diff.ts',
        status: 'added',
        additions: 42,
        deletions: 0,
        patch: '@@ -0,0 +1,3 @@\n+export function splitHunks(lines: string[]) {\n+  return [];\n+}'
      },
      {
        filename: 'docs/diff-view.md',
        status: 'renamed',
        previous_filename: 'docs/diff.md',
        additions: 3,
        deletions: 1,
        patch: '@@ -1,2 +1,4 @@\n-Diff view\n+Diff view (unified and split)\n+\n+See the PR details panel.'
      },
      {
        filename: 'assets/diff-mock.png',
        status: 'added',
        additions: 0,
        deletions: 0,
        patch: null,
        changes: 0
      }
    ],
    checks: [
      { name: 'build (windows-latest)', status: 'completed', conclusion: 'success' },
      { name: 'build (macos-latest)', status: 'completed', conclusion: 'success' },
      { name: 'build (ubuntu-latest)', status: 'completed', conclusion: 'success' }
    ],
    runs: [{ name: 'CI', status: 'completed', conclusion: 'success' }]
  });
  reviewOn('atlas-cad#13', {
    user: 'alex-reviewer',
    state: 'APPROVED',
    body: 'Looks good. Thread anchoring is the right call.',
    days: -12
  });
  thread('atlas-cad#13', {
    path: 'src/renderer/src/issues/PullDiff.tsx',
    line: 18,
    diffHunk: diffPatch,
    resolved: true,
    comments: [
      { user: 'alex-reviewer', body: 'Can this be a constant? It is recomputed on every render.', days: -13 },
      { user: LOGIN, body: 'Moved it to a memo. Resolving.', days: -12 }
    ]
  });
  thread('atlas-cad#13', {
    path: 'src/renderer/src/issues/pull-diff.ts',
    line: 2,
    outdated: true,
    diffHunk: '@@ -0,0 +1,3 @@',
    comments: [
      { user: 'sam-contrib', body: 'Empty hunk list should still return a stable array.', days: -14 }
    ]
  });

  addItem(atlas, {
    kind: 'pull',
    title: 'Fix crash symbolication on Windows',
    body: 'Symbolication used the wrong PDB path on Windows, so every frame came back unresolved.\n\nCloses nothing yet; see #2 for the release step.\n\n## How I tested\n\n- Reproduced with the dump from #2\n- Frames now resolve to function names\n\n![Symbolicated report](/assets/symbolicate-report.png)',
    labels: [
      atlas.labels.find((l) => l.name === 'bug'),
      atlas.labels.find((l) => l.name === 'ready-for-agent')
    ],
    head: {
      ref: 'fix/crash-symbolicate',
      sha: 'c0ffee00aa11bb22cc33dd44ee55ff6677889900',
      repo: `${LOGIN}/atlas-cad`
    },
    base: { ref: 'main' },
    created_at: at(-6),
    updated_at: at(0, 1),
    files: [
      {
        filename: 'src/main/symbolicate.ts',
        status: 'modified',
        additions: 21,
        deletions: 4,
        patch:
          '@@ -40,6 +40,11 @@ export function resolvePdb(dump: Dump) {\n-  return join(dump.dir, "symbols.pdb");\n+  const candidates = [dump.pdbPath, join(dump.dir, "symbols.pdb")];\n+  return candidates.find((p) => p && existsSync(p)) ?? null;\n }'
      },
      {
        filename: 'test/symbolicate.test.ts',
        status: 'modified',
        additions: 9,
        deletions: 0,
        patch:
          '@@ -1,3 +1,12 @@\n+it("finds the PDB next to the dump", () => {\n+  expect(resolvePdb(sample)).not.toBeNull();\n+});'
      }
    ],
    checks: [
      { name: 'build (windows-latest)', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'success' },
      { name: 'smoke test', status: 'in_progress', conclusion: null }
    ],
    runs: [{ name: 'CI', status: 'in_progress', conclusion: null }],
    review_requested: ['alex-reviewer']
  });
  reviewOn('atlas-cad#14', {
    user: 'alex-reviewer',
    state: 'APPROVED',
    body: 'Works on my dump. Ship it once smoke finishes.',
    days: -1,
    hours: 3
  });
  thread('atlas-cad#14', {
    path: 'src/main/symbolicate.ts',
    line: 43,
    comments: [
      {
        user: 'alex-reviewer',
        body: 'Should `existsSync` be async? It runs on the main thread.',
        days: -1,
        hours: 2
      }
    ]
  });

  addItem(atlas, {
    kind: 'pull',
    title: 'DXF block definitions writer (draft)',
    body: 'Writes BLOCKS and INSERT entities. Still missing the attribute definitions.\n\n- [x] BLOCKS section\n- [ ] ATTDEF entities\n- [ ] Round-trip test against AutoCAD 2026',
    labels: [atlas.labels.find((l) => l.name === 'enhancement')],
    head: {
      ref: 'feature/dxf-blocks',
      sha: 'deadbeefcafe0000111122223333444455556666',
      repo: `${LOGIN}/atlas-cad`
    },
    base: { ref: 'main' },
    draft: true,
    created_at: at(-3),
    updated_at: at(-1, 5),
    checks: [
      { name: 'build (windows-latest)', status: 'completed', conclusion: 'failure' },
      { name: 'unit tests', status: 'completed', conclusion: 'failure' }
    ],
    runs: [{ name: 'CI', status: 'completed', conclusion: 'failure' }],
    files: [
      {
        filename: 'src/io/dxf/blocks.ts',
        status: 'added',
        additions: 118,
        deletions: 0,
        patch:
          '@@ -0,0 +1,4 @@\n+export function writeBlocks(model: Model) {\n+  return model.blocks.map(writeBlock).join("");\n+}'
      }
    ]
  });
  reviewOn('atlas-cad#15', {
    user: 'alex-reviewer',
    state: 'CHANGES_REQUESTED',
    body: 'Please split the BLOCKS writer from INSERT handling before this leaves draft.',
    days: -2
  });
  comment('atlas-cad#15', LOGIN, 'Splitting now. Thanks for the pointer.', -1, 6);

  addItem(atlas, {
    kind: 'pull',
    title: 'Architecture overview for the main process',
    body: 'Adds the main-process overview and sequence notes. Conflicts with the diagrams in #1; rebase pending.',
    labels: [atlas.labels.find((l) => l.name === 'documentation')],
    head: {
      ref: 'docs/architecture',
      sha: '0123456789abcdef0123456789abcdef01234567',
      repo: `${LOGIN}/atlas-cad`
    },
    base: { ref: 'main' },
    created_at: at(-4),
    updated_at: at(-2),
    mergeable: false,
    mergeable_state: 'dirty',
    checks: [
      { name: 'lint', status: 'completed', conclusion: 'failure' },
      { name: 'build (windows-latest)', status: 'completed', conclusion: 'success' }
    ],
    runs: [{ name: 'CI', status: 'completed', conclusion: 'failure' }],
    files: [
      {
        filename: 'docs/architecture.md',
        status: 'modified',
        additions: 46,
        deletions: 9,
        patch:
          '@@ -1,4 +1,8 @@\n # Architecture\n+\n+Main owns credentials and GitHub access.\n+The renderer keeps displayed data in memory.'
      }
    ]
  });

  addItem(atlas, {
    kind: 'pull',
    title: 'Experiment: remove the unused importer',
    body: 'Trying out removing the old importer. Closed because the importer is still used by the trial crews.',
    labels: [atlas.labels.find((l) => l.name === 'refactor')],
    head: {
      ref: 'feature/clipboard-paste',
      sha: '7777777777777777777777777777777777777777',
      repo: `${LOGIN}/atlas-cad`
    },
    base: { ref: 'main' },
    state: 'closed',
    closed_at: at(-5),
    created_at: at(-9),
    updated_at: at(-5),
    files: [
      {
        filename: 'src/io/legacy.ts',
        status: 'removed',
        additions: 0,
        deletions: 212,
        patch: '@@ -1,3 +0,0 @@\n-export function importLegacy() {\n-  return [];\n-}'
      }
    ]
  });

  addItem(atlas, {
    kind: 'pull',
    user: 'sam-contrib',
    title: 'Inbox keyboard navigation (draft)',
    body: 'First pass at the Inbox arrow-key handling from #6. Focus ring still needs design sign-off.',
    labels: [atlas.labels.find((l) => l.name === 'accessibility')],
    head: {
      ref: 'feature/inbox-keys',
      sha: '5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a',
      repo: `${LOGIN}/atlas-cad`
    },
    base: { ref: 'main' },
    created_at: at(-2),
    updated_at: at(-1, 8),
    review_requested: [LOGIN],
    checks: [{ name: 'build (windows-latest)', status: 'completed', conclusion: 'success' }],
    runs: [{ name: 'CI', status: 'completed', conclusion: 'success' }],
    files: [
      {
        filename: 'src/renderer/src/inbox/Inbox.tsx',
        status: 'modified',
        additions: 17,
        deletions: 3,
        patch:
          '@@ -40,6 +40,20 @@ export function Inbox() {\n+  useEffect(() => {\n+    function onKey(event: KeyboardEvent) {\n+      if (event.key === "ArrowDown") focusNext();\n+    }\n+  }, []);'
      }
    ]
  });

  // -- Field notes (private) ---------------------------------------------------------------------------

  addItem(notes, {
    kind: 'issue',
    title: 'Export progress: show percentage for large sessions',
    body: 'Long exports show a spinner only. A percentage and an ETA would help crews plan the day.\n\n- [ ] Percent in the status line\n- [ ] ETA after 10 seconds',
    labels: [notes.labels.find((l) => l.name === 'enhancement')],
    milestone: 1,
    created_at: at(-4),
    updated_at: at(-1)
  });
  comment(
    'field-notes#1',
    'jordan-design',
    'Mockup attached in the board. The ETA should hide under 5 seconds.',
    -1,
    2
  );
  addItem(notes, {
    kind: 'issue',
    title: 'Sync failed on hotel Wi-Fi',
    body: 'Sync stopped at 60%, with `ECONNRESET` in the log. Retry worked the next morning.',
    labels: [notes.labels.find((l) => l.name === 'bug')],
    assignees: [LOGIN],
    created_at: at(-2),
    updated_at: at(-2)
  });
  addItem(notes, {
    kind: 'pull',
    title: 'Export progress indicator',
    body: 'Adds the progress indicator behind the export button.',
    labels: [notes.labels.find((l) => l.name === 'design')],
    head: {
      ref: 'feature/export-progress',
      sha: 'abababababababababababababababababababab',
      repo: `${LOGIN}/field-notes`
    },
    base: { ref: 'main' },
    created_at: at(-1),
    updated_at: at(-1),
    checks: [{ name: 'build', status: 'queued', conclusion: null }],
    runs: [{ name: 'CI', status: 'queued', conclusion: null }],
    files: [
      {
        filename: 'src/export/progress.ts',
        status: 'added',
        additions: 33,
        deletions: 0,
        patch:
          '@@ -0,0 +1,3 @@\n+export function progressLabel(done: number, total: number) {\n+  return `${Math.round((done / total) * 100)}%`;\n+}'
      }
    ]
  });

  // -- Pdal fork and archived docs ---------------------------------------------------------------------

  addItem(fork, {
    kind: 'issue',
    title: 'Try the ASPRS classification mapping',
    body: 'Experiment only. Not for the field build.',
    created_at: at(-12),
    updated_at: at(-12)
  });
  addItem(archived, {
    kind: 'issue',
    title: 'Broken link in the install guide',
    body: 'The guide points at the old installer. Archived, so nothing will change here.',
    created_at: at(-40),
    updated_at: at(-40)
  });
  addItem(archived, {
    kind: 'issue',
    title: 'Add a table of contents',
    body: 'Would help on long pages. Not planned for the archive.',
    created_at: at(-45),
    updated_at: at(-45)
  });

  // -- Projects v2 -------------------------------------------------------------------------------------

  const statusOptions = [
    { id: 'opt_backlog', name: 'Backlog', color: 'GRAY' },
    { id: 'opt_progress', name: 'In progress', color: 'YELLOW' },
    { id: 'opt_review', name: 'Requesting review', color: 'PURPLE' },
    { id: 'opt_done', name: 'Done', color: 'GREEN' }
  ];
  const priorityOptions = [
    { id: 'opt_p0', name: 'P0', color: 'RED' },
    { id: 'opt_p1', name: 'P1', color: 'ORANGE' },
    { id: 'opt_p2', name: 'P2', color: 'BLUE' }
  ];
  const sizeOptions = [
    { id: 'opt_s', name: 'S', color: 'GREEN' },
    { id: 'opt_m', name: 'M', color: 'YELLOW' },
    { id: 'opt_l', name: 'L', color: 'ORANGE' },
    { id: 'opt_xl', name: 'XL', color: 'RED' }
  ];
  const fields = [
    { id: 'PVTSSF_status', name: 'Status', dataType: 'SINGLE_SELECT', options: statusOptions },
    { id: 'PVTSSF_priority', name: 'Priority', dataType: 'SINGLE_SELECT', options: priorityOptions },
    { id: 'PVTSSF_size', name: 'Size', dataType: 'SINGLE_SELECT', options: sizeOptions },
    { id: 'PVTF_estimate', name: 'Estimate', dataType: 'NUMBER' },
    { id: 'PVTF_start', name: 'Start date', dataType: 'DATE' },
    { id: 'PVTF_target', name: 'Target date', dataType: 'DATE' },
    {
      id: 'PVTIF_sprint',
      name: 'Sprint',
      dataType: 'ITERATION',
      configuration: {
        iterations: [
          { id: 'it_1', title: 'Sprint 1', startDate: at(-7).slice(0, 10), duration: 14 },
          { id: 'it_2', title: 'Sprint 2', startDate: at(7).slice(0, 10), duration: 14 }
        ]
      }
    },
    { id: 'PVTF_notes', name: 'Notes', dataType: 'TEXT' }
  ];
  const project = (number, title, closed, extra) => ({
    id: `PVT_${number}`,
    number,
    title,
    url: `https://github.com/users/${LOGIN}/projects/${number}`,
    closed,
    fields: structuredClone(fields),
    views: [],
    items: [],
    ...extra
  });
  const roadmap = project(1, 'Atlas roadmap', false, {
    views: [
      {
        id: 'PVTV_board',
        number: 1,
        name: 'Backlog board',
        layout: 'BOARD_LAYOUT',
        filter: '',
        groupBy: 'PVTSSF_status'
      },
      {
        id: 'PVTV_priority',
        number: 2,
        name: 'Priority table',
        layout: 'TABLE_LAYOUT',
        filter: 'priority:P0,P1',
        groupBy: null
      },
      { id: 'PVTV_all', number: 3, name: 'All items', layout: 'TABLE_LAYOUT', filter: '', groupBy: null }
    ]
  });
  const notesPlan = project(2, 'Field notes plan', true, {
    views: [
      {
        id: 'PVTV_notes_board',
        number: 1,
        name: 'Board',
        layout: 'BOARD_LAYOUT',
        filter: '',
        groupBy: 'PVTSSF_status'
      }
    ]
  });
  store.projects.push(roadmap, notesPlan);

  /** Adds a project item for an item key, or a draft issue when `key` is null. */
  function projectItem(p, key, values, draftTitle) {
    const id = `PVTI_${uid()}`;
    p.items.push({ id, key, draftTitle: draftTitle ?? null, values });
    return id;
  }
  const SS = (fieldId, optionId) => ({ kind: 'single-select', fieldId, optionId });

  projectItem(roadmap, 'atlas-cad#2', {
    PVTSSF_status: SS('PVTSSF_status', 'opt_progress'),
    PVTSSF_priority: SS('PVTSSF_priority', 'opt_p0'),
    PVTSSF_size: SS('PVTSSF_size', 'opt_m'),
    PVTF_estimate: { kind: 'number', fieldId: 'PVTF_estimate', number: 5 }
  });
  projectItem(roadmap, 'atlas-cad#1', {
    PVTSSF_status: SS('PVTSSF_status', 'opt_backlog'),
    PVTSSF_priority: SS('PVTSSF_priority', 'opt_p2'),
    PVTSSF_size: SS('PVTSSF_size', 'opt_s')
  });
  projectItem(roadmap, 'atlas-cad#3', {
    PVTSSF_status: SS('PVTSSF_status', 'opt_backlog'),
    PVTSSF_priority: SS('PVTSSF_priority', 'opt_p1'),
    PVTSSF_size: SS('PVTSSF_size', 'opt_l'),
    PVTF_estimate: { kind: 'number', fieldId: 'PVTF_estimate', number: 8 }
  });
  projectItem(roadmap, 'atlas-cad#14', {
    PVTSSF_status: SS('PVTSSF_status', 'opt_review'),
    PVTSSF_priority: SS('PVTSSF_priority', 'opt_p0'),
    PVTSSF_size: SS('PVTSSF_size', 'opt_s'),
    PVTF_estimate: { kind: 'number', fieldId: 'PVTF_estimate', number: 2 },
    PVTIF_sprint: { kind: 'iteration', fieldId: 'PVTIF_sprint', iterationId: 'it_1' }
  });
  projectItem(roadmap, 'atlas-cad#15', {
    PVTSSF_status: SS('PVTSSF_status', 'opt_progress'),
    PVTSSF_priority: SS('PVTSSF_priority', 'opt_p1'),
    PVTSSF_size: SS('PVTSSF_size', 'opt_l'),
    PVTIF_sprint: { kind: 'iteration', fieldId: 'PVTIF_sprint', iterationId: 'it_1' }
  });
  projectItem(roadmap, 'atlas-cad#7', {
    PVTSSF_status: SS('PVTSSF_status', 'opt_backlog'),
    PVTSSF_priority: SS('PVTSSF_priority', 'opt_p1'),
    PVTSSF_size: SS('PVTSSF_size', 'opt_s'),
    PVTF_target: { kind: 'date', fieldId: 'PVTF_target', date: at(12).slice(0, 10) }
  });
  projectItem(roadmap, 'atlas-cad#13', {
    PVTSSF_status: SS('PVTSSF_status', 'opt_done'),
    PVTSSF_priority: SS('PVTSSF_priority', 'opt_p1'),
    PVTSSF_size: SS('PVTSSF_size', 'opt_m'),
    PVTF_start: { kind: 'date', fieldId: 'PVTF_start', date: at(-16).slice(0, 10) },
    PVTF_target: { kind: 'date', fieldId: 'PVTF_target', date: at(-11).slice(0, 10) }
  });
  projectItem(roadmap, 'atlas-cad#4', {
    PVTSSF_status: SS('PVTSSF_status', 'opt_done'),
    PVTSSF_priority: SS('PVTSSF_priority', 'opt_p2'),
    PVTSSF_size: SS('PVTSSF_size', 'opt_m'),
    PVTF_notes: { kind: 'text', fieldId: 'PVTF_notes', text: 'Verified with the trial crew on Tuesday.' }
  });
  projectItem(roadmap, 'atlas-cad#5', { PVTSSF_status: SS('PVTSSF_status', 'opt_done') });
  projectItem(
    roadmap,
    null,
    { PVTSSF_status: SS('PVTSSF_status', 'opt_backlog'), PVTSSF_priority: SS('PVTSSF_priority', 'opt_p2') },
    'Research: laser scanner export formats'
  );
  projectItem(roadmap, 'field-notes#1', {
    PVTSSF_status: SS('PVTSSF_status', 'opt_progress'),
    PVTSSF_priority: SS('PVTSSF_priority', 'opt_p1'),
    PVTIF_sprint: { kind: 'iteration', fieldId: 'PVTIF_sprint', iterationId: 'it_2' }
  });
  projectItem(roadmap, 'atlas-cad#6', {
    PVTSSF_status: SS('PVTSSF_status', 'opt_backlog'),
    PVTSSF_priority: SS('PVTSSF_priority', 'opt_p2'),
    PVTSSF_size: SS('PVTSSF_size', 'opt_s')
  });
  projectItem(notesPlan, 'field-notes#2', { PVTSSF_status: SS('PVTSSF_status', 'opt_backlog') });
  projectItem(notesPlan, 'field-notes#3', { PVTSSF_status: SS('PVTSSF_status', 'opt_done') });

  // Dates for the Gantt and calendar demos: work that ran in the past, runs now, and is still to come.
  const dated = (p, key, startDay, targetDay) => {
    const item = p.items.find((i) => i.key === key);
    if (!item) throw new Error(`No seeded item ${key} to date`);
    if (startDay !== null)
      item.values.PVTF_start = { kind: 'date', fieldId: 'PVTF_start', date: at(startDay).slice(0, 10) };
    if (targetDay !== null)
      item.values.PVTF_target = { kind: 'date', fieldId: 'PVTF_target', date: at(targetDay).slice(0, 10) };
  };
  dated(roadmap, 'atlas-cad#1', 2, 9);
  dated(roadmap, 'atlas-cad#2', -5, 6);
  dated(roadmap, 'atlas-cad#3', 4, 20);
  dated(roadmap, 'atlas-cad#4', -20, -14);
  dated(roadmap, 'atlas-cad#5', -25, -18);
  dated(roadmap, 'atlas-cad#6', null, 16);
  dated(roadmap, 'atlas-cad#7', 9, 12);
  dated(roadmap, 'atlas-cad#14', -8, -1);
  dated(roadmap, 'atlas-cad#15', -3, 5);
  dated(roadmap, 'field-notes#1', 0, 10);
  dated(notesPlan, 'field-notes#2', 1, 6);
  dated(notesPlan, 'field-notes#3', -12, -4);

  // -- Notifications for the unread list ---------------------------------------------------------------

  store.notifications.push(
    {
      id: '9001',
      reason: 'mention',
      unread: true,
      updated_at: at(0, 2),
      repo: 'atlas-cad',
      subject: {
        title: 'Crash reports are not symbolicatable: ship PDBs and record exception details',
        type: 'Issue',
        key: 'atlas-cad#2'
      }
    },
    {
      id: '9002',
      reason: 'review_requested',
      unread: true,
      updated_at: at(0, 1),
      repo: 'atlas-cad',
      subject: { title: 'Fix crash symbolication on Windows', type: 'PullRequest', key: 'atlas-cad#14' }
    }
  );

  // Sub-issues: Docs (#1) is the parent of three items, so the counts and the links have data to show.
  const atlasRepo = store.repos.find((r) => r.name === 'atlas-cad');
  for (const child of [2, 3, 9]) {
    const item = atlasRepo?.items.find((i) => i.number === child && i.kind === 'issue');
    if (item) item.parent = 1;
  }

  return store;
}
