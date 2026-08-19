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

    // Employee ID is required since the 2026-08-14 blank-record validation
    // fix (same as ContractStaff) — a save with only the name filled in is
    // rejected with a toast and the modal stays open. Fill it in here too,
    // matching ContractStaff.test.jsx's pattern.
    const refIdInput = screen.getByPlaceholderText(/e\.g\. slot-001/i);
    await user.type(refIdInput, 'SLOT-TEST-001');

    await user.click(screen.getByRole('button', { name: /save staff member/i }));

    expect(screen.queryByText(/add new staff member/i)).not.toBeInTheDocument();
    expect(await screen.findByText('Test Staffer Adeyemi')).toBeInTheDocument();
  });
});
