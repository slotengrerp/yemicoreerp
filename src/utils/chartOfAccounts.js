// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Chart of Accounts (single source of truth)
//
// This is the REAL chart of accounts — sourced from the company's actual Sage
// export ("CURRENT General Ledger Chart of Accounts_20260529_123438.xlsx"),
// with real bank accounts and opening balances. It used to be defined inline
// in Accounting.jsx (as a local `const DEFAULT_COA`); it's pulled out here so
// glPosting.js (which posts journal entries against these exact codes) can
// import and validate against the same list instead of keeping its account
// codes in sync with Accounting.jsx by comment convention only.
//
// A separate, much smaller `DEFAULT_COA` used to also exist in
// utils/accounting.js — that file was dead code (its report-generation
// functions were superseded by live equivalents inside Accounting.jsx, e.g.
// getTrialBalance()/getBalanceSheet()) and has been removed. This file is
// the only chart of accounts in the codebase now.
//
// Fixes applied when this was extracted from Accounting.jsx (2026-07-23 audit):
//   - Code 5010 was assigned to two different accounts ("NHF Payable" and
//     "Purchase Accrual"). glPosting.js's NHF_PAYABLE constant already used
//     5010, so NHF Payable keeps it; Purchase Accrual has been renumbered to
//     5013 (previously unused).
//   - Codes 2000-2005 (Land, Building, Plant/Machinery, Motor Vehicle, Office
//     Equipment, Furniture) were each defined twice — once with Cost /
//     Accumulated-Depreciation sub-accounts (200101/200102, 200201/200202,
//     etc. — which glPosting.js's FIXEDASSET_ACCUMDEP_MAP depends on), and
//     once as a flatter duplicate added later under a "matches Sage COA
//     2000-2005" comment. The flat duplicates have been dropped; the
//     detailed versions (with the sub-accounts depreciation posts to) are
//     kept.
// ══════════════════════════════════════════════════════════════════════════════

