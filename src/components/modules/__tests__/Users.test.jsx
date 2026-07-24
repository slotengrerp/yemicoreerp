import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Users from '../Users';
import { renderWithProviders } from '../../../test/testUtils';
import { getUsers } from '../../../utils/auth';

describe('Users — Add User', () => {
  beforeEach(() => localStorage.clear());

  it('opens the Add User form without crashing, saves, and the user appears in the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Users />);

    await user.click(screen.getByRole('button', { name: /\+ add user/i }));
    const heading = await screen.findByText(/\+ add new user/i);
    expect(heading).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/tunde adeyemi/i), 'Chinedu Eze');
    await user.type(screen.getByPlaceholderText(/user@slotengineering\.com/i), 'ceze@slotengineering.com');
    await user.type(screen.getByPlaceholderText(/set a strong password/i), 'TestPass123!');

    await user.click(screen.getByRole('button', { name: /create user/i }));

    // Does the modal close and the user show up in THIS session at all?
    expect(await screen.findByText('Chinedu Eze')).toBeInTheDocument();
  });

  it('persists the new user to localStorage — and does not attempt a cloud login when Supabase isn\'t configured', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Users />);

    await user.click(screen.getByRole('button', { name: /\+ add user/i }));
    await screen.findByText(/\+ add new user/i);
    await user.type(screen.getByPlaceholderText(/tunde adeyemi/i), 'Chinedu Eze');
    await user.type(screen.getByPlaceholderText(/user@slotengineering\.com/i), 'ceze@slotengineering.com');
    await user.type(screen.getByPlaceholderText(/set a strong password/i), 'TestPass123!');
    await user.click(screen.getByRole('button', { name: /create user/i }));
    await screen.findByText('Chinedu Eze');

    const stored = getUsers();
    const created = stored.find(u => u.email === 'ceze@slotengineering.com');

    // The record IS created — but only here, in this browser's localStorage.
    expect(created).toBeTruthy();
    // No field links this record to a real Supabase Auth account — matching
    // the manual "copy the UUID into app_users" step the UI itself
    // documents as a separate, out-of-app procedure.
    expect(created.auth_user_id).toBeUndefined();
  });

  it('changing an existing user\'s role saves cleanly', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Users />);

    // The seeded manager (Tunde Adeyemi) — edit and promote to accountant.
    const row = await screen.findByText('Tunde Adeyemi');
    await user.click(within(row.closest('tr')).getByRole('button', { name: /edit/i }));
    await screen.findByText(/✏️ edit user/i);

    const roleSelect = screen.getByDisplayValue('Manager');
    await user.selectOptions(roleSelect, 'accountant');
    await user.click(screen.getByRole('button', { name: /update user/i }));

    expect(screen.queryByText(/✏️ edit user/i)).not.toBeInTheDocument();
    const stored = getUsers();
    expect(stored.find(u => u.name === 'Tunde Adeyemi').role).toBe('accountant');
  });
});
