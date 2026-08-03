// ══════════════════════════════════════════════════════════════════════════════
// lazyWithRetry — resilient dynamic imports for code-split modules
// ══════════════════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS (2026-07-30)
//
// Every module in App.jsx is code-split with React.lazy(() => import('...')).
// Vite emits each one as a separate hashed chunk (Accounting-a1b2c3.js). The
// browser only fetches that chunk when the user first opens the module —
// which can be hours after the page was loaded.
//
// Two things then go wrong, and both produced the SAME user-facing symptom:
// the "Something went wrong in the accounting module" error screen, with a
// technical detail like "FG is not defined" (a binding the chunk imports
// from a shared chunk that never finished loading).
//
//   1) STALE CHUNK AFTER A DEPLOY. Firebase Hosting replaces dist/ on every
//      deploy, so the previous build's chunk filenames stop existing. Anyone
//      with the app already open — a tab left open overnight, or a browser
//      holding a cached index.html — is still asking for the OLD filename.
//      That request 404s. On a day with several deploys, every open tab in
//      the office breaks the moment someone clicks into a module they hadn't
//      opened yet. This is the common case and it has nothing to do with the
//      user's connection.
//
//   2) GENUINELY BAD NETWORK. A dropped or timed-out request for the chunk
//      fails the same way.
//
// Plain React.lazy makes both cases permanent: it MEMOISES the rejected
// promise. Once the import fails, every later render replays the same
// rejection — so the error screen's "Try Again" button cannot ever recover,
// which is exactly why staff reported it as constant and unescapable.
//
// WHAT THIS DOES
//
//   • Retries the import a few times with backoff — fixes case 2 (a blip).
//   • If it still fails, treats it as case 1 (we deployed underneath them)
//     and reloads the page ONCE to pick up the new index.html and its new
//     chunk names. A sessionStorage flag makes it strictly once-per-session,
//     so a genuinely missing file can never cause a reload loop.
//   • Never memoises a failure: a fresh import() is issued per attempt.
//
// Do not replace these with bare React.lazy again.
// ══════════════════════════════════════════════════════════════════════════════

import { lazy } from 'react';

const RELOAD_FLAG = 'slot-erp:chunk-reload';

// A failed dynamic import surfaces differently across browsers. Chrome says
// "Failed to fetch dynamically imported module", Firefox "error loading
// dynamically imported module", Safari "Importing a module script failed".
// A chunk that 404s to an SPA rewrite returns index.html with a text/html
// content type, which browsers reject as "Expected a JavaScript module".
// Treat all of these as "the chunk isn't there", not as an app bug.
export function looksLikeChunkLoadFailure(err) {
  const msg = String(err?.message || err || '');
  return /dynamically imported module|Importing a module script failed|Failed to fetch|Loading chunk|module script|MIME type|NetworkError/i.test(msg);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Drop-in replacement for React.lazy.
 *
 * @param {() => Promise<any>} importFn  e.g. () => import('./modules/Accounting')
 * @param {string} label                 module name, for console diagnostics only
 */
// Every module registered through lazyWithRetry, so prefetchAllChunks() below
// can warm exactly the chunks the app actually uses. Deriving the list here
// instead of maintaining a second hand-written copy means a module added to
// App.jsx can never be silently left out of the prefetch.
const registry = [];

export function lazyWithRetry(importFn, label = 'module') {
  registry.push({ label, importFn });
  return lazy(async () => {
    const delays = [0, 400, 1200]; // 3 attempts total

    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt]) await sleep(delays[attempt]);
      try {
        const mod = await importFn();
        // Recovered (or first-try success) — clear the guard so a future
        // deploy in this same session can still trigger its own reload.
        try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* private mode */ }
        return mod;
      } catch (err) {
        const last = attempt === delays.length - 1;
        console.warn(`[SLOT ERP] Chunk load failed for ${label} (attempt ${attempt + 1}/${delays.length}):`, err?.message || err);
        if (!last) continue;

        // Out of retries. If this smells like a missing/!changed chunk, the
        // overwhelmingly likely cause is that a new version was deployed
        // while this tab was open. Reload once to fetch the new manifest.
        // NEVER reload while offline. The reload is only useful when the
        // server has a NEWER build waiting; with no connection there is
        // nothing to fetch, and reloading would replace a working app —
        // the user's data still on screen, queued edits still pending —
        // with a dead browser error page. Offline, we let the error
        // boundary render so the rest of the app stays usable and the
        // user can retry once they have signal.
        const online = (typeof navigator === 'undefined') || navigator.onLine !== false;

        if (looksLikeChunkLoadFailure(err) && online) {
          let alreadyReloaded = false;
          try { alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1'; } catch { /* private mode */ }

          if (!alreadyReloaded) {
            try { sessionStorage.setItem(RELOAD_FLAG, '1'); } catch { /* private mode */ }
            console.warn(`[SLOT ERP] Reloading once to pick up a newer deployment (${label}).`);
            window.location.reload();
            // Park forever so React never renders an error for this render
            // pass — the reload is already in flight.
            return await new Promise(() => {});
          }
        }
        throw err; // genuinely broken — let the error boundary show it
      }
    }
    throw new Error(`Unreachable: ${label}`);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// prefetchAllChunks — download every module's code in the background
// ══════════════════════════════════════════════════════════════════════════════
//
// Code-splitting means a module's JavaScript is only fetched when the user
// first opens it. That is great for first-paint time and terrible on a weak
// connection: a user who has been working happily for an hour clicks
// Accounting, the network is down at that exact second, and the module cannot
// open at all — the code was never on their device.
//
// SLOT staff work on connections that drop. So once the app is up and the
// user is signed in and idle on the dashboard, quietly pull every other
// module's chunk into the browser's HTTP cache. By the time anyone clicks
// into a module, its code is already local and a dead connection no longer
// matters for navigation.
//
// Deliberately gentle: waits for idle, runs two at a time, gives up quietly
// on failure (a failed prefetch costs nothing — the real load will retry),
// and never runs while offline.
let prefetchStarted = false;

export function prefetchAllChunks({ concurrency = 2 } = {}) {
  if (prefetchStarted) return;                                   // once per page load
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  // Respect the user's data preference — never burn a metered/saver connection.
  const conn = typeof navigator !== 'undefined' ? navigator.connection : null;
  if (conn?.saveData) return;

  prefetchStarted = true;

  const start = () => {
    const queue = [...registry];
    let active = 0;

    const pump = () => {
      while (active < concurrency && queue.length) {
        const { label, importFn } = queue.shift();
        active++;
        Promise.resolve()
          .then(importFn)
          .catch(() => { /* prefetch is best-effort; the real load will retry */ })
          .finally(() => { active--; pump(); });
      }
      if (!active && !queue.length) {
        console.info(`[SLOT ERP] Prefetched ${registry.length} module chunks — modules will now open even if the connection drops.`);
      }
    };
    pump();
  };

  // Don't compete with the dashboard's own first render or its data fetches.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 5000 });
  else setTimeout(start, 3000);
}

export default lazyWithRetry;
