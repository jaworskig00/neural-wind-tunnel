import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Vite's warning counts uncompressed bytes, which says little about what a visitor downloads.
    // The real budgets are enforced by size-limit against gzip sizes; see `size-limit` in
    // package.json. This threshold only silences a warning the renderer chunk will always trip.
    chunkSizeWarningLimit: 1000,
  },
})
