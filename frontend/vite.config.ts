import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'oc-declare-wasm': path.resolve(__dirname, '../rust/wasm/pkg'),
    },
  },
  server: {
    fs: {
      // Allow serving files from the wasm pkg directory
      allow: ['.', '../rust/wasm/pkg'],
    },
  },
})
