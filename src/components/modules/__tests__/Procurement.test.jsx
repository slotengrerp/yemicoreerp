import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Procurement from '../Procurement';
import { renderWithProviders } from '../../../test/testUtils';

describe('Procurement — Add Purchase Order', () => {
  it('creates a Client Purchase Order without crashing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Procurement />);

    // Purchase Orders / Client is the default tab and filter.
    await user.click(screen.getByRole('button', { name: /\+ new client po/i }));
    expect(await screen.findByText(/new client purchase order/i)).toBeInTheDocument();

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

    await user.click(screen.getByRole('button', { name: /save purchase order/i }));
    expect(screen.queryByText(/new slot purchase order/i)).not.toBeInTheDocument();
  });
});
