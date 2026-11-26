import type {
  AgentState,
  FontSetting,
  Layout,
  NewSessionInput,
  NewTabInput,
  PaneNode,
  PtyExit,
  RulesPayload,
  SavedScreen,
  SessionConfig,
  SessionGroup,
  SessionMeta,
  Settings,
  SplitDir,
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

/** 端末の右クリックメニューで選ばれた操作 */
export type TerminalMenuAction =
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'split'; dir: SplitDir }
  | { type: 'unsplit' }
  | null

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
  | 'toggle-dashboard'

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

  /** タブ targetId を dir の向きに分割し、新しいタブを右（下）に置く（タブの並びでは targetId の後ろ） */
  splitTab(
    sessionId: string,
    input: NewTabInput,
    targetId: string,
    dir: SplitDir,
  ): Promise<{ tab: TabConfig; layout: Layout }>
  /** タブを分割から外す（タブは残る） */
  unsplitTab(id: string): Promise<Layout>
  /** 分割の配置を置き換える（区切りを動かしたとき） */
  setSplits(sessionId: string, splits: PaneNode[]): Promise<Layout>
  /** 端末の右クリックメニュー（hasSelection: 選択があるか） */
  terminalMenu(id: string, hasSelection: boolean): Promise<TerminalMenuAction>

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
  /**
   * 選択中のセッションと、表示しているタブを main に知らせる（通知を出すかの判断・保存用）。
   * visibleIds は画面に出ているタブ（分割していればその全部）
   */
  reportSelected(sessionId: string | null, tabId: string | null, visibleIds: string[]): void
  /** 通知のクリックなどで main からセッション（とタブ）の選択を求められたとき */
  onSelectSession(cb: (sessionId: string, tabId: string | null) => void): () => void
  /** メニューの「新しいセッション」など */
  onMenu(cb: (action: MenuAction) => void): () => void

  clipboardRead(): Promise<string>
  clipboardWrite(text: string): void
  /** 画面のテキストをファイルに保存する（保存ダイアログを出す） */
  saveScreen(defaultName: string, text: string): Promise<string | null>
  /** 前回の終了のときに残した、タブの表示（残していなければ null） */
  loadSavedScreen(id: string): Promise<SavedScreen | null>
  /** 終了する前に、タブごとの表示を集める（cb が返したものをメインが残す） */
  onCollectScreens(cb: () => { id: string; data: string }[]): () => void

  // ---- 別ウィンドウ（メインのウィンドウの側） ----
  /** タブが別ウィンドウで開かれた（表示を送り始める） */
  onPopoutOpened(cb: (id: string) => void): () => void
  /** 別ウィンドウが閉じた（メインのウィンドウに戻す） */
  onPopoutClosed(cb: (id: string) => void): () => void
  /** 別ウィンドウで打った文字 */
  onPopoutInput(cb: (id: string, data: string) => void): () => void
  /** 別ウィンドウの端末の大きさが変わった */
  onPopoutResize(cb: (id: string, cols: number, rows: number) => void): () => void
  /** 別ウィンドウが前面に来た・離れた */
  onPopoutFocus(cb: (id: string, focused: boolean) => void): () => void
  /** 端末に書いたものを別ウィンドウへ送る（snapshot は開いた時点の表示。cols・rows はその大きさ） */
  popoutRelay(id: string, msg: PopoutMessage): void
  /** 別ウィンドウを閉じる（メインのウィンドウに戻す） */
  popoutClose(id: string): void
  /** 別ウィンドウを前に出す */
  popoutShow(id: string): void

  // ---- 別ウィンドウ（別ウィンドウの側） ----
  popoutReady(): void
  popoutInput(data: string): void
  popoutResize(cols: number, rows: number): void
  popoutMenu(hasSelection: boolean): Promise<PopoutMenuAction>
  onPopoutData(cb: (msg: PopoutMessage) => void): () => void
}

/** メインのウィンドウから別ウィンドウへ送るもの */
export type PopoutMessage =
  | { type: 'snapshot'; data: string; cols: number; rows: number }
  | { type: 'data'; data: string }

/** 別ウィンドウの右クリックメニューで選ばれた操作 */
export type PopoutMenuAction = 'copy' | 'paste' | 'return' | null
