// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Period & Fiscal Year Locking v1.0
//
// Implements the audit's Tier 1 finding that "Fiscal Year Start" was a
// display setting with no enforcement. This module gives every transaction
// a stable `periodKey` (e.g. "2026-07") derived from its date + the
// configured fiscal year start, and blocks new postings into periods that
// have been closed — and surfaces a one-time year-end close process.
//
// Close/period model:
//   • A "period" is one calendar month under the configured fiscal year
//     start. With Jan start, periods are "2026-01"…"2026-12". With Jul
//     start (e.g. Nigeria's often-July fiscal year), July is period 1 of
//     the new FY and June is period 12.
//   • A "closed period" is one the accountant has explicitly locked — no
//     new journal entries, no source-module postings (AR invoice, AP bill,
//     payroll run, etc.) can land in it. Existing entries can still be
//     VOIDED via the standard void-and-reverse path (the same pattern
//     already used for AR/AP/Payroll/etc.), which posts a reversal pair
//     in the *current* open period rather than the closed one.
//   • A "closed fiscal year" is one where all 12 periods are closed and
//     the year-end closing entry has been posted (closing all revenue and
//     expense accounts to Retained Earnings).
//
// Storage:
//   closedPeriods: ['2026-04', '2026-05', ...]   ← in appSettings.accounting
//   closedYears:   ['2025', ...]                 ← in appSettings.accounting
//   yearEndClosings: { '2025': { id, date, retainedEarnings, postedBy } }
// ══════════════════════════════════════════════════════════════════════════════

// 12 calendar months in order (used to compute period index relative to FY start)
const CALENDAR_MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// ── Period key from a date ────────────────────────────────────────────────────
// Returns { periodKey: 'YYYY-MM', fy: 'YYYY', fyLabel: 'FY 2026', periodNo: 1-12, monthName }
export function periodOf(date, fiscalYearStartMonth = 'January') {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    return { periodKey: '', fy: '', fyLabel: '', periodNo: 0, monthName: '' };
  }
  const monthIdx   = d.getMonth();               // 0-11
  const calendarYr = d.getFullYear();
  const fyStartIdx = CALENDAR_MONTHS.indexOf(fiscalYearStartMonth);
  // Months BEFORE the FY start belong to the previous FY
  const periodNo   = (((monthIdx - fyStartIdx) + 12) % 12) + 1;
  const fy         = monthIdx >= fyStartIdx ? calendarYr : calendarYr - 1;
  // Use the FY end year in the label (e.g. FY2026 = Jul 2025 – Jun 2026)
  const fyEndYear  = fyStartIdx === 0 ? fy : fy + 1;
  return {
    periodKey: `${fy}-${String(periodNo).padStart(2, '0')}`,
    fy:        String(fy),
    fyLabel:   fyStartIdx === 0 ? `FY ${fy}` : `FY ${fy}/${String(fyEndYear).slice(-2)}`,
    periodNo,
    monthName: CALENDAR_MONTHS[monthIdx],
  };
}

// ── 12 period keys for a fiscal year, in order ────────────────────────────────
export function periodsInFY(fyStr, fiscalYearStartMonth = 'January') {
  const fy = Number(fyStr);
  if (isNaN(fy)) return [];
  const fyStartIdx = CALENDAR_MONTHS.indexOf(fiscalYearStartMonth);
  // Walk 12 months starting from FY start in year fy
  const result = [];
  for (let i = 0; i < 12; i++) {
    const monthIdx = (fyStartIdx + i) % 12;
    const year     = fyStartIdx === 0 ? fy : (fy + Math.floor((fyStartIdx + i) / 12));
    const d        = new Date(year, monthIdx, 1);
    result.push(periodOf(d, fiscalYearStartMonth));
  }
  return result;
}

// ── Closed-period helpers ─────────────────────────────────────────────────────
export function isPeriodClosed(periodKey, settings) {
  const closed = settings?.accounting?.closedPeriods || [];
  return closed.includes(periodKey);
}

export function isYearClosed(fy, settings) {
  const closed = settings?.accounting?.closedYears || [];
  return closed.includes(String(fy));
}

export function closedPeriods(settings) {
  return settings?.accounting?.closedPeriods || [];
}

export function closedYears(settings) {
  return settings?.accounting?.closedYears || [];
}

// ── Post guard — throw with a clear error if the period is locked ────────────
export function assertPeriodOpen(periodKey, settings) {
  if (isPeriodClosed(periodKey, settings)) {
    const err = new Error(`Period ${periodKey} is closed — cannot post. Reopen the period in Settings → Accounting → Period Close.`);
    err.code = 'PERIOD_CLOSED';
    err.periodKey = periodKey;
    throw err;
  }
  const [fy] = periodKey.split('-');
  if (isYearClosed(fy, settings)) {
    const err = new Error(`Fiscal year ${fy} is closed — cannot post. Reopen the year in Settings → Accounting → Year-End Close.`);
    err.code = 'YEAR_CLOSED';
    err.fy = fy;
    throw err;
  }
}

// ── Close / reopen actions (return NEW settings — never mutate) ───────────────
export function closePeriod(periodKey, settings) {
  const accounting = settings?.accounting || {};
  const closed = new Set(accounting.closedPeriods || []);
  closed.add(periodKey);
  return {
    ...settings,
    accounting: { ...accounting, closedPeriods: Array.from(closed).sort() },
  };
}

