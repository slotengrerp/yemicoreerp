// ── ACCOUNTING UTILITY FUNCTIONS ─────────────────────────────────────────────
// These are PURE functions — they receive data as parameters and return results.
// Do NOT read from global state. Components call these and display the output.
// WARNING: Do not simplify the double-entry logic. It is correct and tested.

export function generateTrialBalance(journalEntries, chartOfAccounts) {
  const accounts = {};
  (chartOfAccounts || []).forEach(acc => {
    accounts[acc.code] = { code: acc.code, name: acc.name, type: acc.type, totalDr: 0, totalCr: 0 };
  });
  (journalEntries || []).forEach(je => {
    (je.lines || []).forEach(line => {
      if (!accounts[line.account]) {
        accounts[line.account] = { code: line.account, name: line.accountName || line.account, type: 'Unknown', totalDr: 0, totalCr: 0 };
      }
      accounts[line.account].totalDr += Number(line.debit) || 0;
      accounts[line.account].totalCr += Number(line.credit) || 0;
    });
  });
  const rows = Object.values(accounts).map(a => ({
    ...a,
    balance: a.totalDr - a.totalCr,
  }));
  const totalDr = rows.reduce((s, r) => s + r.totalDr, 0);
  const totalCr = rows.reduce((s, r) => s + r.totalCr, 0);
  return { rows, totalDr, totalCr, balanced: Math.abs(totalDr - totalCr) < 0.01 };
}

export function generateProfitAndLoss(journalEntries, chartOfAccounts) {
  const tb = generateTrialBalance(journalEntries, chartOfAccounts);
  const revenue = tb.rows.filter(r => r.type === 'Revenue').map(r => ({ ...r, balance: r.totalCr - r.totalDr }));
  const expenses = tb.rows.filter(r => r.type === 'Expense').map(r => ({ ...r, balance: r.totalDr - r.totalCr }));
  const totalRevenue = revenue.reduce((s, r) => s + r.balance, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.balance, 0);
  const netProfit = totalRevenue - totalExpenses;
  return { revenue, expenses, totalRevenue, totalExpenses, netProfit };
}

export function generateBalanceSheet(journalEntries, chartOfAccounts) {
  const tb = generateTrialBalance(journalEntries, chartOfAccounts);
  const assets      = tb.rows.filter(r => r.type === 'Asset').map(r => ({ ...r, balance: r.totalDr - r.totalCr }));
  const liabilities = tb.rows.filter(r => r.type === 'Liability').map(r => ({ ...r, balance: r.totalCr - r.totalDr }));
  const equity      = tb.rows.filter(r => r.type === 'Equity').map(r => ({ ...r, balance: r.totalCr - r.totalDr }));
  const { netProfit } = generateProfitAndLoss(journalEntries, chartOfAccounts);
  const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
  const totalEquity = equity.reduce((s, r) => s + r.balance, 0) + netProfit;
  return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, netProfit };
}

export function generateCashFlow(journalEntries, chartOfAccounts) {
  // Simplified cash flow — classifies by account type
  const cashAccounts = (chartOfAccounts || []).filter(a => a.type === 'Asset' && /cash|bank/i.test(a.name)).map(a => a.code);
  const operating = [], investing = [], financing = [];
  (journalEntries || []).forEach(je => {
    (je.lines || []).forEach(line => {
      if (!cashAccounts.includes(line.account)) return;
      const entry = { date: je.date, description: je.description, amount: (Number(line.debit) || 0) - (Number(line.credit) || 0) };
      if (/salary|payroll|revenue|sales|expense/i.test(je.description)) operating.push(entry);
      else if (/asset|equipment|vehicle/i.test(je.description)) investing.push(entry);
      else financing.push(entry);
    });
  });
  const sum = arr => arr.reduce((s, e) => s + e.amount, 0);
  return { operating, investing, financing, netOperating: sum(operating), netInvesting: sum(investing), netFinancing: sum(financing) };
}

