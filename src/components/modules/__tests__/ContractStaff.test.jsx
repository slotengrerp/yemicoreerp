// Regression test for the production incident where opening "Add Staff" in
// ContractStaff crashed the whole screen: StaffModal referenced `projects`
// without it being passed in as a prop. This test renders the real modal and
// walks through the real save flow, so a repeat of that exact mistake (or
// anything else that breaks this screen) fails here before it reaches SLOT.
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractStaff from '../ContractStaff';
import { renderWithProviders } from '../../../test/testUtils';

describe('ContractStaff — Add Staff', () => {
  it('opens the Add Staff form without crashing, and saves a new staff member', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContractStaff />);

    // Opening the form is the exact step that crashed the whole screen in
    // production — if this throws, the test fails here instead of in SLOT's
    // browser.
    await user.click(screen.getByRole('button', { name: /\+ add staff/i }));

    const heading = await screen.findByText(/add new contract staff/i);
    expect(heading).toBeInTheDocument();

    const fullNameInput = screen.getByPlaceholderText(/full legal name/i);
    await user.type(fullNameInput, 'Test Engineer Okoro');

    const refIdInput = screen.getByPlaceholderText(/NLNG-ENG-005/i);
    await user.type(refIdInput, 'NLNG-TEST-001');

    await user.click(screen.getByRole('button', { name: /save staff member/i }));

    // Modal should close and the new staff member should now appear in the list.
    expect(screen.queryByText(/add new contract staff/i)).not.toBeInTheDocument();
    expect(await screen.findByText('Test Engineer Okoro')).toBeInTheDocument();
  });

  it('renders the Project / Cost Centre dropdown in the Add Staff form without crashing', async () => {
    // Specifically targets the bug class: the dropdown maps over `projects`,
    // which must actually be in scope inside the modal component.
    const user = userEvent.setup();
    renderWithProviders(<ContractStaff />);
    await user.click(screen.getByRole('button', { name: /\+ add staff/i }));
    await screen.findByText(/add new contract staff/i);

    const projectSelect = screen.getByText(/— unallocated —/i);
    expect(projectSelect).toBeInTheDocument();
  });
});
