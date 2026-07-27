import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Users from '../Users';
import { renderWithProviders } from '../../../test/testUtils';

// Users.jsx v2.0 is fully Supabase-backed — there is no localStorage users
// store to fall back to any more (see the module's own header comment: "As
// of v1.2, the user list is the source of truth in the app_users Postgres
// table... There is no longer a local users store in localStorage"). These
// tests mock the Supabase client and the supabase/auth helpers Users.jsx
// actually imports (createSupabaseUser / updateSupabaseUser / etc.), with a
// small mock-able "table" standing in for `app_users` so create/list/update
// round-trip the way they really do.
vi.mock('../../../supabase/client', () => ({
  supabaseReady: true,
  supabase: { from: vi.fn() },
}));
vi.mock('../../../supabase/auth', () => ({
  createSupabaseUser: vi.fn(),
  updateSupabaseUser: vi.fn(),
  disableSupabaseUser: vi.fn(),
  enableSupabaseUser: vi.fn(),
  adminResetPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

import { supabase } from '../../../supabase/client';
import { createSupabaseUser, updateSupabaseUser } from '../../../supabase/auth';

// A tiny stand-in for the app_users table. supabase.from(...).select(...)
// .order(...) always resolves with whatever `rows` currently holds — read
// live at call time, not snapshotted — so it reflects a create/update no
// matter which microtask tick the component's own refetch happens to land
// on relative to the mocked create/update call resolving.
let rows = [];
function mockTable(seed) { rows = [...seed]; }

describe('Users — Add User', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTable([]);
    supabase.from.mockImplementation(() => ({
      // A fresh array each call — real Supabase responses are always new
      // objects, and React's useMemo/state-change detection relies on that;
      // resolving the SAME reference every time (an earlier version of this
      // mock did) made `filtered` a stale useMemo cache that never noticed
      // the table had changed.
      select: () => ({ order: () => Promise.resolve({ data: [...rows], error: null }) }),
    }));
  });

  it('opens the Add User form without crashing, saves, and the user appears in the list', async () => {
    const user = userEvent.setup();
    // Push the new row into the shared `rows` array as part of the same
    // mocked call the component awaits, so it's guaranteed to be there by
    // the time Users.jsx's post-create refetch reads the table.
    createSupabaseUser.mockImplementation(async (args) => {
      rows.push({ id: 'u1', name: args.name, email: args.email, role: args.role, modules: args.modules || [], status: 'Active' });
      return { success: true, profile: { auth_user_id: 'auth-1' } };
    });
    renderWithProviders(<Users />);

    // Wait for the initial (mocked) load to settle before interacting — the
    // "+ Add User" button is disabled while `loading` is true, which was the
    // actual cause of this test's original flakiness.
    await screen.findByText(/no users found/i);

    await user.click(screen.getByRole('button', { name: /\+ add user/i }));
    const heading = await screen.findByText(/\+ add new user/i);
    expect(heading).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/tunde adeyemi/i), 'Chinedu Eze');
    await user.type(screen.getByPlaceholderText(/user@slotengineering\.com/i), 'ceze@slotengineering.com');
    // Real placeholder text is "Min 8 chars, mixed case, number/symbol" —
    // the old "set a strong password" placeholder never existed in v2.0.
    await user.type(screen.getByPlaceholderText(/min 8 chars/i), 'TestPass123!');

    await user.click(screen.getByRole('button', { name: /create user/i }));

    expect(await screen.findByText('Chinedu Eze')).toBeInTheDocument();
    expect(createSupabaseUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ceze@slotengineering.com', name: 'Chinedu Eze', role: 'viewer' })
    );
  });

  it('rejects a weak password and does not create the user', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Users />);
    await screen.findByText(/no users found/i);

    await user.click(screen.getByRole('button', { name: /\+ add user/i }));
    await screen.findByText(/\+ add new user/i);
    await user.type(screen.getByPlaceholderText(/tunde adeyemi/i), 'Weak Pass');
    await user.type(screen.getByPlaceholderText(/user@slotengineering\.com/i), 'weak@slotengineering.com');
    await user.type(screen.getByPlaceholderText(/min 8 chars/i), 'weak'); // too short, no uppercase/number

    await user.click(screen.getByRole('button', { name: /create user/i }));

    // validatePassword() rejects it before createSupabaseUser is ever called,
    // and the modal stays open so the admin can correct it.
    expect(createSupabaseUser).not.toHaveBeenCalled();
    expect(screen.getByText(/\+ add new user/i)).toBeInTheDocument();
  });

  it('changing an existing user\'s role saves cleanly', async () => {
    const user = userEvent.setup();
    mockTable([{ id: 'u-tunde', name: 'Tunde Adeyemi', email: 'tunde@slotengineering.com', role: 'manager', modules: [], status: 'Active' }]);
    updateSupabaseUser.mockResolvedValue({ success: true, profile: { role: 'accountant' } });
    renderWithProviders(<Users />);

    const row = await screen.findByText('Tunde Adeyemi');
    await user.click(within(row.closest('tr')).getByRole('button', { name: /edit/i }));
    await screen.findByText(/✏️ edit user/i);

    const roleSelect = screen.getByDisplayValue('Manager');
    await user.selectOptions(roleSelect, 'accountant');
    await user.click(screen.getByRole('button', { name: /update user/i }));

    await waitFor(() => expect(screen.queryByText(/✏️ edit user/i)).not.toBeInTheDocument());
    expect(updateSupabaseUser).toHaveBeenCalledWith('u-tunde', expect.objectContaining({ role: 'accountant' }));
  });
});
