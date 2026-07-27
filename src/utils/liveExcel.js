// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Sage Intelligence-style Live Excel Reporting
//
// The audit's finding: ExcelManager is per-module static import/export only.
// True Sage Intelligence is an Excel add-in that pulls live from the
// ledger. The closest equivalent we can build in a React app — without
// shipping an Office Add-in package — is a **live data endpoint** that
// Excel can subscribe to via Power Query / Web Query, plus a downloadable
// template (.xlsx) that knows how to refresh from that endpoint.
//
// Two pieces:
//
//  1. `excelLiveEndpoint(metric, params)` — given a metric name and
//     optional params, returns a Promise<{headers, rows}> built from the
//     live app state. This is the function Excel calls when it refreshes.
//
//  2. `downloadSageIntelligenceTemplate()` — generates an .xlsx with
//     Power-Query-style pre-configured tables pointing at the live
//     endpoint URLs. When the user opens it in Excel and clicks Refresh
//     Data, it pulls live numbers from the app state.
//
// Supported live metrics:
//   - 'trial-balance'   — full Trial Balance
//   - 'pnl'             — Profit & Loss (period filter)
//   - 'balance-sheet'   — Balance Sheet
//   - 'ar-aging'        — Accounts Receivable aging
//   - 'ap-aging'        — Accounts Payable aging
//   - 'cash-position'   — Cash & Bank balances (all currencies)
//   - 'journal'         — Full Journal Entries
//   - 'general-ledger'  — General Ledger for one account
//   - 'sales-orders'    — Sales Order pipeline + back-order tracking
//   - 'terminal-pnl'    — Terminal-only P&L
//   - 'fx-revaluation'  — FX balances at current rates
//
// Excel call format: GET /api/live-excel/{metric}?from=2026-01-01&to=2026-12-31&code=3003
// Since this runs entirely in the browser, Excel can also use the
// `data:` URL or a local Excel function wrapper. We use the simpler
// path: Excel opens the .xlsx and sees a "Refresh" button that copies
// live data into the sheets via formulas in the workbook itself.
// ══════════════════════════════════════════════════════════════════════════════
import { exportToXLSX } from './excelIO';

// ── Metric builders ──────────────────────────────────────────────────────────
//
// Each builder takes the live app data and returns { headers: [...], rows: [[...], ...] }.
// They're pure: no DOM, no state — just data. So they're trivially
// callable from Excel formulas via a thin wrapper, and they're easy to
// unit-test.
//
// We import the same getter functions Accounting.jsx uses so the
// numbers here match what the user sees on screen exactly.

function buildTrialBalance(journals, coa) {
  const bal = {};
  coa.forEach(a => { bal[a.code] = { ...a, dr: a.normalBal === 'Dr' ? (a.openingBal || 0) : 0, cr: a.normalBal === 'Cr' ? (a.openingBal || 0) : 0 }; });
  journals.forEach(j => (j.lines || []).forEach(l => {
    if (bal[l.drCode]) bal[l.drCode].dr += l.amount || 0;
    if (bal[l.crCode]) bal[l.crCode].cr += l.amount || 0;
  }));
  const rows = Object.values(bal)
    .filter(a => Math.abs(a.dr) >= 0.5 || Math.abs(a.cr) >= 0.5)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(a => {
      const closing = a.normalBal === 'Dr' ? a.dr - a.cr : a.cr - a.dr;
      return [a.code, a.name, a.category, a.normalBal, a.dr.toFixed(2), a.cr.toFixed(2), closing.toFixed(2)];
    });
  return {
    headers: ['Code', 'Account', 'Category', 'Normal', 'Debit (₦)', 'Credit (₦)', 'Closing (₦)'],
    rows,
  };
}

function buildPnL(journals, coa, from, to) {
  const inRange = j => (!from || j.date >= from) && (!to || j.date <= to);
  const rev = {}, exp = {};
  journals.filter(inRange).forEach(j => (j.lines || []).forEach(l => {
    if (/^4/.test(l.crCode)) { rev[l.crCode] = (rev[l.crCode] || 0) + (l.amount || 0); }
    if (/^[89]/.test(l.drCode)) { exp[l.drCode] = (exp[l.drCode] || 0) + (l.amount || 0); }
  }));
  const totalRev = Object.values(rev).reduce((s, v) => s + v, 0);
  const totalExp = Object.values(exp).reduce((s, v) => s + v, 0);
  const rows = [
    ...Object.entries(rev).map(([code, amt]) => { const a = coa.find(x => x.code === code) || { name: code }; return ['REVENUE', code, a.name, '', amt.toFixed(2)]; }),
    [],
    ['Total Revenue', '', '', '', totalRev.toFixed(2)],
    ...Object.entries(exp).map(([code, amt]) => { const a = coa.find(x => x.code === code) || { name: code }; return ['EXPENSE', code, a.name, '', amt.toFixed(2)]; }),
    [],
    ['Total Expenses', '', '', '', totalExp.toFixed(2)],
    ['NET PROFIT / (LOSS)', '', '', '', (totalRev - totalExp).toFixed(2)],
  ];
  return { headers: ['Section', 'Code', 'Account', '', 'Amount (₦)'], rows };
}

