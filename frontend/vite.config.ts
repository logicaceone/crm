import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Forces a new CSS hash on every production build by stamping the current
// build timestamp into a CSS custom property. Without this, identical source
// content produces identical hashes and browsers serve cached old files
// indefinitely (assets are sent with `Cache-Control: immutable`).
function cacheBustPlugin(): Plugin {
  const stamp = new Date().toISOString()
  return {
    name: 'cache-bust',
    transform(code, id) {
      if (id.endsWith('index.css')) {
        return code.replace(
          /--build-version:\s*"[^"]*";/,
          `--build-version: "${stamp}";`,
        )
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [react(), cacheBustPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['BACKEND_URL'] ?? 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