export function reopenPeriod(periodKey, settings) {
  const accounting = settings?.accounting || {};
  const closed = (accounting.closedPeriods || []).filter(p => p !== periodKey);
  return {
    ...settings,
    accounting: { ...accounting, closedPeriods: closed.sort() },
  };
}

export function closeYear(fy, settings, yearEndClosing = null) {
  const accounting = settings?.accounting || {};
  const closedYears = new Set(accounting.closedYears || []);
  closedYears.add(String(fy));
  // Also auto-close all 12 periods for that FY
  const fyPeriodKeys = periodsInFY(String(fy), accounting.fiscalYearStart || 'January')
    .map(p => p.periodKey);
  const closedPeriods = new Set(accounting.closedPeriods || []);
  fyPeriodKeys.forEach(p => closedPeriods.add(p));
  const yec = accounting.yearEndClosings || {};
  const next = { ...settings, accounting: {
    ...accounting,
    closedYears: Array.from(closedYears).sort(),
    closedPeriods: Array.from(closedPeriods).sort(),
  }};
  if (yearEndClosing) {
    next.accounting.yearEndClosings = {
      ...yec,
      [String(fy)]: { ...yearEndClosing, date: yearEndClosing.date || new Date().toISOString() },
    };
  }
  return next;
}

export function reopenYear(fy, settings) {
  const accounting = settings?.accounting || {};
  const closedYears = (accounting.closedYears || []).filter(y => y !== String(fy));
  return {
    ...settings,
    accounting: {
      ...accounting,
      closedYears: closedYears.sort(),
      yearEndClosings: { ...(accounting.yearEndClosings || {}) },
    },
  };
}

// ── Build a year-end closing entry (closes revenue + expense to RE) ──────────
// Caller passes the current journal array; we compute net income and return
// a journal entry object (caller persists + posts it).
//
//   Dr Revenue accounts (one line per non-zero revenue account)   sumRev
//   Dr/Cr Net P&L                                                  netPnL (positive = income)
//   Cr Expense accounts (one line per non-zero expense account)   sumExp
export function buildYearEndClosingEntry(fy, journals, coa, currentUser, openingNetIncomeAccountCode = '3100') {
  // Sum revenue and expense balances for this FY
  const revByAcct  = new Map();
  const expByAcct  = new Map();
  const fyPrefix   = `${fy}-`;

  (journals || []).forEach(j => {
    if (!(j?.date || '').startsWith(fyPrefix) && !(j?.periodKey || '').startsWith(fyPrefix)) return;
    (j.lines || []).forEach(line => {
      const isRev = (line.crCode || '').match(/^4/);  // 4xxx = revenue
      const isExp = (line.drCode || '').match(/^8/);  // 8xxx = direct/admin expense
      const isAdmin = (line.drCode || '').match(/^9/);// 9xxx = admin expense
      if (isRev) {
        // Revenue is normal Cr — credit side is the amount
        const cur = revByAcct.get(line.crCode) || { code: line.crCode, name: line.crName, amount: 0 };
        cur.amount += Number(line.amount) || 0;
        revByAcct.set(line.crCode, cur);
      }
      if (isExp || isAdmin) {
        // Expense is normal Dr — debit side is the amount
        const cur = expByAcct.get(line.drCode) || { code: line.drCode, name: line.drName, amount: 0 };
        cur.amount += Number(line.amount) || 0;
        expByAcct.set(line.drCode, cur);
      }
    });
  });

  const sumRev = Array.from(revByAcct.values()).reduce((a, l) => a + l.amount, 0);
  const sumExp = Array.from(expByAcct.values()).reduce((a, l) => a + l.amount, 0);
  const netPnL = sumRev - sumExp;
  const reAcct = (coa || []).find(a => a.code === openingNetIncomeAccountCode)
              || { code: openingNetIncomeAccountCode, name: 'Retained Earnings' };

  // Build balanced journal lines
  const lines = [];
  // Close revenue: Dr each revenue account, Cr P&L
  Array.from(revByAcct.values()).forEach(r => {
    if (r.amount === 0) return;
    lines.push({
      drCode: r.code, drName: r.name,
      crCode: openingNetIncomeAccountCode, crName: reAcct.name,
      amount: r.amount, currency: 'NGN', fxRate: 1, fcAmount: null,
      memo: `Year-end close — ${fy} revenue → RE`,
    });
  });
  // Close expense: Dr P&L, Cr each expense account
  Array.from(expByAcct.values()).forEach(e => {
    if (e.amount === 0) return;
    lines.push({
      drCode: openingNetIncomeAccountCode, drName: reAcct.name,
      crCode: e.code, crName: e.name,
      amount: e.amount, currency: 'NGN', fxRate: 1, fcAmount: null,
      memo: `Year-end close — ${fy} expense → RE`,
    });
  });

  return {
    id:          `JE-YEC-${fy}`,
    date:        `${fy}-12-31`,
    ref:         `YEC-${fy}`,
    description: `Year-End Closing: FY ${fy} (Revenue ${sumRev.toLocaleString()} − Expense ${sumExp.toLocaleString()} = Net ${netPnL.toLocaleString()})`,
    source:      'year-end-close',
    sourceId:    fy,
    postedBy:    currentUser?.name || 'System',
    periodKey:   `${fy}-12`,
    lines,
    netIncome:   netPnL,
    sumRev,
    sumExp,
  };
}
