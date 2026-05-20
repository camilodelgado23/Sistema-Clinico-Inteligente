import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'

import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />

    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-soft)',
          fontFamily: 'var(--font-body)',
          fontSize: '0.875rem',
        },
        success: {
          iconTheme: { primary: 'var(--success)', secondary: 'var(--bg-base)' },
        },
        error: {
          iconTheme: { primary: 'var(--danger)', secondary: 'var(--bg-base)' },
          duration: 6000,
        },
      }}
    />
  </React.StrictMode>
)