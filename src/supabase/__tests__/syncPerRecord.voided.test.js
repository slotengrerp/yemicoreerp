import { describe, it, expect, beforeEach, vi } from 'vitest';

// ══════════════════════════════════════════════════════════════════════════
// Regression test for the 2026-07-24 backfill failure:
//   "Could not find the 'voided' column of 'vendors' in the schema cache"
// (same error for clients, projects). Root cause: saveRecord(),
// backfillFromBlob(), and loadAll() all sent/selected a `voided` field
// unconditionally for every RECORD_TABLES entry, but vendors/clients/
// projects were deliberately created without that column (master data,
// not transactions). Fix gates on a NO_VOID_TABLES set instead of assuming.
//
// Confirmed this test actually catches the bug: temporarily reverted the
// fix and re-ran it — all 3 cases failed with the exact mismatch the fix
// closes. Restored the fix and confirmed all 3 pass again before committing.
// ══════════════════════════════════════════════════════════════════════════

let upsertCalls = [];
let selectCalls = [];

vi.mock('../client', () => ({
  supabase: {
    from: (table) => ({
      upsert: (rows, opts) => {
        upsertCalls.push({ table, rows: Array.isArray(rows) ? rows : [rows], opts });
        return Promise.resolve({ error: null });
      },
      select: (cols) => {
        selectCalls.push({ table, cols });
        return {
          eq: () => Promise.resolve({ data: [], error: null }),
        };
      },
    }),
  },
}));

import { saveRecord, backfillFromBlob, loadAll } from '../syncPerRecord';

describe('syncPerRecord — voided column gating for master-data tables', () => {
  beforeEach(() => {
    upsertCalls = [];
    selectCalls = [];
  });

  it('saveRecord: omits `voided` for vendors/clients/projects, includes it for a transactional table', async () => {
    await saveRecord('vendors', { id: 'v1', name: 'Acme Ltd' });
    await saveRecord('invoices', { id: 'i1', amount: 500 });

    const vendorRow = upsertCalls.find(c => c.table === 'vendors').rows[0];
    expect(vendorRow).not.toHaveProperty('voided');

    const invoiceRow = upsertCalls.find(c => c.table === 'invoices').rows[0];
    expect(invoiceRow).toHaveProperty('voided', false);
  });

  it('backfillFromBlob: omits `voided` for clients/projects, includes it for a transactional table', async () => {
    await backfillFromBlob({
      clients:  [{ id: 'c1', name: 'Client A' }],
      projects: [{ id: 'p1', name: 'Project A' }],
      pettycash:[{ id: 'pc1', amount: 100 }],
    });

    const clientRow  = upsertCalls.find(c => c.table === 'clients').rows[0];
    const projectRow = upsertCalls.find(c => c.table === 'projects').rows[0];
    const cashRow     = upsertCalls.find(c => c.table === 'pettycash').rows[0];

    expect(clientRow).not.toHaveProperty('voided');
    expect(projectRow).not.toHaveProperty('voided');
    expect(cashRow).toHaveProperty('voided', false);
  });

  it('loadAll: does not select `voided` for vendors/clients/projects, does select it for a transactional table', async () => {
    await loadAll();

    const vendorSelect = selectCalls.find(c => c.table === 'vendors');
    const invoiceSelect = selectCalls.find(c => c.table === 'invoices');

    expect(vendorSelect.cols).not.toMatch(/voided/);
    expect(invoiceSelect.cols).toMatch(/voided/);
  });
});
