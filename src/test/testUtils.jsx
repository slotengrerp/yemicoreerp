// ══════════════════════════════════════════════════════════════════════════════
// SLOT ERP — Test utilities
// ══════════════════════════════════════════════════════════════════════════════
//
// Renders components inside the REAL AppContext + ThemeContext providers
// (not mocks) so tests exercise the actual code path every real user goes
// through — the same providers, the same reducer, the same theme tokens.
// Only the starting data is swapped out for a small, known test fixture.
import { render } from '@testing-library/react';
import { AppProvider, defaultAppState } from '../context/AppContext';
import { ThemeProvider } from '../context/ThemeContext';

export function makeTestUser(overrides = {}) {
  return {
    id: 'test-user-1',
    name: 'Test Admin',
    email: 'test@slot.local',
    role: 'admin',
    modules: [],
    ...overrides,
  };
}

export function makeTestState(overrides = {}) {
  return {
    ...defaultAppState,
    currentUser: makeTestUser(),
    loading: false,
    ...overrides,
    db: { ...defaultAppState.db, ...(overrides.db || {}) },
    acctData: { ...defaultAppState.acctData, ...(overrides.acctData || {}) },
  };
}

// Render a component under real providers, seeded with `state` (defaults to
// a logged-in admin with otherwise-empty data — the emptiest, most
// crash-prone state a screen can be in, which is exactly what's worth
// testing for).
export function renderWithProviders(ui, { state } = {}) {
  return render(
    <ThemeProvider>
      <AppProvider initialState={state || makeTestState()}>
        {ui}
      </AppProvider>
    </ThemeProvider>
  );
}
