/**
 * タブごとの xterm.js を React の外で持つ（id はタブの id）。
 * 選択を切り替えても端末と PTY は生かしたまま、表示だけを切り替える。
 * 状態の判定もここで行う（非表示のセッションも判定を続ける）。
 */
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type IMarker } from '@xterm/xterm'
import type { TerminalMenuAction } from '@shared/api'
import { DEFAULT_FONT, fontFamilyCss } from '@shared/font'
import { decodeOsc52 } from '@shared/osc52'
import { compileRuleSet, detect, Stabilizer, type CompiledRuleSet, type DetectResult } from '@shared/detect'
import {
  SSH_CONNECTION_ERROR,
  type AgentState,
  type FontSetting,
  type RulesPayload,
  type SavedScreen,
  type TabConfig,
} from '@shared/types'
import { darkQuery, termTheme } from './termTheme'

const api = window.nagaya
const isMac = navigator.platform.toLowerCase().includes('mac')
const DETECT_INTERVAL_MS = 200
/** 再接続までの待ち時間（秒）。回数が増えるほど長くし、最後の値で繰り返す */
const RECONNECT_DELAYS = [2, 5, 10, 20, 30]
/** これより長くつながっていたら、再接続の回数を数え直す */
const RECONNECT_RESET_MS = 60_000

const theme = termTheme

/** 端末の中のプロセスの状態 */
export type ConnStatus = 'running' | 'exited' | 'reconnecting'

export interface ConnEvent {
  id: string
  status: ConnStatus
  /** 再接続の何回目か（reconnecting のとき） */
  attempt?: number
  /** 再接続するまでの秒数（reconnecting のとき） */
  delaySec?: number
}

interface Entry {
  id: string
  cfg: TabConfig
  term: Terminal
  fit: FitAddon
  serialize: SerializeAddon
  el: HTMLDivElement
  running: boolean
  dirty: boolean
  stabilizer: Stabilizer
  last: DetectResult | null
  observer: ResizeObserver
  /** 最後に起動した時刻（再接続の回数を数え直すため） */
  startedAt: number
  attempt: number
  reconnectTimer: number | null
  /** 前回の表示を戻している最中か（終わるまで起動しない） */
  restoring: boolean
  /**
   * 戻した前回の表示の、次の行。これより上は判定に使わない（前回の確認待ちの画面などで誤判定しないように）。
   * スクロールバックから押し出されると isDisposed になり、そのときは全部を判定に使う
   */
  floor: IMarker | null
  /** 別ウィンドウで開いているか（このウィンドウでは隠し、大きさは別ウィンドウに合わせる） */
  popped: boolean
  /** 別ウィンドウに開いた時点の表示を送るまで、その後に書いたものを溜めておく */
  pending: string[] | null
  /** 表示が変わるたびに増える数（ダッシュボードが、変わったカードだけ描き直すため） */
  rev: number
  /** いつもの置き場（タブの TerminalSlot） */
  home: HTMLElement
  /** ダッシュボードに貸し出しているか（そのあいだは home に戻さない） */
  borrowed: boolean
}

/** 端末の右クリックメニューで選ばれた、分割の操作（App が処理する） */
export interface PaneMenuEvent {
  id: string
  action: Extract<NonNullable<TerminalMenuAction>, { type: 'split' | 'unsplit' }>
}

export interface PopoutEvent {
  id: string
  popped: boolean
  /** 別ウィンドウが前面にあるか */
  focused: boolean
}

export interface StateEvent {
  id: string
  state: AgentState
}

type Listener<T> = (v: T) => void

/** リンクをブラウザで開く（メイン側の setWindowOpenHandler が既定のブラウザに渡す） */
function openLink(uri: string): void {
  window.open(uri)
}

