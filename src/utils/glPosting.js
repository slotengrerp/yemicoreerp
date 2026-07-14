// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — GL Auto-Posting Utilities v1.0
//
// Pure functions that convert AP/AR records into double-entry journal entries
// in the exact format Accounting.jsx expects. Accounting.jsx watches
// appState.db.invoices / appState.db.arReceipts / appState.db.ap via a
// useEffect and calls these functions to auto-post — so AP/AR modules never
// have to know about journal formats, and the Accounting module stays as the
// single source of truth for the General Ledger.
//
// COA ACCOUNT MAP (must match DEFAULT_COA in Accounting.jsx exactly):
//   6002 — Trade Receivables          (Current Asset, Dr normal)
//   6006 — Input VAT                  (Current Asset, Dr normal)
//   6007 — WHT Receivable             (Current Asset, Dr normal)
//   7001 — Trade Payables             (Current Liability, Cr normal)
//   5011 — Sales VAT Payable          (Current Liability, Cr normal)
//   5012 — WHT Payable                (Current Liability, Cr normal)
//   5015 — NCDF Payable               (Current Liability, Cr normal)
//   4001 — Manpower Income            (Revenue, Cr normal)
//   4002 — Procurement Income         (Revenue, Cr normal)
//   4003 — Engineering Services Income(Revenue, Cr normal)
//   4005 — Logistics Income (Flopeng) (Revenue, Cr normal)
//   4500 — Other Income               (Revenue, Cr normal)
//   8001 — Direct Cost — Salaries     (CoS Expense, Dr normal)
//   8003 — Other Direct Cost          (CoS Expense, Dr normal)
//   8004 — Direct Cost — Materials    (CoS Expense, Dr normal)
//   8005 — Carriage Inward/Transport  (CoS Expense, Dr normal)
//   9014 — General Repairs & Maint.   (Admin Expense, Dr normal)
// ══════════════════════════════════════════════════════════════════════════════

import { BANK_ACCOUNTS } from './financeConstants';

// ── Named account constants ───────────────────────────────────────────────────
const A = {
  TRADE_RECEIVABLES: { code: '6002', name: 'Trade Receivables' },
  TRADE_PAYABLES:    { code: '7001', name: 'Trade Payables' },
  WHT_RECEIVABLE:    { code: '6007', name: 'Withholding Tax Receivable' },
  INPUT_VAT:         { code: '6006', name: 'Input VAT' },
  SALES_VAT_PAYABLE: { code: '5011', name: 'Sales VAT Payable' },
  WHT_PAYABLE:       { code: '5012', name: 'Withholding Tax Payable' },
  NCDF_PAYABLE:      { code: '5015', name: 'Nigerian Content Development Fund' },
};

// ── AR category → income COA account ─────────────────────────────────────────
export const AR_INCOME_MAP = {
  'Engineering Services': { code: '4003', name: 'Engineering Services Income' },
  'Procurement Services': { code: '4002', name: 'Procurement Income' },
  'Logistics':            { code: '4005', name: 'Logistics Income (Flopeng)' },
  'Consultancy':          { code: '4003', name: 'Engineering Services Income' },
  'Maintenance':          { code: '4003', name: 'Engineering Services Income' },
  'Project Management':   { code: '4001', name: 'Manpower Income' },
  'Equipment Supply':     { code: '4002', name: 'Procurement Income' },
  'Labour Supply':        { code: '4001', name: 'Manpower Income' },
  'Other':                { code: '4500', name: 'Other Income' },
};
const DEFAULT_INCOME  = { code: '4003', name: 'Engineering Services Income' };

// ── AP category → expense COA account ────────────────────────────────────────
export const AP_EXPENSE_MAP = {
  'Materials':    { code: '8004', name: 'Direct Cost — Materials Purchases' },
  'Services':     { code: '8003', name: 'Other Direct Cost' },
  'Logistics':    { code: '8005', name: 'Carriage Inward / Transport Expenses' },
  'Labour':       { code: '8001', name: 'Direct Cost — Salaries & Wages' },
  'Maintenance':  { code: '9014', name: 'General Repairs & Maintenance' },
  'Other':        { code: '8003', name: 'Other Direct Cost' },
};
const DEFAULT_EXPENSE = { code: '8003', name: 'Other Direct Cost' };