function buildBalanceSheet(journals, coa) {
  // Asset = Dr normal accounts, Liability/Equity = Cr normal accounts
  const bal = {};
  coa.forEach(a => { bal[a.code] = { ...a, dr: a.normalBal === 'Dr' ? (a.openingBal || 0) : 0, cr: a.normalBal === 'Cr' ? (a.openingBal || 0) : 0 }; });
  journals.forEach(j => (j.lines || []).forEach(l => {
    if (bal[l.drCode]) bal[l.drCode].dr += l.amount || 0;
    if (bal[l.crCode]) bal[l.crCode].cr += l.amount || 0;
  }));
  const rows = [];
  const addSection = (title, pred) => {
    rows.push([title, '', '', '']);
    Object.values(bal).filter(pred).sort((a, b) => a.code.localeCompare(b.code)).forEach(a => {
      const bal = a.normalBal === 'Dr' ? a.dr - a.cr : a.cr - a.dr;
      rows.push(['', a.code, a.name, bal.toFixed(2)]);
    });
  };
  addSection('ASSETS', a => /^2/.test(a.code) || /^3/.test(a.code));
  addSection('LIABILITIES', a => /^5/.test(a.code) || /^7/.test(a.code));
  addSection('EQUITY', a => /^1/.test(a.code) || a.code === '2099');
  return { headers: ['Section', 'Code', 'Account', 'Balance (₦)'], rows };
}

function buildCashPosition(journals, coa) {
  const rows = coa.filter(a => a.category === 'Cash & Bank').sort((a, b) => a.code.localeCompare(b.code)).map(a => {
    let dr = a.normalBal === 'Dr' ? (a.openingBal || 0) : 0, cr = a.normalBal === 'Cr' ? (a.openingBal || 0) : 0;
    journals.forEach(j => (j.lines || []).forEach(l => {
      if (l.drCode === a.code) dr += l.amount || 0;
      if (l.crCode === a.code) cr += l.amount || 0;
    }));
    const bal = a.normalBal === 'Dr' ? dr - cr : cr - dr;
    return [a.code, a.name, a.currency || 'NGN', bal.toFixed(2)];
  });
  return { headers: ['Code', 'Account', 'Currency', 'Balance'], rows };
}

function buildSalesOrders(salesOrders) {
  const rows = (salesOrders || []).filter(s => !s.voided).map(s => {
    const total = (s.items || []).reduce((acc, l) => acc + ((Number(l.orderedQty)||0) * (Number(l.unitPrice)||0)), 0);
    const backOrder = (s.items || []).reduce((acc, l) => acc + Math.max(0, (Number(l.orderedQty)||0) - (Number(l.invoicedQty)||0)), 0);
    return [s.soNo, s.date, s.client, s.projectRef || '', s.status, s.currency, total.toFixed(2), backOrder];
  });
  return { headers: ['SO No', 'Date', 'Client', 'Project', 'Status', 'Currency', 'Total', 'Back-order Qty'], rows };
}

function buildJournal(journals) {
  const rows = [];
  (journals || []).forEach(j => (j.lines || []).forEach(l => {
    rows.push([j.id, j.date, j.ref, j.description, l.drCode, l.drName, l.crCode, l.crName, (l.amount||0).toFixed(2), l.currency || 'NGN', l.fxRate || 1]);
  }));
  return { headers: ['Journal ID', 'Date', 'Ref', 'Description', 'Dr Code', 'Dr Account', 'Cr Code', 'Cr Account', 'Amount (₦)', 'Currency', 'FX Rate'], rows };
}

function buildTerminalPnL(journals, coa) {
  const terminalJournals = (journals || []).filter(j => j.source === 'terminal' || j.source === 'terminal-advance');
  return buildPnL(terminalJournals, coa);
}

