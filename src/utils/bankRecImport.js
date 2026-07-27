// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Bank Statement CSV Import + Auto-Match v1.0
//
// The audit's Tier-2 finding: bank reconciliation today is a manual
// checklist keyed in one statement line at a time. This module imports a
// CSV/OFX-style statement and auto-matches each line against the GL cashbook
// using a small set of heuristics:
//
//   1. Exact reference match   — statement ref = invoice ref / receipt no
//   2. Exact amount + date     — bank debit/credit = AR receipt / AP payment
//   3. Counterparty match      — statement narrative contains vendor/client name
//   4. Fuzzy                   — date within ±3 days AND amount within ±₦100
//
// Returns a per-line match result the UI can present for accountant review.
// ══════════════════════════════════════════════════════════════════════════════

// ── CSV parser — handles quoted fields, commas inside quotes, CRLF/LF ─────────
export function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  text = text.replace(/^\uFEFF/, ''); // strip BOM
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length && r.some(c => (c||'').toString().trim() !== ''));
}

// ── Normalize a statement CSV into { date, ref, narrative, debit, credit, balance } ─
// Heuristic header detection — looks for common column names.
export function normalizeStatement(rows) {
  if (rows.length < 2) return [];
  const header = rows[0].map(h => (h || '').toString().trim().toLowerCase());
  const idx = (...names) => {
    for (const n of names) {
      const i = header.findIndex(h => h === n || h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const dateIdx    = idx('date', 'trans date', 'value date', 'posting date');
  const refIdx     = idx('ref', 'reference', 'trans ref', 'txn id', 'transaction id');
  const narrIdx    = idx('narrative', 'description', 'details', 'narration', 'memo');
  const debitIdx   = idx('debit', 'withdrawal', 'dr', 'out', 'amount out');
  const creditIdx  = idx('credit', 'deposit', 'cr', 'in',  'amount in');
  const amountIdx  = idx('amount', 'value');
  const balanceIdx = idx('balance', 'running balance', 'closing balance');

  return rows.slice(1).map((r, i) => {
    const get = idx => idx >= 0 ? (r[idx] || '').toString().trim() : '';
    const num = s => Number(String(s || '').replace(/[, ]/g, '')) || 0;
    let debit = num(get(debitIdx));
    let credit = num(get(creditIdx));
    if (!debit && !credit && amountIdx >= 0) {
      const amt = num(get(amountIdx));
      if (amt < 0) debit = Math.abs(amt); else credit = amt;
    }
    return {
      lineNo:  i + 1,
      date:    get(dateIdx),
      ref:     get(refIdx),
      narrative: get(narrIdx),
      debit,   credit,
      balance: num(get(balanceIdx)),
      raw:     r,
    };
  });
}

// ── Auto-match one statement line against GL cashbook entries ────────────────
// cashbookEntries is the union of AR receipts + AP payments + manual journals
// hitting bank/cash accounts. Each entry should expose: { date, ref, party, amount, drAccount, crAccount }.
export function matchStatementLine(line, cashbookEntries, opts = {}) {
  const dateWindow = opts.dateWindow ?? 3;       // ±days
  const amtWindow  = opts.amtWindow  ?? 100;     // ±₦
  const candidates = [];
  const lineAmt = (line.credit || 0) - (line.debit || 0);

  for (const e of cashbookEntries) {
    if (e.reconciled) continue;
    // Reference match
    if (line.ref && e.ref && String(line.ref).trim() === String(e.ref).trim()) {
      return { match: e, score: 100, method: 'reference' };
    }
    // Date proximity + amount proximity
    const d1 = new Date(line.date); const d2 = new Date(e.date);
    if (isNaN(d1) || isNaN(d2)) continue;
    const dayDiff = Math.abs((d1 - d2) / 86400000);
    if (dayDiff > dateWindow) continue;
    const amtDiff = Math.abs(lineAmt - e.amount);
    if (amtDiff > amtWindow)   continue;
    let score = 50;
    if (amtDiff < 1) score += 30;          // exact amount
    else if (amtDiff < 10) score += 20;
    if (dayDiff < 1)  score += 15;          // same day
    if (e.party && line.narrative && line.narrative.toLowerCase().includes(e.party.toLowerCase())) score += 20;
    candidates.push({ match: e, score, method: amtDiff < 1 ? 'amount' : 'fuzzy', dayDiff, amtDiff });
  }
  if (!candidates.length) return { match: null, score: 0, method: 'none' };
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

// ── Bulk import — returns { matched[], unmatched[], suggestions[] } ─────────
export function autoReconcile(statementLines, cashbookEntries, opts) {
  const matched = [];
  const unmatched = [];
  const suggestions = [];
  for (const line of statementLines) {
    const result = matchStatementLine(line, cashbookEntries, opts);
    if (result.match && result.score >= 70) {
      matched.push({ line, ...result });
    } else if (result.match) {
      suggestions.push({ line, ...result });
    } else {
      unmatched.push(line);
    }
  }
  return { matched, unmatched, suggestions };
}
