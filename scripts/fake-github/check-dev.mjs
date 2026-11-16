// Drives a running `npm run fake-dev -- --cdp 9222` session through the sign-in and notification flow, and reports
// each step. Exits 0 when every step passes.
//
//   node scripts/fake-github/check-dev.mjs [--cdp 9222] [--fake http://127.0.0.1:4010]
//
// The fake approves the device code on the first poll, so sign-in completes without any input. The notification
// check pushes a review request through the fake, then waits for Orbit's next poll to show it as a toast.
const argValue = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const cdp = `http://127.0.0.1:${argValue('--cdp', '9222')}`;
const fakeOrigin = argValue('--fake', 'http://127.0.0.1:4010');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageSocket() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`${cdp}/json`)).json();
      const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch {
      // DevTools is not up yet; the app is still starting.
    }
    await sleep(2000);
  }
  throw new Error(
    `No Orbit page on ${cdp}. Start the app with: npm run fake-dev -- --cdp ${cdp.split(':').pop()}`
  );
}

const socket = await pageSocket();
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let nextId = 1;
const pending = new Map();
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  const done = pending.get(message.id);
  if (done) {
    pending.delete(message.id);
    done(message);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return reply.result?.result?.value;
};
const bodyText = () => evaluate('document.body ? document.body.innerText : ""');

async function waitFor(label, check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(1000);
  }
  console.log(`FAIL ${label} (waited ${Math.round(timeoutMs / 1000)}s)`);
  return false;
}

let failures = 0;
const step = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

// A profile that is already signed in skips the sign-in screen.
const alreadySignedIn = (await bodyText()).includes('demo-dev');
if (!alreadySignedIn) {
  step(
    'app shows the sign-in screen',
    await waitFor('sign-in screen', async () => (await bodyText()).includes('Sign in with GitHub'), 90_000)
  );
  await evaluate(
    "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Sign in with GitHub'))?.click()"
  );
}
step(
  alreadySignedIn ? 'profile is signed in as demo-dev' : 'signed in as demo-dev through the device flow',
  await waitFor('signed-in account', async () => (await bodyText()).includes('demo-dev'), 60_000)
);

// A focused window gets in-app toasts; an unfocused one gets desktop notifications instead. Bring the page forward so
// this run checks the toast path.
await send('Page.bringToFront');
await evaluate('window.focus()');
// The first poll after sign-in is a quiet baseline, so the review request is new only once it arrives.
const notice = await fetch(`${fakeOrigin}/__fake/notify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    key: 'atlas-cad#14',
    reason: 'review_requested',
    title: 'Fix crash symbolication on Windows'
  })
});
step('fake pushed a review request for atlas-cad#14', notice.status === 201);
step(
  'Orbit shows the new notification as a toast',
  await waitFor('notification toast', async () => (await bodyText()).includes('Review requested'), 150_000)
);

// Orbit records which route each delivery took: in-app (focused window) or desktop (unfocused window).
const route = await evaluate(
  `window.__TAURI_INTERNALS__.invoke('diagnostics_get_report').then((r) => r.split(String.fromCharCode(10)).filter((line) => line.includes('notify ')).slice(-1)[0] ?? '')`
);
step(
  `notification took the in-app route (diagnostics: ${route || 'none'})`,
  String(route).includes('notify in-app')
);

socket.close();
console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
