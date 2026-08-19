import { X } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// ── Pill (status badge) ───────────────────────────────────────────────────────
export function Tag({ status }) {
  const { C } = useTheme();
  const colour = C.SM?.[status] || C.textMuted;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap',
      fontSize: 11, fontWeight: 500,
      color: colour,
      background: colour + '20',
      border: '1px solid ' + colour + '30',
    }}>
      {status}
    </span>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
export function Btn({ variant = 'ghost', size = 'md', onClick, children, style, disabled, type = 'button' }) {
  const { C } = useTheme();
  const variants = {
    primary: { background: C.green,   color: '#FFFFFF', border: 'none' },
    amber:   { background: C.amber,   color: '#FFFFFF', border: 'none' },
    ghost:   { background: 'transparent', color: C.textMid, border: '1px solid ' + C.border },
    danger:  { background: C.danger,  color: '#FFFFFF', border: 'none' },
    outline: { background: 'transparent', color: C.green, border: '1px solid ' + C.green },
  };
  const sz = size === 'sm'
    ? { padding: '4px 12px', fontSize: 11.5 }
    : { padding: '7px 18px', fontSize: 13 };
  return (
    <button type={type} disabled={disabled} onClick={onClick} style={{
      borderRadius: 8, fontWeight: 500, letterSpacing: 0, whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'opacity .15s, filter .15s',
      ...variants[variant] || variants.ghost, ...sz, ...style,
    }}>
      {children}
    </button>
  );
}

