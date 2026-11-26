import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import type { TabConfig } from '@shared/types'

export interface SpawnSpec {
  file: string
  args: string[]
  cwd: string
}

/** 既定のシェル。Windows は PowerShell、それ以外はログインシェル */
export function defaultShell(): string {
  if (process.env.NAGAYA_SHELL) return process.env.NAGAYA_SHELL
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

/**
 * セッションの設定から起動するプロセスを決める。
 * コマンドはシェル経由で実行する（引用符や PATH の解決をシェルに任せるため）。
 */
export function spawnSpec(cfg: Pick<TabConfig, 'command' | 'cwd'>): SpawnSpec {
  const shell = defaultShell()
  const win = process.platform === 'win32'
  const isPwsh = /(^|[\\/])(powershell|pwsh)(\.exe)?$/i.test(shell)
  let args: string[]
  if (!cfg.command) {
    args = win ? (isPwsh ? ['-NoLogo'] : []) : ['-l']
  } else if (win) {
    // Windows PowerShell 5.1 の -Command は、終了コードを 0 か 1 にしてしまう。
    // SSH が切れたこと（ssh の終了コード 255）を伝えるため、最後のコマンドの終了コードで終わらせる
    args = isPwsh
      ? ['-NoLogo', '-NoProfile', '-Command', `${cfg.command}\nexit $LASTEXITCODE`]
      : ['/d', '/s', '/c', cfg.command]
  } else {
    args = ['-lc', cfg.command]
  }
  let cwd = homedir()
  if (cfg.cwd) {
    const expanded = cfg.cwd.replace(/^~(?=$|[\\/])/, homedir())
    if (existsSync(expanded) && statSync(expanded).isDirectory()) cwd = expanded
    else throw new Error(`作業ディレクトリがありません: ${cfg.cwd}`)
  }
  return { file: shell, args, cwd }
}

type DataListener = (id: string, data: string) => void
type ExitListener = (id: string, exitCode: number, signal?: number) => void

/** タブごとの PTY を管理する。出力は少しまとめてから送る（IPC の回数を減らすため） */
export class PtyManager {
  private ptys = new Map<string, pty.IPty>()
  private buffers = new Map<string, string>()
  private flushTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly onData: DataListener,
    private readonly onExit: ExitListener,
  ) {}

  /** 動いているプロセスの数 */
  get count(): number {
    return this.ptys.size
  }

  has(id: string): boolean {
    return this.ptys.has(id)
  }

  /** reconnect が true なら、再接続のコマンド（あれば）で起動する */
  start(cfg: TabConfig, cols: number, rows: number, reconnect = false): void {
    this.kill(cfg.id)
    const command = reconnect && cfg.reconnectCommand ? cfg.reconnectCommand : cfg.command
    const spec = spawnSpec({ command, cwd: cfg.cwd })
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.TERM_PROGRAM = 'nagaya'
    const p = pty.spawn(spec.file, spec.args, {
      name: 'xterm-256color',
      cols: Math.max(cols, 2),
      rows: Math.max(rows, 2),
      cwd: spec.cwd,
      env,
      // Windows は ConPTY を使う（node-pty の既定）。
      // ConPTY は起動すると画面を消して左上から描き始めるので、前回の表示や、終了・再接続の前の表示が消える。
      // カーソルの位置を引き継がせると、消さずにその位置から描く（ConPTY がカーソルの位置を問い合わせ、
      // xterm.js が答える。答えが届くまで ConPTY は待つので、renderer は起動を待たずに書き込めるようにしてある）
      conptyInheritCursor: process.platform === 'win32',
    })
    this.ptys.set(cfg.id, p)
    p.onData((d) => this.push(cfg.id, d))
    p.onExit(({ exitCode, signal }) => {
      // 同じ id で再起動済みなら古い終了は無視
      if (this.ptys.get(cfg.id) !== p) return
      this.flush()
      this.ptys.delete(cfg.id)
      this.onExit(cfg.id, exitCode, signal)
    })
  }

  private push(id: string, data: string): void {
    this.buffers.set(id, (this.buffers.get(id) ?? '') + data)
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 4)
  }

  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    for (const [id, data] of this.buffers) this.onData(id, data)
    this.buffers.clear()
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const p = this.ptys.get(id)
    if (!p || cols < 2 || rows < 2) return
    try {
      p.resize(cols, rows)
    } catch {
      /* 終了直後のリサイズは無視 */
    }
  }

  kill(id: string): void {
    const p = this.ptys.get(id)
    if (!p) return
    this.ptys.delete(id)
    this.buffers.delete(id)
    try {
      p.kill()
    } catch {
      /* 無視 */
    }
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id)
  }
}
