import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountsPayable from '../AccountsPayable';
import { renderWithProviders } from '../../../test/testUtils';

describe('AccountsPayable — Create Bill and Record Payment', () => {
  it('creates a bill against a real supplier, then records a payment against it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountsPayable />);

    // ── Create the bill ──────────────────────────────────────────────────
    await user.click(screen.getAllByRole('button', { name: /\+ new bill/i })[0]);
    expect(await screen.findByText(/new supplier bill/i)).toBeInTheDocument();

    const supplierSelect = screen.getAllByRole('combobox')[0];
    await user.selectOptions(supplierSelect, 'ACRIFA GLOBAL SERVIC');

    await user.type(screen.getByPlaceholderText(/supplier's invoice reference/i), 'INV-TEST-001');

    const allDateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(allDateInputs[1], '2026-08-15'); // Due Date — Bill Date defaults to today already

    await user.type(screen.getByPlaceholderText('0.00'), '250000');

    await user.click(screen.getByRole('button', { name: /save bill/i }));
    expect(screen.queryByText(/new supplier bill/i)).not.toBeInTheDocument();

    // Saving returns to the Overview tab — switch to Bills to see the list.
    await user.click(screen.getByRole('button', { name: /bills/i }));

    // ── Open the bill and record a payment against it ───────────────────
    const viewButtons = await screen.findAllByRole('button', { name: /^view$/i });
    await user.click(viewButtons[0]);

    await user.click(await screen.findByRole('button', { name: /record payment/i }));
    expect(await screen.findByText(/^record payment$/i)).toBeInTheDocument();

    // Amount and date are pre-filled by openPayModal from the outstanding balance.
    await user.click(screen.getByRole('button', { name: /confirm payment/i }));

    expect(screen.queryByText(/^record payment$/i)).not.toBeInTheDocument();
  });
});
