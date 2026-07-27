// ══════════════════════════════════════════════════════════════════════════════
// SLOT ERP — Error Boundary
// ══════════════════════════════════════════════════════════════════════════════
//
// React only lets error boundaries be class components — there's no hook
// equivalent as of this writing, so this one exception to the rest of the
// app's function-component style is required, not a style regression.
//
// Without this, an uncaught error ANYWHERE inside the wrapped subtree used to
// unmount the entire React tree with nothing left on screen — a blank/dark
// page with no way back except a full reload. This happened in production
// at least twice (a crash inside the Add Staff form, and a suspected crash
// during initial data load). This component exists specifically so a bug in
// one module can no longer take down the whole app for everyone using it.
//
// Usage: wrap each major independent region of the UI (sidebar, topbar, the
// active module) in its own <ErrorBoundary label="..."> so a crash in one
// region leaves the others usable — e.g. if a module crashes, the sidebar
// still works and the user can navigate to a different module without
// reloading the page.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Logged to the console for now. If Anthropic/SLOT ever wants proactive
    // alerting, this is the one place to add it — everything caught by any
    // boundary in the app funnels through here.
    console.error(`[SLOT ERP] Error boundary "${this.props.label || 'unnamed'}" caught:`, error, info?.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { label, fullPage } = this.props;
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 14, padding: fullPage ? '80px 24px' : '40px 24px', minHeight: fullPage ? '100vh' : 200,
        textAlign: 'center', background: fullPage ? '#0F3A1A' : 'transparent', color: fullPage ? '#fff' : undefined,
      }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          {label ? `Something went wrong in ${label}` : 'Something went wrong'}
        </div>
        <div style={{ fontSize: 13, opacity: 0.75, maxWidth: 420, lineHeight: 1.6 }}>
          This part of the app hit an unexpected error and stopped, but the rest of SLOT ERP is still working.
          Try again, or head back to the Dashboard. If this keeps happening, please report it with the details below.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button onClick={this.reset} style={{
            padding: '9px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#1A5C2A', color: '#fff', fontSize: 13, fontWeight: 600,
          }}>Try Again</button>
          {this.props.onGoHome && (
            <button onClick={() => { this.reset(); this.props.onGoHome(); }} style={{
              padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', color: 'inherit',
            }}>Back to Dashboard</button>
          )}
        </div>
        {this.state.error && (
          <details style={{ marginTop: 10, fontSize: 11, opacity: 0.6, maxWidth: 480 }}>
            <summary style={{ cursor: 'pointer' }}>Technical details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', textAlign: 'left', marginTop: 6 }}>{String(this.state.error?.message || this.state.error)}</pre>
          </details>
        )}
      </div>
    );
  }
}
