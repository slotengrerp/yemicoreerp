// SLOT Engineering Nigeria Limited — Design System v3.2
// Sharp, readable themes. SLOT corporate green used for brand/chrome only.
// Card surfaces and body text are NEUTRAL so content is always legible.
// DARK: grey cards (#1C1E20) + white text (#F0F2F0). No more green-on-green.
// LIGHT: neutral text (#111827) + vivid sidebar (opacity 0.70).

export const LIGHT = {
  // ── Brand ──────────────────────────────────────────────────────────────────
  green:        '#1A5C2A',   // Primary — buttons, active states, headings
  greenDark:    '#0F3A1A',   // Sidebar background
  greenMid:     '#2E7D40',   // Hover states
  greenLight:   '#4CAF64',   // Pills, dividers
  greenPale:    '#EAF4EC',   // Alt table rows, card hover tint
  greenPale2:   '#F4FAF5',   // Odd row tint

  amber:        '#B86800',   // Slightly darker amber — better contrast on white
  amberLight:   '#E8960C',
  amberPale:    '#FEF3E2',

  // ── Backgrounds — NEUTRAL, not green-tinted ────────────────────────────────
  bg:           '#F0F2F1',   // Page root — neutral grey
  bgCard:       '#FFFFFF',   // Cards, modals — pure white
  bgAlt:        '#F7F8F7',   // Panel fills

  // ── Borders — darker so they're actually visible ───────────────────────────
  border:       '#C8D4CB',   // Card borders, inputs
  borderLight:  '#E2EAE4',   // Row dividers

  // ── Semantic ───────────────────────────────────────────────────────────────
  success:      '#1A7A4A',
  danger:       '#C0392B',
  warning:      '#B86800',
  info:         '#1A5C8A',

  // ── Text — NEUTRAL dark, not green-tinted ─────────────────────────────────
  text:         '#111827',   // Near-black — maximum readability
  textMid:      '#374151',   // Labels, secondary headings
  textMuted:    '#6B7280',   // Metadata, dates, placeholders
  textLight:    '#9CA3AF',   // Disabled, zero-values
  textOnDark:   '#FFFFFF',

  // ── Sidebar — deep forest green, bright white text ─────────────────────────
  sidebarBg:           '#0D3318',   // Deep forest, not murky
  sidebarActiveText:   '#FFFFFF',
  sidebarInactiveText: 'rgba(255,255,255,0.70)',   // was 0.58 — too dim
  sidebarActiveBg:     'rgba(232,150,12,0.25)',
  sidebarActiveBorder: '#F0A020',   // bright amber, clearly visible

  // ── Table headers ──────────────────────────────────────────────────────────
  tableHeaderBg:   '#1A5C2A',   // SLOT green — strong, visible
  tableHeaderText: '#FFFFFF',   // White text on green

  // ── Shadows ────────────────────────────────────────────────────────────────
  shadowCard:   '0 1px 4px rgba(0,0,0,0.09)',
  shadowModal:  '0 24px 80px rgba(0,0,0,0.30)',
  shadowSidebar:'3px 0 16px rgba(0,0,0,0.25)',
  shadowTopbar: '0 1px 4px rgba(0,0,0,0.09)',
  shadowBanner: '0 4px 20px rgba(15,58,26,0.25)',

  // ── Status map ─────────────────────────────────────────────────────────────
  SM: {
    'Active':           '#1A7A4A',
    'Paid':             '#1A7A4A',
    'Approved':         '#1A7A4A',
    'Completed':        '#1A7A4A',
    'Complete':         '#1A7A4A',
    'Operational':      '#1A7A4A',
    'In Use':           '#1A7A4A',
    'Available':        '#1A7A4A',
    'Overdue':          '#C0392B',
    'Faulty':           '#C0392B',
    'Terminated':       '#C0392B',
    'Decommissioned':   '#C0392B',
    'Depleted':         '#C0392B',
    'In Progress':      '#B86800',
    'Maintenance':      '#B86800',
    'Under Maintenance':'#B86800',
    'Under Repair':     '#B86800',
    'Low Stock':        '#B86800',
    'Partial':          '#B86800',
    'Pending':          '#B86800',
    'Suspended':        '#B86800',
    'Submitted':        '#1A5C8A',
    'PO Issued':        '#2E7D40',
    'Draft':            '#6B7280',
    'Open':             '#6B7280',
    'Inactive':         '#9CA3AF',
    'In Storage':       '#9CA3AF',
    'Standby':          '#1A5C8A',
  },
};

