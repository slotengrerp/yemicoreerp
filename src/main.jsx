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
      release: 'bizcore-erp@1.0.0',
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
    console.info('[BizCore] Sentry monitoring active');
  }).catch(() => {
    // Sentry package not installed — run: npm install @sentry/react
    console.warn('[BizCore] VITE_SENTRY_DSN set but @sentry/react not installed. Run: npm install @sentry/react');
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
