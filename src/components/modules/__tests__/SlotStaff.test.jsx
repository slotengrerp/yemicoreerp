// Same regression class as ContractStaff.test.jsx — SlotStaff's StaffModal
// had the identical `projects` scoping bug and crashed the same way.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SlotStaff from '../SlotStaff';
import { renderWithProviders } from '../../../test/testUtils';

describe('SlotStaff — Add Staff', () => {
  it('opens the Add Staff form without crashing, and saves a new staff member', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SlotStaff />);

    await user.click(screen.getByRole('button', { name: /\+ add staff/i }));

    const heading = await screen.findByText(/add new staff member/i);
    expect(heading).toBeInTheDocument();

    const fullNameInput = screen.getByPlaceholderText(/full legal name/i);
    await user.type(fullNameInput, 'Test Staffer Adeyemi');

    await user.click(screen.getByRole('button', { name: /save staff member/i }));

    expect(screen.queryByText(/add new staff member/i)).not.toBeInTheDocument();
    expect(await screen.findByText('Test Staffer Adeyemi')).toBeInTheDocument();
  });
});