class TerminalManager {
  private entries = new Map<string, Entry>()
  private ruleSets = new Map<string, CompiledRuleSet>()
  private ruleErrors: string[] = []
  private stateListeners = new Set<Listener<StateEvent>>()
  private detailListeners = new Set<Listener<{ id: string; result: DetectResult | null }>>()
  private connListeners = new Set<Listener<ConnEvent>>()
  private paneMenuListeners = new Set<Listener<PaneMenuEvent>>()
  private explainId: string | null = null
  private font: FontSetting = { ...DEFAULT_FONT }

  constructor() {
    api.onPtyData((id, data) => {
      const e = this.entries.get(id)
      if (!e) return
      this.write(e, data, () => {
        e.dirty = true
        e.rev++
      })
    })
    api.onPtyExit(({ id, exitCode }) => this.onExit(id, exitCode))
    darkQuery.addEventListener('change', () => {
      for (const e of this.entries.values()) e.term.options.theme = theme()
    })
    setInterval(() => this.tick(), DETECT_INTERVAL_MS)
    api.onCollectScreens(() => this.serializeAll())
    api.onPopoutOpened((id) => this.popoutOpened(id))
    api.onPopoutClosed((id) => this.popoutClosed(id))
    api.onPopoutInput((id, data) => {
      const e = this.entries.get(id)
      // このウィンドウで打ったのと同じ扱いにする（Enter で起動し直す・再接続なども効く）
      if (e?.popped) e.term.input(data, true)
    })
    api.onPopoutResize((id, cols, rows) => {
      const e = this.entries.get(id)
      if (!e?.popped || (e.term.cols === cols && e.term.rows === rows)) return
      e.term.resize(cols, rows)
      if (e.running) api.ptyResize(id, cols, rows)
      e.dirty = true
    })
    api.onPopoutFocus((id, focused) => {
      if (focused) this.popoutFocused.add(id)
      else this.popoutFocused.delete(id)
      this.popoutListeners.forEach((l) => l({ id, popped: this.entries.get(id)?.popped ?? false, focused }))
    })
  }

  /** 端末に書く。別ウィンドウで開いていれば、そちらにも送る */
  private write(e: Entry, data: string, cb?: () => void): void {
    e.term.write(data, cb)
    this.relay(e, data)
  }

  private relay(e: Entry, data: string): void {
    if (!e.popped) return
    if (e.pending) e.pending.push(data)
    else api.popoutRelay(e.id, { type: 'data', data })
  }

  // ---- 別ウィンドウ ----

  private popoutFocused = new Set<string>()
  private popoutListeners = new Set<Listener<PopoutEvent>>()

  private popoutOpened(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    e.popped = true
    // 今までに書いたものが反映されてから、その時点の表示を送る。それまでに書いたものは pending に溜めて後から送る
    const pending: string[] = []
    e.pending = pending
    e.term.write('', () => {
      if (e.pending !== pending) return
      api.popoutRelay(id, { type: 'snapshot', data: e.serialize.serialize(), cols: e.term.cols, rows: e.term.rows })
      for (const data of pending) api.popoutRelay(id, { type: 'data', data })
      e.pending = null
    })
    this.popoutListeners.forEach((l) => l({ id, popped: true, focused: false }))
  }

  private popoutClosed(id: string): void {
    this.popoutFocused.delete(id)
    const e = this.entries.get(id)
    if (!e) return
    e.popped = false
    e.pending = null
    this.fitEntry(e) // このウィンドウの大きさに戻す
    this.popoutListeners.forEach((l) => l({ id, popped: false, focused: false }))
  }

  /** 別ウィンドウで開いた・閉じた・前面に来たとき */
  onPopout(l: Listener<PopoutEvent>): () => void {
    this.popoutListeners.add(l)
    return () => this.popoutListeners.delete(l)
  }

  isPopped(id: string): boolean {
    return this.entries.get(id)?.popped ?? false
  }

  /** 別ウィンドウで開いていて、そのウィンドウが前面にあるか */
  isPopoutFocused(id: string): boolean {
    return this.popoutFocused.has(id)
  }

  // ---- 終了したときの表示を残す・戻す ----