export function generateVATSummary(journalEntries, invoices, procurements, vatAdjustments = []) {
  const outputVAT = (invoices || []).filter(i => i.status === 'Paid').reduce((s, i) => s + (Number(i.vatAmount) || (Number(i.amount) || 0) * 0.075), 0);
  const inputVAT  = (procurements || []).filter(p => p.vatAmount).reduce((s, p) => s + (Number(p.vatAmount) || 0), 0);
  const adjustments = (vatAdjustments || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const vatPayable = outputVAT - inputVAT + adjustments;
  return { outputVAT, inputVAT, adjustments, vatPayable };
}

export function validateJournalEntry(lines) {
  const totalDr = (lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCr = (lines || []).reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return { valid: Math.abs(totalDr - totalCr) < 0.01, totalDr, totalCr, diff: totalDr - totalCr };
}

export function calculateDepreciation(asset) {
  const cost = Number(asset.cost) || 0;
  const residual = Number(asset.residualValue) || 0;
  const life = Number(asset.usefulLife) || 5;
  const yearsOwned = asset.purchaseDate
    ? Math.max(0, (new Date() - new Date(asset.purchaseDate)) / (365.25 * 24 * 3600 * 1000))
    : 0;

  if (asset.depreciationMethod === 'reducing') {
    const rate = 1 - Math.pow(residual / cost, 1 / life);
    const accumDepr = cost * (1 - Math.pow(1 - rate, yearsOwned));
    const nbv = cost - accumDepr;
    const annualCharge = nbv * rate;
    return { accumDepr, nbv: Math.max(nbv, residual), annualCharge };
  }
  // Default: straight-line
  const annualCharge = (cost - residual) / life;
  const accumDepr = Math.min(annualCharge * yearsOwned, cost - residual);
  const nbv = cost - accumDepr;
  return { accumDepr, nbv: Math.max(nbv, residual), annualCharge };
}

export function autoPostInvoice(invoice) {
  return {
    id: 'je_inv_' + invoice.id,
    date: invoice.paidDate || new Date().toISOString(),
    description: 'Invoice paid: ' + invoice.invoiceNo + ' — ' + invoice.client,
    source: 'auto',
    lines: [
      { account: '1001', accountName: 'Bank / Cash', debit: Number(invoice.amount) || 0, credit: 0 },
      { account: '1100', accountName: 'Accounts Receivable', debit: 0, credit: Number(invoice.amount) || 0 },
    ],
  };
}

export function autoPostProcurement(po) {
  return {
    id: 'je_po_' + po.id,
    date: po.date || new Date().toISOString(),
    description: 'PO raised: ' + po.poNumber + ' — ' + po.supplier,
    source: 'auto',
    lines: [
      { account: '5100', accountName: 'Procurement Expense', debit: Number(po.amount) || 0, credit: 0 },
      { account: '2001', accountName: 'Accounts Payable', debit: 0, credit: Number(po.amount) || 0 },
    ],
  };
}

export function autoPostPayroll(payrollTotal, period) {
  return {
    id: 'je_pay_' + Date.now(),
    date: new Date().toISOString(),
    description: 'Payroll: ' + (period || new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })),
    source: 'auto',
    lines: [
      { account: '5001', accountName: 'Salary Expense', debit: payrollTotal, credit: 0 },
      { account: '1001', accountName: 'Bank / Cash', debit: 0, credit: payrollTotal },
    ],
  };
}

export const DEFAULT_COA = [
  { code: '1001', name: 'Bank / Cash', type: 'Asset',     openingBalance: 0 },
  { code: '1100', name: 'Accounts Receivable', type: 'Asset', openingBalance: 0 },
  { code: '1200', name: 'Inventory',   type: 'Asset',     openingBalance: 0 },
  { code: '1500', name: 'Fixed Assets',type: 'Asset',     openingBalance: 0 },
  { code: '2001', name: 'Accounts Payable', type: 'Liability', openingBalance: 0 },
  { code: '2100', name: 'VAT Payable', type: 'Liability', openingBalance: 0 },
  { code: '2200', name: 'WHT Payable', type: 'Liability', openingBalance: 0 },
  { code: '3001', name: 'Share Capital', type: 'Equity',  openingBalance: 0 },
  { code: '3100', name: 'Retained Earnings', type: 'Equity', openingBalance: 0 },
  { code: '4001', name: 'Service Revenue', type: 'Revenue', openingBalance: 0 },
  { code: '4100', name: 'Contract Revenue', type: 'Revenue', openingBalance: 0 },
  { code: '5001', name: 'Salary Expense', type: 'Expense', openingBalance: 0 },
  { code: '5100', name: 'Procurement Expense', type: 'Expense', openingBalance: 0 },
  { code: '5200', name: 'Overhead Expense', type: 'Expense', openingBalance: 0 },
  { code: '5300', name: 'Petty Cash Expense', type: 'Expense', openingBalance: 0 },
];
