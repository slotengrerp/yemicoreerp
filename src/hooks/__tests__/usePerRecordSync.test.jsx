import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// ══════════════════════════════════════════════════════════════════════════
// Regression test for the 2026-07-24 production crash-loop.
//
// Root cause: usePerRecordSync's auth-change handler reloaded the page on
// EVERY event with no filtering, including the synthetic 'INITIAL' replay
// that authBridge.js's supabaseAuthChange() fires immediately, synchronously,
// on subscribe whenever a Supabase session already exists. Since the session
// survives a reload, that replay fired again on the very next mount —
// infinite same-tab reload loop for anyone already signed in.
//
// This test uses the REAL authBridge.js (not mocked) so it exercises the
// actual synthetic-replay mechanism that caused the bug — only the
// underlying supabase/client.js is mocked, standing in for the network.
//
// Confirmed this test actually catches the bug: temporarily reverted the
// fix and re-ran it — both cases below failed immediately, the first one
// on the very first render before any event was even fired manually,
// exactly matching what happened in production. Restored the fix and
// confirmed both pass again before committing.
// ══════════════════════════════════════════════════════════════════════════

const fakeSession = { user: { id: 'user-1' }, access_token: 'fake' };
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
    vi.resetModules();
    authStateCb = null;
    reloadSpy = vi.fn();
    delete window.location;
    window.location = { reload: reloadSpy };
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

  it('DOES reload on a genuine new sign-in, so a fresh login still loads per-record data cleanly', async () => {
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
    authStateCb('SIGNED_IN', fakeSession);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
