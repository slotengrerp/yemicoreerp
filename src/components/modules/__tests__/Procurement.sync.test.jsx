// This test exists specifically to verify the sync fix: that creating a
// Purchase Order actually reaches the central store (db.procurement), which
// is the object App.jsx pushes to Supabase. The pre-fix code saved only to
// a private localStorage key (slot_proc) that never dispatched anything —
// a form-closes-without-crashing test alone would not have caught that bug,
// since the UI worked fine either way. This asserts on the actual data path.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from '../../../context/AppContext';
import Procurement from '../Procurement';
import { renderWithProviders } from '../../../test/testUtils';

// Tiny spy that surfaces central state into the DOM so the test can read it —
// standard way to assert on context state without reaching into internals.
function ProcurementStateSpy() {
  const { state } = useApp();
  return <div data-testid="proc-state">{JSON.stringify(state.db.procurement)}</div>;
}

describe('Procurement — saves reach the central (Supabase-synced) store', () => {
  it('adds the new PO to state.db.procurement.pos, not just a local-only key', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Procurement />
        <ProcurementStateSpy />
      </>
    );

    const before = JSON.parse(screen.getByTestId('proc-state').textContent);
    // Central store has nothing synced yet before the first save in this
    // test session — that's expected (no eager sync on mount). What matters
    // is that after a save, the central store actually has PO data in it —
    // pre-fix, this stayed empty forever because nothing ever dispatched to it.
    const posBefore = before.pos?.length || 0;

    await user.click(screen.getByRole('button', { name: /\+ new client po/i }));
    await screen.findByText(/new client purchase order/i);
    await user.click(screen.getByRole('button', { name: /save purchase order/i }));

    const after = JSON.parse(screen.getByTestId('proc-state').textContent);
    expect(after.pos?.length).toBeGreaterThan(posBefore);
    expect(after.pos?.length).toBeGreaterThan(0);
  });
});
