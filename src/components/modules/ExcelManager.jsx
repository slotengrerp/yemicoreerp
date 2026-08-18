// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Excel Import / Export Manager v1.0
// Per-module Excel export + template download + file import with preview
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useRef } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { showToast, generateId } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity } from '../../utils/audit';
import { exportToXLSX, importAdapted, downloadTemplate, MODULE_COLUMNS } from '../../utils/excelIO';
import { diffAndPush } from '../../hooks/usePerRecordSync';

// modKey → RECORD_TABLES key, for the bulk-import push below. Most flat
// modules match 1:1 (the modKey IS the RECORD_TABLES key — nlng, slot,
// invoices, inventory, vehicles, pettycash, fixedassets, salesOrders all
// happen to already agree); only the four NESTED_TARGETS ones need
// remapping since their modKey names differ from the RECORD_TABLES keys.
//
// FOUND 2026-07-29, same sweep that wired every other module's save
// function: this import path bypasses every module's own save/updateDB
// entirely (dispatches UPDATE_MODULE + saveDBLocal directly), so wiring
// ContractStaff.jsx/SlotStaff.jsx's updateDB alone did NOT cover a staff
// list imported from here — the exact same class of bug as the original
// incident, reachable through a second door.
const IMPORT_TABLE_OVERRIDES = {
  procurement: 'procurementPos',
  ap_bills: 'apBills',
  fleet_roster: 'fleetVehicles',
  terminal_containers: 'terminalContainers',
};

function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = {
    primary: { bg:C.green,   co:'#fff', b:'none' },
    ghost:   { bg:'transparent', co:C.textMid, b:'1px solid '+C.border },
    danger:  { bg:C.danger,  co:'#fff', b:'none' },
    amber:   { bg:C.amber,   co:'#fff', b:'none' },
    outline: { bg:'transparent', co:C.green, b:'1px solid '+C.green },
  }[variant] || {};
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7, padding:sm?'5px 12px':'8px 18px', fontSize:sm?12:13, fontWeight:500, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1, display:'inline-flex', alignItems:'center', gap:6, whiteSpace:'nowrap', ...style }}>
      {children}
    </button>
  );
}

function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}

