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

// ══════════════════════════════════════════════════════════════════════════════
// Real-world spreadsheet adaptation
// ══════════════════════════════════════════════════════════════════════════════
//
// Staff do not keep their records in our field names. A terminal register is
// a human sheet: a company banner across row 1, headers like "CONTAINER Nos"
// and "SHIPPING COY", typos that have been there for years ("RECIPT",
// "TRANSIRE"), day-first dates, and merged cells where one Bill of Lading
// covers several containers.
//
// Telling people to restructure that by hand before every upload guarantees
// two things: it won't get done, and when it is done it will be done
// inconsistently. So the importer meets the spreadsheet where it is.
//
// Four adaptations, all reversible and all reported to the user:
//   1. find the real header row (skip banners)
//   2. translate known column labels to field names
//   3. read day-first dates
//   4. carry merged-cell values down
// ══════════════════════════════════════════════════════════════════════════════

// Compare headers ignoring case, spaces, punctuation and trailing blanks, so
// "BILL OF LADING No." · "bill_of_lading_no" · "billOfLading" all agree.
function normaliseHeader(h) {
  return String(h || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Known real-world labels → our field names. Add to this list whenever a new
// client sheet turns up; it is cheaper than asking them to change their file.
const COLUMN_ALIASES = {
  terminal_containers: {
    DATEOFTRANSIREAPPLICATION: 'transireDate',
    TRANSIREDATE:              'transireDate',
    BILLOFLADINGNO:            'billOfLading',
    BILLOFLADING:              'billOfLading',
    BL:                        'billOfLading',
    NOOFCONTAINERSBILLLADDING: 'noOfContainers',
    NOOFCONTAINERSBILLLADING:  'noOfContainers',
    NOOFCONTAINERS:            'noOfContainers',
    SIZESOFCONTAINERS:         'size',
    SIZE:                      'size',
    CONTAINERNOS:              'containerNo',
    CONTAINERNO:               'containerNo',
    CONTAINERNUMBER:           'containerNo',
    MATERIALDESCRIPTIONPACKAGE:'materialDescription',
    MATERIALDESCRIPTION:       'materialDescription',
    NAMEOFCONSIGNEE:           'consigneeName',
    CONSIGNEE:                 'consigneeName',
    CONSIGNEENAME:             'consigneeName',
    SHIPPINGCOY:               'shippingCompany',
    SHIPPINGCOMPANY:           'shippingCompany',
    SHIPPINGLINE:              'shippingCompany',
    SHIPPINGVESSEL:            'shippingVessel',
    VESSEL:                    'shippingVessel',
    DATEOFRECIPTINTOWAREHOUSE: 'warehouseReceiptDate',   // sic — their spelling
    DATEOFRECEIPTINTOWAREHOUSE:'warehouseReceiptDate',
    WAREHOUSERECEIPTDATE:      'warehouseReceiptDate',
    DATEOFEXAMINATION:         'examinationDate',
    EXAMINATIONDATE:           'examinationDate',
    DATEOFRELEASE:             'releaseDate',
    RELEASEDATE:               'releaseDate',
    REMARK:                    'remark',
    REMARKS:                   'remark',
    PORTTYPE:                  'portType',
    STATUS:                    'status',
    CONTAINERTYPE:             'containerType',
  },
};

// Fields read as dates, per module.
const DATE_FIELDS = {
  terminal_containers: ['transireDate', 'warehouseReceiptDate', 'examinationDate', 'releaseDate'],
};

// Fields that carry DOWN a merged block. Never include an identity field —
// inheriting a container number would silently duplicate boxes.
const INHERITED_FIELDS = {
  terminal_containers: ['billOfLading', 'noOfContainers', 'transireDate', 'materialDescription',
                        'consigneeName', 'shippingCompany', 'shippingVessel', 'size'],
};

/**
 * Day-first date → ISO. Returns the original string untouched if it is not a
 * recognisable day-first date, so ISO input and free text both pass through.
 *
 * Day-first is the right assumption for these sheets: values like 13/1/2026
 * are unambiguous (there is no 13th month) and the registers are written by
 * Nigerian operators, where DD/MM/YYYY is standard. Reading them as US dates
 * would silently turn 5/1/2026 (5 January) into 1 May.
 */
export function parseDayFirstDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;              // already ISO

  // Letter O typed for a zero, inside an otherwise numeric date.
  let v = raw;
  if (/^[\dOo]{1,2}[/-][\dOo]{1,2}[/-][\dOo]{2,5}$/.test(v)) v = v.replace(/[Oo]/g, '0');

  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,5})$/);
  if (!m) return raw;

  const day = +m[1], month = +m[2];
  let year = +m[3];
  if (m[3].length > 4) return '';                               // "10126" — a slip
  if (year < 100) year += 2000;

  // Outside this range the value is a typo, not a date. Blank it rather than
  // guess — an invented date in a customs record is worse than a missing one.
  if (year < 2000 || year > 2035) return '';
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';

  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

