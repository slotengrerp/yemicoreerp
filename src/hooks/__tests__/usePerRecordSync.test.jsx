import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// ══════════════════════════════════════════════════════════════════════════
// Regression tests for two related 2026-07-24 production incidents, both in
// usePerRecordSync's auth-change reload guard.
//
// BUG 1 — crash-loop. Root cause: the handler reloaded the page on EVERY
// event with no filtering, including the synthetic 'INITIAL' replay that
// authBridge.js's supabaseAuthChange() fires immediately, synchronously, on
// subscribe whenever a Supabase session already exists. Since the session
// survives a reload, that replay fired again on the very next mount —
// infinite same-tab reload loop for anyone already signed in. Fixed by
// filtering to event === 'SIGNED_IN' only.
//
// BUG 2 — "the app refreshes itself" every time a user switched browser
// tabs and back. Root cause: filtering on event name alone wasn't enough —
// supabase-js's own client re-validates the session on every tab-focus
// regain and genuinely fires a real 'SIGNED_IN' event for the SAME
// already-signed-in user (documented supabase-js behavior, see
// supabase/supabase-js#716, #1618, #1708, supabase/supabase#7250). Fixed by
// tracking the last-seen user id and only reloading when it actually
// changes (a real new/different sign-in), not on every SIGNED_IN event.
//
// This test uses the REAL authBridge.js (not mocked) so it exercises the
// actual synthetic-replay mechanism, not just a stand-in. Only the
// underlying supabase/client.js is mocked, standing in for the network.
//
// Confirmed both fixes are actually caught by these tests: temporarily
// reverted each fix in turn and re-ran — every case below that's supposed
// to guard against it failed immediately, exactly matching the reported
// production behavior. Restored both fixes and confirmed all pass again
// before committing.
// ══════════════════════════════════════════════════════════════════════════

const fakeSession = { user: { id: 'user-1' }, access_token: 'fake' };
const otherUserSession = { user: { id: 'user-2' }, access_token: 'fake-2' };
let authStateCb = null;

vi.mock('../../supabase/client', () => ({
  supabaseReady: true,
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: fakeSession } }),
      onAuthStateChange: (cb) => {
        authStateCb = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

// Stub the per-record data layer — this test is only about the reload
// guard, not the load/backfill logic those functions drive.
vi.mock('../../supabase/syncPerRecord', () => ({
  loadAll: vi.fn().mockResolvedValue(null),
  loadAppSettings: vi.fn().mockResolvedValue(null),
  loadJournals: vi.fn().mockResolvedValue([]),
  loadActivity: vi.fn().mockResolvedValue([]),
  backfillFromBlob: vi.fn().mockResolvedValue({ results: [] }),
  backfillAccountingData: vi.fn().mockResolvedValue({ results: {} }),
  saveRecord: vi.fn(),
  saveAppSettings: vi.fn(),
  postJournalEntry: vi.fn(),
  logActivityServer: vi.fn(),
  saveAttachment: vi.fn(),
  subscribePerRecord: vi.fn(() => vi.fn()),
  RECORD_TABLES: {},
}));

describe('usePerRecordSync — auth-change reload guard', () => {
  let reloadSpy;

  beforeEach(async () => {
    // The whole reload guard this file tests only runs when per-record sync
    // is enabled — usePerRecordSync's effect bails out entirely (including
    // the supabaseAuthChange subscription) when USE_PER_RECORD is false.
    // CI runs `npm test` with VITE_USE_PER_RECORD_SYNC=false at the process
    // level (the rest of the suite intentionally exercises the legacy
    // engine, no Supabase needed), which silently skipped this file's
    // subscription and made "DOES reload on a genuine new sign-in" fail
    // every time — there was no listener left to fire. Stub the env var to
    // 'true' for this file specifically so it exercises the real code path
    // regardless of how the outer test command was invoked.
    vi.stubEnv('VITE_USE_PER_RECORD_SYNC', 'true');
    vi.resetModules();
    authStateCb = null;
    reloadSpy = vi.fn();
    delete window.location;
    window.location = { reload: reloadSpy };
  });

  // The test suite runs with a single fork (see vite.config.js), so all test
  // files share one process — an env stub left in place here would otherwise
  // leak into whichever file runs next.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does NOT reload for the initial replay of an already-existing session (the exact bug that caused the production crash-loop)', async () => {
    // Import authBridge FIRST and let its bootstrap() resolve — this
    // mirrors reality: after any reload, the session was already
    // established well before this component's effect subscribes.
    await import('../../supabase/authBridge');
    await new Promise((r) => setTimeout(r, 0));

    const mod = await import('../usePerRecordSync');
    function Host({ state, dispatch }) {
      mod.usePerRecordSync({ state, dispatch });
      return null;
    }
    render(<Host state={{ currentUser: { id: 'user-1' } }} dispatch={() => {}} />);

    // Give the synthetic replay + any microtasks a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('DOES reload on a genuine new/different sign-in, so a fresh login still loads per-record data cleanly', async () => {
    await import('../../supabase/authBridge');
    await new Promise((r) => setTimeout(r, 0));

    const mod = await import('../usePerRecordSync');
    function Host({ state, dispatch }) {
      mod.usePerRecordSync({ state, dispatch });
      return null;
    }
    render(<Host state={{ currentUser: { id: 'user-1' } }} dispatch={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(reloadSpy).not.toHaveBeenCalled();

    await waitFor(() => expect(authStateCb).not.toBeNull());
    // A DIFFERENT user's session — this is what a genuine new sign-in
    // looks like (e.g. someone else logging in on a shared machine after
    // the previous person signed out). Must be a different user.id from
    // the one already loaded, or this doesn't test anything real.
    authStateCb('SIGNED_IN', otherUserSession);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload when supabase-js re-fires SIGNED_IN for the SAME user on browser tab-focus regain (bug: "the app refreshes itself" on every tab switch)', async () => {
    await import('../../supabase/authBridge');
    await new Promise((r) => setTimeout(r, 0));

    const mod = await import('../usePerRecordSync');
    function Host({ state, dispatch }) {
      mod.usePerRecordSync({ state, dispatch });
      return null;
    }
    render(<Host state={{ currentUser: { id: 'user-1' } }} dispatch={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(reloadSpy).not.toHaveBeenCalled();

    await waitFor(() => expect(authStateCb).not.toBeNull());
    // Same session, same user — exactly what supabase-js sends when the
    // tab regains focus, even though nothing about the sign-in changed.
    // Fire it repeatedly (mirrors the reported "10 times in 1 minute").
    authStateCb('SIGNED_IN', fakeSession);
    authStateCb('SIGNED_IN', fakeSession);
    authStateCb('SIGNED_IN', fakeSession);

    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
