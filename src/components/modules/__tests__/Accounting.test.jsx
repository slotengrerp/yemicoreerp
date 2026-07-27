// Regression test for the opening-balance bug found during the accounting
// review: the demo Chart of Accounts' opening balances didn't net to zero
// (₦127,750,000 Dr vs ₦5,780,000 Cr), so the Trial Balance could never
// balance regardless of correct journal posting. Retained Earnings now
// carries the ₦121,970,000 credit needed to close that gap. This test fails
// if that ever regresses.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Accounting from '../Accounting';
import { renderWithProviders } from '../../../test/testUtils';

describe('Accounting — Trial Balance', () => {
  it('renders without crashing and the Trial Balance is balanced on the default Chart of Accounts', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Accounting />);

    await user.click(screen.getByRole('button', { name: /trial balance/i }));

    expect(await screen.findByText(/✓ BALANCED/i)).toBeInTheDocument();
    expect(screen.queryByText(/OUT OF BALANCE/i)).not.toBeInTheDocument();
  });

  it('renders the Balance Sheet without crashing and it balances', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Accounting />);

    await user.click(screen.getByRole('button', { name: /balance sheet/i }));

    // The Balance Sheet tab shows a danger alert specifically when assets
    // don't equal liabilities + equity — absence of that alert is the signal.
    expect(screen.queryByText(/does not balance/i)).not.toBeInTheDocument();
  });
});
