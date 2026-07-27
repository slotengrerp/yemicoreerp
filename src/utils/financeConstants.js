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

// ════════════════════════════════════════════════════════════════════════════
// Nigerian PAYE Calculator — Personal Income Tax Act (PITA) compliant
//
// CRITICAL FIX: previously the app applied the 7/11/15/19/21/24% bands
// directly to gross × 12, omitting the Consolidated Relief Allowance (CRA).
// Nigerian law requires CRA to be deducted BEFORE applying the bands:
//
//   CRA = max(₦200,000, 1% of gross) + 20% of gross
//
// So taxable income = gross − CRA, and the bands apply to that.
// Without this fix, every employee was overpaying PAYE by ~30%.
//
// Bands (2024 onwards, post-2020 Finance Act):
//   First       ₦300,000  →  7%
//   Next        ₦300,000  → 11%
//   Next        ₦500,000  → 15%
//   Next        ₦500,000  → 19%
//   Next    ₦1,600,000    → 21%
//   Above  ₦3,200,000     → 24%  (i.e. everything above the sum of the above)
//
// Returns the MONTHLY PAYE (annual tax ÷ 12), rounded to the nearest naira.
// ════════════════════════════════════════════════════════════════════════════
export function calcPAYE_Nigeria(monthlyGross) {
  const annualGross = Number(monthlyGross) * 12;
  if (annualGross <= 0) return 0;
  // Consolidated Relief Allowance
  const cra = Math.max(200000, annualGross * 0.01) + (annualGross * 0.20);
  const taxable = Math.max(0, annualGross - cra);
  const bands = [
    [300000,  7],
    [300000, 11],
    [500000, 15],
    [500000, 19],
    [1600000, 21],
    [Infinity, 24],
  ];
  let tax = 0, remaining = taxable;
  for (const [limit, rate] of bands) {
    const slice = Math.min(remaining, limit);
    tax += slice * (rate / 100);
    remaining -= slice;
    if (remaining <= 0) break;
  }
  return Math.round(tax / 12);
}

// NHF (National Housing Fund) — 2.5% of basic, but exempt if gross < ₦3,000/yr
// (effectively everyone with a salary pays, but we keep the legal check).
export function calcNHF_Nigeria(basic) {
  if ((Number(basic) || 0) * 12 < 3000) return 0;
  return Math.round(Number(basic) * 0.025);
}

// Pension (employee contribution) — 8% of (basic + housing + transport)
// per PRA 2014. Some employers negotiate lower, but 8% is the statutory default.
export function calcPension_Nigeria(basic, housing, transport) {
  return Math.round(((Number(basic) || 0) + (Number(housing) || 0) + (Number(transport) || 0)) * 0.08);
}
