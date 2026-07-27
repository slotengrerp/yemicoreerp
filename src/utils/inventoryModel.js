// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Inventory Model v1.0
//
// The audit's strategic question: what does the client mean by "Inventory"?
//   Option A — Equipment/asset register (what `Inventory.jsx` already does):
//     Vehicles, heavy equipment, construction materials on-site, office
//     appliances. Static records, status tracking, no quantities on hand.
//   Option B — Stock/warehouse management (what Sage 200 Inventory does):
//     Items with on-hand quantity, unit cost, FIFO/weighted-average
//     valuation, warehouses, bin locations, batch/serial numbers, reorder
//     points, stock movements in/out with GL posting.
//
// This module provides the data shape for OPTION B so it can be built
// incrementally on top of the existing equipment register without breaking
// it. The two coexist:
//
//   db.equipment = [/* existing static asset records, untouched */]
//   db.stock = {
//     items:      [{ id, code, name, category, uom, ... }],
//     warehouses: [{ id, name, location }],
//     locations:  [{ id, warehouseId, bin, ... }],
//     batches:    [{ id, itemId, lotNo, expiryDate, qty, unitCost }],
//     serials:    [{ id, itemId, serialNo, status, locationId }],
//     movements:  [{ id, itemId, type, qty, unitCost, refType, refId, date, postedToGL }],
//     valuations: { itemId: { qtyOnHand, avgCost, totalValue, lastValuedAt } },
//   }
//
// The Settings → Accounting → Inventory Mode toggle lets an admin declare
// which interpretation they're using — for now the toggle is informational
// and doesn't change behavior; the stock/warehouse UI is the next iteration.
// ══════════════════════════════════════════════════════════════════════════════

// ── Data shape constants ─────────────────────────────────────────────────────
export const STOCK_CATEGORIES = [
  'Raw Materials',
  'Spare Parts',
  'Consumables',
  'Finished Goods',
  'Tools',
  'Safety Equipment',
  'Office Supplies',
  'Other',
];

export const UOM = [
  'pcs', 'kg', 'g', 'tonnes',
  'litres', 'm', 'm²', 'm³',
  'box', 'roll', 'set', 'pair',
  'bag', 'drum', 'pallet',
];

export const MOVEMENT_TYPES = [
  { code: 'RECEIVE',  name: 'Goods Received (in)',  dr: 'inventory',  cr: 'GR/IR'    },
  { code: 'ISSUE',    name: 'Issue to Project (out)', dr: 'cogs',     cr: 'inventory' },
  { code: 'TRANSFER', name: 'Warehouse Transfer',     neutral: true                       },
  { code: 'ADJUST',   name: 'Stock Adjustment',       neutral: true                       },
  { code: 'RETURN',   name: 'Return from Project (in)', dr: 'inventory', cr: 'cogs'    },
  { code: 'SCRAP',    name: 'Scrap / Write-off',      dr: 'scrap-exp', cr: 'inventory' },
];

