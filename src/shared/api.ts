import type {
  AgentState,
  FontSetting,
  Layout,
  NewSessionInput,
  NewTabInput,
  PtyExit,
  RulesPayload,
  SessionConfig,
  SessionGroup,
  SessionMeta,
  Settings,
  TabConfig,
} from './types'

/** セッションの右クリックメニューで選ばれた操作（削除は確認済み） */
export type SessionMenuAction =
  | { type: 'edit' }
  | { type: 'duplicate' }
  | { type: 'new-tab' }
  | { type: 'restart' }
  | { type: 'delete' }
  | { type: 'move'; groupId: string | null }
  | { type: 'move-new-group' }
  | null

/** タブの右クリックメニューで選ばれた操作（閉じるは確認済み） */
export type TabMenuAction = { type: 'edit' } | { type: 'duplicate' } | { type: 'restart' } | { type: 'close' } | null

/** グループの右クリックメニューで選ばれた操作（削除は確認済み） */
export type GroupMenuAction = { type: 'new-session' } | { type: 'rename' } | { type: 'delete' } | null

export type MenuAction =
  | 'new-session'
  | 'new-group'
  | 'toggle-explain'
  | 'save-screen'
  | 'next-session'
  | 'prev-session'
  | 'new-tab'
  | 'next-tab'
  | 'prev-tab'
  | 'font-settings'

export interface AppInfo {
  platform: string
  defaultShell: string
  version: string
}

/** preload が renderer に公開する API（window.nagaya） */
export interface NagayaApi {
  info(): Promise<AppInfo>

  getLayout(): Promise<Layout & { selectedId: string | null }>
  createSession(input: NewSessionInput): Promise<{ session: SessionConfig; layout: Layout }>
  /** 名前とグループを変える */
  updateSession(id: string, meta: SessionMeta): Promise<Layout>
  /** タブごと写したセッションを作る */
  duplicateSession(id: string, meta: SessionMeta): Promise<{ session: SessionConfig; layout: Layout }>
  removeSession(id: string): Promise<Layout>
  /** セッションを groupId のグループの beforeId の前へ（null ならグループの最後） */
  moveSession(id: string, groupId: string | null, beforeId: string | null): Promise<Layout>
  /** サイドバーの右クリックメニューを出し、選ばれた操作を返す */
  sessionMenu(id: string): Promise<SessionMenuAction>

  /** タブを足す（afterId のタブの後ろ。null なら最後） */
  addTab(sessionId: string, input: NewTabInput, afterId: string | null): Promise<{ tab: TabConfig; layout: Layout }>
  updateTab(cfg: TabConfig): Promise<Layout>
  /** タブを閉じる（プロセスも終わる。最後の1枚は閉じない） */
  removeTab(id: string): Promise<Layout>
  tabMenu(id: string): Promise<TabMenuAction>

  createGroup(name: string): Promise<{ group: SessionGroup; layout: Layout }>
  renameGroup(id: string, name: string): Promise<Layout>
  removeGroup(id: string): Promise<Layout>
  setGroupCollapsed(id: string, collapsed: boolean): Promise<Layout>
  moveGroup(id: string, beforeId: string | null): Promise<Layout>
  groupMenu(id: string): Promise<GroupMenuAction>

  /** タブ（id）の端末を起動する。reconnect が true なら再接続のコマンドで起動する */
  ptyStart(id: string, cols: number, rows: number, reconnect?: boolean): Promise<{ ok: boolean; error?: string }>
  ptyWrite(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  ptyKill(id: string): void
  onPtyData(cb: (id: string, data: string) => void): () => void
  onPtyExit(cb: (e: PtyExit) => void): () => void

  getRules(): Promise<RulesPayload>
  reloadRules(): Promise<RulesPayload>
  openRulesFolder(): Promise<void>
  onRulesChanged(cb: (p: RulesPayload) => void): () => void

  getSettings(): Promise<Settings>
  setFont(font: FontSetting): Promise<void>
  onSettingsChanged(cb: (s: Settings) => void): () => void

  /** タブの確定した状態を main に知らせる（通知・タイトル用） */
  reportState(tabId: string, state: AgentState): void
  /** 選択中のセッションと、表示しているタブを main に知らせる（通知を出すかの判断・保存用） */
  reportSelected(sessionId: string | null, tabId: string | null): void
  /** 通知のクリックなどで main からセッション（とタブ）の選択を求められたとき */
  onSelectSession(cb: (sessionId: string, tabId: string | null) => void): () => void
  /** メニューの「新しいセッション」など */
  onMenu(cb: (action: MenuAction) => void): () => void

  clipboardRead(): Promise<string>
  clipboardWrite(text: string): void
  /** 画面のテキストをファイルに保存する（保存ダイアログを出す） */
  saveScreen(defaultName: string, text: string): Promise<string | null>
}
