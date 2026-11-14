# Orbit layout prototype — throwaway

Question: which navigation and information hierarchy should Orbit use?

Three structurally different React + Tailwind + daisyUI variants share sample data:

- `?variant=A`: persistent sidebar, compact list, detail pane.
- `?variant=B`: top navigation, broad list, reading pane.
- `?variant=C`: compact navigation rail, workspace cards, detail pane.

C is the user's selected direction and now opens by default. It uses a shared
right-hand detail panel for Inbox, repo lists, and every Project view. Drag the
divider (or focus it and use arrow keys) to resize. Expand fills the workspace;
Collapse restores its previous width. Closing restores the full workspace.
Project navigation initially leaves the panel closed; selecting an item opens it.
The workspace stays mounted while expanded, retaining its scroll and view state.

Build from this directory with `npm ci` followed by `npm run build`. Double-click
`generated/orbit-layout-prototype.html`, or present its contents using T3's
`html_preview` and `html_render`. No server or GitHub credentials are required.

Use the floating switcher or left/right arrows to change variants. Try Inbox tabs,
the repo selector, Issues, Pull requests, Projects, all five Project view tabs,
item selection, PR files/checks, comments, sample creation, status changes, card
dragging between Project columns, and the light/dark toggle. GitHub saved and
Orbit custom views are shown separately, with sample layouts only. This prototype
does not decide filtering, date-field mapping, inline review UX, or merge policy.

State lives in memory; only the variant search parameter changes the URL. Sample
mutations never call GitHub. The state strip exposes the current context.
On narrow displays the desktop shell scrolls horizontally. Local navigation
restores the selected item and filters; scroll restoration is an approved product
requirement rather than a completed implementation in this throwaway prototype.

The prototype switcher is gated by the prototype build flag (set
`ORBIT_PROTOTYPE=0` when building to remove it). The bundled React runtime uses
production mode to keep the self-contained visualizer artifact small.
Do not promote this code into the
product. Capture the full prototype on a throwaway branch after feedback, and link
it from the layout decision ticket before closing that ticket.
