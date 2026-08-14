/**
 * DocScanner.jsx — Global Document Scanner
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a full-screen modal for scanning/uploading documents.
 * Launched from the Topbar; results stored in AppContext (state.scannedDocs).
 * Any module can read state.scannedDocs to access recent scans.
 *
 * Storage:
 *   • Primary: Supabase Storage (private bucket `scanner-docs`) — URL/path
 *     stored in app state, full binary stays in object storage.
 *   • Fallback: inline base64 (only if Supabase is offline). Tagged with
 *     `storageBackend: 'inline'` so the doc can be re-uploaded later.
 *
 * Props:
 *   onClose()                         — called when the modal is dismissed
 *   onSave(docObj)                    — called with the saved doc object
 *
 * Doc object shape:
 *   { id, name, timestamp, module, text, imageUrl, storagePath,
 *     storageBackend, fileType, fileSize }
 */

import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useApp } from '../../context/AppContext';

// ── tiny uid ────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);

// ── Module options — where is this doc going? ────────────────────────────────
const MODULE_OPTIONS = [
  { value: 'general',      label: '📂 General / No module' },
  { value: 'accounting',   label: '📒 Accounting' },
  { value: 'procurement',  label: '🛒 Procurement' },
  { value: 'invoices',     label: '🧾 Invoices' },
  { value: 'pettycash',    label: '💵 Petty Cash' },
  { value: 'nlng',         label: '👷 Contract Staff (NLNG)' },
  { value: 'slot',         label: '👤 Company Staff' },
  { value: 'inventory',    label: '📦 Inventory' },
  { value: 'vehicles',     label: '🚗 Fleet & Vehicles' },
  { value: 'terminal',     label: '🏭 Terminal Operations' },
  { value: 'request',      label: '📋 Requests' },
  { value: 'approvals',    label: '✅ Approvals' },
];