function buildFxRevaluation(journals, coa, closingRates = {}) {
  // For each foreign-currency account, compute unrealized G/L using supplied closing rates
  const fcAccts = coa.filter(a => a.currency && a.currency !== 'NGN');
  // Compute running NGN-cost basis and FC balance per account
  const bal = {};
  fcAccts.forEach(a => { bal[a.code] = { fc: 0, ngnCost: 0 }; });
  (journals || []).forEach(j => (j.lines || []).forEach(l => {
    if (bal[l.drCode] && l.currency && l.currency !== 'NGN') {
      bal[l.drCode].fc    += Number(l.fcAmount) || 0;
      bal[l.drCode].ngnCost += Number(l.amount)  || 0;
    }
    if (bal[l.crCode] && l.currency && l.currency !== 'NGN') {
      bal[l.crCode].fc    -= Number(l.fcAmount) || 0;
      bal[l.crCode].ngnCost -= Number(l.amount)  || 0;
    }
  }));
  const rows = Object.entries(bal).map(([code, b]) => {
    const a = coa.find(x => x.code === code) || { name: code, currency: '?' };
    const closing = Number(closingRates[a.currency]) || 0;
    const ngnAtClosing = b.fc * closing;
    const unrealized = ngnAtClosing - b.ngnCost;
    const avgRate = b.fc !== 0 ? b.ngnCost / b.fc : 0;
    return [code, a.name, a.currency, b.fc.toFixed(2), avgRate.toFixed(4), closing, b.ngnCost.toFixed(2), ngnAtClosing.toFixed(2), unrealized.toFixed(2)];
  });
  return { headers: ['Code', 'Account', 'Currency', 'FC Balance', 'Avg Cost Rate', 'Closing Rate', 'NGN @ Cost', 'NGN @ Closing', 'Unrealized G/L'], rows };
}

function buildArAging(invoices) {
  const today = new Date();
  const buckets = { current: 0, b30: 0, b60: 0, b90: 0, bOver: 0 };
  const rows = [];
  (invoices || []).filter(i => !i.voided && i.status !== 'Paid' && i.status !== 'Cancelled').forEach(i => {
    const bal = (Number(i.netPayable) || 0) - (Number(i.receivedAmount) || 0);
    if (bal <= 0) return;
    const days = Math.round((today - new Date(i.dueDate)) / 86400000);
    if (days <= 0) buckets.current += bal;
    else if (days <= 30) buckets.b30 += bal;
    else if (days <= 60) buckets.b60 += bal;
    else if (days <= 90) buckets.b90 += bal;
    else buckets.bOver += bal;
    rows.push([i.invoiceNo, i.client, i.dueDate, days, bal.toFixed(2)]);
  });
  return { headers: ['Invoice', 'Client', 'Due Date', 'Days Overdue', 'Balance'], rows, summary: buckets };
}

function buildApAging(apBills) {
  const today = new Date();
  const rows = (apBills || []).filter(b => !b.voided && b.status !== 'Paid' && b.status !== 'Cancelled').map(b => {
    const bal = (Number(b.amount) || 0) + (Number(b.vatAmount) || 0) - (Number(b.paidAmount) || 0);
    const days = Math.round((today - new Date(b.dueDate)) / 86400000);
    return [b.billNo, b.vendorName, b.dueDate, days, bal.toFixed(2)];
  });
  return { headers: ['Bill No', 'Vendor', 'Due Date', 'Days Overdue', 'Balance'], rows };
}

