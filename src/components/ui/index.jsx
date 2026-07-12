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
    <div onClick={onClose} style={{
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