  /** すべての端末の表示を書き出す（終了する前にメインから呼ばれる） */
  private serializeAll(): { id: string; data: string }[] {
    const out: { id: string; data: string }[] = []
    for (const e of this.entries.values()) {
      try {
        // 代替画面（vim など）とモード（マウス操作など）は戻さない。戻すのは見た目だけ
        out.push({ id: e.id, data: e.serialize.serialize({ excludeAltBuffer: true, excludeModes: true }) })
      } catch {
        // 1枚書き出せなくても、ほかのタブは残す
      }
    }
    return out
  }

  /** 前回の表示を戻してから、プロセスを起動する */
  private async restoreThenStart(e: Entry): Promise<void> {
    e.restoring = true
    try {
      const saved = await api.loadSavedScreen(e.id).catch(() => null)
      if (saved && this.entries.get(e.id) === e) await this.restoreScreen(e, saved)
    } finally {
      e.restoring = false
    }
    if (this.entries.get(e.id) === e) await this.start(e.id)
  }

  private restoreScreen(e: Entry, saved: SavedScreen): Promise<void> {
    return new Promise((resolve) => {
      this.write(e, saved.data, () => {
        // カーソルを、戻した表示の最後の行の次へ動かす（途中に残っていると、新しい出力が前回の表示を上書きする）
        const buf = e.term.buffer.active
        let last = buf.length - 1
        while (last >= 0 && (buf.getLine(last)?.translateToString(true).trim() ?? '') === '') last--
        const row = last - buf.baseY
        const move = row >= 0 ? `\x1b[${row + 1};1H\r\n` : '\x1b[H'
        const at = new Date(saved.savedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
        this.write(e, `\x1b[0m${move}\x1b[2m── ここまで前回の表示（${at} に終了）──\x1b[0m\r\n`, () => {
          e.floor?.dispose()
          e.floor = e.term.registerMarker(0) ?? null
          resolve()
        })
      })
    })
  }

  // ---- フォント ----

  /** 端末のフォントを変える（開いている端末すべてに効く。桁数・行数も合わせ直す） */
  setFont(font: FontSetting): void {
    if (font.family === this.font.family && font.size === this.font.size) return
    this.font = { ...font }
    for (const e of this.entries.values()) {
      e.term.options.fontFamily = fontFamilyCss(font.family)
      e.term.options.fontSize = font.size
      this.fitEntry(e)
    }
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
      e.stabilizer.stableMs = next.get(e.cfg.agent)?.stableMs ?? 500
      e.dirty = true
    }
  }

  get errors(): string[] {
    return this.ruleErrors
  }

  get agents(): string[] {
    return [...this.ruleSets.keys()]
  }

  // ---- 終了と再接続 ----

  private onExit(id: string, exitCode: number): void {
    const e = this.entries.get(id)
    if (!e) return
    e.running = false
    // 終わったプロセスの状態（確認待ちなど）を残さない
    e.stabilizer.reset()
    e.last = null
    this.emitState(id, 'unknown')
    if (e.cfg.autoReconnect && exitCode === SSH_CONNECTION_ERROR) {
      if (performance.now() - e.startedAt > RECONNECT_RESET_MS) e.attempt = 0
      this.scheduleReconnect(e)
      return
    }
    this.write(e, `\r\n\x1b[2m[プロセスが終了しました（終了コード ${exitCode}）。Enter で起動し直します]\x1b[0m\r\n`)
    this.emitConn({ id, status: 'exited' })
  }

  private scheduleReconnect(e: Entry): void {
    const delaySec = RECONNECT_DELAYS[Math.min(e.attempt, RECONNECT_DELAYS.length - 1)]
    e.attempt++
    this.write(e, 
      `\r\n\x1b[33m[接続が切れました（終了コード ${SSH_CONNECTION_ERROR}）。${delaySec} 秒後に再接続します（${e.attempt} 回目）。` +
        `Enter ですぐに再接続、Esc で中止]\x1b[0m\r\n`,
    )
    this.clearReconnect(e)
    e.reconnectTimer = window.setTimeout(() => {
      e.reconnectTimer = null
      void this.reconnect(e.id)
    }, delaySec * 1000)
    this.emitConn({ id: e.id, status: 'reconnecting', attempt: e.attempt, delaySec })
  }

