/**
 * 別ウィンドウ（タブ1枚だけを出すウィンドウ）の画面。
 * 端末の中身はメインのウィンドウから送られてくるものを出すだけで、打った文字はメインのウィンドウに送る
 * （プロセス・判定・再接続はメインのウィンドウが受け持つ）。
 */
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { DEFAULT_FONT, fontFamilyCss } from '@shared/font'
import type { FontSetting } from '@shared/types'
import { darkQuery, termTheme } from './termTheme'

const api = window.nagaya
const isMac = navigator.platform.toLowerCase().includes('mac')

export async function startPopout(): Promise<void> {
  document.body.classList.add('popout')
  const root = document.getElementById('root')!
  const el = document.createElement('div')
  el.className = 'term-inner'
  root.appendChild(el)

  let font: FontSetting = { ...DEFAULT_FONT }
  try {
    font = (await api.getSettings()).font
  } catch {
    // 既定のフォントのまま
  }
  const openLink = (uri: string): void => void window.open(uri)
  const term = new Terminal({
    fontFamily: fontFamilyCss(font.family),
    fontSize: font.size,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    theme: termTheme(),
    macOptionIsMeta: true,
    linkHandler: { activate: (_e, uri) => openLink(uri) },
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new Unicode11Addon())
  term.loadAddon(new WebLinksAddon((_e, uri) => openLink(uri)))
  term.unicode.activeVersion = '11'
  term.open(el)

  /** 送られてきた表示を出し終えるまでは、大きさをメインのウィンドウに知らせない */
  let synced = false
  const fitAndReport = (force = false): void => {
    if (el.clientWidth === 0 || el.clientHeight === 0) return
    const before = `${term.cols}x${term.rows}`
    try {
      fit.fit()
    } catch {
      return
    }
    if (synced && (force || `${term.cols}x${term.rows}` !== before)) api.popoutResize(term.cols, term.rows)
  }
  new ResizeObserver(() => fitAndReport()).observe(el)

  api.onPopoutData((msg) => {
    if (msg.type === 'snapshot') {
      // 送られてきた表示は、メインのウィンドウの大きさで書き出したもの。同じ大きさで出してから、このウィンドウに合わせる
      synced = false
      term.reset()
      term.resize(msg.cols, msg.rows)
      term.write(msg.data, () => {
        synced = true
        fitAndReport(true)
      })
    } else {
      term.write(msg.data)
    }
  })
  api.onSettingsChanged((s) => {
    term.options.fontFamily = fontFamilyCss(s.font.family)
    term.options.fontSize = s.font.size
    fitAndReport()
  })
  darkQuery.addEventListener('change', () => (term.options.theme = termTheme()))

  term.onData((data) => api.popoutInput(data))

  const paste = async (): Promise<void> => {
    const text = await api.clipboardRead()
    if (text) term.paste(text)
  }
  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown' || isMac) return true
    const key = ev.key.toLowerCase()
    if (ev.ctrlKey && !ev.altKey) {
      if (key === 'c' && (term.hasSelection() || ev.shiftKey)) {
        if (term.hasSelection()) {
          api.clipboardWrite(term.getSelection())
          term.clearSelection()
        }
        ev.preventDefault()
        return false
      }
      if (key === 'v') {
        ev.preventDefault()
        void paste()
        return false
      }
    }
    if (key === 'enter' && ev.shiftKey && !ev.ctrlKey && !ev.altKey) {
      ev.preventDefault()
      api.popoutInput('\x1b\r')
      return false
    }
    return true
  })
  const copySelection = (): void => {
    if (term.hasSelection()) api.clipboardWrite(term.getSelection())
  }
  el.addEventListener('mousedown', (ev) => {
    if (ev.button === 0) window.addEventListener('mouseup', copySelection, { once: true })
  })
  el.addEventListener('dblclick', copySelection)
  el.addEventListener('contextmenu', (ev) => {
    ev.preventDefault()
    const selection = term.hasSelection() ? term.getSelection() : ''
    void api.popoutMenu(selection !== '').then(async (action) => {
      if (action === 'copy') {
        if (selection) api.clipboardWrite(selection)
        term.clearSelection()
      } else if (action === 'paste') {
        await paste()
      } else if (action === 'return') {
        window.close()
        return
      }
      term.focus()
    })
  })

  fitAndReport()
  api.popoutReady()
  term.focus()
}
