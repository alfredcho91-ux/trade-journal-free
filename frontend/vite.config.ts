import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    define: {
      global: 'globalThis',
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: 'globalThis',
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return

            if (id.includes('/echarts/') || id.includes('/zrender/')) return 'charts'
            if (id.includes('@tanstack/react-query')) return 'react-query'
            if (id.includes('lucide-react')) return 'icons'
            if (id.includes('react-dom')) return 'react-dom'
            if (id.includes('react')) return 'react'

            return 'vendor'
          },
        },
      },
    },
    server: {
      host: env.JOURNAL_HOST || '127.0.0.1',
      port: Number(env.JOURNAL_FRONTEND_PORT || 5181),
      allowedHosts: ['.ngrok-free.dev'],
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:8011',
          changeOrigin: true,
        },
      },
    },
  }
})