  private clearReconnect(e: Entry): void {
    if (e.reconnectTimer !== null) window.clearTimeout(e.reconnectTimer)
    e.reconnectTimer = null
  }

  /** 再接続する（画面は消さずに続ける） */
  async reconnect(id: string): Promise<void> {
    const e = this.entries.get(id)
    if (!e || e.running) return
    this.clearReconnect(e)
    this.write(e, '\x1b[2m[再接続します…]\x1b[0m\r\n')
    await this.spawn(e, true)
  }

  /** 再接続の待ちをやめる */
  cancelReconnect(id: string): void {
    const e = this.entries.get(id)
    if (!e || e.reconnectTimer === null) return
    this.clearReconnect(e)
    e.attempt = 0
    this.write(e, '\x1b[2m[再接続をやめました。Enter で起動し直します]\x1b[0m\r\n')
    this.emitConn({ id, status: 'exited' })
  }

  // ---- 端末 ----

  /** 端末を作って container に置き、PTY を起動する（作成済みなら置き直すだけ） */
  attach(cfg: TabConfig, container: HTMLElement): void {
    const id = cfg.id
    let e = this.entries.get(id)
    if (e) {
      e.home = container
      if (!e.borrowed && e.el.parentElement !== container) container.appendChild(e.el)
      return
    }
    const el = document.createElement('div')
    el.className = 'term-inner'
    container.appendChild(el)
    const term = new Terminal({
      fontFamily: fontFamilyCss(this.font.family),
      fontSize: this.font.size,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: theme(),
      macOptionIsMeta: true,
      // OSC 8 のハイパーリンク（既定の処理は空のウィンドウを開いてから移るため、ブラウザに URL が渡らない）
      linkHandler: { activate: (_e, uri) => openLink(uri) },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const serialize = new SerializeAddon()
    term.loadAddon(serialize)
    term.loadAddon(new Unicode11Addon())
    term.loadAddon(new WebLinksAddon((_e, uri) => openLink(uri))) // 文字のままの URL もクリックで開く
    term.unicode.activeVersion = '11' // 日本語・絵文字の幅を Claude Code の想定に合わせる
    term.open(el)

    const entry: Entry = {
      id,
      cfg,
      term,
      fit,
      serialize,
      el,
      running: false,
      dirty: false,
      stabilizer: new Stabilizer(this.ruleSets.get(cfg.agent)?.stableMs ?? 500),
      last: null,
      observer: new ResizeObserver(() => this.fitEntry(entry)),
      startedAt: 0,
      attempt: 0,
      reconnectTimer: null,
      restoring: false,
      floor: null,
      popped: false,
      pending: null,
      rev: 0,
      home: container,
      borrowed: false,
    }
    this.entries.set(id, entry)
    entry.observer.observe(el)

    term.onData((data) => {
      if (entry.running) {
        api.ptyWrite(id, data)
      } else if (entry.reconnectTimer !== null) {
        // 再接続の待ち中: Enter ですぐ再接続、Esc で中止
        if (data === '\r') void this.reconnect(id)
        else if (data === '\x1b') this.cancelReconnect(id)
      } else if (data === '\r' && !entry.restoring) {
        void this.start(id)
      }
    })
    term.attachCustomKeyEventHandler((ev) => this.handleKey(entry, ev))
    // OSC 52（クリップボードへの書き込み）: Claude Code などマウス操作を受け取るアプリは、
    // 自分で選択した範囲をこれで送ってくる。書き込みだけ受け、読み出し（?）には応じない
    term.parser.registerOscHandler(52, (data) => {
      const text = decodeOsc52(data)
      if (text !== null) api.clipboardWrite(text)
      return true
    })
    // 選択しただけでコピーする。ドラッグは端末の外で離すこともあるので、離したのは window で受ける。
    // ダブルクリックの単語の選択は mouseup の後に決まるので dblclick でも受ける
    const copySelection = (): void => {
      if (term.hasSelection()) api.clipboardWrite(term.getSelection())
    }
    el.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return
      window.addEventListener('mouseup', copySelection, { once: true })
    })
    el.addEventListener('dblclick', copySelection)
    el.addEventListener('contextmenu', (ev) => {
      // 右クリック: メニュー（コピー・貼り付け・分割）を出す
      ev.preventDefault()
      void this.contextMenu(entry)
    })

    this.fitEntry(entry)
    void this.restoreThenStart(entry)
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

  private async contextMenu(e: Entry): Promise<void> {
    // メニューを出しているあいだに選択が変わることがあるので、先に取っておく
    const selection = e.term.hasSelection() ? e.term.getSelection() : ''
    const action = await api.terminalMenu(e.id, selection !== '')
    if (!action) return
    if (action.type === 'copy') {
      if (selection) api.clipboardWrite(selection)
      e.term.clearSelection()
      e.term.focus()
    } else if (action.type === 'paste') {
      await this.paste(e)
      e.term.focus()
    } else {
      this.paneMenuListeners.forEach((l) => l({ id: e.id, action }))
    }
  }

  /** 端末の右クリックメニューで分割の操作が選ばれたとき */
  onPaneMenu(l: Listener<PaneMenuEvent>): () => void {
    this.paneMenuListeners.add(l)
    return () => this.paneMenuListeners.delete(l)
  }

  private async paste(e: Entry): Promise<void> {
    const text = await api.clipboardRead()
    if (text) e.term.paste(text) // ブラケットペーストに対応した形で送られる
  }

  private fitEntry(e: Entry): void {
    if (e.popped) return // 大きさは別ウィンドウに合わせる
    if (e.el.clientWidth === 0 || e.el.clientHeight === 0) return
    const before = `${e.term.cols}x${e.term.rows}`
    try {
      e.fit.fit()
    } catch {
      return
    }
    if (`${e.term.cols}x${e.term.rows}` !== before && e.running) api.ptyResize(e.id, e.term.cols, e.term.rows)
  }

  /** 起動する（再接続の回数も数え直す） */
  async start(id: string): Promise<void> {
    const e = this.entries.get(id)
    if (!e) return
    this.clearReconnect(e)
    e.attempt = 0
    await this.spawn(e, false)
  }

  private async spawn(e: Entry, reconnect: boolean): Promise<void> {
    this.fitEntry(e)
    e.stabilizer.reset()
    this.emitState(e.id, 'unknown')
    e.startedAt = performance.now()
    // 起動を待つあいだに来た端末の問い合わせ（ConPTY のカーソル位置など）にも答えられるよう、先に動いていることにする
    e.running = true
    const r = await api.ptyStart(e.id, e.term.cols, e.term.rows, reconnect)
    if (r.ok) {
      this.emitConn({ id: e.id, status: 'running' })
    } else {
      e.running = false
      this.write(e, `\r\n\x1b[31m起動できませんでした: ${r.error ?? ''}\x1b[0m\r\n\x1b[2m[Enter で再試行します]\x1b[0m\r\n`)
      this.emitConn({ id: e.id, status: 'exited' })
    }
  }

  async restart(id: string): Promise<void> {
    const e = this.entries.get(id)
    if (!e) return
    api.ptyKill(id)
    e.running = false
    e.term.reset()
    e.rev++
    this.relay(e, '\x1bc') // 別ウィンドウの端末も消す
    e.floor?.dispose()
    e.floor = null
    await this.start(id)
  }

  /** タブの設定が変わったとき（ルール・自動再接続など） */
  updateConfig(cfg: TabConfig): void {
    const e = this.entries.get(cfg.id)
    if (!e) return
    e.cfg = cfg
    e.stabilizer.stableMs = this.ruleSets.get(cfg.agent)?.stableMs ?? 500
    e.dirty = true
    if (!cfg.autoReconnect && e.reconnectTimer !== null) this.cancelReconnect(cfg.id)
  }

  focus(id: string): void {
    const e = this.entries.get(id)
    if (!e || e.popped) return // 別ウィンドウで開いているあいだは、このウィンドウで打たせない
    this.fitEntry(e)
    e.term.focus()
  }

  dispose(id: string): void {
    const e = this.entries.get(id)
    if (!e) return
    this.clearReconnect(e)
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

  /** 判定に使う行（今の画面のうち、戻した前回の表示の行は空にする） */
  private detectLines(e: Entry): string[] {
    const lines = this.screenLines(e.id)
    const floor = e.floor && !e.floor.isDisposed ? e.floor.line : -1
    if (floor < 0) return lines
    const base = e.term.buffer.active.baseY
    return lines.map((l, i) => (base + i < floor ? '' : l))
  }

  private tick(): void {
    const now = performance.now()
    for (const e of this.entries.values()) {
      if (!e.dirty && !e.stabilizer.pending) continue
      if (e.dirty) {
        e.dirty = false
        const rs = this.ruleSets.get(e.cfg.agent)
        e.last = rs ? detect(this.detectLines(e), rs) : null
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

  private emitConn(ev: ConnEvent): void {
    this.connListeners.forEach((l) => l(ev))
  }

  onConn(l: Listener<ConnEvent>): () => void {
    this.connListeners.add(l)
    return () => this.connListeners.delete(l)
  }

  /** 判定の詳細を受け取る（id のセッションだけ。null で止める） */
  explain(id: string | null, l: Listener<{ id: string; result: DetectResult | null }>): () => void {
    this.explainId = id
    this.detailListeners.add(l)
    const e = id ? this.entries.get(id) : undefined
    if (e) {
      const rs = this.ruleSets.get(e.cfg.agent)
      e.last = rs ? detect(this.detectLines(e), rs) : null
      l({ id: e.id, result: e.last })
    }
    return () => {
      this.detailListeners.delete(l)
      if (this.explainId === id) this.explainId = null
    }
  }

  // ---- ダッシュボード ----

  /** 今の画面（戻した前回の表示の行は空にする。判定に使うのと同じ行） */
  liveLines(id: string): string[] {
    const e = this.entries.get(id)
    return e ? this.detectLines(e) : []
  }

  /** 表示が変わるたびに増える数（端末がなければ -1） */
  revision(id: string): number {
    return this.entries.get(id)?.rev ?? -1
  }

  /** 端末で打ったのと同じ扱いで送る（Enter で起動し直す・再接続なども効く） */
  input(id: string, data: string): void {
    this.entries.get(id)?.term.input(data, true)
  }

  /**
   * 端末をダッシュボードのカードに貸し出す（container に移して、そこで直接操作できるようにする）。
   * 桁数・行数は container に合わせ直す。別ウィンドウで開いているタブは貸し出さない（false を返す）
   */
  borrow(id: string, container: HTMLElement): boolean {
    const e = this.entries.get(id)
    if (!e || e.popped) return false
    e.borrowed = true
    if (e.el.parentElement !== container) container.appendChild(e.el)
    this.fitEntry(e)
    return true
  }

  /** 貸し出した端末を、いつもの置き場に戻す */
  giveBack(id: string): void {
    const e = this.entries.get(id)
    if (!e?.borrowed) return
    e.borrowed = false
    if (e.el.parentElement !== e.home) e.home.appendChild(e.el)
    this.fitEntry(e)
  }

  /** 再接続を待っているか */
  isReconnecting(id: string): boolean {
    return (this.entries.get(id)?.reconnectTimer ?? null) !== null
  }

  candidate(id: string): AgentState {
    return this.entries.get(id)?.last?.state ?? 'unknown'
  }
}

export const terminals = new TerminalManager()