/**
 * Pick the header row. A human sheet often opens with a title banner, so the
 * real headers can be on row 2, 3 or lower. Score each candidate by how many
 * of its cells we recognise and take the best — never guess blindly.
 */
function findHeaderRow(rows, modKey) {
  const aliases = COLUMN_ALIASES[modKey] || {};
  const known = new Set([...Object.keys(aliases), ...(MODULE_COLUMNS[modKey]?.columns || []).map(normaliseHeader)]);
  let best = { index: 0, score: -1 };

  rows.slice(0, 10).forEach((cells, i) => {
    const score = cells.filter(c => c && known.has(normaliseHeader(c))).length;
    if (score > best.score) best = { index: i, score };
  });
  return best;
}

/**
 * Turn a raw grid into field-named rows, applying all four adaptations.
 * Returns { rows, info } — `info` describes what was adapted so the UI can
 * tell the user rather than silently transforming their file.
 */
export function adaptRows(grid, modKey) {
  const { index: hdrIdx, score } = findHeaderRow(grid, modKey);
  const aliases = COLUMN_ALIASES[modKey] || {};
  const headers = (grid[hdrIdx] || []).map(h => {
    const n = normaliseHeader(h);
    return aliases[n] || (MODULE_COLUMNS[modKey]?.columns || []).find(c => normaliseHeader(c) === n) || h;
  });

  const dateFields = DATE_FIELDS[modKey] || [];
  const inherit    = INHERITED_FIELDS[modKey] || [];
  const carried    = {};
  const info       = { headerRow: hdrIdx + 1, matchedColumns: score, bannerSkipped: hdrIdx > 0, filledDown: 0, datesConverted: 0 };

  const rows = [];
  grid.slice(hdrIdx + 1).forEach(cells => {
    if (!cells.some(c => String(c || '').trim())) return;       // wholly blank line

    const row = {};
    headers.forEach((h, i) => { row[h] = String(cells[i] ?? '').trim(); });

    inherit.forEach(f => {
      if (!(f in row)) return;
      if (row[f]) carried[f] = row[f];
      else if (carried[f]) { row[f] = carried[f]; info.filledDown++; }
    });

    dateFields.forEach(f => {
      if (!row[f]) return;
      const iso = parseDayFirstDate(row[f]);
      if (iso !== row[f]) info.datesConverted++;
      row[f] = iso;
    });

    rows.push(row);
  });

  return { rows, info };
}

/**
 * Import rows from an uploaded CSV, adapted to the target module's fields.
 * @param {File} file
 * @param {string} modKey  which MODULE_COLUMNS entry the file is destined for
 */
