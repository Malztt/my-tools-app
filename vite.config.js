import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          utils: ['xlsx', 'file-saver', 'jszip'],
          pdf: ['pdfjs-dist', 'pdf-lib'],
          ui: ['lucide-react', '@hello-pangea/dnd'],
          markdown: ['react-markdown', 'markmap-view', 'markmap-lib']
        }
      }
    }
  }
})
