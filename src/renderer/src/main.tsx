import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'

// StrictMode は使わない（端末と PTY を二重に作らないため）
createRoot(document.getElementById('root')!).render(<App />)
