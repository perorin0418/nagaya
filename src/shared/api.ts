import type { AgentState, NewSessionInput, PtyExit, RulesPayload, SessionConfig } from './types'

export type SessionMenuAction = 'edit' | 'restart' | 'delete' | null

export interface AppInfo {
  platform: string
  defaultShell: string
  version: string
}

/** preload が renderer に公開する API（window.nagaya） */
export interface NagayaApi {
  info(): Promise<AppInfo>

  listSessions(): Promise<{ sessions: SessionConfig[]; selectedId: string | null }>
  createSession(input: NewSessionInput): Promise<SessionConfig>
  updateSession(cfg: SessionConfig): Promise<void>
  removeSession(id: string): Promise<void>
  /** サイドバーの右クリックメニューを出し、選ばれた操作を返す（削除は確認済みで返る） */
  sessionMenu(id: string): Promise<SessionMenuAction>

  ptyStart(id: string, cols: number, rows: number): Promise<{ ok: boolean; error?: string }>
  ptyWrite(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  ptyKill(id: string): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (e: PtyExit) => void): () => void

  getRules(): Promise<RulesPayload>
  reloadRules(): Promise<RulesPayload>
  openRulesFolder(): Promise<void>
  onRulesChanged(cb: (p: RulesPayload) => void): () => void

  /** 確定した状態を main に知らせる（通知・タイトル用） */
  reportState(id: string, state: AgentState): void
  /** 選択中のセッションを main に知らせる（通知を出すかの判断・保存用） */
  reportSelected(id: string | null): void
  /** 通知のクリックなどで main からセッションの選択を求められたとき */
  onSelectSession(cb: (id: string) => void): () => void
  /** メニューの「新しいセッション」など */
  onMenu(cb: (action: 'new-session' | 'toggle-explain' | 'save-screen' | 'next-session' | 'prev-session') => void): () => void

  clipboardRead(): Promise<string>
  clipboardWrite(text: string): void
  /** 画面のテキストをファイルに保存する（保存ダイアログを出す） */
  saveScreen(defaultName: string, text: string): Promise<string | null>
}