// ── SLOT Engineering Nigeria Limited — Full SAGE Chart of Accounts ─────────
// Source: CURRENT General Ledger Chart of Accounts_20260529_123438.xlsx
export const DEFAULT_COA = [
  // ── EQUITY ──────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  // OPENING BALANCES ZEROED — 2026-07-28
  // ══════════════════════════════════════════════════════════════════════════
  // Eleven accounts below carried non-zero `openingBal` values taken from the
  // company's Sage export. They were a complete and internally consistent
  // opening trial balance — assets ₦127,750,000 = liabilities ₦5,780,000 +
  // equity ₦121,970,000, balancing to the naira.
  //
  // They were zeroed on request as part of the clean-slate reset. Because they
  // lived on the accounts themselves rather than in any journal, they survived
  // the database wipe entirely and kept showing ₦82.5m of cash and ₦45.2m of
  // receivables against ledgers reading "0 txs".
  //
  // THE ORIGINAL FIGURES, so nothing is lost and the accountant can restore
  // them properly (as a dated opening journal entry, not hardcoded here):
  //     1002   Retained Earnings / Losses          121,970,000  Cr
  //     3001   Imprest Cash                            500,000  Dr
  //     3003   Access Bank (Naira 0002238013)       42,500,000  Dr
  //     3005   Zenith Bank (1011010033)             18,200,000  Dr
  //     3006   Zenith Bank (1013042537)              5,400,000  Dr
  //     3007   First Bank (2008176695)               9,800,000  Dr
  //     3009   Sterling Bank (0068919961)            1,200,000  Dr
  //     3011   UBA Bank (1015363537)                 3,300,000  Dr
  //     3017   Fidelity Bank PLC (4011553970)        1,650,000  Dr
  //     6002   Trade Receivables                    45,200,000  Dr
  //     7001   Trade Payables                        5,780,000  Cr
  //
  // Do not re-add figures here. Opening balances belong in a journal entry, so
  // they carry a date, appear in the ledger, and can be edited by an
  // accountant instead of requiring a code change and redeploy.
  // ══════════════════════════════════════════════════════════════════════════
  {code:"10001",name:"Share Capital",                              type:"Equity",   category:"Equity",             normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"1002", name:"Retained Earnings / Losses",                type:"Equity",   category:"Equity",             normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"1003", name:"Directors Loan Accounts",                   type:"Equity",   category:"Equity",             normalBal:"Cr",openingBal:0,currency:"NGN"},
  // ── PROPERTY, PLANT & EQUIPMENT ─────────────────────────────────────────
  {code:"2000", name:"Land",                                      type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"2001", name:"Building",                                  type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"200101",name:"Building — Cost",                          type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"200102",name:"Building — Accumulated Depreciation",      type:"Asset",    category:"Fixed Assets",       normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"2002", name:"Plant / Machineries",                       type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"200201",name:"Plant/Machineries — Cost",                 type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"200202",name:"Plant/Machineries — Accumulated Depreciation",type:"Asset", category:"Fixed Assets",       normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"2003", name:"Motor Vehicle",                             type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"200301",name:"Motor Vehicle — Cost",                     type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"200302",name:"Motor Vehicle — Accumulated Depreciation", type:"Asset",    category:"Fixed Assets",       normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"2004", name:"Office & Safety Equipment",                 type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"200401",name:"Office & Safety Equipment — Cost",         type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"200402",name:"Office & Safety Equipment — Accumulated Depreciation",type:"Asset",category:"Fixed Assets",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"2005", name:"Furniture / Fittings / Caravans",           type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"200501",name:"Furniture/Fittings/Caravans — Cost",       type:"Asset",    category:"Fixed Assets",       normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"200502",name:"Furniture/Fittings/Caravans — Accumulated Depreciation",type:"Asset",category:"Fixed Assets",normalBal:"Cr",openingBal:0,currency:"NGN"},
  // ── CASH & BANK ──────────────────────────────────────────────────────────
  {code:"3001", name:"Imprest Cash",                              type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3002", name:"Main Cash",                                 type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3003", name:"Access Bank (Naira A/C 0002238013)",        type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3004", name:"Access Bank (Dollar A/C 0002214695)",       type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"USD"},
  {code:"3005", name:"Zenith Bank (A/C 1011010033)",              type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3006", name:"Zenith Bank (A/C 1013042537)",              type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3007", name:"First Bank (A/C 2008176695)",               type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3008", name:"Standard Chartered Bank (A/C 0002151883)",  type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3009", name:"Sterling Bank (A/C 0068919961)",            type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3010", name:"Unity Bank (A/C 0025894154)",               type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3011", name:"UBA Bank (A/C 1015363537)",                 type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3014", name:"Stanbic IBTC Bank",                         type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3015", name:"Access Bank Euro",                          type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"EUR"},
  {code:"3016", name:"Merchant Bank (A/C 1000159983)",            type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3017", name:"Fidelity Bank PLC (A/C 4011553970)",        type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3018", name:"Access Fixed Deposits",                     type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"3019", name:"Transit / Suspense Account",                type:"Asset",    category:"Cash & Bank",        normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"2099", name:"Cumulative Translation Adjustment (CTA)",   type:"Equity",   category:"Equity",             normalBal:"Cr",openingBal:0,currency:"NGN"},
  // ── NON-CURRENT ASSETS ───────────────────────────────────────────────────
  {code:"3012", name:"Flopeng Logistics Nig. Ltd",                type:"Asset",    category:"Non-Current Assets", normalBal:"Dr",openingBal:0,currency:"NGN"},
  // ── REVENUE ──────────────────────────────────────────────────────────────
  {code:"4001", name:"Manpower Income",                           type:"Revenue",  category:"Income",             normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"4002", name:"Procurement Income",                        type:"Revenue",  category:"Income",             normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"4003", name:"Engineering Services Income",               type:"Revenue",  category:"Income",             normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"4004", name:"Packing Income",                            type:"Revenue",  category:"Income",             normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"4005", name:"Logistics Income (Flopeng)",                type:"Revenue",  category:"Income",             normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"4500", name:"Other Income",                              type:"Revenue",  category:"Other Income",        normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"4501", name:"Profit on Exchange",                        type:"Revenue",  category:"Other Income",        normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"4502", name:"Discount Received",                         type:"Revenue",  category:"Other Income",        normalBal:"Cr",openingBal:0,currency:"NGN"},
  // ── CURRENT LIABILITIES ──────────────────────────────────────────────────
  {code:"5001", name:"Staff Net Salary Payable",                  type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5002", name:"Manpower Net Salary Payable",               type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5003", name:"Staff PAYE Payable",                        type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5004", name:"Manpower PAYE Payable",                     type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5006", name:"Staff Pension Payable",                     type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5007", name:"Director's Loan Account",                   type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5008", name:"Manpower Pension Payable",                  type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5009", name:"Other Accrued Expenses",                    type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5010", name:"NHF Payable",                                type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5013", name:"Purchase Accrual",                          type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"}, // FIX: was 5010, duplicate of NHF Payable — see header note
  {code:"5011", name:"Sales VAT Payable",                         type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5012", name:"Withholding Tax Payable",                   type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5015", name:"Nigerian Content Development Fund",         type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"5016", name:"Cabotage Marine Tax",                       type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  // ── CURRENT ASSETS ───────────────────────────────────────────────────────
  {code:"3013", name:"Container Deposit",                         type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"6001", name:"Inventories",                               type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"6002", name:"Trade Receivables",                         type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"6003", name:"Other Receivables",                         type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"600301",name:"Jonjac Manpower Ltd",                      type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"600302",name:"Pejoy Procurement Ltd",                    type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"600303",name:"SLE Industrial Gas Ltd",                   type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"600304",name:"Arden Gas Ltd",                            type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"6004", name:"Work-in-Progress",                          type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"6005", name:"Recovery Account",                          type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"6006", name:"Input VAT",                                 type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"6007", name:"Withholding Tax Receivable",                type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"6008", name:"Staff Loans & Advances",                    type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"6009", name:"Inter-Company Loan",                        type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"6010", name:"AFAM Investment",                           type:"Asset",    category:"Current Assets",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  // ── TRADE PAYABLES / TAX ─────────────────────────────────────────────────
  {code:"7001", name:"Trade Payables",                            type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"7002", name:"Company Taxes Payable",                     type:"Liability",category:"Taxation",           normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"7003", name:"End of Contract Bonus",                     type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  // ── COST OF SALES ────────────────────────────────────────────────────────
  {code:"8001", name:"Direct Cost — Salaries & Wages",            type:"Expense",  category:"Cost of Sales",      normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"8002", name:"Direct Cost — Clearing / Duties",           type:"Expense",  category:"Cost of Sales",      normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"8003", name:"Other Direct Cost",                         type:"Expense",  category:"Cost of Sales",      normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"8004", name:"Direct Cost — Materials Purchases",         type:"Expense",  category:"Cost of Sales",      normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"8005", name:"Carriage Inward / Transport Expenses",      type:"Expense",  category:"Cost of Sales",      normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"8006", name:"Stock Adjustment",                          type:"Expense",  category:"Cost of Sales",      normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"8007", name:"Cost Variance",                             type:"Expense",  category:"Cost of Sales",      normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"8008", name:"Discount Allowed",                          type:"Expense",  category:"Cost of Sales",      normalBal:"Dr",openingBal:0,currency:"NGN"},
  // ── ADMINISTRATION EXPENSES ──────────────────────────────────────────────
  {code:"9001", name:"Depreciation Charges",                      type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9002", name:"Staff Salaries Expenses",                   type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9003", name:"Telephone Expenses",                        type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9004", name:"Vehicle Running Expenses",                  type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9005", name:"Transport & Travel / Accommodation",        type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9006", name:"Business Promotion & Advertising",          type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9007", name:"Insurance Expenses",                        type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9008", name:"Licence & Registrations",                   type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9009", name:"Communication & IT Subscriptions",          type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9010", name:"Printing & Stationery",                     type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9011", name:"Security Expenses",                         type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9012", name:"Safety Expenses",                           type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9013", name:"Diesel & Fuelling",                         type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9014", name:"General Repairs & Maintenance",             type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9015", name:"Staff Allowances",                          type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9016", name:"Employer Pension",                          type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9017", name:"Medical Expenses",                          type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9018", name:"Training & Personnel Development",          type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9019", name:"Cleaning & Sanitation",                     type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9020", name:"Newspapers & Periodicals",                  type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9021", name:"Office Consumables",                        type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9022", name:"Audit Fee & Professional Services",         type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9023", name:"Legal Fee",                                 type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9024", name:"Training",                                  type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9025", name:"Government Rates",                          type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9026", name:"Development Levy",                          type:"Liability",category:"Current Liabilities",normalBal:"Cr",openingBal:0,currency:"NGN"},
  {code:"9027", name:"Repair & Maintenance — Equipment",          type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9028", name:"Maintenance — Premises & Building",         type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9029", name:"Feeding / Entertainment Expenses",          type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9030", name:"Community Development & Relations",         type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9031", name:"Postage / Dispatch / Freight Expenses",     type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  // ── OTHER EXPENSES ───────────────────────────────────────────────────────
  {code:"9100", name:"Loss on Exchange",                          type:"Expense",  category:"Other Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  // ── FINANCE COSTS ────────────────────────────────────────────────────────
  {code:"9500", name:"Interest Charges",                          type:"Expense",  category:"Finance Costs",      normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9550", name:"Bank Charges",                              type:"Expense",  category:"Finance Costs",      normalBal:"Dr",openingBal:0,currency:"NGN"},
  // ── STATUTORY LEVIES ─────────────────────────────────────────────────────
  {code:"9551", name:"NSITF",                                     type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9552", name:"ITF",                                       type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9553", name:"Rent Expenses",                             type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9554", name:"CSR / Charitable Donation",                 type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9555", name:"Repairs & Maint. — Furniture & Fittings",  type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9556", name:"Repairs & Maintenance — Motor Vehicle",     type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9557", name:"Electricity / PHED Bills",                  type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9558", name:"Repairs & Maintenance — Plant & Machinery", type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
  {code:"9559", name:"Tax Expense",                               type:"Expense",  category:"Admin Expenses",     normalBal:"Dr",openingBal:0,currency:"NGN"},
];

// ── Lookup helpers ───────────────────────────────────────────────────────────
export const COA_BY_CODE = Object.fromEntries(DEFAULT_COA.map(a => [a.code, a]));

export function isKnownAccount(code) {
  return Object.prototype.hasOwnProperty.call(COA_BY_CODE, code);
}

export function getAccountName(code, fallbackName = '') {
  return COA_BY_CODE[code]?.name || fallbackName;
}

// ── mergeCOA — this file is the live source of truth, not a one-time seed ────
//
// Added 2026-07-28. Accounting.jsx used to load the chart of accounts as
// `saved?.coa || DEFAULT_COA`: the FIRST time a browser ran, it snapshotted
// this list into its own storage, and from then on never looked at the code
// again. Consequences, all seen in practice:
//
//   • Zeroing the opening balances here fixed nothing for anyone already using
//     the app — two people on the same deployed build saw different figures,
//     because each was reading their own frozen copy.
//   • Any account added or renamed here would reach ONLY brand-new browsers.
//     A posting to a newly-added code would fail for existing users with no
//     obvious cause.
//
// The rule now: every account defined in this file is refreshed from this file
// on every load, for everyone, on every device. Accounts a user created in
// Accounting → Chart of Accounts (codes that do not appear here) are kept —
// removing them would delete their work.
//
// NOTE this means openingBal is code-controlled for the ~129 standard accounts.
// Editing an opening balance on the Chart of Accounts screen will not survive a
// reload. That is deliberate: an opening balance belongs in a dated journal
// entry, where it appears in the ledger and can be traced — not as a figure
// attached to an account with no transaction behind it, which is exactly how
// ₦82.5m of untraceable cash came to be displayed against ledgers reading
// "0 txs".
export function mergeCOA(savedCoa) {
  if (!Array.isArray(savedCoa) || savedCoa.length === 0) return DEFAULT_COA;
  const standardCodes = new Set(DEFAULT_COA.map(a => a.code));
  const userAdded = savedCoa.filter(a => a && a.code && !standardCodes.has(a.code));
  if (userAdded.length === 0) return DEFAULT_COA;
  return [...DEFAULT_COA, ...userAdded]
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}
