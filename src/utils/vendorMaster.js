// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Vendor Master v2.0
// Single shared supplier list — persisted to localStorage.
// Used by Procurement (PO creation) and GRN (receiving).
//
// SOURCE: Accounts_Payable_Supplier_Listing_20260529_123805.xlsx (live SAGE export)
// Same multi-currency pattern as the Client Master — CSPS and VONK each have
// separate SAGE codes per currency, linked here via `groupKey`.
//
// SAGE provided NO contact/phone/email/address data for any supplier — those
// fields start blank rather than inventing placeholder data.
//
// DATA QUALITY — resolved by accountant review, July 2026:
//   - "ACRIFA" / "ACRIFA ENERGY LTD" / "ACRIFA GLOBAL SERVIC" are confirmed
//     as the same corporate group trading in three currencies (Euro/USD/NGN
//     respectively), not duplicates. "Acrifa" is the confirmed correct
//     spelling.
//   - "VONK" / "VONK (USD)" are confirmed as the same entity trading in two
//     currencies (Euro/USD respectively).
// ══════════════════════════════════════════════════════════════════════════════
import { generateId } from './helpers';
import { diffAndPush } from '../hooks/usePerRecordSync';

const VENDOR_KEY = 'bc_vendors';

const SEED_VENDORS = [
  { id:'v001', code:'ACRIFA',                groupKey:'ACRIFA',         name:'Acrifa Energy Ltd (Euro)',                   currency:'EUR', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'Confirmed same corporate group as ACRIFA ENERGY LTD / ACRIFA GLOBAL SERVIC — accountant reviewed 2026-07', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v002', code:'ACRIFA ENERGY LTD',     groupKey:'ACRIFA',         name:'Acrifa Energy Limited (USD)',                currency:'USD', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'Confirmed same corporate group as ACRIFA / ACRIFA GLOBAL SERVIC — accountant reviewed 2026-07',          createdAt:'2026-05-29T00:00:00Z' },
  { id:'v003', code:'ACRIFA GLOBAL SERVIC',  groupKey:'ACRIFA',         name:'Acrifa Global Services Ltd (NGN)',           currency:'NGN', category:'Services', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v004', code:'BENNIC GLOBAL LINKS',   groupKey:'BENNIC',         name:'Bennic Global Links (Nig)',                  currency:'NGN', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v005', code:'CATERING & FACILITIE',  groupKey:'CATERING',       name:'Catering & Facilities',                      currency:'NGN', category:'Catering', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v006', code:'CHIBYKE DAN- GLOBAL',   groupKey:'CHIBYKE',        name:'Chibyke Dan-Global Services Nig',            currency:'NGN', category:'Services', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v007', code:'CHIDAIIK VENTURES',     groupKey:'CHIDAIIK',       name:'Chidaiik Ventures',                          currency:'NGN', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v008', code:'COBEF INTERNATIONAL',   groupKey:'COBEF',          name:'Cobef International Ltd',                    currency:'NGN', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v009', code:'COURDEAU CATERING',     groupKey:'COURDEAU',       name:'Courdeau Catering',                          currency:'NGN', category:'Catering', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v010', code:'CSPS (EURO)',           groupKey:'CSPS',           name:'CSPS',                                       currency:'EUR', category:'Services', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v011', code:'CSPS (POUNDS)',         groupKey:'CSPS',           name:'CSPS',                                       currency:'GBP', category:'Services', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v012', code:'CSPS (USD)',            groupKey:'CSPS',           name:'CSPS',                                       currency:'USD', category:'Services', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v013', code:'EMERSON FZE',           groupKey:'EMERSON',        name:'Emerson FZE',                                currency:'NGN', category:'Equipment', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v014', code:'EMMY ELVIS INTER.',     groupKey:'EMMY ELVIS',     name:'Emmy Elvis International Company',           currency:'NGN', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v015', code:'ENERNICS',              groupKey:'ENERNICS',       name:'Wogu Tony Chinedu (Enernics)',               currency:'NGN', category:'Other', contact:'Wogu Tony Chinedu', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v016', code:'FERRY MOORE INDUSTRI',  groupKey:'FERRY MOORE',    name:'Ferry Moore Industrial Co.',                 currency:'NGN', category:'Equipment', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v017', code:'IN HOUSE',              groupKey:'IN HOUSE',       name:'In House',                                   currency:'NGN', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'Internal/in-house work code, not an external vendor', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v018', code:'LA CULINAIRE',          groupKey:'LA CULINAIRE',   name:'La Culinaire',                               currency:'NGN', category:'Catering', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v019', code:'MACJAMES GLOBAL RES.',  groupKey:'MACJAMES',       name:'Macjames Global Resources Ltd',              currency:'NGN', category:'Materials', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v020', code:'MENAGE LTD',            groupKey:'MENAGE',         name:'Menage Ltd',                                 currency:'NGN', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v021', code:'MOMENTIVE PERFORM.',    groupKey:'MOMENTIVE',      name:'Momentive Performance Materials (India) Pvt Ltd', currency:'NGN', category:'Materials', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v022', code:'S.J ABED GEN ENT',      groupKey:'S.J ABED',       name:'S.J Abed Gen Ent',                           currency:'NGN', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v023', code:'SAFETY GEAR STORE LT',  groupKey:'SAFETY GEAR',    name:'Safety Gear Store Ltd',                      currency:'NGN', category:'Materials', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v024', code:'TANIT MEDICAL ENG.',    groupKey:'TANIT',          name:'Tanit Medical Engineering Ltd',              currency:'NGN', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v025', code:'VINO WORLDWIDE.  S.',   groupKey:'VINO',           name:'Vino Worldwide. S.Co',                       currency:'NGN', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v026', code:'VONK',                  groupKey:'VONK',           name:'Vonk (Euro)',                                currency:'EUR', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v027', code:'VONK (USD)',            groupKey:'VONK',           name:'Vonk (USD)',                                 currency:'USD', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'Confirmed same entity as VONK (Euro) — accountant reviewed 2026-07', createdAt:'2026-05-29T00:00:00Z' },
  { id:'v028', code:'WORLDWIDE ENERGY LOG',  groupKey:'WORLDWIDE',      name:'Worldwide Energy Logistics Ltd',             currency:'NGN', category:'Logistics', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'', createdAt:'2026-05-29T00:00:00Z' },
];

export const VENDOR_CATEGORIES = ['Materials', 'Equipment', 'Services', 'Fuel/Lube', 'Catering', 'Logistics', 'IT', 'Civil Works', 'Consulting', 'Other'];

export function getVendors() {
  try {
    const raw = localStorage.getItem(VENDOR_KEY);
    if (!raw) {
      localStorage.setItem(VENDOR_KEY, JSON.stringify(SEED_VENDORS));
      return SEED_VENDORS;
    }
    return JSON.parse(raw);
  } catch {
    return SEED_VENDORS;
  }
}

export function saveVendors(vendors) {
  // Per-record push — 2026-07-29 full-app sync sweep. This whole file is a
  // standalone localStorage store (see header) that predates the per-record
  // sync engine and was never wired to it — 'vendors' has had a Supabase
  // table since before this session, but nothing ever pushed to it. Capture
  // the prior list BEFORE overwriting localStorage so diffAndPush has a real
  // "before" to compare against.
  const prev = getVendors();
  try { localStorage.setItem(VENDOR_KEY, JSON.stringify(vendors)); } catch {}
  try { window.dispatchEvent(new CustomEvent('slot:masterDataChanged', { detail: { mod: 'vendors', data: vendors } })); } catch {}
  diffAndPush('vendors', prev, vendors);
}

export function addVendor(vendor) {
  const vendors = getVendors();
  const rec = { ...vendor, id: generateId(), createdAt: new Date().toISOString() };
  const updated = [...vendors, rec];
  saveVendors(updated);
  return updated;
}

export function updateVendor(id, changes) {
  const vendors = getVendors().map(v => v.id === id ? { ...v, ...changes } : v);
  saveVendors(vendors);
  return vendors;
}

export function deleteVendor(id) {
  const vendors = getVendors().filter(v => v.id !== id);
  saveVendors(vendors);
  return vendors;
}

/** Returns active vendor codes for dropdown use (was names-only before — now code-based to match SAGE) */
export function getVendorNames() {
  return getVendors().filter(v => v.status === 'Active').map(v => v.code).sort();
}

/** Look up a vendor by its SAGE code */
export function getVendorByCode(code) {
  return getVendors().find(v => v.code === code) || null;
}

/** All currency-variant codes belonging to the same legal entity, e.g. CSPS in 3 currencies */
export function getVendorGroup(groupKey) {
  return getVendors().filter(v => v.groupKey === groupKey && v.status === 'Active');
}
