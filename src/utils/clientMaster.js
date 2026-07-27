// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Client Master v2.1
// Shared customer/client database.
//
// SYNC NOTE (v2.1): this file's own localStorage key (bc_clients) stays as
// the fast synchronous read/write path everything below already uses — that
// part didn't need to change. What was missing is that this key was never
// connected to the central Supabase-synced store at all, so every client
// added/edited/deleted here only ever existed on the browser it was entered
// on. saveClients() now also fires a 'slot:masterDataChanged' event, which
// App.jsx listens for and folds into the central store (db.clients) — that's
// what actually reaches the cloud. App.jsx also mirrors db.clients back into
// bc_clients on boot/cloud-load/realtime-update, so getClients() here always
// sees the latest data regardless of which device it came from.
//
// SOURCE: Accounts_Receivable_Customer_Listing_20260522_113946.xlsx (live SAGE export)
// IMPORTANT: SAGE creates a SEPARATE customer code per currency for the same
// legal entity (e.g. NLNG has 4 codes — NGN, USD, EUR, GBP — because SAGE 50's
// AR ledger doesn't support multi-currency on a single customer record). The
// `groupKey` field links these variants together so the app can show "NLNG"
// as one company with 4 selectable currency-specific accounts, while still
// posting to the correct SAGE-matching code under the hood.
//
// SAGE provided NO contact/phone/email/address data for any customer — those
// fields start blank here rather than inventing placeholder data. Fill them
// in via the UI as real contact details become available.
// ══════════════════════════════════════════════════════════════════════════════
import { generateId } from './helpers';

const CLIENT_KEY = 'bc_clients';

const SEED_CLIENTS = [
  { id:'c001', code:'ALPHADEN ENERGY',        groupKey:'ALPHADEN', name:'Alphaden Energy & Oilfield Limited', currency:'NGN', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c002', code:'ALPHADEN ENERGY & OI',   groupKey:'ALPHADEN', name:'Alphaden Energy & Oilfield Limited', currency:'USD', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c003', code:'GEOPLEX DRILLTEQ LTD',   groupKey:'GEOPLEX',  name:'Geoplex Drillteq Ltd',               currency:'NGN', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c004', code:'NLNG NGN',               groupKey:'NLNG',     name:'Nigeria LNG Limited',                currency:'NGN', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'Monthly retainer client', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c005', code:'NLNG (USD)',             groupKey:'NLNG',     name:'Nigeria LNG Limited',                currency:'USD', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c006', code:'NLNG (EURO)',            groupKey:'NLNG',     name:'Nigeria LNG Limited',                currency:'EUR', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c007', code:'NLNG (POUNDS)',          groupKey:'NLNG',     name:'Nigeria LNG Limited',                currency:'GBP', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c008', code:'SAIPEM USD',             groupKey:'SAIPEM',   name:'Saipem',                              currency:'USD', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c009', code:'SHELL NIG. GAS',         groupKey:'SHELL',    name:'Shell Nigeria Gas',                  currency:'NGN', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c010', code:'SPDC',                   groupKey:'SPDC',     name:'Renaissance Africa Energy Company of Nig. Ltd', currency:'NGN', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'Formerly SPDC', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c011', code:'SPDC(USD)',              groupKey:'SPDC',     name:'Renaissance Africa Energy Company of Nig. Ltd', currency:'USD', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'', createdAt:'2026-05-22T00:00:00Z' },
  { id:'c012', code:'SPDC(EURO)',             groupKey:'SPDC',     name:'Renaissance Africa Energy Company of Nig. Ltd', currency:'EUR', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'', createdAt:'2026-05-22T00:00:00Z' },
];

export const CLIENT_CATEGORIES = ['Oil & Gas', 'Construction', 'Government', 'Manufacturing', 'Logistics', 'Finance', 'Other'];

export function getClients() {
  try {
    const raw = localStorage.getItem(CLIENT_KEY);
    if (!raw) {
      localStorage.setItem(CLIENT_KEY, JSON.stringify(SEED_CLIENTS));
      return SEED_CLIENTS;
    }
    return JSON.parse(raw);
  } catch {
    return SEED_CLIENTS;
  }
}

export function saveClients(clients) {
  try { localStorage.setItem(CLIENT_KEY, JSON.stringify(clients)); } catch {}
  try { window.dispatchEvent(new CustomEvent('slot:masterDataChanged', { detail: { mod: 'clients', data: clients } })); } catch {}
}

export function addClient(client) {
  const clients = getClients();
  const rec = { ...client, id: generateId(), createdAt: new Date().toISOString() };
  const updated = [...clients, rec];
  saveClients(updated);
  return updated;
}

export function updateClient(id, changes) {
  const clients = getClients().map(c => c.id === id ? { ...c, ...changes } : c);
  saveClients(clients);
  return clients;
}

export function deleteClient(id) {
  const clients = getClients().filter(c => c.id !== id);
  saveClients(clients);
  return clients;
}

/** Returns active clients for dropdown use, sorted by company then currency */
export function getClientNames() {
  return getClients()
    .filter(c => c.status === 'Active')
    .sort((a, b) => a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency))
    .map(c => c.code);
}

/** Look up a client by its SAGE code (e.g. "NLNG (USD)") */
export function getClientByCode(code) {
  return getClients().find(c => c.code === code) || null;
}

/** Look up a client by display name — kept for backward compatibility, returns first match */
export function getClientByName(name) {
  return getClients().find(c => c.name === name) || null;
}

/** All currency-variant codes belonging to the same legal entity, e.g. all 4 NLNG codes */
export function getClientGroup(groupKey) {
  return getClients().filter(c => c.groupKey === groupKey && c.status === 'Active');
}
