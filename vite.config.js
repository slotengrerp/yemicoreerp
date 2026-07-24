import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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