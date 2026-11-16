/**
 * セッションごとの xterm.js を React の外で持つ。
 * 選択を切り替えても端末と PTY は生かしたまま、表示だけを切り替える。
 * 状態の判定もここで行う（非表示のセッションも判定を続ける）。
 */
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal, type ITheme } from '@xterm/xterm'
import { compileRuleSet, detect, Stabilizer, type CompiledRuleSet, type DetectResult } from '@shared/detect'
import type { AgentState, RulesPayload } from '@shared/types'

const api = window.nagaya
const isMac = navigator.platform.toLowerCase().includes('mac')
const DETECT_INTERVAL_MS = 200

const LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#2c2c2a',
  cursor: '#2c2c2a',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(55,138,221,.30)',
}
const DARK: ITheme = {
  background: '#1a1a19',
  foreground: '#e8e6df',
  cursor: '#e8e6df',
  cursorAccent: '#1a1a19',
  selectionBackground: 'rgba(55,138,221,.40)',
}
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const theme = (): ITheme => (darkQuery.matches ? DARK : LIGHT)

interface Entry {
  id: string
  agent: string
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  running: boolean
  dirty: boolean
  stabilizer: Stabilizer
  last: DetectResult | null
  observer: ResizeObserver
}

export interface StateEvent {
  id: string
  state: AgentState
}

type Listener<T> = (v: T) => void

class TerminalManager {
  private entries = new Map<string, Entry>()
  private ruleSets = new Map<string, CompiledRuleSet>()
  private ruleErrors: string[] = []
  private stateListeners = new Set<Listener<StateEvent>>()
  private detailListeners = new Set<Listener<{ id: string; result: DetectResult | null }>>()
  private exitListeners = new Set<Listener<{ id: string; running: boolean }>>()
  private explainId: string | null = null

  constructor() {
    api.onPtyData((id, data) => {
      const e = this.entries.get(id)
      if (!e) return
      e.term.write(data, () => {
        e.dirty = true
      })
    })
    api.onPtyExit(({ id, exitCode }) => {
      const e = this.entries.get(id)
      if (!e) return
      e.running = false
      e.term.write(`\r\n\x1b[2m[プロセスが終了しました（終了コード ${exitCode}）。Enter で起動し直します]\x1b[0m\r\n`)
      e.dirty = true
      this.exitListeners.forEach((l) => l({ id, running: false }))
    })
    darkQuery.addEventListener('change', () => {
      for (const e of this.entries.values()) e.term.options.theme = theme()
    })
    setInterval(() => this.tick(), DETECT_INTERVAL_MS)
  }

  // ---- ルール ----

  setRules(p: RulesPayload): void {
    const errors = [...p.errors]
    const next = new Map<string, CompiledRuleSet>()
    for (const raw of p.ruleSets) {
      try {
        next.set(raw.agent, compileRuleSet(raw, raw.agent))
      } catch (e) {
        errors.push((e as Error).message)
      }
    }
    this.ruleSets = next
    this.ruleErrors = errors
    // 安定化の時間もルールに合わせて更新し、全セッションを判定し直す
    for (const e of this.entries.values()) {
      e.stabilizer.stableMs = next.get(e.agent)?.stableMs ?? 500
      e.dirty = true
    }
  }

  get errors(): string[] {
    return this.ruleErrors
  }

  get agents(): string[] {
    return [...this.ruleSets.keys()]
  }

  // ---- 端末 ----

  /** 端末を作って container に置き、PTY を起動する（作成済みなら置き直すだけ） */
  attach(id: string, agent: string, container: HTMLElement): void {
    let e = this.entries.get(id)
    if (e) {
      if (e.el.parentElement !== container) container.appendChild(e.el)
      return
    }
    const el = document.createElement('div')
    el.className = 'term-inner'
    container.appendChild(el)
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, "BIZ UDGothic", "MS Gothic", "Noto Sans Mono CJK JP", ui-monospace, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: theme(),
      macOptionIsMeta: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11' // 日本語・絵文字の幅を Claude Code の想定に合わせる
    term.open(el)

    const entry: Entry = {
      id,
      agent,
      term,
      fit,
      el,
      running: false,
      dirty: false,
      stabilizer: new Stabilizer(this.ruleSets.get(agent)?.stableMs ?? 500),
      last: null,
      observer: new ResizeObserver(() => this.fitEntry(entry)),
    }
    this.entries.set(id, entry)
    entry.observer.observe(el)

    term.onData((data) => {
      if (entry.running) {
        api.ptyWrite(id, data)
      } else if (data === '\r') {
        void this.start(id)
      }
    })
    term.attachCustomKeyEventHandler((ev) => this.handleKey(entry, ev))
    el.addEventListener('contextmenu', (ev) => {
      // 右クリック: 選択があればコピー、なければ貼り付け（Windows Terminal と同じ）
      ev.preventDefault()
      if (term.hasSelection()) {
        api.clipboardWrite(term.getSelection())
        term.clearSelection()
      } else {
        void this.paste(entry)
      }
    })

    this.fitEntry(entry)
    void this.start(id)
  }

