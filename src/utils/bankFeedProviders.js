// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Live Bank Feed Provider Abstraction
//
// The audit found that bank reconciliation today is manual (with CSV import
// + auto-match). True "live" feeds need a bank-API integration. In Nigeria
// the practical providers are:
//
//   • Mono    — https://mono.co  (account aggregation, NIBSS-scope)
//   • Okra    — https://okra.ng  (account aggregation + identity)
//   • Stitch  — https://stitch.money  (data + payments)
//
// All three expose roughly the same shape: a Connect-style flow that
// exchanges a public_key + customer auth code for a long-lived account_id,
// then `GET /transactions?account_id=...&from=...&to=...` returns the
// same {date, ref, narrative, debit, credit} tuple we already parse in
// bankRecImport.js.
//
// This module abstracts the provider-specific bits behind one interface so
// the Accounting module's Bank Reconciliation tab can call
// `fetchTransactions({ account, from, to })` and not care which provider
// is wired. The provider is configured once in Settings (key + secret) and
// the rest is automatic.
//
// Each provider module exposes:
//   - `id`             unique slug
//   - `displayName`    human-readable
//   - `requiresAuth()` returns the list of fields needed (apiKey, accountId, etc.)
//   - `fetchTxns(config, { from, to, account })` returns [{ date, ref, narrative, debit, credit, balance, raw }]
//   - `verify(config)`  test call to confirm credentials work
//
// If no provider is configured (or the live call fails), the existing
// `autoReconcile()` from `bankRecImport.js` runs against the manual entry
// list — so the live feed is strictly an upgrade, never a regression.
// ══════════════════════════════════════════════════════════════════════════════

// ── Provider: Mono ───────────────────────────────────────────────────────────
const mono = {
  id: 'mono',
  displayName: 'Mono (Nigerian Open Banking)',
  docsUrl: 'https://docs.mono.co',
  requiresAuth: () => ['monoSecretKey', 'monoAccountId'],
  async verify({ monoSecretKey, monoAccountId }) {
    if (!monoSecretKey || !monoAccountId) throw new Error('Mono secret key and account id required');
    const r = await fetch(`https://api.withmono.com/v2/accounts/${monoAccountId}`, {
      headers: { 'mono-sec-key': monoSecretKey },
    });
    if (!r.ok) throw new Error(`Mono verify failed: HTTP ${r.status}`);
    return await r.json();
  },
  async fetchTxns({ monoSecretKey, monoAccountId }, { from, to }) {
    if (!monoSecretKey || !monoAccountId) throw new Error('Mono credentials missing');
    const all = [];
    let cursor;
    // Mono paginates 100 per page. Walk until exhausted or `from` is past.
    do {
      const url = new URL(`https://api.withmono.com/v2/accounts/${monoAccountId}/transactions`);
      url.searchParams.set('limit', '100');
      if (from) url.searchParams.set('start', from);
      if (to)   url.searchParams.set('end', to);
      if (cursor) url.searchParams.set('cursor', cursor);
      const r = await fetch(url, { headers: { 'mono-sec-key': monoSecretKey } });
      if (!r.ok) throw new Error(`Mono fetch failed: HTTP ${r.status}`);
      const data = await r.json();
      const txns = (data?.data || []).map(t => ({
        date:        (t.date || '').slice(0, 10),
        ref:         t.id || '',
        narrative:   t.narration || t.description || '',
        debit:       Number(t.amount) < 0 ? Math.abs(Number(t.amount)) : 0,
        credit:      Number(t.amount) > 0 ? Number(t.amount) : 0,
        balance:     Number(t.balance) || 0,
        raw:         t,
      }));
      all.push(...txns);
      cursor = data?.paging?.next_cursor || data?.paging?.cursor;
      if (!cursor) break;
    } while (cursor);
    return all;
  },
};

// ── Provider: Okra ───────────────────────────────────────────────────────────
const okra = {
  id: 'okra',
  displayName: 'Okra (Nigerian Open Banking)',
  docsUrl: 'https://docs.okra.ng',
  requiresAuth: () => ['okraApiKey', 'okraRecordId'],
  async verify({ okraApiKey, okraRecordId }) {
    if (!okraApiKey || !okraRecordId) throw new Error('Okra api key and record id required');
    const r = await fetch(`https://api.okra.ng/v2/sandbox/transactions/byRecordId`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${okraApiKey}` },
      body: JSON.stringify({ record: okraRecordId, page: 1, limit: 1 }),
    });
    if (!r.ok) throw new Error(`Okra verify failed: HTTP ${r.status}`);
    return await r.json();
  },
  async fetchTxns({ okraApiKey, okraRecordId }, { from, to }) {
    if (!okraApiKey || !okraRecordId) throw new Error('Okra credentials missing');
    const all = [];
    let page = 1;
    while (true) {
      const r = await fetch(`https://api.okra.ng/v2/sandbox/transactions/byRecordId`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${okraApiKey}` },
        body: JSON.stringify({ record: okraRecordId, page, limit: 100, from, to }),
      });
      if (!r.ok) throw new Error(`Okra fetch failed: HTTP ${r.status}`);
      const data = await r.json();
      const txns = (data?.data?.transaction || []).map(t => ({
        date:        (t.transactiondate || t.created_at || '').slice(0, 10),
        ref:         t._id || t.trans_ref || '',
        narrative:   t.trans_desc || t.narration || '',
        debit:       Number(t.amount) < 0 ? Math.abs(Number(t.amount)) : 0,
        credit:      Number(t.amount) > 0 ? Number(t.amount) : 0,
        balance:     Number(t.balance) || 0,
        raw:         t,
      }));
      all.push(...txns);
      if (txns.length < 100) break;
      page += 1;
      if (page > 50) break; // safety cap — caller can paginate manually if they really need more
    }
    return all;
  },
};

// ── Provider: CSV paste / file (no live API; uses the existing parser) ──────
const csv = {
  id: 'csv',
  displayName: 'CSV / OFX file upload (no live API)',
  docsUrl: '',
  requiresAuth: () => [],
  async verify() { return { ok: true, mode: 'csv' }; },
  async fetchTxns() { return []; }, // Caller uses the file picker / paste UI directly
};

// ── Provider registry ────────────────────────────────────────────────────────
export const BANK_FEED_PROVIDERS = [mono, okra, csv];
export const BANK_FEED_PROVIDER_MAP = Object.fromEntries(BANK_FEED_PROVIDERS.map(p => [p.id, p]));

// ── High-level helper ────────────────────────────────────────────────────────
// `config` shape: { provider: 'mono' | 'okra' | 'csv', monoSecretKey, monoAccountId, okraApiKey, okraRecordId }
// Returns the same {date, ref, narrative, debit, credit, balance, raw} shape
// the rest of the bank-reconciliation engine already speaks.
export async function fetchBankTransactions(config, { from, to, account } = {}) {
  if (!config || !config.provider || config.provider === 'csv') {
    throw new Error('CSV mode: use the file picker — no fetch needed');
  }
  const prov = BANK_FEED_PROVIDER_MAP[config.provider];
  if (!prov) throw new Error(`Unknown provider: ${config.provider}`);
  return prov.fetchTxns(config, { from, to, account });
}

export async function verifyBankFeedCredentials(config) {
  const prov = BANK_FEED_PROVIDER_MAP[config.provider];
  if (!prov) throw new Error(`Unknown provider: ${config.provider}`);
  return prov.verify(config);
}
