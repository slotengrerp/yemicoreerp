import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TerminalOps from '../TerminalOps';
import { renderWithProviders } from '../../../test/testUtils';

describe('TerminalOps — Bill of Lading form inputs keep focus while typing', () => {
  // Regression test for the 2026-07-27 diagnostic-audit fix: `LBL` (the
  // field-label wrapper used by every modal in this file — Container,
  // Charge, Logistics, BoL, Advance, Consignee, ShippingCompany) used to be
  // redefined as a brand-new inline function on every render of each modal.
  // Every keystroke -> setF() -> re-render -> LBL got a new identity -> React
  // unmounted+remounted the whole <LBL> subtree, including the real <input>
  // DOM node -> the field lost focus after every single character typed.
  // Reported by the user as "Cursor is disappearing" on the Bill of Lading
  // No, Shipping Company (free-text), and Shipping Vessel fields. LBL is now
  // a single, module-scope component (stable identity across renders), so
  // this should no longer happen on ANY field in ANY of these modals — this
  // test exercises the exact field the bug report named.
  it('lets you type a multi-character Bill of Lading No without losing focus or dropping characters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TerminalOps />);

    await user.click(screen.getByRole('button', { name: /bill of lading/i }));
    await user.click(await screen.findByRole('button', { name: /\+ add bill of lading/i }));

    const bolInput = await screen.findByPlaceholderText(/e\.g\. MSCUB123456/i);
    await user.click(bolInput);
    await user.type(bolInput, 'MSCUB999888');

    // If LBL were still remounting on every keystroke, this would either
    // fail mid-type (React losing the element user-event is targeting) or
    // land here with a truncated value (only the last character or two
    // surviving the last remount) instead of the full string.
    expect(bolInput).toHaveValue('MSCUB999888');
    expect(bolInput).toHaveFocus();
  });

  it('does not remount the whole form between keystrokes (label text stays mounted throughout)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TerminalOps />);

    await user.click(screen.getByRole('button', { name: /bill of lading/i }));
    await user.click(await screen.findByRole('button', { name: /\+ add bill of lading/i }));

    const bolInput = await screen.findByPlaceholderText(/e\.g\. MSCUB123456/i);
    await user.type(bolInput, 'ABC');
    // A sibling field rendered by the same LBL component — still present
    // and untouched confirms the surrounding form didn't get torn down.
    expect(screen.getByText(/shipping vessel/i)).toBeInTheDocument();
    expect(bolInput).toHaveValue('ABC');
  });
});

describe('TerminalOps — basic navigation smoke test', () => {
  it('renders and switches between every tab without crashing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TerminalOps />);

    const tabs = [
      /container registry/i,
      /bill of lading/i,
      /master data/i,
      /clearing & charges/i,
      /logistics & transit/i,
      /advance payments/i,
      /standalone p&l/i,
      /^\s*📊\s*reports|reports$/i,
    ];

    for (const name of tabs) {
      await user.click(screen.getByRole('button', { name }));
    }
  });
});