// ── FIFO / Weighted-Average costing ──────────────────────────────────────────
// Given a list of past movements (most recent last) and a target issue qty,
// compute the issued cost. Returns { unitCost, totalCost, layersConsumed }.
//
//   fifo:  consume oldest layers first (standard FIFO inventory accounting)
//   wavg:  weight all open layers by remaining qty
export function valueIssue(movements, issueQty, method = 'wavg') {
  if (!issueQty || issueQty <= 0) return { unitCost: 0, totalCost: 0, layersConsumed: [], qtyOnHand: 0, insufficientStock: false };
  if (method === 'fifo') {
    // Build inventory layers from RECEIVE + RETURN movements (positive qty)
    const layers = [];
    for (const m of movements) {
      const qty = Number(m.qty) || 0;
      if (m.type === 'RECEIVE' || m.type === 'RETURN' || (m.type === 'ADJUST' && qty > 0)) {
        layers.push({ qty: Math.abs(qty), unitCost: Number(m.unitCost) || 0, refId: m.id });
      } else if (m.type === 'ISSUE' || m.type === 'SCRAP' || (m.type === 'ADJUST' && qty < 0)) {
        // Consume oldest first
        let toConsume = Math.abs(qty);
        for (const l of layers) {
          if (toConsume <= 0) break;
          const take = Math.min(l.qty, toConsume);
          l.qty -= take;
          toConsume -= take;
        }
      }
    }
    const open = layers.filter(l => l.qty > 1e-6);
    const qtyOnHand = open.reduce((s, l) => s + l.qty, 0);
    let remaining = issueQty;
    let totalCost = 0;
    const consumed = [];
    for (const l of open) {
      if (remaining <= 0) break;
      const take = Math.min(l.qty, remaining);
      totalCost += take * l.unitCost;
      consumed.push({ qty: take, unitCost: l.unitCost, refId: l.refId });
      remaining -= take;
    }
    const qtyCosted = issueQty - remaining;
    // FIX (T1-4): was `totalCost / (issueQty - remaining)` with no guard —
    // divided by zero (-> NaN) whenever there were no open layers to
    // consume (e.g. issuing stock for an item with zero receipts on
    // record). That NaN then flowed straight into journalFromStockIssue()'s
    // GL amount.
    const unitCost = qtyCosted > 0 ? totalCost / qtyCosted : 0;
    return { unitCost, totalCost, layersConsumed: consumed, qtyOnHand, insufficientStock: remaining > 1e-6 };
  }
  // Weighted average: sum(qty × cost) / sum(qty) of all open RECEIVE/RETURN layers
  let totalQty = 0, totalValue = 0;
  for (const m of movements) {
    const qty = Number(m.qty) || 0;
    if (m.type === 'RECEIVE' || m.type === 'RETURN' || (m.type === 'ADJUST' && qty > 0)) {
      totalQty += Math.abs(qty);
      totalValue += Math.abs(qty) * (Number(m.unitCost) || 0);
    } else if (m.type === 'ISSUE' || m.type === 'SCRAP' || (m.type === 'ADJUST' && qty < 0)) {
      // Reduce both qty and value proportionally (assuming average cost basis)
      const avg = totalQty > 0 ? totalValue / totalQty : 0;
      totalQty  = Math.max(0, totalQty - Math.abs(qty));
      totalValue = Math.max(0, totalValue - Math.abs(qty) * avg);
    }
  }
  const unitCost = totalQty > 0 ? totalValue / totalQty : 0;
  // FIX (T1-4): previously always costed the FULL requested issueQty even
  // when totalQty (actual qty on hand) was lower — silently overstated COGS
  // and let stock go negative with zero warning. Now caps at what's on hand
  // and reports the shortfall via insufficientStock so the caller can
  // block/warn (see Inventory.jsx's `result.unitCost <= 0` guard, which
  // doesn't catch a partial over-issue on its own).
  const cappedQty = Math.min(issueQty, totalQty);
  return {
    unitCost,
    totalCost: cappedQty * unitCost,
    layersConsumed: [{ qty: cappedQty, unitCost }],
    qtyOnHand: totalQty,
    insufficientStock: issueQty > totalQty + 1e-6,
  };
}

// ── Reorder point alert ──────────────────────────────────────────────────────
// Returns { alert: 'BELOW'|'AT'|'ABOVE', reorderQty, currentQty, reorderPoint }.
export function checkReorder(item, currentQty) {
  const rp = Number(item.reorderPoint) || 0;
  const ro = Number(item.reorderQty)   || 0;
  if (currentQty <= 0)            return { alert: 'BELOW',  reorderQty: ro, currentQty, reorderPoint: rp };
  if (currentQty <= rp)           return { alert: 'AT',     reorderQty: ro, currentQty, reorderPoint: rp };
  if (currentQty <= rp * 1.2)     return { alert: 'NEAR',   reorderQty: ro, currentQty, reorderPoint: rp };
  return                                { alert: 'ABOVE', reorderQty: 0, currentQty, reorderPoint: rp };
}

// ── Build a stock-issue journal entry (Dr COGS / Cr Inventory) ──────────────
// bankCode / bankName are accepted (and stored) for future expansion to
// cash-paid stock purchases; the pure inventory issue currently posts
// directly to inventory, not to bank.
export function journalFromStockIssue(item, issueQty, unitCost, refType, refId, bankCode = '', bankName = '') { // eslint-disable-line no-unused-vars
  const total = Math.round((Number(issueQty) || 0) * (Number(unitCost) || 0) * 100) / 100; // FIX (T1-3): was whole-Naira rounding, same drift bug as jLine() in glPosting.js
  const cogsAcct  = item.cogsAccountCode  || '8004';   // Direct Cost — Materials
  const invAcct   = item.inventoryAccountCode || '1500';
  return {
    id:          `JE-STOCK-${refId}-${item.id}`,
    date:        new Date().toISOString().split('T')[0],
    ref:         refId,
    description: `Stock Issue: ${item.name} × ${issueQty} ${item.uom || 'units'} @ ${unitCost.toLocaleString()}`,
    source:      'stock-issue',
    sourceId:    refId,
    periodKey:   `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    lines: [{
      drCode: cogsAcct, drName: 'Direct Cost — Materials',
      crCode: invAcct,  crName: 'Inventory',
      amount: total, currency: 'NGN', fxRate: 1, fcAmount: total,
      memo: `${item.code} ${item.name} (${refType} ${refId})`,
    }],
  };
}