// ── KPI Stat Card ─────────────────────────────────────────────────────────────
export function StatCard({ label, value, accent, sub, icon: Icon, onClick }) {
  const { C } = useTheme();
  const c = accent || C.green;
  return (
    <div onClick={onClick} style={{
      background: C.bgCard, border: '1px solid ' + C.border,
      borderRadius: 12, padding: '13px 15px',
      boxShadow: C.shadowCard,
      flex: 1, minWidth: 148, position: 'relative', overflow: 'hidden',
      cursor: onClick ? 'pointer' : 'default',
    }}>
      {/* Left accent bar */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: c, borderRadius: '12px 0 0 12px' }} />
      <div style={{ paddingLeft: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>{label}</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: c, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{sub}</div>}
      </div>
      {Icon && <Icon size={22} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.12, color: c }} />}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer, maxWidth = 540 }) {
  const { C } = useTheme();
  return (
    // 2026-08-15: backdrop used to call onClose on any click — one misclick
    // outside a half-filled form (which happens constantly, since this modal
    // covers nearly every form in the app) silently discarded everything
    // typed with no confirmation. Backdrop no longer closes the modal; only
    // the explicit × button (or a Cancel/Close button in the footer) does.
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(10,35,15,0.60)',
      backdropFilter: 'blur(3px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.bgCard, borderRadius: 14, width: '100%', maxWidth,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: C.shadowModal,
      }}>
        {/* Title bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, marginBottom: 18, borderBottom: '1px solid ' + C.borderLight, padding: '20px 24px 14px' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: C.textMuted, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>&times;</button>
        </div>
        <div style={{ padding: '0 24px 20px' }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '14px 24px', borderTop: '1px solid ' + C.borderLight }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Form Group ────────────────────────────────────────────────────────────────
export function FG({ label, full, children, hint }) {
  const { C } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: full ? '1/-1' : undefined }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: C.textMid }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 10, color: C.textMuted }}>{hint}</span>}
    </div>
  );
}

// ── Form Grid ─────────────────────────────────────────────────────────────────
export function FormGrid({ cols = 2, children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},1fr)`, gap: 12 }}>{children}</div>;
}

// ── Section divider label ─────────────────────────────────────────────────────
export function SectionLabel({ label }) {
  const { C } = useTheme();
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.4px', margin: '18px 0 10px', paddingBottom: 6, borderBottom: '2px solid ' + C.greenPale }}>
      {label}
    </div>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────
export function Inp({ value, onChange, placeholder, type = 'text', disabled }) {
  const { C } = useTheme();
  return (
    <input value={value} onChange={onChange} placeholder={placeholder} type={type} disabled={disabled}
      style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid ' + C.border, background: C.bgCard, color: C.text, fontSize: 13 }}
    />
  );
}

// ── Select ────────────────────────────────────────────────────────────────────
export function Sel({ value, onChange, children }) {
  const { C } = useTheme();
  return (
    <select value={value} onChange={onChange}
      style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid ' + C.border, background: C.bgCard, color: C.text, fontSize: 13 }}
    >
      {children}
    </select>
  );
}

// ── Search bar ────────────────────────────────────────────────────────────────
export function SearchBar({ value, onChange, placeholder = 'Search…' }) {
  const { C } = useTheme();
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid ' + C.border, background: C.bgCard, color: C.text, fontSize: 13, width: '100%' }}
    />
  );
}

// ── Table shell ───────────────────────────────────────────────────────────────
export function Table({ headers, children, compact, minWidth = 600 }) {
  const { C } = useTheme();
  const pad = compact ? '7px 8px' : '9px 10px';
  const thStyle = {
    padding: pad, textAlign: 'left', fontSize: 10.5, fontWeight: 700,
    color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.4px',
    whiteSpace: 'nowrap', background: C.greenPale, borderBottom: '2px solid ' + C.border,
  };
  return (
    <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid ' + C.border, boxShadow: C.shadowCard }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth, fontSize: compact ? 12 : 13 }}>
        <thead>
          <tr>{headers.map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// Shared TD style — call as a function to get theme-aware styles
export function useTD(compact) {
  const { C } = useTheme();
  return { padding: compact ? '7px 8px' : '9px 10px', borderBottom: '1px solid ' + C.borderLight, color: C.text, verticalAlign: 'middle' };
}

// Odd-row background helper
export function useRowBg(i) {
  const { C } = useTheme();
  return { background: i % 2 === 1 ? C.greenPale2 : 'transparent' };
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ children, style, padding = '1.1rem 1.25rem' }) {
  const { C } = useTheme();
  return (
    <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding, boxShadow: C.shadowCard, ...style }}>
      {children}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function EmptyState({ icon = '📭', text = 'No records found', sub }) {
  const { C } = useTheme();
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: C.textMuted }}>
      <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.4 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{text}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
export function Confirm({ message, onConfirm, onCancel }) {
  const { C } = useTheme();
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,35,15,0.60)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }}>
      <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 14, padding: 28, maxWidth: 380, width: '100%', textAlign: 'center', boxShadow: C.shadowModal }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 20, lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
          <Btn variant="danger" onClick={onConfirm}>Confirm Delete</Btn>
        </div>
      </div>
    </div>
  );
}

// ── Alert banner ──────────────────────────────────────────────────────────────
export function Alert({ variant = 'info', children }) {
  const { C } = useTheme();
  const map = {
    info:    { bg: C.greenPale,  border: C.greenLight, borderLeft: C.greenLight, color: C.green  },
    warning: { bg: C.amberPale,  border: C.amberLight, borderLeft: C.amberLight, color: C.amber  },
    danger:  { bg: '#FDEDEC',    border: '#E07070',    borderLeft: '#E07070',    color: C.danger },
  };
  const s = map[variant] || map.info;
  return (
    <div style={{ background: s.bg, border: '1px solid ' + s.border, borderLeft: '4px solid ' + s.borderLeft, borderRadius: 8, padding: '9px 14px', fontSize: 12, color: s.color }}>
      {children}
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
export function TabBar({ tabs, active, onChange, size = 'md' }) {
  const { C } = useTheme();
  const pad = size === 'sm' ? '8px 14px' : '10px 18px';
  const fz  = size === 'sm' ? 12 : 13;
  return (
    <div style={{ display: 'flex', borderBottom: '2px solid ' + C.borderLight, overflowX: 'auto', gap: 0 }}>
      {tabs.map(t => {
        const isActive = t.key === active;
        return (
          <button key={t.key} onClick={() => onChange(t.key)} style={{
            padding: pad, fontSize: fz, border: 'none', background: 'none', cursor: 'pointer',
            fontWeight: isActive ? 700 : 400,
            color: isActive ? C.green : C.textMuted,
            borderBottom: isActive ? '2px solid ' + C.green : '2px solid transparent',
            marginBottom: -2, whiteSpace: 'nowrap',
          }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Theme toggle button ───────────────────────────────────────────────────────
export function ThemeToggle() {
  const { C, isDark, toggle } = useTheme();
  return (
    <button onClick={toggle} title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'} style={{
      background: isDark ? C.bgAlt : C.greenPale,
      border: '1px solid ' + C.border,
      borderRadius: 20, padding: '4px 10px 4px 8px',
      display: 'flex', alignItems: 'center', gap: 5,
      fontSize: 12, fontWeight: 600, color: C.textMid, cursor: 'pointer',
    }}>
      <span style={{ fontSize: 14 }}>{isDark ? '☀️' : '🌙'}</span>
      {isDark ? 'Light' : 'Dark'}
    </button>
  );
}

// ── AttachmentUploader ───────────────────────────────────────────────────────
//
// Reusable file-upload widget. Used wherever a transaction needs scanned
// supporting documents (AR invoices, AP bills, journal entries, etc.).
// Files are uploaded to Supabase Storage when available, or kept inline
// (base64) when offline — see `src/supabase/storage.js` for the contract.
//
//   <AttachmentUploader
//     attachments={invoice.attachments}      // [{id,name,url,sizeBytes,contentType,storageBackend,uploadedAt,uploadedBy}]
//     onChange={next => updateInvoice({...invoice, attachments: next})}
//     folder="invoices"                       // logical folder, prefix on storage path
//     maxSizeMB={10}
//     parentType="ar-invoice"                 // optional — see below
//     parentId={invoice.id}                   // optional — see below
//   />
//
// `attachments` is the source of truth. The component uploads the bytes
// and adds a record to the list, never mutating other entries.
//
// `parentType`/`parentId` (optional): when supplied, every upload/delete is
// also mirrored into the standalone `attachments` cross-module index table
// (supabase/syncPerRecord.js's saveAttachment/deleteAttachment) — the lookup
// meant to power a company-wide "search all documents" view. 2026-08-19: this
// table existed with zero writers anywhere in the app; every AttachmentUploader
// call site was omitting these props, so the index was silently unpopulated
// forever even though the feature it exists for was already half-built (see
// loadAttachments). Fire-and-forget, same pattern as audit.js's pushActivity —
// a failed index write must never block the actual upload/delete it's
// describing. Callers that don't pass these props are unaffected: the
// attachment still lives safely in the parent record's own attachments[]
// field either way, this only concerns the separate cross-module index.
import { useState, useRef } from 'react';
import { showToast } from '../../utils/helpers';
export function AttachmentUploader({ attachments = [], onChange, folder = 'general', maxSizeMB = 10, compact = false, currentUser, parentType, parentId }) {
  const { C } = useTheme();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const next = [...attachments];
      for (const file of files) {
        if (file.size > maxSizeMB * 1024 * 1024) {
          showToast(`${file.name} exceeds ${maxSizeMB} MB — skipped`, 'error');
          continue;
        }
        try {
          const { uploadDocument } = await import('../../supabase/storage');
          const result = await uploadDocument({
            file,
            name: file.name,
            contentType: file.type,
            companyId: folder,
          });
          const attRecord = {
            id: 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            name: file.name,
            url: result.url,
            path: result.path,
            sizeBytes: result.sizeBytes,
            contentType: file.type || 'application/octet-stream',
            storageBackend: result.backend,   // 'storage' (Supabase) or 'inline' (base64 fallback)
            folder,
            uploadedAt: new Date().toISOString(),
            uploadedBy: currentUser?.name || currentUser?.email || 'system',
          };
          next.push(attRecord);
          if (parentType && parentId) {
            import('../../hooks/usePerRecordSync').then(({ pushAttachment }) => {
              pushAttachment({ parentType, parentId, att: attRecord });
            }).catch(() => {});
          }
        } catch (e) {
          showToast(`Upload failed: ${file.name} — ${e.message}`, 'error');
        }
      }
      onChange?.(next);
      showToast(`${files.length} file(s) uploaded`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleDelete(att) {
    if (!window.confirm(`Delete attachment "${att.name}"?`)) return;
    if (att.storageBackend === 'storage' && att.path) {
      const { deleteDocument } = await import('../../supabase/storage');
      await deleteDocument(att.path);
    }
    if (parentType && parentId) {
      import('../../hooks/usePerRecordSync').then(({ pushDeleteAttachment }) => {
        // storage file is already removed above — pass no storagePath so
        // deleteAttachment's own best-effort storage cleanup is a no-op.
        pushDeleteAttachment(att.id);
      }).catch(() => {});
    }
    onChange?.(attachments.filter(a => a.id !== att.id));
    showToast('Attachment deleted', 'error');
  }

  function fmtSize(b) {
    if (!b) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  function pickIcon(ct) {
    if (!ct) return '📎';
    if (ct.startsWith('image/')) return '🖼';
    if (ct.includes('pdf')) return '📄';
    if (ct.includes('sheet') || ct.includes('csv') || ct.includes('excel')) return '📊';
    if (ct.includes('word') || ct.includes('document')) return '📝';
    return '📎';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
        onChange={e => handleFiles(e.target.files)}
        style={{ display: 'none' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            padding: compact ? '4px 10px' : '6px 14px', borderRadius: 6, fontSize: compact ? 11 : 12,
            background: C.green, color: '#fff', border: 'none', fontWeight: 600,
            cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1,
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        >
          {uploading ? '⏳ Uploading…' : '📎 Attach Files'}
        </button>
        <span style={{ fontSize: 11, color: C.textMuted }}>
          {attachments.length} attached · max {maxSizeMB}MB each · stored in Supabase Storage
        </span>
      </div>
      {attachments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {attachments.map(att => (
            <div
              key={att.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 9px', borderRadius: 6,
                background: C.bgAlt, border: '1px solid ' + C.borderLight,
                fontSize: 12,
              }}
            >
              <span style={{ fontSize: 16 }}>{pickIcon(att.contentType)}</span>
              <a
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                download={att.name}
                style={{ flex: 1, color: C.text, fontWeight: 500, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={att.name}
              >
                {att.name}
              </a>
              <span style={{ fontSize: 10, color: C.textMuted }}>{fmtSize(att.sizeBytes)}</span>
              <span
                title={att.storageBackend === 'storage' ? 'Supabase Storage' : 'Inline (offline mode)'}
                style={{
                  fontSize: 9, padding: '1px 6px', borderRadius: 8, fontWeight: 600,
                  color: att.storageBackend === 'storage' ? C.success : C.warning,
                  background: (att.storageBackend === 'storage' ? C.success : C.warning) + '15',
                }}
              >
                {att.storageBackend === 'storage' ? '☁ storage' : '📦 inline'}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(att)}
                title="Delete attachment"
                style={{ background: 'transparent', border: 'none', color: C.danger, cursor: 'pointer', fontSize: 13, padding: 0 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