// ── DARK MODE ──────────────────────────────────────────────────────────────────
// Key fix: card surfaces are dark GREY (not green), body text is off-WHITE (not
// green-tinted). Green is used ONLY for brand accents, not surfaces or body text.
export const DARK = {
  // ── Brand accents — brighter for dark background ───────────────────────────
  green:        '#3CB860',   // Bright enough to stand out on dark grey
  greenDark:    '#0A1A0D',
  greenMid:     '#2EA050',
  greenLight:   '#5CC870',
  greenPale:    '#232628',   // Hover tint — very subtle grey, NOT dark green
  greenPale2:   '#1E2124',   // Alt row tint — barely-there grey
  amber:        '#F0A020',   // Brighter amber — clearly visible on dark
  amberLight:   '#F5B830',
  amberPale:    '#2A1800',

  // ── Backgrounds — DARK GREY, not dark green ───────────────────────────────
  bg:           '#111214',   // Page root — near-black neutral grey
  bgCard:       '#1C1E20',   // Cards — dark grey, NOT green-tinted
  bgAlt:        '#262A2E',   // Panel fills — slightly lighter than bgCard

  // ── Borders — visible on dark surfaces ────────────────────────────────────
  border:       '#2E3235',   // Grey border — clearly visible
  borderLight:  '#252829',   // Row divider

  // ── Semantic ───────────────────────────────────────────────────────────────
  success:      '#34C472',   // Bright green — readable on dark grey card
  danger:       '#F05050',   // Bright red
  warning:      '#F0A020',   // Bright amber
  info:         '#3A9AE0',   // Bright blue

  // ── Text — WHITE and LIGHT GREY on dark grey cards ─────────────────────────
  text:         '#F0F2F0',   // Near-white primary text — maximum contrast
  textMid:      '#B8C0BC',   // Secondary text — light grey
  textMuted:    '#7A8580',   // Muted text — readable grey
  textLight:    '#4A5550',   // Disabled / zero values
  textOnDark:   '#FFFFFF',

  // ── Sidebar — very dark, bright white text ─────────────────────────────────
  sidebarBg:           '#0C0E0D',
  sidebarActiveText:   '#FFFFFF',
  sidebarInactiveText: 'rgba(255,255,255,0.72)',   // Clearly readable
  sidebarActiveBg:     'rgba(240,160,32,0.22)',
  sidebarActiveBorder: '#F0A020',   // Bright amber indicator

  // ── Table headers — neutral dark, clearly separated from rows ──────────────
  tableHeaderBg:   '#2A2E32',   // Dark grey — distinct from card bg #1C1E20
  tableHeaderText: '#E8EDE9',   // Near-white — high contrast

  // ── Shadows ────────────────────────────────────────────────────────────────
  shadowCard:   '0 1px 4px rgba(0,0,0,0.50)',
  shadowModal:  '0 24px 80px rgba(0,0,0,0.80)',
  shadowSidebar:'3px 0 20px rgba(0,0,0,0.70)',
  shadowTopbar: '0 1px 4px rgba(0,0,0,0.50)',
  shadowBanner: '0 4px 20px rgba(0,0,0,0.60)',

  // ── Status map — bright enough for dark grey cards ────────────────────────
  SM: {
    'Active':           '#34C472',
    'Paid':             '#34C472',
    'Approved':         '#34C472',
    'Completed':        '#34C472',
    'Complete':         '#34C472',
    'Operational':      '#34C472',
    'In Use':           '#34C472',
    'Available':        '#34C472',
    'Overdue':          '#F05050',
    'Faulty':           '#F05050',
    'Terminated':       '#F05050',
    'Decommissioned':   '#F05050',
    'Depleted':         '#F05050',
    'In Progress':      '#F0A020',
    'Maintenance':      '#F0A020',
    'Under Maintenance':'#F0A020',
    'Under Repair':     '#F0A020',
    'Low Stock':        '#F0A020',
    'Partial':          '#F0A020',
    'Pending':          '#F0A020',
    'Suspended':        '#F0A020',
    'Submitted':        '#3A9AE0',
    'PO Issued':        '#3CB860',
    'Draft':            '#7A8580',
    'Open':             '#7A8580',
    'Inactive':         '#4A5550',
    'In Storage':       '#4A5550',
    'Standby':          '#3A9AE0',
  },
};
