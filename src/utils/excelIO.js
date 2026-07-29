// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Excel / CSV Export Utility v2.0
// FIX: Removed CDN dynamic import (https://cdn.sheetjs.com/...) which caused
// Vite to hang during pre-bundling. Now uses CSV export which needs no external
// dependency and works instantly.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Export an array of objects to a .csv file (opens in Excel, Numbers, Sheets).
 * @param {string}   filename  - Output filename without extension
 * @param {object[]} data      - Array of flat objects
 * @param {object}   [options] - { sheetName, title }
 */
export function exportToCSV(filename, data, options = {}) {
  if (!data || data.length === 0) throw new Error('No data to export');
  const { title } = options;
  const headers = Object.keys(data[0]);
  const escape  = v => { const s = String(v ?? '').replace(/"/g, '""'); return s.includes(',') || s.includes('\n') || s.includes('"') ? `"${s}"` : s; };
  const rows = [
    ...(title ? [[title], []] : []),
    headers,
    ...data.map(row => headers.map(h => escape(row[h] ?? ''))),
  ];
  const csv  = rows.map(r => r.map(escape).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${filename}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// Keep same API surface so ExcelManager still works — alias exportToCSV as exportToXLSX
export const exportToXLSX = exportToCSV;

/**
 * Import rows from an uploaded CSV file.
 * @param {File} file
 * @returns {Promise<object[]>}
 */
export function importFromCSV(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = ev => {
      try {
        const text = ev.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { reject(new Error('File has no data rows')); return; }
        const headers = parseCSVLine(lines[0]);
        const rows = lines.slice(1).map(line => {
          const vals = parseCSVLine(line);
          return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
        }).filter(row => Object.values(row).some(v => v !== ''));
        resolve(rows);
      } catch (err) { reject(err); }
    };
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsText(file, 'utf-8');
  });
}

function parseCSVLine(line) {
  const result = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  result.push(cur.trim());
  return result;
}

// Keep same API — alias importFromCSV as importFromXLSX
export const importFromXLSX = importFromCSV;

/**
 * Download a CSV template for a module.
 *
 * 2026-07-28: Row 1 (if present) is a SAMPLE row showing the expected
 * format. Every value in it is a placeholder — never a real client, vendor
 * or staff name, and never an amount that resembles a real transaction —
 * and its identity field is flagged "SAMPLE — Delete This Row" so it can't
 * be mistaken for a real record. Earlier versions used real-looking company
 * names (Nigeria LNG, Dangote) and figures that matched fabricated demo
 * data almost exactly; anyone who imported a template without deleting row
 * 1 would have created a real financial record from it.
 */
export function downloadTemplate(moduleName, columns, exampleRows = []) {
  const data = exampleRows.length ? exampleRows : [Object.fromEntries(columns.map(c => [c, '']))];
  exportToCSV(`${moduleName}_import_template`, data, { title: `${moduleName} Import Template — Row 1 is a SAMPLE. Delete it before importing your own data.` });
}

// ── Per-module column definitions ─────────────────────────────────────────────
//
// 2026-07-28: every `example` row below was rewritten to use placeholder
// values only. They used to carry real SLOT client/vendor names (Nigeria
// LNG, Dangote, MSC) and amounts that matched fabricated demo data almost
// to the naira (e.g. fixedassets' ₦85,000,000 excavator, ap_bills'
// ₦1,850,000 bill) — see the same-day commit that emptied those SEED
// constants elsewhere for what they matched. A template is downloaded,
// not reviewed line-by-line before import, so every row's most visible
// identity field now reads "SAMPLE — Delete This Row".
export const MODULE_COLUMNS = {
  nlng: {
    label: 'Contract Staff (NLNG)',
    columns: ['fullName','email','refId','department','role','workLocation','dob','stateOfOrigin','lga','phone','bank','accountNo','basicSalary','housing','transport','grossSalary','status'],
    example: [{ fullName:'SAMPLE — Delete This Row', email:'sample.employee@example.com', refId:'SAMPLE-001', department:'Engineering', role:'Project Engineer', workLocation:'Port Harcourt', dob:'1990-01-01', stateOfOrigin:'Rivers', lga:'Port Harcourt', phone:'08000000000', bank:'Sample Bank', accountNo:'0000000000', basicSalary:100000, housing:20000, transport:10000, grossSalary:130000, status:'Active' }],
  },
  slot: {
    label: 'Company Staff (SLOT)',
    columns: ['fullName','staffId','email','phone','department','jobTitle','employmentType','startDate','basicSalary','housing','transport','medicalAllowance','grossSalary','bank','accountNo','pensionPin','status'],
    example: [{ fullName:'SAMPLE — Delete This Row', staffId:'SAMPLE-001', email:'sample.staff@example.com', phone:'08000000000', department:'Finance', jobTitle:'Accountant', employmentType:'Full-time', startDate:'2024-01-01', basicSalary:100000, housing:20000, transport:10000, medicalAllowance:10000, grossSalary:140000, bank:'Sample Bank', accountNo:'0000000000', pensionPin:'PEN000000000', status:'Active' }],
  },
  invoices: {
    label: 'Invoices',
    columns: ['invoiceNo','client','clientAddress','projectRef','category','date','dueDate','paymentTerms','notes'],
    example: [{ invoiceNo:'SAMPLE-INV-0001', client:'SAMPLE — Delete This Row', clientAddress:'Sample Address', projectRef:'SAMPLE-PROJECT', category:'Engineering Services', date:'2025-01-15', dueDate:'2025-02-15', paymentTerms:'Net 30', notes:'Delete this row before importing' }],
  },
  procurement: {
    label: 'Purchase Orders',
    columns: ['poNo','supplier','date','deliveryDate','description','status','paymentTerms','notes'],
    example: [{ poNo:'SAMPLE-PO-0001', supplier:'SAMPLE — Delete This Row', date:'2025-01-10', deliveryDate:'2025-01-25', description:'Sample item description', status:'Draft', paymentTerms:'Net 30', notes:'Delete this row before importing' }],
  },
  grn: {
    label: 'Goods Received Notes',
    columns: ['grnNo','date','poRef','supplier','receivedBy','store','inspectionStatus','notes'],
    example: [{ grnNo:'SAMPLE-GRN-0001', date:'2025-01-20', poRef:'SAMPLE-PO-0001', supplier:'SAMPLE — Delete This Row', receivedBy:'Sample Staff', store:'Main Warehouse', inspectionStatus:'Accepted', notes:'Delete this row before importing' }],
  },
  inventory: {
    label: 'Inventory',
    columns: ['name','regNumber','type','make','quantity','position','status','remark'],
    example: [{ name:'SAMPLE — Delete This Row', regNumber:'SAMPLE-001', type:'material', make:'Sample Make', quantity:'1', position:'Yard A - Bay 3', status:'Available', remark:'Delete this row before importing' }],
  },
  vehicles: {
    label: 'Fleet / Vehicles',
    columns: ['vehicleNumber','make','yearOfPurchase','unitServing','engineNo','chassisNo','colour','insuranceExpiry','roadWorthinessExpiry','licenceExpiry'],
    example: [{ vehicleNumber:'SAMPLE-000-XX', make:'SAMPLE — Delete This Row', yearOfPurchase:2021, unitServing:'Operations', engineNo:'SAMPLE-ENG', chassisNo:'SAMPLE-CHS', colour:'White', insuranceExpiry:'2025-12-31', roadWorthinessExpiry:'2025-11-30', licenceExpiry:'2025-12-31' }],
  },
  pettycash: {
    label: 'Petty Cash',
    columns: ['voucherNo','date','payee','category','purpose','amount','requestedBy','approvedBy','status'],
    example: [{ voucherNo:'SAMPLE-PCV-0001', date:'2025-01-10', payee:'SAMPLE — Delete This Row', category:'Fuel & Transport', purpose:'Sample purpose', amount:1000, requestedBy:'Sample Staff', approvedBy:'', status:'Pending' }],
  },
  fixedassets: {
    label: 'Fixed Assets',
    columns: ['description','category','serialNo','location','department','purchaseDate','cost','residualValue','usefulLifeYrs','condition','assignedTo','notes'],
    example: [{ description:'SAMPLE — Delete This Row', category:'Plant & Equipment', serialNo:'SAMPLE-001', location:'Sample Location', department:'Engineering', purchaseDate:'2021-06-01', cost:100000, residualValue:10000, usefulLifeYrs:10, condition:'Good', assignedTo:'Sample Team', notes:'Delete this row before importing' }],
  },
  salesOrders: {
    label: 'Sales Orders',
    columns: ['client','clientCode','projectRef','date','expectedDelivery','currency','status','description','qty','unit','unitPrice','notes'],
    example: [{ client:'SAMPLE — Delete This Row', clientCode:'SAMPLE', projectRef:'SAMPLE-PROJECT', date:'2026-07-01', expectedDelivery:'2026-07-15', currency:'NGN', status:'Draft', description:'Sample item description', qty:1, unit:'month', unitPrice:100000, notes:'Delete this row before importing' }],
    note: 'Each row becomes one Sales Order with a single line item (description/qty/unit/unitPrice). For orders needing multiple line items, import the first line then add the rest directly in Sales Orders.',
  },
  ap_bills: {
    label: 'Accounts Payable Bills',
    columns: ['vendor','vendorName','currency','fxRate','category','date','dueDate','projectCode','description','amount','vatAmount','whtRate','whtAmount','netPayable','status','notes'],
    example: [{ vendor:'SAMPLE — Delete This Row', vendorName:'Sample Vendor Ltd', currency:'NGN', fxRate:1, category:'Logistics', date:'2026-06-01', dueDate:'2026-07-01', projectCode:'SAMPLE-PROJECT', description:'Sample service description', amount:100000, vatAmount:7500, whtRate:5, whtAmount:5000, netPayable:102500, status:'Unpaid', notes:'Delete this row before importing' }],
  },
  fleet_roster: {
    label: 'Fleet Roster',
    columns: ['vehicleNo','vehicleType','make','model','year','engineNo','chassisNo','assignedDriver','assignedUnit','currentLocation','vehicleLicenseExpiry','insuranceCertExpiry','roadWorthinessExpiry','currentKm','status'],
    example: [{ vehicleNo:'SAMPLE-000-XX', vehicleType:'SUV', make:'SAMPLE — Delete This Row', model:'Sample Model', year:2020, engineNo:'SAMPLE-ENG', chassisNo:'SAMPLE-CHS', assignedDriver:'Sample Driver', assignedUnit:'Management', currentLocation:'Port Harcourt HQ', vehicleLicenseExpiry:'2026-12-31', insuranceCertExpiry:'2026-12-31', roadWorthinessExpiry:'2026-09-30', currentKm:'0', status:'Active' }],
    note: 'Imports into the vehicle roster only — maintenance/repair history is a separate record type not covered by import.',
  },
  terminal_containers: {
    label: 'Terminal Containers',
    columns: ['containerNo','containerType','size','portType','shippingCompany','shippingVessel','consigneeName','materialDescription','billOfLading','noOfContainers','status'],
    example: [{ containerNo:'SAMPLE0000001', containerType:'20ft DV', size:'20ft', portType:'Sea', shippingCompany:'SAMPLE — Delete This Row', shippingVessel:'Sample Vessel', consigneeName:'Sample Consignee Ltd', materialDescription:'Sample material description', billOfLading:'SAMPLE-BOL-001', noOfContainers:1, status:'Arrived' }],
    note: 'Imports into Containers only — Bills of Lading, Charges, Logistics, and Advances are separate record types not covered by import.',
  },
};
