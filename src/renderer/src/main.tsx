import '@xterm/xterm/css/xterm.css'
import './styles.css'

// ?popout=<タブの id> なら、そのタブだけを出す別ウィンドウ。
// 別ウィンドウでは App（と端末の管理）を読み込まない（PTY の出力を二重に受け取らないように）
if (new URLSearchParams(location.search).has('popout')) {
  void import('./popout').then((m) => m.startPopout())
} else {
  void Promise.all([import('react-dom/client'), import('./App')]).then(([{ createRoot }, { App }]) => {
    // StrictMode は使わない（端末と PTY を二重に作らないため）
    createRoot(document.getElementById('root')!).render(<App />)
  })
}
