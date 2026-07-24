import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Users from '../Users';
import { renderWithProviders } from '../../../test/testUtils';

// Users.jsx v2.0 imports `createSupabaseUser` (an alias of
// createUserWithCloudLogin — see supabase/auth.js), not
// `createUserWithCloudLogin` directly, and there is no local `app_users`
// fallback if the cloud call fails: a failed create must show an error and
// leave the modal open, not silently create a local-only record. Mocking
// the module by the name Users.jsx actually imports keeps this test wired
// to the real code path instead of an unused stand-in.
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
import { createSupabaseUser } from '../../../supabase/auth';

// See Users.test.jsx for why `rows` is a live-read shared array rather than
// a value baked into the mock at setup time.
let rows = [];
function mockTable(seed) { rows = [...seed]; }

async function fillAndSubmit(user) {
  await screen.findByText(/no users found/i); // wait for initial load — button is disabled until then
  await user.click(screen.getByRole('button', { name: /\+ add user/i }));
  await screen.findByText(/\+ add new user/i);
  await user.type(screen.getByPlaceholderText(/tunde adeyemi/i), 'Amaka Nwosu');
  await user.type(screen.getByPlaceholderText(/user@slotengineering\.com/i), 'anwosu@slotengineering.com');
  await user.type(screen.getByPlaceholderText(/min 8 chars/i), 'TestPass123!');
  await user.click(screen.getByRole('button', { name: /create user/i }));
}

describe('Users — Add User with cloud login (Supabase configured)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTable([]);
    supabase.from.mockImplementation(() => ({
      // Fresh array each call — see Users.test.jsx for why this matters
      // (resolving the same reference every time made useMemo/`filtered`
      // stale and never notice the table had changed).
      select: () => ({ order: () => Promise.resolve({ data: [...rows], error: null }) }),
    }));
  });

  it('on success: creates the user via createSupabaseUser and the new row appears in the list', async () => {
    // Push into the shared `rows` array as part of the same mocked call the
    // component awaits, so Users.jsx's post-create refetch (not a local
    // append — this is the real round trip) is guaranteed to see it.
    createSupabaseUser.mockImplementation(async (args) => {
      rows.push({ id: 'u2', name: args.name, email: args.email, role: args.role, modules: args.modules || [], status: 'Active' });
      return { success: true, profile: { auth_user_id: 'auth-uuid-123', email: args.email } };
    });
    const user = userEvent.setup();
    renderWithProviders(<Users />);

    await fillAndSubmit(user);

    expect(await screen.findByText('Amaka Nwosu')).toBeInTheDocument();
    expect(createSupabaseUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'anwosu@slotengineering.com', name: 'Amaka Nwosu' })
    );
  });

  it('on failure: shows an error and does not add the user — no silent local-only account', async () => {
    createSupabaseUser.mockResolvedValue({
      success: false,
      error: 'A login already exists for this email',
    });
    const user = userEvent.setup();
    renderWithProviders(<Users />);

    await fillAndSubmit(user);

    // v2.0 has no local fallback store — a failed cloud create must not
    // leave a fake/orphaned record behind, and the admin needs the chance
    // to fix the input, so the modal stays open.
    await waitFor(() => expect(createSupabaseUser).toHaveBeenCalled());
    expect(screen.queryByText('Amaka Nwosu')).not.toBeInTheDocument();
    expect(screen.getByText(/\+ add new user/i)).toBeInTheDocument();
  });
});