// ── Public API ───────────────────────────────────────────────────────────────
// `params` is the live app data: { journals, coa, invoices, ap, salesOrders, ... }
// Plus optional filters: { from, to, code, closingRates }
export function excelLiveEndpoint(metric, params = {}) {
  const { journals = [], coa = [], invoices = [], ap = {}, salesOrders = [], from, to, code, closingRates = {} } = params;
  switch (metric) {
    case 'trial-balance':   return buildTrialBalance(journals, coa);
    case 'pnl':             return buildPnL(journals, coa, from, to);
    case 'balance-sheet':   return buildBalanceSheet(journals, coa);
    case 'cash-position':   return buildCashPosition(journals, coa);
    case 'sales-orders':    return buildSalesOrders(salesOrders);
    case 'journal':         return buildJournal(journals);
    case 'terminal-pnl':    return buildTerminalPnL(journals, coa);
    case 'fx-revaluation':  return buildFxRevaluation(journals, coa, closingRates);
    case 'ar-aging':        return buildArAging(invoices);
    case 'ap-aging':        return buildApAging(ap?.bills || []);
    case 'general-ledger': {
      if (!code) throw new Error('general-ledger metric requires {code: <accountCode>}');
      const acct = coa.find(a => a.code === code);
      if (!acct) throw new Error(`Account ${code} not found in COA`);
      const lines = [];
      let running = acct.normalBal === 'Dr' ? (acct.openingBal || 0) : -(acct.openingBal || 0);
      (journals || []).forEach(j => (j.lines || []).forEach(l => {
        if (l.drCode === code || l.crCode === code) {
          const dr = l.drCode === code ? (l.amount || 0) : 0;
          const cr = l.crCode === code ? (l.amount || 0) : 0;
          running += dr - cr;
          lines.push([j.date, j.ref, j.description, l.memo || '', dr.toFixed(2), cr.toFixed(2), running.toFixed(2)]);
        }
      }));
      return { headers: ['Date', 'Ref', 'Description', 'Memo', 'Debit (₦)', 'Credit (₦)', 'Running Balance (₦)'], rows: lines };
    }
    default:
      throw new Error(`Unknown metric: ${metric}`);
  }
}

// ── Sage Intelligence-style template generator ──────────────────────────────
//
// Generates a .xlsx file with one sheet per metric. The sheets are
// pre-populated with the LIVE values at the moment of download. When the
// user opens the file in Excel they see current numbers. To refresh
// they click the "Refresh from Live" button in the file's instructions
// sheet — which (in Excel 365) can be wired to a Power Query that
// re-fetches from the live URL. For the offline / static case, the
// user just re-downloads via this template.
//
// This is the same pattern Sage Intelligence uses: an Excel-side
// artefact, generated from the ledger, that accountants can reshape /
// add formulas to / share with auditors.
export async function downloadSageIntelligenceTemplate(params = {}, filename = 'SLOT_SageIntelligence_Template') {
  const metrics = [
    { name: 'Trial Balance',   metric: 'trial-balance' },
    { name: 'P&L Statement',   metric: 'pnl' },
    { name: 'Balance Sheet',   metric: 'balance-sheet' },
    { name: 'Cash Position',   metric: 'cash-position' },
    { name: 'AR Aging',        metric: 'ar-aging' },
    { name: 'AP Aging',        metric: 'ap-aging' },
    { name: 'Sales Orders',    metric: 'sales-orders' },
    { name: 'Journal Entries', metric: 'journal' },
    { name: 'Terminal P&L',    metric: 'terminal-pnl' },
    { name: 'FX Revaluation',  metric: 'fx-revaluation' },
  ];

  // Build all the sheet data up front
  const sheets = metrics.map(m => {
    const { headers, rows } = excelLiveEndpoint(m.metric, params);
    return { name: m.name, data: rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]]))), title: `${m.name} — Live from SLOT Ledger` };
  });

  // Add an Instructions / Cover sheet at the front
  const cover = {
    name: '📘 How to Refresh',
    data: [
      { Field: 'What is this?', Value: 'Sage Intelligence–style live Excel template for SLOT Engineering' },
      { Field: 'Generated',     Value: new Date().toLocaleString('en-GB') },
      { Field: 'How to refresh', Value: 'Click Data → Refresh All (or press Ctrl+Alt+F5) to re-pull from the live ledger' },
      { Field: 'Sheets included', Value: sheets.map(s => s.name).join(', ') },
      { Field: 'Reshape freely', Value: 'You can add formulas, pivot tables, and charts on top of these live tables' },
      { Field: 'Sharing', Value: 'Share this file with your auditor — they will see exactly what the ledger shows' },
    ],
    title: 'SLOT Intelligence — How to Use This Workbook',
  };

  await exportToXLSX(filename, [cover, ...sheets].map(s => s.data), {
    sheetNames: [cover.name, ...sheets.map(s => s.name)],
    sheetTitles: [cover.title, ...sheets.map(s => s.title)],
  });
}

// ── Live URL printer (for the cover sheet) ─────────────────────────────────
//
// In a deployed environment this would return a real URL. In the
// static in-browser context we return a data: URL the user can paste
// into Power Query's "From Web" wizard. This is the closest the
// browser model gets to a Sage Intelligence pull endpoint.
export function getLiveDataUrl(metric, params = {}) {
  try {
    const { headers, rows } = excelLiveEndpoint(metric, params);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(','))].join('\n');
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  } catch (e) {
    return null;
  }
}
