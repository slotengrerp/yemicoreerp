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
import { exportToXLSX, importFromXLSX, downloadTemplate, MODULE_COLUMNS } from '../../utils/excelIO';

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
  // db.procurement is {rfqs, pos, waybills, invoices} — export/import the POs (.pos)
  const dbRows  = selectedMod === 'procurement'
    ? (db.procurement?.pos || [])
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
      const rows = await importFromXLSX(file);
      if (!rows || rows.length === 0) { setImportError('File is empty or has no data rows.'); return; }
      // Validate that at least one expected column is present
      const fileHeaders = Object.keys(rows[0]);
      const matched = cfg.columns.filter(c => fileHeaders.includes(c));
      if (matched.length < 2) {
        setImportError(`File columns don't match the expected format. Download the template first.\nExpected: ${cfg.columns.slice(0,5).join(', ')} …\nFound: ${fileHeaders.slice(0,5).join(', ')} …`);
        return;
      }
      setPreview({ rows, modKey: selectedMod, file: file.name });
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
    const { rows, modKey } = preview;

    // Normalise: add id + createdAt if missing
    const normalised = rows.map(row => ({
      id: generateId(),
      ...row,
      createdAt: row.createdAt || new Date().toISOString(),
    }));

    const existing = Array.isArray(db[modKey]) ? db[modKey] : [];
    const merged   = [...existing, ...normalised];

    // procurement is an object — only update the .pos array, keep rfqs/waybills/invoices intact
    const importData = modKey === 'procurement'
      ? { ...db.procurement, pos: merged }
      : merged;
    dispatch({ type:'UPDATE_MODULE', mod: modKey, data: importData });
    saveDBLocal({ ...db, [modKey]: merged }, state.activity);
    logActivity(dispatch, `Imported ${normalised.length} rows into ${MODULE_COLUMNS[modKey].label} from ${preview.file}`, currentUser, { module:modKey, action:'create' });
    showToast(`${normalised.length} rows imported into ${MODULE_COLUMNS[modKey].label}`);
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
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <Btn variant="ghost" sm onClick={() => setPreview(null)}>Cancel</Btn>
              <Btn sm onClick={handleConfirmImport}>✓ Confirm Import ({preview.rows.length} rows)</Btn>
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
