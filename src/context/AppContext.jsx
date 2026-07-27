import { createContext, useContext, useReducer } from 'react';

const AppContext = createContext();

const initialState = {
  db: {
    nlng: [], procurement: [], inventory: [], vehicles: [],
    invoices: [], slot: [], request: [], pettycash: [],
    terminal: { containers: [], charges: [], logistics: [], bols: [], advances: [], consignees: [], shippingCompanies: [] },
    fixedassets: [], wht: [], _trash: [],
    // Sage-style collections added by SageReports module:
    creditNotes: [],              // AR credit notes (link to original invoice)
    paymentBatches: [],           // AP batch payment runs (one batch = many bills)
    // Tier 2 collections:
    recurringInvoiceTemplates: [],// Recurring invoice templates (monthly/quarterly/yearly)
    recurringInvoices: [],        // Runtime key that SageReports2 uses for recurring templates
    prepayAccruals: [],           // Prepayments & accruals (combined key)
    bankReconciliations: [],      // Bank reconciliation records
    assetDisposals: [],           // Asset disposal records
    prepayments: [],              // Prepayments (Dr Prepaid / Cr Bank, reversed monthly)
    accruals: [],                 // Accruals (Dr Expense / Cr Accrued, reversed on payment)
    budgets: [],                  // Annual budgets per account
    stockTakes: [],               // Physical stock take records
    stockItems: [],               // Stock item master data
    stockMovements: [],           // Stock movement history
    arReceipts: [],               // AR receipt records (used by bank rec)
    ap: { bills: [], payments: [] }, // AP payment records (used by bank rec)
    // Tier 3 collections:
    warehouses: [],               // Multi-warehouse master
    stockTransfers: [],           // Inter-warehouse transfer records
    serialBatches: [],            // Serial number / batch lot tracking
    boms: [],                     // Bill of Materials definitions
    bomBuilds: [],                // BOM assembly build history
  },
  acctData: {
    journals: [], coa: [], bankStmt: [], vatAdj: [], whtEntries: [], assets: []
  },
  scannedDocs: [],   // global doc scanner — shared across all modules
  activity: [],
  currentUser: null,
  appSettings: {
    brand: { name: 'SLOT Engineering Nigeria Limited', short: 'SLOT Engineering', tagline: 'Engineering Excellence · Delivering Value', color: '#1A5C2A', amber: '#C97A0A', currency: '₦', industry: 'Engineering & Logistics' },
    theme: 'dark',
    recovery_code: ''
  },
  cloudReady: false,
  offlineMode: false,
  loading: true,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_USER':        return { ...state, currentUser: action.payload };
    case 'SET_DB':          return { ...state, db: action.payload };
    case 'UPDATE_MODULE':   return { ...state, db: { ...state.db, [action.mod]: action.data } };
    case 'SET_ACCT':        return { ...state, acctData: action.payload };
    case 'ADD_ACTIVITY':    return { ...state, activity: [action.payload, ...state.activity].slice(0, 500) };
    case 'SET_SETTINGS':    return { ...state, appSettings: action.payload };
    case 'SET_CLOUD':       return { ...state, cloudReady: action.payload };
    case 'SET_OFFLINE':     return { ...state, offlineMode: action.payload };
    case 'SET_LOADING':     return { ...state, loading: action.payload };
    case 'SET_ACTIVITY':    return { ...state, activity: action.payload };
    // ── Document scanner ─────────────────────────────────────────────────────
    case 'ADD_SCAN_DOC':    return { ...state, scannedDocs: [action.payload, ...state.scannedDocs].slice(0, 100) };
    case 'CLEAR_SCAN_DOCS': return { ...state, scannedDocs: [] };
    default: return state;
  }
}

export function AppProvider({ children, initialState: initialStateOverride }) {
  const [state, dispatch] = useReducer(reducer, initialStateOverride || initialState);
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
export const defaultAppState = initialState;
