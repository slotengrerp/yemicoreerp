// These are integration tests, not unit tests — they mount a source module
// (Terminal Ops / Contract Staff / Fleet Maintenance) alongside Accounting
// under the SAME AppProvider, perform the real user action, then check
// Accounting's own Journal Entries tab for the resulting entry.
//
// This is deliberately not just "does clicking the button show a success
// toast" — that's exactly what the original Terminal Ops bug got right
// while still being completely broken (it wrote to a `db.accounting` key
// the real Accounting module never read from). These tests only pass if
// the entry is genuinely visible from Accounting's own rendering path.
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../../../context/ThemeContext';
import { AppProvider } from '../../../context/AppContext';
import { render } from '@testing-library/react';
import TerminalOps from '../TerminalOps';
import ContractStaff from '../ContractStaff';
import FleetMaintenance from '../FleetMaintenance';
import Accounting from '../Accounting';
import { makeTestState } from '../../../test/testUtils';

function renderTwoModules(SourceModule, sourceProps = {}, stateOverrides = {}) {
  const state = makeTestState(stateOverrides);
  return render(
    <ThemeProvider>
      <AppProvider initialState={state}>
        <SourceModule {...sourceProps} />
        <Accounting />
      </AppProvider>
    </ThemeProvider>
  );
}

async function openJournalTab(user) {
  await user.click(screen.getByRole('button', { name: /journal entries/i }));
}

describe('GL integration — Terminal Ops charges', () => {
  it('a charge marked "Post to Accounting" actually appears in the real Journal', async () => {
    const user = userEvent.setup();
    // AppContext's default state initializes db.terminal as empty arrays,
    // which takes priority over TerminalOps' own internal demo data — seed
    // a real unposted charge explicitly, the same shape the real form saves.
    renderTwoModules(TerminalOps, {}, {
      db: { terminal: { containers: [], logistics: [], charges: [{
        id: 'test-charge-1', containerNo: 'TEST1234567', arrivalDate: '2026-07-01',
        paymentDate: '2026-07-05', agentName: 'Test Clearing Agency Ltd',
        equipmentCharge: 50000, terminalCharge: 120000, storageCharge: 30000,
        totalAmount: 200000, postedToAccounting: false,
      }] } },
    });

    await user.click(screen.getByRole('button', { name: /clearing.*charges/i }));
    const postButtons = await screen.findAllByRole('button', { name: /^post/i });
    await user.click(postButtons[0]);

    await openJournalTab(user);
    expect(await screen.findByText(/Terminal\/Clearing Charges:/i)).toBeInTheDocument();
  });
});

describe('GL integration — Payroll', () => {
  const testStaff = [{
    id: 'test-staff-1', sn: 1, refId: 'NLNG-TEST-001', fullName: 'Test Engineer',
    department: 'Engineering', status: 'Active',
    basicSalary: 300000, housing: 100000, transport: 50000,
  }];

  it('running Contract Staff payroll actually posts a journal entry to the real Journal', async () => {
    const user = userEvent.setup();
    renderTwoModules(ContractStaff, {}, { db: { nlng: testStaff } });

    // "Run Payroll" only appears in the Payroll view, reached via this StatCard.
    await user.click(screen.getByText(/monthly payroll/i));
    await user.click(screen.getByRole('button', { name: /run payroll for/i }));

    await openJournalTab(user);
    expect(await screen.findByText(/Payroll Run: Contract Staff/i)).toBeInTheDocument();
  });

  it('does not allow running the same period twice', async () => {
    const user = userEvent.setup();
    renderTwoModules(ContractStaff, {}, { db: { nlng: testStaff } });

    await user.click(screen.getByText(/monthly payroll/i));
    await user.click(screen.getByRole('button', { name: /run payroll for/i }));

    expect(await screen.findByText(/posted to gl/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run payroll for/i })).not.toBeInTheDocument();
  });
});

describe('GL integration — Fleet Maintenance repairs', () => {
  it('a repair marked "Post to Accounting" actually appears in the real Journal', async () => {
    const user = userEvent.setup();
    // db.fleet isn't in AppContext's default state at all, so FleetMaintenance
    // falls back to its own internal seed data — no explicit seeding needed.
    renderTwoModules(FleetMaintenance);

    await user.click(screen.getByRole('button', { name: /repair records/i }));
    const rows = document.querySelectorAll('tbody tr');
    expect(rows.length).toBeGreaterThan(0);
    await user.click(rows[0]);

    await user.click(await screen.findByRole('button', { name: /post to accounting/i }));

    await openJournalTab(user);
    expect(await screen.findByText(/Vehicle Repair:/i)).toBeInTheDocument();
  });
});