// ── Petty Cash category → expense COA account (matches real Sage COA) ──────
export const PETTYCASH_EXPENSE_MAP = {
  'Stationery':             { code: '9010', name: 'Printing and Stationeries' },
  'Office Supplies':        { code: '9021', name: 'Office Consumables' },
  'Transportation':         { code: '9005', name: 'Transport & Travelling/Accommodation Expenses' },
  'Fuel':                   { code: '9013', name: 'Diesel & Fuelling' },
  'Meals & Entertainment':  { code: '9029', name: 'Feeding/Entertainment Expenses' },
  'Utilities':              { code: '9557', name: 'PHED/Electricity Bills' },
  'Maintenance & Repairs':  { code: '9014', name: 'General Repairs and Maintenance Expenses' },
  'Medical':                { code: '9017', name: 'Medical Expenses' },
  'Communication':          { code: '9009', name: 'Communication & Subscriptions/IT Expenses' },
  'Miscellaneous':          { code: '9021', name: 'Office Consumables' },
};
const DEFAULT_PC_EXPENSE = { code: '9021', name: 'Office Consumables' };
const IMPREST_CASH       = { code: '3001', name: 'Imprest Cash' };

// ── Fixed Asset category → PP&E COA account (matches real Sage COA 2000-2005) ──
export const FIXEDASSET_CATEGORY_MAP = {
  'Land':               { code: '2000', name: 'Land' },
  'Building':           { code: '2001', name: 'Building' },
  'Plant & Equipment':  { code: '2002', name: 'Plant/Machineries' },
  'Motor Vehicle':      { code: '2003', name: 'Motor Vehicle' },
  'Office Equipment':   { code: '2004', name: 'Office and Safety Equipments' },
  'IT Equipment':       { code: '2004', name: 'Office and Safety Equipments' },
  'Furniture & Fittings': { code: '2005', name: 'Furnitures/Fittings/Caravans' },
};
const DEFAULT_ASSET_ACCT = { code: '2004', name: 'Office and Safety Equipments' };
// Funding source (cash vs. supplier credit) isn't captured on the asset record
// itself, so the capitalization entry credits Suspense rather than guessing —
// the accountant clears it against Cash/Bank or AP during reconciliation.
const CAPEX_SUSPENSE = { code: '3019', name: 'Transit / Suspense Account' };

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Convert a foreign-currency amount to NGN using the given rate. */
function toNGN(fcAmt, fxRate) {
  return Math.round((Number(fcAmt) || 0) * (Number(fxRate) || 1));
}

/**
 * Build one journal line (a single balanced Dr/Cr pair).
 * amount is ALWAYS in NGN. currency/fxRate/fcAmount carry the foreign-currency
 * view that the Accounting module uses for its native-currency bank reports.
 */
function jLine(drCode, drName, crCode, crName, ngnAmount, currency = 'NGN', fxRate = 1, fcAmount = null, memo = '') {
  const amt = Math.round(Math.abs(ngnAmount));
  return {
    drCode, drName,
    crCode, crName,
    amount:   amt,
    currency: currency || 'NGN',
    fxRate:   Number(fxRate) || 1,
    fcAmount: fcAmount != null ? Math.abs(Number(fcAmount)) : amt,
    memo,
  };
}

/** Look up a bank account by code from the shared list. */
function bankAcct(code, name) {
  const found = BANK_ACCOUNTS.find(b => b.code === code);
  return found ? { code: found.code, name: found.name } : { code: code || '3003', name: name || 'Bank Account' };
}

