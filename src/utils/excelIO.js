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
 * Download a CSV template for a module
 */
export function downloadTemplate(moduleName, columns, exampleRows = []) {
  const data = exampleRows.length ? exampleRows : [Object.fromEntries(columns.map(c => [c, '']))];
  exportToCSV(`${moduleName}_import_template`, data, { title: `${moduleName} Import Template` });
}

// ── Per-module column definitions ─────────────────────────────────────────────
export const MODULE_COLUMNS = {
  nlng: {
    label: 'Contract Staff (NLNG)',
    columns: ['fullName','email','refId','department','role','workLocation','dob','stateOfOrigin','lga','phone','bank','accountNo','basicSalary','housing','transport','grossSalary','status'],
    example: [{ fullName:'Adewale Okonkwo', email:'a.okonkwo@nlng.com', refId:'NLNG-ENG-001', department:'Engineering', role:'Project Engineer', workLocation:'Port Harcourt', dob:'1988-04-15', stateOfOrigin:'Rivers', lga:'Port Harcourt', phone:'08034567890', bank:'GTBank', accountNo:'0123456789', basicSalary:350000, housing:70000, transport:35000, grossSalary:455000, status:'Active' }],
  },
  slot: {
    label: 'Company Staff (SLOT)',
    columns: ['fullName','staffId','email','phone','department','jobTitle','employmentType','startDate','basicSalary','housing','transport','medicalAllowance','grossSalary','bank','accountNo','pensionPin','status'],
    example: [{ fullName:'Chidi Okafor', staffId:'SLOT-001', email:'c.okafor@slotng.com', phone:'08012345678', department:'Finance', jobTitle:'Accountant', employmentType:'Full-time', startDate:'2023-01-01', basicSalary:250000, housing:50000, transport:25000, medicalAllowance:20000, grossSalary:345000, bank:'Access Bank', accountNo:'1234567890', pensionPin:'PEN100123456', status:'Active' }],
  },
  invoices: {
    label: 'Invoices',
    columns: ['invoiceNo','client','clientAddress','projectRef','category','date','dueDate','paymentTerms','notes'],
    example: [{ invoiceNo:'INV-2025-001', client:'Nigeria LNG Limited', clientAddress:'Bonny Island', projectRef:'NLNG-PROJECT-001', category:'Engineering Services', date:'2025-01-15', dueDate:'2025-02-15', paymentTerms:'Net 30', notes:'' }],
  },
  procurement: {
    label: 'Purchase Orders',
    columns: ['poNo','supplier','date','deliveryDate','description','status','paymentTerms','notes'],
    example: [{ poNo:'PO-2025-0001', supplier:'Dangote Industries Ltd', date:'2025-01-10', deliveryDate:'2025-01-25', description:'Reinforcement steel supply', status:'Draft', paymentTerms:'Net 30', notes:'' }],
  },
  grn: {
    label: 'Goods Received Notes',
    columns: ['grnNo','date','poRef','supplier','receivedBy','store','inspectionStatus','notes'],
    example: [{ grnNo:'GRN-2025-001', date:'2025-01-20', poRef:'PO-2025-0001', supplier:'Dangote Industries Ltd', receivedBy:'Emeka Eze', store:'Main Warehouse', inspectionStatus:'Accepted', notes:'' }],
  },
  inventory: {
    label: 'Inventory',
    columns: ['name','regNumber','type','make','quantity','position','status','remark'],
    example: [{ name:'Reinforcement Steel 16mm', regNumber:'INV-2025-001', type:'material', make:'Alstom', quantity:'500 tonnes', position:'Yard A - Bay 3', status:'Available', remark:'' }],
  },
  vehicles: {
    label: 'Fleet / Vehicles',
    columns: ['vehicleNumber','make','yearOfPurchase','unitServing','engineNo','chassisNo','colour','insuranceExpiry','roadWorthinessExpiry','licenceExpiry'],
    example: [{ vehicleNumber:'PH-458-AHZ', make:'Toyota Hilux D4D', yearOfPurchase:2021, unitServing:'Operations', engineNo:'ENG123', chassisNo:'CHS456', colour:'White', insuranceExpiry:'2025-12-31', roadWorthinessExpiry:'2025-11-30', licenceExpiry:'2025-12-31' }],
  },
  pettycash: {
    label: 'Petty Cash',
    columns: ['voucherNo','date','payee','category','purpose','amount','requestedBy','approvedBy','status'],
    example: [{ voucherNo:'PCV-2025-001', date:'2025-01-10', payee:'Fuel Station', category:'Fuel & Transport', purpose:'Generator fuel', amount:15000, requestedBy:'Bello Usman', approvedBy:'Manager', status:'Approved' }],
  },
  fixedassets: {
    label: 'Fixed Assets',
    columns: ['description','category','serialNo','location','department','purchaseDate','cost','residualValue','usefulLifeYrs','condition','assignedTo','notes'],
    example: [{ description:'Caterpillar 320D Excavator', category:'Plant & Equipment', serialNo:'CAT320D-2021-001', location:'Bonny Island Site', department:'Engineering', purchaseDate:'2021-06-01', cost:85000000, residualValue:8500000, usefulLifeYrs:10, condition:'Good', assignedTo:'Site Engineering Team', notes:'' }],
  },
  salesOrders: {
    label: 'Sales Orders',
    columns: ['client','clientCode','projectRef','date','expectedDelivery','currency','status','description','qty','unit','unitPrice','notes'],
    example: [{ client:'Nigeria LNG Limited', clientCode:'NLNG NGN', projectRef:'NLNG HRSS-Q3', date:'2026-07-01', expectedDelivery:'2026-07-15', currency:'NGN', status:'Confirmed', description:'Engineering & Technical Support — Q3 retainer', qty:3, unit:'month', unitPrice:4500000, notes:'' }],
    note: 'Each row becomes one Sales Order with a single line item (description/qty/unit/unitPrice). For orders needing multiple line items, import the first line then add the rest directly in Sales Orders.',
  },
  ap_bills: {
    label: 'Accounts Payable Bills',
    columns: ['vendor','vendorName','currency','fxRate','category','date','dueDate','projectCode','description','amount','vatAmount','whtRate','whtAmount','netPayable','status','notes'],
    example: [{ vendor:'WORLDWIDE ENERGY LOG', vendorName:'Worldwide Energy Logistics Ltd', currency:'NGN', fxRate:1, category:'Logistics', date:'2026-06-01', dueDate:'2026-07-01', projectCode:'NLNG HRSS', description:'Logistics & Haulage Services', amount:1850000, vatAmount:138750, whtRate:5, whtAmount:92500, netPayable:1896250, status:'Unpaid', notes:'' }],
  },
  fleet_roster: {
    label: 'Fleet Roster',
    columns: ['vehicleNo','vehicleType','make','model','year','engineNo','chassisNo','assignedDriver','assignedUnit','currentLocation','vehicleLicenseExpiry','insuranceCertExpiry','roadWorthinessExpiry','currentKm','status'],
    example: [{ vehicleNo:'AA-001-PH', vehicleType:'SUV', make:'Toyota', model:'Land Cruiser 200', year:2020, engineNo:'ENG-FL01-2020', chassisNo:'CHS-FL01-2020', assignedDriver:'Ernest Ojukwu', assignedUnit:'Management', currentLocation:'Port Harcourt HQ', vehicleLicenseExpiry:'2026-12-31', insuranceCertExpiry:'2026-12-31', roadWorthinessExpiry:'2026-09-30', currentKm:'0', status:'Active' }],
    note: 'Imports into the vehicle roster only — maintenance/repair history is a separate record type not covered by import.',
  },
  terminal_containers: {
    label: 'Terminal Containers',
    columns: ['containerNo','containerType','size','portType','shippingCompany','shippingVessel','consigneeName','materialDescription','billOfLading','noOfContainers','status'],
    example: [{ containerNo:'MSCU1234567', containerType:'20ft DV', size:'20ft', portType:'Sea', shippingCompany:'MSC Mediterranean Shipping', shippingVessel:'MSC LUNA', consigneeName:'SLOT Engineering Nigeria Ltd', materialDescription:'Industrial Pipes & Fittings', billOfLading:'MSCUB123456', noOfContainers:1, status:'Released' }],
    note: 'Imports into Containers only — Bills of Lading, Charges, Logistics, and Advances are separate record types not covered by import.',
  },
};