export default function ExcelManager() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { db, currentUser } = state;

  const [selectedMod, setSelectedMod] = useState('nlng');
  const [importing,   setImporting]   = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [preview,     setPreview]     = useState(null); // { rows, modKey }
  const [importError, setImportError] = useState('');
  const fileRef = useRef(null);

  const modKeys = Object.keys(MODULE_COLUMNS);
  const cfg     = MODULE_COLUMNS[selectedMod];

  // Some modules don't live as a flat db[key] array — they're a sub-array
  // inside a parent object (db.procurement.pos, db.ap.bills, etc.). This map
  // is the single source of truth for that, used by both export (reading
  // current rows) and import (merging new rows back in) below.
  const NESTED_TARGETS = {
    procurement:         { parentKey: 'procurement', childKey: 'pos' },
    ap_bills:            { parentKey: 'ap',           childKey: 'bills' },
    fleet_roster:        { parentKey: 'fleet',         childKey: 'fleet' },
    terminal_containers: { parentKey: 'terminal',      childKey: 'containers' },
  };

  // ── Duplicate defence ─────────────────────────────────────────────────────
  // Every import used to be a blind append: `[...existing, ...incoming]`. Two
  // people uploading the same spreadsheet — which is exactly what happens when
  // several staff are testing at once and nobody knows who has already done it
  // — silently doubled every record, and nothing in the app or the database
  // objected, because the only unique key anywhere is the randomly generated
  // `id`. Same invoice, two ids, both stored.
  //
  // This maps each import type to the field(s) that identify a record in the
  // real world. A row whose natural key already exists is a re-upload, not new
  // data.
  //
  // Terminal containers deliberately key on containerNo + billOfLading, NOT
  // containerNo alone: the same physical box legitimately returns months later
  // on a different Bill of Lading, and blocking that would reject real work.
  // The same box on the SAME BoL is always a duplicate.
  const NATURAL_KEYS = {
    nlng:                ['refId'],
    slot:                ['refId'],
    invoices:            ['invoiceNo'],
    procurement:         ['poNo'],
    ap_bills:            ['vendor', 'date', 'amount'],
    fixedassets:         ['serialNo'],
    fleet_roster:        ['vehicleNo'],
    salesOrders:         ['orderNo'],
    terminal_containers: ['containerNo', 'billOfLading'],
  };

  function keyOf(row, fields) {
    return fields
      .map(f => String(row?.[f] ?? '').trim().toUpperCase())
      .join('␟');                     // unit separator — can't occur in real data
  }

  // Returns { fresh, dupInFile, dupExisting } without mutating anything.
  function splitDuplicates(rows, modKey) {
    const fields = NATURAL_KEYS[modKey];
    if (!fields) return { fresh: rows, dupInFile: [], dupExisting: [], fields: null };

    const nestedT = NESTED_TARGETS[modKey];
    const current = nestedT
      ? (db[nestedT.parentKey]?.[nestedT.childKey] || [])
      : (Array.isArray(db[modKey]) ? db[modKey] : []);

    // A row with a blank natural key can't be judged, so it is treated as new
    // rather than silently dropped — losing data would be worse than a dupe.
    const known = new Set(
      current
        .filter(r => fields.some(f => String(r?.[f] ?? '').trim()))
        .map(r => keyOf(r, fields))
    );

    const seen = new Set();
    const fresh = [], dupInFile = [], dupExisting = [];

    rows.forEach(row => {
      if (!fields.some(f => String(row?.[f] ?? '').trim())) { fresh.push(row); return; }
      const k = keyOf(row, fields);
      if (known.has(k))      { dupExisting.push(row); return; }
      if (seen.has(k))       { dupInFile.push(row);   return; }
      seen.add(k);
      fresh.push(row);
    });

    return { fresh, dupInFile, dupExisting, fields };
  }

  const nested  = NESTED_TARGETS[selectedMod];
  const dbRows  = nested
    ? (db[nested.parentKey]?.[nested.childKey] || [])
    : (Array.isArray(db[selectedMod]) ? db[selectedMod] : []);

  // ── Export ────────────────────────────────────────────────────────────────
  async function handleExport() {
    if (dbRows.length === 0) { showToast('No data in this module to export', 'error'); return; }
    setExporting(true);
    try {
      const data = dbRows.map(row => {
        const out = {};
        cfg.columns.forEach(col => { out[col] = row[col] ?? ''; });
        return out;
      });
      await exportToXLSX(
        `${selectedMod}_export_${new Date().toISOString().slice(0,10)}`,
        data,
        { sheetName: cfg.label, title: `${cfg.label} — Exported ${new Date().toLocaleDateString('en-GB')}` }
      );
      logActivity(dispatch, `Exported ${dbRows.length} rows from ${cfg.label} to Excel`, currentUser, { module:selectedMod, action:'info' });
      showToast(`${cfg.label} exported (${dbRows.length} rows)`);
    } catch (err) {
      showToast('Export failed: ' + err.message, 'error');
    } finally {
      setExporting(false);
    }
  }

  // ── Template download ─────────────────────────────────────────────────────
  async function handleTemplate() {
    try {
      await downloadTemplate(cfg.label, cfg.columns, cfg.example);
      showToast('Template downloaded');
    } catch (err) {
      showToast('Could not generate template: ' + err.message, 'error');
    }
  }

  // ── Import — Step 1: read file → preview ─────────────────────────────────
  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setPreview(null);
    setImporting(true);
    try {
      // importAdapted finds the real header row (skipping any title banner),
      // translates the sheet's own column labels into our field names, reads
      // day-first dates, and carries merged-cell values down. `info` records
      // what it changed so we can show the user rather than transform their
      // file silently.
      const { rows, info } = await importAdapted(file, selectedMod);
      if (!rows || rows.length === 0) { setImportError('File is empty or has no data rows.'); return; }

      const fileHeaders = Object.keys(rows[0]);
      const matched = cfg.columns.filter(c => fileHeaders.includes(c));
      if (matched.length < 2) {
        setImportError(
          `Couldn't recognise the columns in this file.\n` +
          `Expected columns like: ${cfg.columns.slice(0,5).join(', ')} …\n` +
          `Found in your file: ${fileHeaders.slice(0,6).join(', ')} …\n\n` +
          `If this is a working spreadsheet with its own column names, tell us the headings and we can teach the app to read them — or download the template and paste your data into it.`
        );
        return;
      }
      // Work out the duplicate picture BEFORE the user commits, so the
      // preview can state plainly what will and won't be added.
      const dup = splitDuplicates(rows, selectedMod);
      setPreview({ rows, modKey: selectedMod, file: file.name, info, ...dup });
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // ── Import — Step 2: confirm and merge ───────────────────────────────────
  function handleConfirmImport() {
    if (!preview) return;
    const { modKey } = preview;

    // Import ONLY the rows that aren't already here. `fresh` is computed at
    // preview time by splitDuplicates() and shown to the user before they
    // confirm, so this is never a surprise. Re-derived here rather than
    // trusted blindly in case the underlying data changed while the preview
    // was open — another user importing the same file at the same moment is
    // precisely the scenario this guards.
    const recheck = splitDuplicates(preview.rows, modKey);
    const rows = recheck.fresh;
    const skipped = recheck.dupInFile.length + recheck.dupExisting.length;

    if (rows.length === 0) {
      showToast(`Nothing imported — all ${preview.rows.length} rows are already in ${MODULE_COLUMNS[modKey].label}`, 'error');
      logActivity(dispatch, `Blocked a duplicate import of ${preview.file} into ${MODULE_COLUMNS[modKey].label} — all ${preview.rows.length} rows already present`, currentUser, { module:modKey, action:'info' });
      setPreview(null);
      return;
    }

    // Sales Orders is a special row shape: each imported row becomes ONE
    // order with a SINGLE line item built from description/qty/unit/
    // unitPrice — see the module's `note` in excelIO.js for the limitation
    // this implies (multi-line orders need the extra lines added manually
    // after import).
    const normalised = rows.map(row => {
      if (modKey === 'salesOrders') {
        const { description, qty, unit, unitPrice, ...rest } = row;
        return {
          id: generateId(),
          ...rest,
          items: [{ id: generateId(), description: description||'', qty: Number(qty)||1, unit: unit||'unit', unitPrice: Number(unitPrice)||0, orderedQty: Number(qty)||1, invoicedQty: 0 }],
          invoices: [],
          createdAt: row.createdAt || new Date().toISOString(),
        };
      }
      if (modKey === 'terminal_containers') {
        // Live-verify QA fix (2026-08-18): caught on production — 578
        // imported containers all showed a blank Port Type, so the Reports
        // tab's "Port Type Breakdown" read 0 Sea / 0 Air despite Total
        // Containers reading 578. Root cause: this generic branch spreads
        // the raw sheet row straight through with no defaults, but the
        // sheet has no Port Type column, so the field was never set on any
        // imported container. Manually adding a container already defaults
        // portType to 'Sea' (see the "+ Add Container" button below) —
        // matching that same default here so future imports report
        // correctly instead of silently going blank. Same reasoning for
        // status/noOfContainers, which the manual form also defaults.
        return {
          id: generateId(),
          ...row,
          status: row.status || 'Arrived',
          portType: row.portType || 'Sea',
          noOfContainers: row.noOfContainers || 1,
          createdAt: row.createdAt || new Date().toISOString(),
        };
      }
      return { id: generateId(), ...row, createdAt: row.createdAt || new Date().toISOString() };
    });

    // ── Terminal: rebuild the BoL → containers hierarchy ─────────────────────
    // A terminal spreadsheet is one row per CONTAINER, but many containers
    // share a Bill of Lading — in the source files the BoL number is written
    // once and the rows beneath it are left blank (merged cells in Excel).
    // Importing those rows flat produced containers with no parent, so the
    // Bills of Lading screen stayed empty and the 40-odd BoL-level features
    // (charges, logistics, advances) had nothing to attach to.
    //
    // Group by billOfLading, create one BoL per distinct number, and link
    // every container to it. Shipment-level details (carrier, vessel) are
    // taken from the first row of each group, matching how saveBoL() mirrors
    // them back down onto containers.
    if (modKey === 'terminal_containers') {
      const existingBols = db.terminal?.bols || [];
      const byNumber = new Map(existingBols.map(b => [String(b.billOfLadingNo || '').trim().toUpperCase(), b]));
      const newBols = [];

      normalised.forEach(c => {
        const key = String(c.billOfLading || '').trim().toUpperCase();
        if (!key) return;                    // container with no BoL stays unlinked
        let bol = byNumber.get(key);
        if (!bol) {
          bol = {
            id: generateId(),
            billOfLadingNo: String(c.billOfLading).trim(),
            shippingCompany: c.shippingCompany || '',
            shippingVessel: c.shippingVessel || '',
            consigneeName: c.consigneeName || '',
            portOfLoading: '',
            portOfDischarge: '',
            portType: c.portType || 'Sea',
            status: c.status || 'Arrived',
            transireDate: c.transireDate || '',
            createdAt: new Date().toISOString(),
          };
          byNumber.set(key, bol);
          newBols.push(bol);
        }
        c.bolId = bol.id;
        // noOfContainers on the sheet describes the BoL, not the row.
        bol.noOfContainers = (bol.noOfContainers || 0) + 1;
      });

      const mergedBols = [...existingBols, ...newBols];
      const existingContainers = db.terminal?.containers || [];
      const mergedContainers = [...existingContainers, ...normalised];

      // Await both pushes and REPORT any that failed. Previously these were
      // fire-and-forget, so an import that only half-reached the database
      // still showed a success toast — the user had no way to know. See
      // diffAndPush for the concurrency bug that caused it.
      Promise.all([
        diffAndPush('terminalBols', existingBols, mergedBols),
        diffAndPush('terminalContainers', existingContainers, mergedContainers),
      ]).then(([b, c]) => {
        const failed = (b?.failed || 0) + (c?.failed || 0);
        if (failed > 0) {
          showToast(`⚠ ${failed} record(s) could not be saved to the cloud and exist only on this device. Re-import the file to retry — duplicates will be skipped automatically.`, 'error');
        } else {
          showToast(`☁ All ${normalised.length} containers and ${newBols.length} bills of lading saved to the cloud`);
        }
      });

      const importData = { ...db.terminal, bols: mergedBols, containers: mergedContainers };
      dispatch({ type:'UPDATE_MODULE', mod:'terminal', data: importData });
      saveDBLocal({ ...db, terminal: importData }, state.activity);
      logActivity(dispatch, `Imported ${normalised.length} containers across ${newBols.length} bills of lading from ${preview.file}${skipped ? ` (${skipped} duplicate row(s) skipped)` : ''}`, currentUser, { module:'terminal', action:'create' });
      showToast(`${normalised.length} containers imported under ${newBols.length} new bills of lading` + (skipped ? ` · ${skipped} duplicate row(s) skipped` : ''));
      setPreview(null);
      return;
    }

    const nestedTarget = NESTED_TARGETS[modKey];
    const existing = nestedTarget
      ? (db[nestedTarget.parentKey]?.[nestedTarget.childKey] || [])
      : (Array.isArray(db[modKey]) ? db[modKey] : []);
    const merged = [...existing, ...normalised];

    // Nested modules (procurement.pos, ap.bills, fleet.fleet,
    // terminal.containers) need their PARENT object preserved — only the
    // one child array is replaced, everything else in the parent stays
    // exactly as it was. Flat modules (fixedassets, salesOrders, etc.) just
    // get their top-level array replaced directly.
    const dbKey = nestedTarget ? nestedTarget.parentKey : modKey;
    const importData = nestedTarget
      ? { ...db[nestedTarget.parentKey], [nestedTarget.childKey]: merged }
      : merged;

    // Per-record push — 2026-07-29 full-app sync sweep. `merged` is additions
    // only (existing + normalised), so this is really just "push every newly
    // imported row" — diffAndPush handles that correctly since none of the
    // `existing` rows changed.
    const pushTable = modKey in IMPORT_TABLE_OVERRIDES ? IMPORT_TABLE_OVERRIDES[modKey] : modKey;
    if (pushTable) diffAndPush(pushTable, existing, merged);

    dispatch({ type:'UPDATE_MODULE', mod: dbKey, data: importData });
    saveDBLocal({ ...db, [dbKey]: importData }, state.activity);
    logActivity(dispatch, `Imported ${normalised.length} rows into ${MODULE_COLUMNS[modKey].label} from ${preview.file}${skipped ? ` (${skipped} duplicate row(s) skipped)` : ''}`, currentUser, { module:modKey, action:'create' });
    showToast(`${normalised.length} rows imported into ${MODULE_COLUMNS[modKey].label}` + (skipped ? ` · ${skipped} duplicate row(s) skipped` : ''));
    setPreview(null);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', background:C.tableHeaderBg, whiteSpace:'nowrap' };
  const td = { padding:'8px 10px', borderBottom:'1px solid '+C.borderLight, fontSize:12, color:C.text };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

      {/* Header */}
      <div>
        <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Excel Import / Export</div>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Export any module to .xlsx · Download import templates · Import data from Excel</div>
      </div>

      {/* Module selector */}
      <Card>
        <div style={{ fontSize:13, fontWeight:600, color:C.text, marginBottom:12 }}>Select Module</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          {modKeys.map(key => (
            <button key={key} onClick={() => { setSelectedMod(key); setPreview(null); setImportError(''); }}
              style={{ padding:'6px 14px', borderRadius:20, fontSize:12, fontWeight:500, border:'1px solid '+(selectedMod===key?C.green:C.border), background:selectedMod===key?C.green:'transparent', color:selectedMod===key?'#fff':C.textMid, cursor:'pointer', transition:'all .15s' }}>
              {MODULE_COLUMNS[key].label}
            </button>
          ))}
        </div>
        <div style={{ marginTop:12, fontSize:11.5, color:C.textMuted }}>
          Selected: <strong style={{ color:C.text }}>{cfg.label}</strong> · {dbRows.length} records in database
        </div>
        {cfg.note && (
          <div style={{ marginTop:10, padding:'8px 12px', background:'rgba(201,122,10,.08)', border:'1px solid rgba(201,122,10,.2)', borderLeft:'3px solid '+C.amber, borderRadius:6, fontSize:11.5, color:C.amber }}>
            {cfg.note}
          </div>
        )}
      </Card>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

        {/* Export */}
        <Card>
          <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:6 }}>📤 Export to Excel</div>
          <div style={{ fontSize:12, color:C.textMuted, marginBottom:16, lineHeight:1.6 }}>
            Export all {dbRows.length} records from <strong>{cfg.label}</strong> as a formatted .xlsx file.
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <Btn onClick={handleExport} disabled={exporting || dbRows.length === 0}>
              {exporting ? 'Exporting…' : `⬇ Export ${dbRows.length} rows`}
            </Btn>
          </div>
          {dbRows.length === 0 && <div style={{ fontSize:11, color:C.textMuted, marginTop:8 }}>No data yet in this module.</div>}
        </Card>

        {/* Template + Import */}
        <Card>
          <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:6 }}>📥 Import from Excel</div>
          <div style={{ fontSize:12, color:C.textMuted, marginBottom:14, lineHeight:1.6 }}>
            Download a template, fill it in, then upload to import records into <strong>{cfg.label}</strong>.
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <Btn variant="outline" onClick={handleTemplate}>⬇ Download Template</Btn>
            <Btn variant="ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? 'Reading…' : '📂 Choose File'}
            </Btn>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileChange} style={{ display:'none' }} />
          </div>
          {importError && (
            <div style={{ marginTop:12, padding:'10px 12px', background:'rgba(192,57,43,.08)', border:'1px solid rgba(192,57,43,.3)', borderRadius:8, fontSize:11.5, color:C.danger, whiteSpace:'pre-wrap' }}>
              {importError}
            </div>
          )}
        </Card>
      </div>

      {/* Expected columns */}
      <Card>
        <div style={{ fontSize:13, fontWeight:600, color:C.text, marginBottom:10 }}>Expected Columns for {cfg.label}</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          {cfg.columns.map(col => (
            <span key={col} style={{ padding:'3px 10px', borderRadius:20, fontSize:11.5, background:C.bgAlt, border:'1px solid '+C.border, color:C.textMid, fontFamily:'monospace' }}>{col}</span>
          ))}
        </div>
      </Card>

      {/* Import preview */}
      {preview && (
        <Card style={{ border:'2px solid '+C.green }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:C.text }}>Preview Import — {preview.rows.length} rows from "{preview.file}"</div>
              <div style={{ fontSize:11.5, color:C.textMuted, marginTop:2 }}>Review the data below. Confirming will add these rows to {MODULE_COLUMNS[preview.modKey].label}.</div>

              {/* What the importer had to adapt to read this file. Shown so a
                  user can see their sheet was understood correctly — silently
                  reshaping someone's data and hoping they don't notice is how
                  you lose their trust the first time it guesses wrong. */}
              {preview.info && (preview.info.bannerSkipped || preview.info.filledDown > 0 || preview.info.datesConverted > 0) && (
                <div style={{
                  marginTop:10, padding:'10px 12px', borderRadius:8, fontSize:12, lineHeight:1.6,
                  background:'rgba(26,92,42,0.10)', border:'1px solid '+C.green, color:C.text,
                }}>
                  <strong>✓ Read your spreadsheet as-is.</strong>
                  <div style={{ marginTop:4 }}>
                    {preview.info.bannerSkipped && (
                      <div>Found your column headings on <strong>row {preview.info.headerRow}</strong> and skipped the title above it.</div>
                    )}
                    <div>Recognised <strong>{preview.info.matchedColumns}</strong> of your column names.</div>
                    {preview.info.filledDown > 0 && (
                      <div>Carried merged-cell values down into <strong>{preview.info.filledDown}</strong> blank cell(s), so rows under a shared Bill of Lading keep their details.</div>
                    )}
                    {preview.info.datesConverted > 0 && (
                      <div>Converted <strong>{preview.info.datesConverted}</strong> day-first date(s) (13/1/2026 → 2026-01-13).</div>
                    )}
                  </div>
                </div>
              )}

              {/* Duplicate report — shown BEFORE confirming, never after.
                  The whole point is that someone about to re-upload a file a
                  colleague already imported finds out here, not by discovering
                  doubled records later. */}
              {preview.fields && (preview.dupExisting.length > 0 || preview.dupInFile.length > 0) && (
                <div style={{
                  marginTop:10, padding:'10px 12px', borderRadius:8, fontSize:12, lineHeight:1.6,
                  background:C.amberBg || 'rgba(255,176,32,0.12)', border:'1px solid '+(C.amber||'#FFB020'), color:C.text,
                }}>
                  <strong>⚠ Duplicates found — these will be skipped.</strong>
                  <div style={{ marginTop:4 }}>
                    {preview.dupExisting.length > 0 && (
                      <div>{preview.dupExisting.length} row(s) are <strong>already in {MODULE_COLUMNS[preview.modKey].label}</strong> — most likely this file was imported before, possibly by someone else.</div>
                    )}
                    {preview.dupInFile.length > 0 && (
                      <div>{preview.dupInFile.length} row(s) are repeated <strong>within this file itself</strong>.</div>
                    )}
                    <div style={{ marginTop:4, opacity:0.85 }}>
                      Matched on: {preview.fields.join(' + ')}. Only the {preview.fresh.length} new row(s) will be added.
                    </div>
                  </div>
                </div>
              )}

              {preview.fields && preview.fresh.length === 0 && (
                <div style={{
                  marginTop:10, padding:'10px 12px', borderRadius:8, fontSize:12,
                  background:'rgba(220,38,38,0.12)', border:'1px solid '+(C.danger||'#DC2626'), color:C.text,
                }}>
                  <strong>Nothing to import.</strong> Every row in this file is already in {MODULE_COLUMNS[preview.modKey].label}.
                </div>
              )}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <Btn variant="ghost" sm onClick={() => setPreview(null)}>Cancel</Btn>
              <Btn sm onClick={handleConfirmImport} disabled={preview.fields && preview.fresh.length === 0}>
                ✓ Confirm Import ({preview.fields ? preview.fresh.length : preview.rows.length} rows)
              </Btn>
            </div>
          </div>
          <div style={{ overflowX:'auto', maxHeight:360, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead style={{ position:'sticky', top:0, zIndex:1 }}>
                <tr>
                  <th style={th}>#</th>
                  {Object.keys(preview.rows[0]).slice(0,8).map(h => <th key={h} style={th}>{h}</th>)}
                  {Object.keys(preview.rows[0]).length > 8 && <th style={th}>+{Object.keys(preview.rows[0]).length - 8} more</th>}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 20).map((row, i) => (
                  <tr key={i} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale} onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <td style={{ ...td, color:C.textMuted }}>{i+1}</td>
                    {Object.values(row).slice(0,8).map((v, j) => (
                      <td key={j} style={td}>{String(v ?? '').slice(0, 50)}</td>
                    ))}
                    {Object.keys(row).length > 8 && <td style={{ ...td, color:C.textMuted }}>…</td>}
                  </tr>
                ))}
                {preview.rows.length > 20 && (
                  <tr><td colSpan={10} style={{ ...td, textAlign:'center', color:C.textMuted, fontStyle:'italic' }}>… and {preview.rows.length - 20} more rows (all will be imported)</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
