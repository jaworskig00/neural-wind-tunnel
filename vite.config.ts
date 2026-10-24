import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The demo is served as a static site; keep the chunk warning low enough that
    // an accidental dependency on something large is noticed immediately.
    chunkSizeWarningLimit: 300,
  },
})