// ══════════════════════════════════════════════════════════════════════════════
// AR INVOICE — Raise Invoice
// ══════════════════════════════════════════════════════════════════════════════
//
// When SLOT raises an invoice, the accounting is:
//   Dr Trade Receivables (6002)         subtotal × fxRate    ← revenue earned
//   Dr Trade Receivables (6002)         vatAmt × fxRate      ← VAT collected on behalf of FIRS
//   Dr WHT Receivable    (6007)         whtAmt × fxRate      ← WHT customer will retain (our tax credit)
//   Dr NCDF Payable      (5015)         ncdfAmt × fxRate     ← NCDF customer pays on our behalf
//   Cr Revenue Account   (4xxx)         subtotal × fxRate
//   Cr Sales VAT Payable (5011)         vatAmt × fxRate
//   Cr Trade Receivables (6002)         whtAmt × fxRate      ← reduces the receivable (customer won't pay this)
//   Cr Trade Receivables (6002)         ncdfAmt × fxRate     ← reduces the receivable
//
// Net Trade Receivables = subtotal + vatAmt - whtAmt - ncdfAmt = netPayable ✓
//
export function journalFromInvoice(inv) {
  const cur    = inv.currency || 'NGN';
  const rate   = Number(inv.fxRate) || 1;
  const incAct = AR_INCOME_MAP[inv.category] || DEFAULT_INCOME;

  const subtotal = Number(inv.subtotal)   || 0;
  const vatAmt   = Number(inv.vatAmount)  || 0;
  const whtAmt   = Number(inv.whtAmount)  || 0;
  const ncdfAmt  = Number(inv.ncdfAmount) || 0;

  const lines = [
    // Line 1 — Revenue: Dr Trade Receivables / Cr Revenue Account (subtotal)
    jLine(
      A.TRADE_RECEIVABLES.code, A.TRADE_RECEIVABLES.name,
      incAct.code, incAct.name,
      toNGN(subtotal, rate), cur, rate, subtotal,
      `Revenue — ${inv.invoiceNo}`,
    ),
    // Line 2 — VAT: Dr Trade Receivables / Cr Sales VAT Payable
    ...(vatAmt > 0 ? [jLine(
      A.TRADE_RECEIVABLES.code, A.TRADE_RECEIVABLES.name,
      A.SALES_VAT_PAYABLE.code, A.SALES_VAT_PAYABLE.name,
      toNGN(vatAmt, rate), cur, rate, vatAmt,
      `Output VAT 7.5% — ${inv.invoiceNo}`,
    )] : []),
    // Line 3 — WHT retained by customer: Dr WHT Receivable / Cr Trade Receivables
    ...(whtAmt > 0 ? [jLine(
      A.WHT_RECEIVABLE.code, A.WHT_RECEIVABLE.name,
      A.TRADE_RECEIVABLES.code, A.TRADE_RECEIVABLES.name,
      toNGN(whtAmt, rate), cur, rate, whtAmt,
      `WHT ${inv.whtRate || 5}% — ${inv.invoiceNo}`,
    )] : []),
    // Line 4 — NCDF retained by customer: Dr NCDF Payable / Cr Trade Receivables
    ...(ncdfAmt > 0 ? [jLine(
      A.NCDF_PAYABLE.code, A.NCDF_PAYABLE.name,
      A.TRADE_RECEIVABLES.code, A.TRADE_RECEIVABLES.name,
      toNGN(ncdfAmt, rate), cur, rate, ncdfAmt,
      `NCDF ${inv.ncdfRate || 1}% — ${inv.invoiceNo}`,
    )] : []),
  ];

  return {
    id:          `JE-AR-INV-${inv.id}`,
    date:        inv.date || new Date().toISOString().split('T')[0],
    ref:         inv.invoiceNo,
    description: `Invoice: ${inv.invoiceNo} — ${inv.client}`,
    source:      'ar',
    sourceId:    inv.id,
    lines,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// AR RECEIPT — Cash collected from customer
// ══════════════════════════════════════════════════════════════════════════════
//
// When cash arrives:
//   Dr Bank Account      (3xxx)   amountReceived × fxRate   ← cash in bank
//   Dr WHT Receivable    (6007)   extraWht × fxRate          ← additional WHT (per remittance advice)
//   Dr NCDF Payable      (5015)   extraNcdf × fxRate         ← NCDF paid by customer on our behalf
//   Cr Trade Receivables (6002)   total applied              ← clears the receivable
//
export function journalFromReceipt(receipt) {
  const cur     = receipt.currency || 'NGN';
  const rate    = Number(receipt.fxRate) || 1;
  const bank    = bankAcct(receipt.bankCode, receipt.bankName);

  const cash     = Number(receipt.amountReceived) || 0;
  const extraWht = Number(receipt.extraWht)        || 0;
  const extraNcdf= Number(receipt.extraNcdf)       || 0;

  const lines = [
    // Cash received → Dr Bank / Cr Trade Receivables
    jLine(
      bank.code, bank.name,
      A.TRADE_RECEIVABLES.code, A.TRADE_RECEIVABLES.name,
      toNGN(cash, rate), cur, rate, cash,
      `Receipt ${receipt.receiptNo} — ${receipt.client}`,
    ),
    // Additional WHT deducted by customer on remittance
    ...(extraWht > 0 ? [jLine(
      A.WHT_RECEIVABLE.code, A.WHT_RECEIVABLE.name,
      A.TRADE_RECEIVABLES.code, A.TRADE_RECEIVABLES.name,
      toNGN(extraWht, rate), cur, rate, extraWht,
      `Additional WHT deducted — ${receipt.receiptNo}`,
    )] : []),
    // Additional NCDF deducted by customer on remittance
    ...(extraNcdf > 0 ? [jLine(
      A.NCDF_PAYABLE.code, A.NCDF_PAYABLE.name,
      A.TRADE_RECEIVABLES.code, A.TRADE_RECEIVABLES.name,
      toNGN(extraNcdf, rate), cur, rate, extraNcdf,
      `Additional NCDF deducted — ${receipt.receiptNo}`,
    )] : []),
  ];

  return {
    id:          `JE-AR-REC-${receipt.id}`,
    date:        receipt.date || new Date().toISOString().split('T')[0],
    ref:         receipt.receiptNo,
    description: `Receipt: ${receipt.receiptNo} — ${receipt.client}`,
    source:      'ar',
    sourceId:    receipt.id,
    lines,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// AP BILL — Supplier invoice received
// ══════════════════════════════════════════════════════════════════════════════
//
//   Dr Expense Account   (8xxx)   amount × fxRate       ← cost incurred
//   Dr Input VAT         (6006)   vatAmt × fxRate        ← recoverable VAT
//   Cr Trade Payables    (7001)   (amount + vatAmt) × fxRate  ← gross liability
//   Dr Trade Payables    (7001)   whtAmt × fxRate        ← WHT we retain from vendor
//   Cr WHT Payable       (5012)   whtAmt × fxRate        ← we'll remit this to FIRS
//
// Net Trade Payables = amount + vatAmt - whtAmt = netPayable ✓
//
export function journalFromAPBill(bill) {
  const cur     = bill.currency || 'NGN';
  const rate    = Number(bill.fxRate) || 1;
  const expAcct = AP_EXPENSE_MAP[bill.category] || DEFAULT_EXPENSE;

  const amount  = Number(bill.amount)    || 0;
  const vatAmt  = Number(bill.vatAmount) || 0;
  const whtAmt  = Number(bill.whtAmount) || 0;

  const lines = [
    // Line 1 — Expense: Dr Expense / Cr Trade Payables
    jLine(
      expAcct.code, expAcct.name,
      A.TRADE_PAYABLES.code, A.TRADE_PAYABLES.name,
      toNGN(amount, rate), cur, rate, amount,
      `Bill ${bill.billNo} — ${bill.vendorName}`,
    ),
    // Line 2 — Input VAT: Dr Input VAT / Cr Trade Payables
    ...(vatAmt > 0 ? [jLine(
      A.INPUT_VAT.code, A.INPUT_VAT.name,
      A.TRADE_PAYABLES.code, A.TRADE_PAYABLES.name,
      toNGN(vatAmt, rate), cur, rate, vatAmt,
      `Input VAT 7.5% — ${bill.billNo}`,
    )] : []),
    // Line 3 — WHT retained: Dr Trade Payables / Cr WHT Payable
    ...(whtAmt > 0 ? [jLine(
      A.TRADE_PAYABLES.code, A.TRADE_PAYABLES.name,
      A.WHT_PAYABLE.code, A.WHT_PAYABLE.name,
      toNGN(whtAmt, rate), cur, rate, whtAmt,
      `WHT ${bill.whtRate || 5}% retained — ${bill.billNo}`,
    )] : []),
  ];

  return {
    id:          `JE-AP-BILL-${bill.id}`,
    date:        bill.date || new Date().toISOString().split('T')[0],
    ref:         bill.billNo,
    description: `AP Bill: ${bill.billNo} — ${bill.vendorName}`,
    source:      'ap',
    sourceId:    bill.id,
    lines,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// AP PAYMENT — Cash paid to supplier
// ══════════════════════════════════════════════════════════════════════════════
//
//   Dr Trade Payables (7001)   payment × fxRate   ← clears the liability
//   Cr Bank Account   (3xxx)   payment × fxRate   ← cash leaves the bank
//
// ══════════════════════════════════════════════════════════════════════════════
// TERMINAL OPERATIONS — Clearing & terminal charges
// ══════════════════════════════════════════════════════════════════════════════
//
//   Dr Direct Cost — Clearing/Duties (8002)   totalAmount   ← cost incurred
//   Cr Bank Account                           totalAmount   ← paid out
//
// Only posts once `paymentDate` is set — an unpaid charge is a commitment,
// not yet a confirmed cash movement, same principle as Petty Cash only
// posting Approved vouchers. No separate "unpaid" liability leg is created
// here (unlike AP bills) because this module doesn't track these clearing
// agents as proper AP sub-ledger suppliers — if that ever changes, this
// should be rebuilt on the AP bill/payment pattern instead.
//
// Tagged source:'terminal' (not 'ar'/'ap'/etc.) so Terminal Ops' entries can
// be identified and pulled out cleanly later if/when Terminal Operations
// gets its own separate set of books — this doesn't build that separation
// itself, it just avoids making it harder to do later.
export function journalFromTerminalCharge(charge) {
  const amt  = Number(charge.totalAmount) || 0;
  const bank = bankAcct(charge.bankCode, charge.bankName);

  return {
    id:          `JE-TERM-${charge.id}`,
    date:        charge.paymentDate || charge.arrivalDate || new Date().toISOString().split('T')[0],
    ref:         charge.receiptNo || charge.containerNo,
    description: `Terminal/Clearing Charges: ${charge.containerNo} — ${charge.agentName}`,
    source:      'terminal',
    sourceId:    charge.id,
    lines: [
      jLine(
        '8002', 'Direct Cost — Clearing / Duties',
        bank.code, bank.name,
        amt, 'NGN', 1, amt,
        `Equipment ₦${Number(charge.equipmentCharge)||0} + Terminal ₦${Number(charge.terminalCharge)||0} + Storage ₦${Number(charge.storageCharge)||0} — ${charge.agentName}`,
      ),
    ],
  };
}

// ── Payroll liability accounts: Staff (SLOT/Company) vs Manpower (Contract) ──
// The real Sage COA already splits these by staff type — not something this
// app invented, it's just not been posted to until now.
const PAYROLL_ACCTS = {
  Company:  { netSalary: { code:'5001', name:'Staff Net Salary Payable' },
              paye:      { code:'5003', name:'Staff PAYE Payable' },
              pension:   { code:'5006', name:'Staff Pension Payable' } },
  Contract: { netSalary: { code:'5002', name:'Manpower Net Salary Payable' },
              paye:      { code:'5004', name:'Manpower PAYE Payable' },
              pension:   { code:'5008', name:'Manpower Pension Payable' } },
};
const NHF_PAYABLE     = { code: '5010', name: 'NHF Payable' };
const OTHER_ACCRUED   = { code: '5009', name: 'Other Accrued Expenses' };
const SALARY_EXPENSE  = { code: '8001', name: 'Direct Cost — Salaries & Wages' };

// ══════════════════════════════════════════════════════════════════════════════
// PAYROLL RUN — Recognize the expense (accrual)
// ══════════════════════════════════════════════════════════════════════════════
//
//   Dr Direct Cost — Salaries & Wages (8001)     totalGross
//   Cr {Staff/Manpower} PAYE Payable              totalPAYE
//   Cr {Staff/Manpower} Pension Payable           totalPension
//   Cr NHF Payable                                totalNHF        (Company staff only)
//   Cr Other Accrued Expenses                     totalOtherDeductions
//   Cr {Staff/Manpower} Net Salary Payable        totalNetPay     ← owed, not yet paid
//
// This recognizes the cost and every withholding the moment payroll is run,
// whether or not staff have actually been paid yet — same accrual principle
// as an AP bill. journalFromPayrollPayment (below) is the second step that
// clears Net Salary Payable once the money actually goes out.
export function journalFromPayrollRun(run) {
  const accts = PAYROLL_ACCTS[run.staffType] || PAYROLL_ACCTS.Company;
  const gross = Number(run.totalGross) || 0;
  const paye  = Number(run.totalPAYE) || 0;
  const pension = Number(run.totalPension) || 0;
  const nhf   = Number(run.totalNHF) || 0;
  const other = Number(run.totalOtherDeductions) || 0;
  const net   = Number(run.totalNetPay) || 0;

  const lines = [
    jLine(SALARY_EXPENSE.code, SALARY_EXPENSE.name, accts.paye.code, accts.paye.name, paye, 'NGN', 1, paye, `${run.staffType} PAYE — ${run.periodLabel}`),
    jLine(SALARY_EXPENSE.code, SALARY_EXPENSE.name, accts.pension.code, accts.pension.name, pension, 'NGN', 1, pension, `${run.staffType} pension — ${run.periodLabel}`),
  ];
  if (nhf > 0)   lines.push(jLine(SALARY_EXPENSE.code, SALARY_EXPENSE.name, NHF_PAYABLE.code, NHF_PAYABLE.name, nhf, 'NGN', 1, nhf, `NHF — ${run.periodLabel}`));
  if (other > 0) lines.push(jLine(SALARY_EXPENSE.code, SALARY_EXPENSE.name, OTHER_ACCRUED.code, OTHER_ACCRUED.name, other, 'NGN', 1, other, `Other deductions (advances/loans/voluntary pension) — ${run.periodLabel}`));
  lines.push(jLine(SALARY_EXPENSE.code, SALARY_EXPENSE.name, accts.netSalary.code, accts.netSalary.name, net, 'NGN', 1, net, `Net pay owed to ${run.staffType.toLowerCase()} staff — ${run.periodLabel}`));

  return {
    id:          `JE-PR-${run.id}`,
    date:        run.runDate || new Date().toISOString().split('T')[0],
    ref:         run.periodLabel,
    description: `Payroll Run: ${run.staffType} Staff — ${run.periodLabel} (${run.lines?.length || 0} staff)`,
    source:      'payroll',
    sourceId:    run.id,
    lines,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PAYROLL PAYMENT — Disbursement (clears the liability)
// ══════════════════════════════════════════════════════════════════════════════
//
//   Dr {Staff/Manpower} Net Salary Payable   totalNetPay
//   Cr Bank Account                          totalNetPay
//
// Only posts once a run has actually been marked paid — same principle as
// an AP payment clearing Trade Payables.
export function journalFromPayrollPayment(run) {
  const accts = PAYROLL_ACCTS[run.staffType] || PAYROLL_ACCTS.Company;
  const net   = Number(run.totalNetPay) || 0;
  const bank  = bankAcct(run.bankCode, run.bankName);

  return {
    id:          `JE-PR-PAY-${run.id}`,
    date:        run.paymentDate || new Date().toISOString().split('T')[0],
    ref:         run.periodLabel,
    description: `Salary Payment: ${run.staffType} Staff — ${run.periodLabel}`,
    source:      'payroll',
    sourceId:    run.id,
    lines: [
      jLine(accts.netSalary.code, accts.netSalary.name, bank.code, bank.name, net, 'NGN', 1, net, `Net salaries paid — ${run.periodLabel}`),
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// FLEET MAINTENANCE — Vehicle repair cost
// ══════════════════════════════════════════════════════════════════════════════
//
//   Dr Repairs & Maintenance — Motor Vehicle (9556)   amount
//   Cr Bank Account                                   amount
//
// Only posts once explicitly marked posted (same review-gate pattern as
// Petty Cash and Terminal Ops charges) — repairs are often entered before
// the mechanic has actually been paid.
export function journalFromFleetRepair(repair) {
  const amt  = Number(repair.amount) || 0;
  const bank = bankAcct(repair.bankCode, repair.bankName);

  return {
    id:          `JE-FLEET-${repair.id}`,
    date:        repair.date || new Date().toISOString().split('T')[0],
    ref:         repair.vehicleNo,
    description: `Vehicle Repair: ${repair.vehicleNo} — ${repair.natureOfRepairs}`,
    source:      'fleet',
    sourceId:    repair.id,
    lines: [
      jLine(
        '9556', 'Repairs & Maintenance — Motor Vehicle',
        bank.code, bank.name,
        amt, 'NGN', 1, amt,
        `Parts ₦${Number(repair.costOfParts)||0} + Labour ₦${Number(repair.costOfLabour)||0} — ${repair.mechanic}`,
      ),
    ],
  };
}

export function journalFromAPPayment(payment) {
  const cur  = payment.currency || 'NGN';
  const rate = Number(payment.fxRate) || 1;
  const bank = bankAcct(payment.bankCode, payment.bankName);
  const amt  = Number(payment.amount) || 0;

  return {
    id:          `JE-AP-PAY-${payment.id}`,
    date:        payment.date || new Date().toISOString().split('T')[0],
    ref:         payment.paymentNo,
    description: `AP Payment: ${payment.paymentNo} — ${payment.vendorName}`,
    source:      'ap',
    sourceId:    payment.id,
    lines: [
      jLine(
        A.TRADE_PAYABLES.code, A.TRADE_PAYABLES.name,
        bank.code, bank.name,
        toNGN(amt, rate), cur, rate, amt,
        `Payment to ${payment.vendorName} — ${payment.paymentNo}`,
      ),
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PETTY CASH — Approved disbursement
// ══════════════════════════════════════════════════════════════════════════════
//
//   Dr {category expense account}   amount   ← expense incurred
//   Cr Imprest Cash          (3001) amount   ← cash leaves the imprest float
//
// Only Approved vouchers are posted — Pending/Rejected vouchers never moved
// real cash, so they shouldn't touch the GL.
export function journalFromPettyCash(pc) {
  const expAcct = PETTYCASH_EXPENSE_MAP[pc.category] || DEFAULT_PC_EXPENSE;
  const amt = Number(pc.amount) || 0;

  return {
    id:          `JE-PC-${pc.id}`,
    date:        pc.date || new Date().toISOString().split('T')[0],
    ref:         pc.voucherNo,
    description: `Petty Cash: ${pc.voucherNo} — ${pc.payee}`,
    source:      'pettycash',
    sourceId:    pc.id,
    lines: [
      jLine(
        expAcct.code, expAcct.name,
        IMPREST_CASH.code, IMPREST_CASH.name,
        amt, 'NGN', 1, amt,
        `${pc.category} — ${pc.description || pc.payee}`,
      ),
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// FIXED ASSET — Capitalization (initial purchase)
// ══════════════════════════════════════════════════════════════════════════════
//
//   Dr {category PP&E account}      cost   ← asset added to the register
//   Cr Transit / Suspense (3019)    cost   ← funding source not captured on
//                                            the asset record; accountant
//                                            reclassifies to Cash/Bank or AP
//                                            during reconciliation
//
// NOTE: this posts the CAPITALIZATION entry only. Ongoing depreciation
// (Dr Depreciation Expense 9001 / Cr Accumulated Depreciation, period by
// period) is a separate, larger scheduling problem — not built here. The
// Fixed Assets register's own NBV calculation (cost, useful life, purchase
// date) still works for on-screen reporting; it just doesn't yet post
// monthly depreciation journals to the GL.
export function journalFromFixedAsset(asset) {
  const acct = FIXEDASSET_CATEGORY_MAP[asset.category] || DEFAULT_ASSET_ACCT;
  const cost = Number(asset.cost) || 0;

  return {
    id:          `JE-FA-${asset.id}`,
    date:        asset.purchaseDate || new Date().toISOString().split('T')[0],
    ref:         asset.assetTag,
    description: `Fixed Asset Capitalization: ${asset.assetTag} — ${asset.description}`,
    source:      'fixedassets',
    sourceId:    asset.id,
    lines: [
      jLine(
        acct.code, acct.name,
        CAPEX_SUSPENSE.code, CAPEX_SUSPENSE.name,
        cost, 'NGN', 1, cost,
        `Capitalized — reclassify funding source in Bank Rec / AP — ${asset.assetTag}`,
      ),
    ],
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// REVERSAL — Void a previously-posted entry
// ══════════════════════════════════════════════════════════════════════════════
//
// Source records (invoices, petty cash vouchers, fixed assets) should never
// be hard-deleted once they've hit the GL — that silently leaves the GL
// overstated with no audit trail. Instead, the source module marks the
// record voided/cancelled and keeps it; this builds the mirror-image entry
// (every Dr/Cr flipped) so the net GL effect nets to zero while both the
// original and the reversal stay fully visible in the Journal.
export function reverseJournal(je, reason = 'Record voided') {
  if (!je || !je.lines) return null;
  return {
    ...je,
    id:          `${je.id}-REV`,
    date:        new Date().toISOString().split('T')[0],
    description: `REVERSAL — ${je.description} (${reason})`,
    lines: je.lines.map(l => ({
      ...l,
      drCode: l.crCode, drName: l.crName,
      crCode: l.drCode, crName: l.drName,
    })),
  };
}
