# Orbit PR-review prototype — throwaway

Question: how should file navigation, diff reading, and review threads fit inside
Orbit's approved compact rail and expandable detail panel?

Three variants on one prototype page, selected with `?variant=A|B|C`:

- A: changed-file navigator with one selected file.
- B: continuous stack of changed-file diffs.
- C: thread queue with a selected file and inline context.

From this directory, run `npm ci` and `npm run build`, then open
`generated/orbit-review-prototype.html` locally or present its HTML using T3's
`html_preview` and `html_render`. No server or credentials are needed. The build
script and copied color theme derive from the approved layout prototype. This
directory contains everything needed to build the review demo independently.

Use the floating switcher, Unified/Split, Panel/Expand, file filter and selector,
gutter comment buttons, reply/resolve controls, and Finish review. The own-PR
toggle removes approve/request-changes options. Failed-submit simulation keeps
pending comments and summary. Rename, deletion, binary, and oversized-file sample
states are included. The large-file control loads a labeled representative
excerpt rather than pretending to load a full unavailable patch.

All review and thread actions are in-memory simulations. Nothing is sent to
GitHub; refreshing clears the demo.

The approved direction is A. In production, added comments and replies are saved
in a pending GitHub review; unadded buffers stay in memory. Replies default to
joining the review and offer explicit Send now. New commits pause submission
until the diff is refreshed and acknowledged; comments keep original anchors.
The demo simulates remote draft recovery through Simulate restart, while an
actual browser refresh still clears all demo state.

The renderer is `react-diff-view`; syntax tokenization uses refractor 3 with a
Prism override to remove the vulnerable older transitive Prism dependency. This
is the approved renderer direction, demonstrated in the prototype. Production
still requires pinned-dependency checks and scoped CSS integration.
Only the JavaScript grammar is bundled. Reassess worker/tokenization and lazy
loading for real large diffs. This code is reference material, not production.