  private handleKey(e: Entry, ev: KeyboardEvent): boolean {
    if (ev.type !== 'keydown') return true
    if (isMac) return true // macOS は Cmd+C / Cmd+V を編集メニューに任せる
    const key = ev.key.toLowerCase()
    if (ev.ctrlKey && !ev.altKey) {
      // Ctrl+C: 選択があればコピー、なければそのまま ^C を送る
      if (key === 'c' && (e.term.hasSelection() || ev.shiftKey)) {
        if (e.term.hasSelection()) {
          api.clipboardWrite(e.term.getSelection())
          e.term.clearSelection()
        }
        ev.preventDefault()
        return false
      }
      // Ctrl+V / Ctrl+Shift+V: 貼り付け
      if (key === 'v') {
        ev.preventDefault()
        void this.paste(e)
        return false
      }
    }
    // Shift+Enter: Claude Code の入力欄で改行する（ESC + CR を送る）
    if (key === 'enter' && ev.shiftKey && !ev.ctrlKey && !ev.altKey) {
      ev.preventDefault()
      if (e.running) api.ptyWrite(e.id, '\x1b\r')
      return false
    }
    return true
  }

  private async paste(e: Entry): Promise<void> {
    const text = await api.clipboardRead()
    if (text) e.term.paste(text) // ブラケットペーストに対応した形で送られる
  }

  private fitEntry(e: Entry): void {
    if (e.el.clientWidth === 0 || e.el.clientHeight === 0) return
    const before = `${e.term.cols}x${e.term.rows}`
    try {
      e.fit.fit()
    } catch {
      return
    }
    if (`${e.term.cols}x${e.term.rows}` !== before && e.running) api.ptyResize(e.id, e.term.cols, e.term.rows)
  }

  async start(id: string): Promise<void> {
    const e = this.entries.get(id)
    if (!e) return
    this.fitEntry(e)
    e.stabilizer.reset()
    this.emitState(id, 'unknown')
    const r = await api.ptyStart(id, e.term.cols, e.term.rows)
    if (r.ok) {
      e.running = true
      this.exitListeners.forEach((l) => l({ id, running: true }))
    } else {
      e.term.write(`\r\n\x1b[31m起動できませんでした: ${r.error ?? ''}\x1b[0m\r\n\x1b[2m[Enter で再試行します]\x1b[0m\r\n`)
    }
  }

  async restart(id: string): Promise<void> {
    const e = this.entries.get(id)
    if (!e) return
    api.ptyKill(id)
    e.running = false
    e.term.reset()
    await this.start(id)
  }

  setAgent(id: string, agent: string): void {
    const e = this.entries.get(id)
    if (!e) return
    e.agent = agent
    e.stabilizer.stableMs = this.ruleSets.get(agent)?.stableMs ?? 500
    e.dirty = true
  }

  focus(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    this.fitEntry(e)
    e.term.focus()
  }

  dispose(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    e.observer.disconnect()
    e.term.dispose()
    e.el.remove()
    this.entries.delete(id)
    api.ptyKill(id)
  }

  isRunning(id: string): boolean {
    return this.entries.get(id)?.running ?? false
  }

  // ---- 画面と判定 ----

  /** 今の画面（スクロールバックを除いた、いちばん下の rows 行）をテキストで返す */
  screenLines(id: string): string[] {
    const e = this.entries.get(id)
    if (!e) return []
    const buf = e.term.buffer.active
    const out: string[] = []
    for (let i = 0; i < e.term.rows; i++) out.push(buf.getLine(buf.baseY + i)?.translateToString(true) ?? '')
    return out
  }

  private tick(): void {
    const now = performance.now()
    for (const e of this.entries.values()) {
      if (!e.dirty && !e.stabilizer.pending) continue
      if (e.dirty) {
        e.dirty = false
        const rs = this.ruleSets.get(e.agent)
        e.last = rs ? detect(this.screenLines(e.id), rs) : null
        if (this.explainId === e.id) this.detailListeners.forEach((l) => l({ id: e.id, result: e.last }))
      }
      const changed = e.stabilizer.push(e.last?.state ?? 'unknown', now)
      if (changed) this.emitState(e.id, changed)
    }
  }

  private emitState(id: string, state: AgentState): void {
    api.reportState(id, state)
    this.stateListeners.forEach((l) => l({ id, state }))
  }

  onState(l: Listener<StateEvent>): () => void {
    this.stateListeners.add(l)
    return () => this.stateListeners.delete(l)
  }

  onRunning(l: Listener<{ id: string; running: boolean }>): () => void {
    this.exitListeners.add(l)
    return () => this.exitListeners.delete(l)
  }

  /** 判定の詳細を受け取る（id のセッションだけ。null で止める） */
  explain(id: string | null, l: Listener<{ id: string; result: DetectResult | null }>): () => void {
    this.explainId = id
    this.detailListeners.add(l)
    const e = id ? this.entries.get(id) : undefined
    if (e) {
      const rs = this.ruleSets.get(e.agent)
      e.last = rs ? detect(this.screenLines(e.id), rs) : null
      l({ id: e.id, result: e.last })
    }
    return () => {
      this.detailListeners.delete(l)
      if (this.explainId === id) this.explainId = null
    }
  }

  candidate(id: string): AgentState {
    return this.entries.get(id)?.last?.state ?? 'unknown'
  }
}

export const terminals = new TerminalManager()
