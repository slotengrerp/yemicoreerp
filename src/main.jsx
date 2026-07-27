import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// ── Sentry Error Monitoring ───────────────────────────────────────────────────
// Active only when VITE_SENTRY_DSN is set in .env
// Setup: 1) sentry.io → New Project → React → copy DSN
//         2) Add VITE_SENTRY_DSN=https://xxx@yyy.ingest.sentry.io/zzz to .env
//         3) npm install @sentry/react
if (import.meta.env.VITE_SENTRY_DSN) {
  import('@sentry/react').then(Sentry => {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE || 'production',
      release: 'slot-erp@1.2.0',
      // Sample 10% of transactions for performance tracing (enough to catch issues, not too noisy)
      tracesSampleRate: 0.1,
      // Scrub sensitive fields before sending to Sentry
      beforeSend(event) {
        // Remove any request body (may contain passwords or form data)
        if (event.request?.data) delete event.request.data;
        // Remove user email from breadcrumbs
        if (event.breadcrumbs?.values) {
          event.breadcrumbs.values = event.breadcrumbs.values.map(b => ({
            ...b,
            data: b.data ? Object.fromEntries(
              Object.entries(b.data).filter(([k]) => !['email','password','token'].includes(k))
            ) : b.data
          }));
        }
        return event;
      },
    });
    console.info('[SLOT] Sentry monitoring active');
  }).catch(() => {
    // Sentry package not installed — run: npm install @sentry/react
    console.warn('[SLOT] VITE_SENTRY_DSN set but @sentry/react not installed. Run: npm install @sentry/react');
  });
}

// ── Global error + promise-rejection handlers ────────────────────────────────
// React's ErrorBoundary only catches errors thrown during render/commit. Errors
// inside useEffect async bodies, unhandled promise rejections, and event-
// handler exceptions bypass ErrorBoundary entirely — they propagate to the
// browser console and disappear. This listener captures them and forwards to
// Sentry (if configured), so production issues become visible.
//
// Without this, the Users.jsx mount-time Supabase call (and similar patterns
// elsewhere) silently failed with no trace — the only symptom was a forever-
// spinning loading spinner.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  console.error('[SLOT] Unhandled promise rejection:', reason?.message || reason);
  if (window.Sentry) {
    try { window.Sentry.captureException(reason); } catch {}
  } else if (import.meta.env.VITE_SENTRY_DSN) {
    import('@sentry/react').then(S => {
      try { S.captureException(reason); } catch {}
    }).catch(() => {});
  }
});

window.addEventListener('error', (event) => {
  console.error('[SLOT] Uncaught error:', event?.message, event?.error);
  if (window.Sentry) {
    try { window.Sentry.captureException(event?.error || event?.message); } catch {}
  } else if (import.meta.env.VITE_SENTRY_DSN) {
    import('@sentry/react').then(S => {
      try { S.captureException(event?.error || event?.message); } catch {}
    }).catch(() => {});
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
