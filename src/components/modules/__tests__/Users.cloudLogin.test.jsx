import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Users from '../Users';
import { renderWithProviders } from '../../../test/testUtils';
import { getUsers } from '../../../utils/auth';

vi.mock('../../../supabase/client', () => ({ supabaseReady: true, supabase: {} }));
vi.mock('../../../supabase/auth', () => ({ createUserWithCloudLogin: vi.fn() }));

import { createUserWithCloudLogin } from '../../../supabase/auth';

async function fillAndSubmit(user) {
  await user.click(screen.getByRole('button', { name: /\+ add user/i }));
  await screen.findByText(/\+ add new user/i);
  await user.type(screen.getByPlaceholderText(/tunde adeyemi/i), 'Amaka Nwosu');
  await user.type(screen.getByPlaceholderText(/user@slotengineering\.com/i), 'anwosu@slotengineering.com');
  await user.type(screen.getByPlaceholderText(/set a strong password/i), 'TestPass123!');
  await user.click(screen.getByRole('button', { name: /create user/i }));
}

describe('Users — Add User with cloud login (Supabase configured)', () => {
  beforeEach(() => {
    localStorage.clear();
    createUserWithCloudLogin.mockReset();
  });

  it('on success: stores the returned auth_user_id against the local user record', async () => {
    createUserWithCloudLogin.mockResolvedValue({
      success: true,
      profile: { auth_user_id: 'auth-uuid-123', email: 'anwosu@slotengineering.com' },
    });
    const user = userEvent.setup();
    renderWithProviders(<Users />);

    await fillAndSubmit(user);
    await screen.findByText('Amaka Nwosu'); // modal closed, row rendered → save completed

    expect(createUserWithCloudLogin).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'anwosu@slotengineering.com', role: expect.any(String) })
    );
    const created = getUsers().find(u => u.email === 'anwosu@slotengineering.com');
    expect(created.auth_user_id).toBe('auth-uuid-123');
  });

  it('on failure: still creates the local record instead of failing silently or blocking the save', async () => {
    createUserWithCloudLogin.mockResolvedValue({
      success: false,
      error: 'A login already exists for this email',
    });
    const user = userEvent.setup();
    renderWithProviders(<Users />);

    await fillAndSubmit(user);
    await screen.findByText('Amaka Nwosu'); // modal closed, row rendered → local save still completed

    // The local record still exists — a cloud failure never blocks adding the user.
    const created = getUsers().find(u => u.email === 'anwosu@slotengineering.com');
    expect(created).toBeTruthy();
    expect(created.auth_user_id).toBeUndefined();
  });
});
