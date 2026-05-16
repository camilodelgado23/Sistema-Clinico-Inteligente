import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || 'http://localhost:8000'),
    'import.meta.env.VITE_RAG_URL': JSON.stringify(process.env.VITE_RAG_URL || 'http://localhost:8004'),
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    watch: { usePolling: true, interval: 1000 },
    proxy: {
      '/infer': { target: 'http://backend:8000' },
      '/auth':  { target: 'http://backend:8000' },
      '/fhir':  { target: 'http://backend:8000' },
      '/admin': { target: 'http://backend:8000' },
      '/api/v1': { target: 'http://backend:8000' },
      '/agent': { target: 'http://rag-agent:8004' },
      '/ws': { target: 'ws://orchestrator:8003', ws: true },
    },
  },
})