export default function DocScanner({ onClose, onSave }) {
  const { C } = useTheme();
  const { state } = useApp();
  const companyId = import.meta.env.VITE_COMPANY_DOC || 'slot-engineering-nigeria';

  // ── step: 'pick' | 'camera' | 'result' ───────────────────────────────────
  const [step, setStep]           = useState('pick');
  const [camErr, setCamErr]       = useState('');
  const [streaming, setStreaming] = useState(false);
  const [captured, setCaptured]   = useState(null);   // data-url or object-url
  const [text, setText]           = useState('');
  const [fileName, setFileName]   = useState('');
  const [fileType, setFileType]   = useState('');
  const [fileSize, setFileSize]   = useState(0);
  const [module, setModule]       = useState('general');
  const [docName, setDocName]     = useState('');
  const [saving, setSaving]       = useState(false);

  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // Stop camera on unmount
  useEffect(() => () => stopStream(), []);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setStreaming(false);
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  async function startCamera() {
    setStep('camera');
    setCamErr('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = s;
      setStreaming(true);
      setTimeout(() => {
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play(); }
      }, 50);
    } catch (err) {
      setCamErr('Camera unavailable: ' + err.message + '. Please use file upload instead.');
    }
  }

  function captureFrame() {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const dataUrl = c.toDataURL('image/jpeg', 0.9);
    stopStream();
    setCaptured(dataUrl);
    setFileName('Camera capture — ' + new Date().toLocaleTimeString());
    setFileType('image/jpeg');
    setFileSize(0);
    setText('📸 Image captured.\n\nReview the document and fill in the details below, then click Save.');
    setStep('result');
  }

  // ── File upload ────────────────────────────────────────────────────────────
  function handleFileUpload() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,.png,.jpg,.jpeg,.webp';
    inp.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      setFileName(file.name);
      setFileType(file.type);
      setFileSize(file.size);
      setDocName(file.name.replace(/\.[^.]+$/, ''));   // strip extension as default name
      const r = new FileReader();
      r.onload = ev => {
        const raw = ev.target.result;
        let extracted = '';
        if (file.type.startsWith('image/')) {
          const url = URL.createObjectURL(file);
          setCaptured(url);
          extracted = `Image file: ${file.name}\nSize: ${(file.size / 1024).toFixed(1)} KB\n\nReview the image and fill in any notes below.`;
        } else if (typeof raw === 'string') {
          // Basic text extraction from PDF binary
          const matches = (raw.match(/[\x20-\x7E]{5,}/g) || [])
            .filter(s =>
              !s.startsWith('/') &&
              !s.includes('endobj') &&
              !s.includes('stream') &&
              !s.includes('%%EOF') &&
              s.trim().length > 3
            )
            .slice(0, 120);
          extracted = matches.length > 4
            ? 'EXTRACTED TEXT:\n\n' + matches.join('\n')
            : `File: ${file.name}\nSize: ${(file.size / 1024).toFixed(1)} KB\n\n⚠ Scanned or image-based PDF detected.\nText could not be extracted automatically.\nReview the original and add notes below.`;
          setCaptured(null);
        }
        setText(extracted || 'No text content detected.');
        setStep('result');
      };
      r.readAsArrayBuffer(file);
    };
    inp.click();
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    try {
      let url = captured || null;
      let storagePath = null;
      let storageBackend = 'inline';   // 'storage' once we successfully upload
      let sizeBytes = fileSize;

      // Upload to Supabase Storage (private bucket) — falls back to inline
      // base64 if Supabase isn't available. Either way, the doc record is
      // small (URL + metadata) instead of the full image inlined into
      // localStorage.
      if (captured) {
        const { uploadDocument } = await import('../../supabase/storage');
        const up = await uploadDocument({
          dataUrl:    captured,
          name:       docName.trim() || fileName || 'scan',
          contentType: fileType || 'image/jpeg',
          companyId,
        });
        if (up) {
          url           = up.url;
          storagePath   = up.path;
          storageBackend = up.backend;
          sizeBytes     = up.sizeBytes || sizeBytes;
        }
      }

      const doc = {
        id:        'SCAN-' + uid(),
        name:      docName.trim() || fileName || 'Untitled scan',
        timestamp: new Date().toISOString(),
        module,
        text,
        imageUrl:       url,
        storagePath,                  // path in `scanner-docs` bucket (null for inline)
        storageBackend,                // 'storage' | 'inline'
        fileType,
        fileSize:      sizeBytes,
      };
      onSave(doc);
      onClose();
    } catch (err) {
      console.error('[DocScanner] save failed:', err);
      setSaving(false);
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const overlay = {
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'rgba(5,20,10,0.72)', backdropFilter: 'blur(5px)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: '32px 16px', overflowY: 'auto',
  };
  const panel = {
    background: C.bgCard, borderRadius: 16, width: '100%', maxWidth: 680,
    padding: '1.6rem', boxShadow: '0 28px 90px rgba(0,0,0,0.40)',
    boxSizing: 'border-box', marginBottom: 32,
  };
  const hdr = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 22, paddingBottom: 14, borderBottom: `1px solid ${C.borderLight}`,
  };
  // Note: hover is handled via onMouseEnter/onMouseLeave on each card below —
  // plain inline `style` objects don't support a `:hover` pseudo-selector key
  // (that only works with CSS-in-JS libraries this app doesn't use), so a
  // ':hover' entry here would be silently ignored by the browser.
  const card = () => ({
    padding: '28px 20px', border: `2px dashed ${C.border}`, borderRadius: 12,
    textAlign: 'center', cursor: 'pointer', transition: 'all 0.18s',
    flex: 1,
  });
  const inp = {
    borderRadius: 7, border: `1px solid ${C.border}`, padding: '7px 10px',
    fontSize: 13, background: C.bgCard, color: C.text, width: '100%',
    boxSizing: 'border-box', outline: 'none',
  };
  const btn = (bg = C.green, co = '#fff') => ({
    background: bg, color: co, border: 'none', borderRadius: 8,
    padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  });
  const ghostBtn = {
    background: 'transparent', color: C.textMid,
    border: `1px solid ${C.border}`, borderRadius: 8,
    padding: '7px 16px', fontSize: 13, cursor: 'pointer',
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) { stopStream(); onClose(); } }}>
      <div style={panel}>

        {/* Header */}
        <div style={hdr}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>📷 Document Scanner</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
              Scan or upload invoices, receipts, delivery notes, bank statements — for any module
            </div>
          </div>
          <button
            onClick={() => { stopStream(); onClose(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 26, color: C.textMuted, lineHeight: 1, marginLeft: 12 }}
          >×</button>
        </div>

        {/* ── Step: pick method ───────────────────────────────────────────── */}
        {step === 'pick' && (
          <div style={{ display: 'flex', gap: 14 }}>
            {/* Camera */}
            <div
              onClick={startCamera}
              style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.green; e.currentTarget.style.background = C.greenPale; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ fontSize: 44, marginBottom: 10 }}>📷</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 5 }}>Use Camera</div>
              <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
                Take a live photo using your device camera
              </div>
            </div>
            {/* File */}
            <div
              onClick={handleFileUpload}
              style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#9B59B6'; e.currentTarget.style.background = 'rgba(155,89,182,0.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ fontSize: 44, marginBottom: 10 }}>📁</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 5 }}>Upload File</div>
              <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
                PDF, PNG, JPG, JPEG or WEBP from your device
              </div>
            </div>
          </div>
        )}

        {/* ── Step: camera live view ───────────────────────────────────────── */}
        {step === 'camera' && (
          <div style={{ textAlign: 'center' }}>
            {camErr ? (
              <div style={{ padding: 24, color: C.danger, background: 'rgba(192,57,43,0.08)', borderRadius: 10, marginBottom: 14 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>❌</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{camErr}</div>
                <button style={btn('#9B59B6')} onClick={handleFileUpload}>📁 Upload File Instead</button>
              </div>
            ) : (
              <>
                <div style={{ position: 'relative', display: 'inline-block', marginBottom: 14 }}>
                  <video
                    ref={videoRef} autoPlay playsInline muted
                    style={{ width: '100%', maxWidth: 540, borderRadius: 10, border: `2px solid ${C.green}`, display: 'block', background: '#000' }}
                  />
                  {streaming && (
                    <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(192,57,43,0.88)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, letterSpacing: '0.5px' }}>
                      ● LIVE
                    </div>
                  )}
                </div>
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button
                    style={{ ...btn('#9B59B6'), fontSize: 14, padding: '9px 26px', opacity: streaming ? 1 : 0.5 }}
                    onClick={captureFrame}
                    disabled={!streaming}
                  >
                    📸 Capture Document
                  </button>
                  <button style={ghostBtn} onClick={() => { stopStream(); setStep('pick'); }}>← Back</button>
                </div>
                {!streaming && !camErr && (
                  <div style={{ marginTop: 10, fontSize: 12, color: C.textMuted }}>Starting camera…</div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Step: result & save ──────────────────────────────────────────── */}
        {step === 'result' && (
          <div>
            {/* Preview */}
            {captured && (
              <div style={{ marginBottom: 14, textAlign: 'center' }}>
                <img
                  src={captured} alt="Document preview"
                  style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, border: `1px solid ${C.border}`, objectFit: 'contain' }}
                />
              </div>
            )}
            {fileName && (
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8 }}>📄 {fileName}{fileSize ? ` · ${(fileSize / 1024).toFixed(1)} KB` : ''}</div>
            )}

            {/* Extracted text preview */}
            {text && (
              <div style={{
                background: C.bgAlt, borderRadius: 8, padding: '10px 13px',
                fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7, color: C.textMid,
                maxHeight: 160, overflowY: 'auto', whiteSpace: 'pre-wrap',
                border: `1px solid ${C.border}`, marginBottom: 16,
              }}>
                {text}
              </div>
            )}

            {/* Document details form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
              <div>
                <label style={{ fontSize: 11, color: C.textMid, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Document Name *
                </label>
                <input
                  style={inp}
                  value={docName}
                  onChange={e => setDocName(e.target.value)}
                  placeholder="e.g. NLNG Invoice Jan 2026, PO-2026-031 receipt…"
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.textMid, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Link to Module
                </label>
                <select
                  style={inp}
                  value={module}
                  onChange={e => setModule(e.target.value)}
                >
                  {MODULE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.textMid, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Additional Notes (optional)
                </label>
                <textarea
                  style={{ ...inp, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
                  value={text.startsWith('EXTRACTED') ? '' : text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Enter any reference numbers, remarks, or manual data from the document…"
                />
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                style={ghostBtn}
                onClick={() => { setCaptured(null); setText(''); setFileName(''); setFileType(''); setFileSize(0); setDocName(''); setStep('pick'); }}
              >
                ↩ Scan Another
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={ghostBtn} onClick={() => { stopStream(); onClose(); }}>Cancel</button>
                <button
                  style={{ ...btn(C.green), opacity: saving ? 0.6 : 1 }}
                  onClick={handleSave}
                  disabled={saving}
                >
                  ✓ Save Document
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
