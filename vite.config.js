import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Build stamp — surfaced in the sidebar footer. Exists because "is my fix
  // actually deployed, or am I looking at a cached/old bundle?" cost a full
  // debugging cycle on 2026-07-27: a confirmed-correct fix was pushed to
  // main, but there was no way to tell from inside the running app whether
  // the browser was executing it. Now there is.
  define: {
    __BUILD_ID__: JSON.stringify(
      (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'local').slice(0, 7) +
      ' · ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z'
    ),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
    // jsdom + lazy-loaded module chunks are slower than the default 5s
    // timeout when multiple test files run together. 15s gives the chunks
    // time to load and the integration tests time to drive the UI.
    testTimeout: 15000,
    // Pool size: 1 is the safest setting for jsdom + React Testing Library
    // — running tests in parallel makes the lazy-loaded chunks race for
    // the event loop and produces flaky timeouts.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'oxc',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react-vendor'
          if (id.includes('node_modules/@supabase')) return 'supabase-vendor'
          if (id.includes('node_modules/recharts')) return 'charts-vendor'
          if (id.includes('node_modules/lucide-react') || id.includes('node_modules/react-hot-toast')) return 'ui-vendor'
        },
      },
    },
  },
  base: '/',
})