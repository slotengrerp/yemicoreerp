// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — Shared finance constants
// Bank accounts (matches the Cash & Bank section of the Chart of Accounts in
// Accounting.jsx exactly — codes 3001-3017) and indicative FX rates, shared
// between Accounts Payable and Accounts Receivable so both post to the same
// bank account list and the same NGN-equivalent logic.
// ══════════════════════════════════════════════════════════════════════════════

// Indicative spot rates — editable per-transaction. Until a live FX feed is
// wired in, whoever enters the bill/receipt confirms the actual rate used by
// the bank on that date. This is what drives "report in NGN, but also see the
// USD/EUR/GBP transaction view" — every foreign-currency record carries BOTH
// its native amount AND a fxRate + ngnEquivalent computed at entry time.
export const DEFAULT_FX = { NGN:1, USD:1550, EUR:1680, GBP:1950 };

export const BANK_ACCOUNTS = [
  { code:'3001', name:'Imprest Cash',                            currency:'NGN' },
  { code:'3002', name:'Main Cash',                               currency:'NGN' },
  { code:'3003', name:'Access Bank (Naira A/C 0002238013)',      currency:'NGN' },
  { code:'3004', name:'Access Bank (Dollar A/C 0002214695)',     currency:'USD' },
  { code:'3005', name:'Zenith Bank (A/C 1011010033)',            currency:'NGN' },
  { code:'3006', name:'Zenith Bank (A/C 1013042537)',            currency:'NGN' },
  { code:'3007', name:'First Bank (A/C 2008176695)',             currency:'NGN' },
  { code:'3008', name:'Standard Chartered Bank (A/C 0002151883)',currency:'NGN' },
  { code:'3009', name:'Sterling Bank (A/C 0068919961)',          currency:'NGN' },
  { code:'3010', name:'Unity Bank (A/C 0025894154)',             currency:'NGN' },
  { code:'3011', name:'UBA Bank (A/C 1015363537)',               currency:'NGN' },
  { code:'3014', name:'Stanbic IBTC Bank',                       currency:'NGN' },
  { code:'3015', name:'Access Bank Euro',                        currency:'EUR' },
  { code:'3016', name:'Merchant Bank (A/C 1000159983)',          currency:'NGN' },
  { code:'3017', name:'Fidelity Bank PLC (A/C 4011553970)',      currency:'NGN' },
];