export function importAdapted(file, modKey) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = ev => {
      try {
        const lines = String(ev.target.result).split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { reject(new Error('File has no data rows')); return; }
        resolve(adaptRows(lines.map(parseCSVLine), modKey));
      } catch (err) { reject(err); }
    };
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsText(file, 'utf-8');
  });
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
  // 2026-07-29: nlng/slot columns were drifted from the real Add/Edit Staff
  // forms in ContractStaff.jsx / SlotStaff.jsx — e.g. slot used `staffId`,
  // `jobTitle`, `employmentType`, `startDate`, `pensionPin`, none of which
  // exist on an actual staff record (the real fields are `refId`,
  // `serviceTitle`, `workLocation`, `employmentDate`; there's no
  // employmentType/pensionPin field at all). Since export reads `row[col]`
  // straight off the real record, every mismatched column exported blank
  // and real data (refId, serviceTitle, employmentDate, projectCode…) was
  // left out entirely — and templates built from the wrong names taught
  // users to fill in columns the app would silently ignore. Both lists below
  // now mirror the live form fields exactly, in the same order as the form's
  // own sections, so Export / Template / Import all round-trip real data.
  nlng: {
    label: 'Contract Staff (NLNG)',
    columns: ['fullName','refId','email','phone','dob','stateOfOrigin','lga','department','role','workLocation','projectCode','employmentDate','refIndicator','bank','accountNo','basicSalary','housing','transport','bonnyAllowance','leaveAllowance','eoyBonus','overtimeAllowance','otherAddition','voluntaryPension','salaryAdvance','loan','status'],
    example: [{ fullName:'SAMPLE — Delete This Row', refId:'SAMPLE-001', email:'sample.employee@example.com', phone:'08000000000', dob:'1990-01-01', stateOfOrigin:'Rivers', lga:'Port Harcourt', department:'Engineering', role:'Project Engineer', workLocation:'Port Harcourt', projectCode:'', employmentDate:'2024-01-01', refIndicator:'SAMPLE/22C', bank:'Sample Bank', accountNo:'0000000000', basicSalary:100000, housing:20000, transport:10000, bonnyAllowance:0, leaveAllowance:0, eoyBonus:0, overtimeAllowance:0, otherAddition:0, voluntaryPension:0, salaryAdvance:0, loan:0, status:'Active' }],
  },
  slot: {
    label: 'Company Staff (SLOT)',
    columns: ['fullName','refId','employmentDate','department','serviceTitle','workLocation','projectCode','status','phone','email','bank','accountNo','basicSalary','housing','transport','otherAddition'],
    example: [{ fullName:'SAMPLE — Delete This Row', refId:'SAMPLE-001', employmentDate:'2024-01-01', department:'Finance', serviceTitle:'Officer', workLocation:'Port Harcourt HQ', projectCode:'', status:'Active', phone:'08000000000', email:'sample.staff@example.com', bank:'Sample Bank', accountNo:'0000000000', basicSalary:100000, housing:20000, transport:10000, otherAddition:0 }],
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
    // 2026-08-03: extended with the four clearing-lifecycle dates
    // (transire application → receipt into warehouse → examination →
    // release). A real terminal record keeps these per container, and
    // without them an import is just a list of box numbers with no history.
    // `remark` carries the free-text status note operators actually write.
    columns: ['containerNo','containerType','size','portType','shippingCompany','shippingVessel','consigneeName','materialDescription','billOfLading','noOfContainers','status','transireDate','warehouseReceiptDate','examinationDate','releaseDate','remark'],
    example: [{ containerNo:'SAMPLE0000001', containerType:'20ft DV', size:'20ft', portType:'Sea', shippingCompany:'SAMPLE — Delete This Row', shippingVessel:'Sample Vessel', consigneeName:'Sample Consignee Ltd', materialDescription:'Sample material description', billOfLading:'SAMPLE-BOL-001', noOfContainers:1, status:'Arrived', transireDate:'2026-01-05', warehouseReceiptDate:'2026-01-10', examinationDate:'2026-01-13', releaseDate:'2026-01-13', remark:'Delete this row before importing' }],
    note: 'Rows sharing a Bill of Lading number are grouped into one BoL automatically, with their containers linked underneath. Dates must be YYYY-MM-DD — a day-first date like 13/1/2026 is ambiguous to a spreadsheet and will not import.',
  },
};
