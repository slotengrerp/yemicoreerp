import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountsReceivable from '../AccountsReceivable';
import { renderWithProviders } from '../../../test/testUtils';

describe('AccountsReceivable — Create Invoice', () => {
  it('opens the New Invoice form without crashing, and saves an invoice against a real customer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountsReceivable />);

    await user.click(screen.getByRole('button', { name: /\+ new invoice/i }));
    expect(await screen.findByText(/^new invoice$/i)).toBeInTheDocument();

    // Client dropdown is the first combobox in the form — pick a real
    // customer from the shared client master (ALPHADEN ENERGY is seeded there).
    const comboboxes = screen.getAllByRole('combobox');
    await user.selectOptions(comboboxes[0], 'ALPHADEN ENERGY');

    // Due Date is required and starts empty.
    const allDateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(allDateInputs[1], '2026-08-15');

    // Line item needs both a description and a unit price to pass validation.
    const descriptionInput = screen.getByPlaceholderText(/item description/i);
    await user.type(descriptionInput, 'Test consulting service');
    const unitPriceInput = screen.getByPlaceholderText('0');
    await user.clear(unitPriceInput);
    await user.type(unitPriceInput, '500000');

    await user.click(screen.getByRole('button', { name: /save invoice/i }));

    // Modal should close and the invoice should now be in the list.
    expect(screen.queryByText(/^new invoice$/i)).not.toBeInTheDocument();
    expect(await screen.findAllByText(/ALPHADEN ENERGY/i)).not.toHaveLength(0);
  });
});
