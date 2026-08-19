import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Procurement from '../Procurement';
import { renderWithProviders } from '../../../test/testUtils';

// Fills the one blank line item row every new PO opens with (description +
// qty), which savePO() has required since the 2026-08-13 blank-record
// validation fix. Returns nothing — just mutates the form via userEvent.
async function fillFirstLineItem(user) {
  const descInput = screen.getByPlaceholderText(/item description/i);
  await user.type(descInput, 'Test line item');
  const row = descInput.closest('tr');
  // Qty is the first number input in the row (Unit Price is the second).
  const qtyInput = within(row).getAllByRole('spinbutton')[0];
  await user.type(qtyInput, '5');
}

describe('Procurement — Add Purchase Order', () => {
  it('creates a Client Purchase Order without crashing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Procurement />);

    // Purchase Orders / Client is the default tab and filter.
    await user.click(screen.getByRole('button', { name: /\+ new client po/i }));
    expect(await screen.findByText(/new client purchase order/i)).toBeInTheDocument();

    // savePO() requires a client name and at least one real line item
    // (description + qty) since 2026-08-13 — fill both before saving.
    const clientInput = screen.getByPlaceholderText(/type a client name, or pick from the list/i);
    await user.type(clientInput, 'Test Client Ltd');
    await fillFirstLineItem(user);

    await user.click(screen.getByRole('button', { name: /save purchase order/i }));
    expect(screen.queryByText(/new client purchase order/i)).not.toBeInTheDocument();
  });

  it('creates a SLOT Purchase Order with manual waybill/invoice reference fields instead of generate buttons', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Procurement />);

    // Switch to the SLOT PO filter, which also switches the New PO button.
    await user.click(screen.getByRole('button', { name: /slot purchase order \(/i }));
    await user.click(screen.getByRole('button', { name: /\+ new slot po/i }));
    expect(await screen.findByText(/new slot purchase order/i)).toBeInTheDocument();

    // SLOT POs should offer manual reference fields, not generate buttons.
    expect(screen.getByPlaceholderText(/waybill ref\. no\. for record/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/invoice ref\. no\. for record/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ waybill$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ invoice$/i })).not.toBeInTheDocument();

    // Same blank-record validation applies to SLOT POs — fill supplier name
    // and a line item before saving.
    const supplierInput = screen.getByPlaceholderText(/type a supplier name, or pick from the list/i);
    await user.type(supplierInput, 'Test Supplier Ltd');
    await fillFirstLineItem(user);

    await user.click(screen.getByRole('button', { name: /save purchase order/i }));
    expect(screen.queryByText(/new slot purchase order/i)).not.toBeInTheDocument();
  });
});
