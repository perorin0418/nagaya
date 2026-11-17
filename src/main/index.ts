import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  shell,
  type MenuItemConstructorOptions,
} from 'electron'
import type { GroupMenuAction, SessionMenuAction, TabMenuAction } from '@shared/api'
import {
  tabLabel,
  type AgentState,
  type FontSetting,
  type NewSessionInput,
  type NewTabInput,
  type SessionMeta,
  type TabConfig,
  type ThemeSetting,
} from '@shared/types'
import icon from '../../resources/icon.png?asset'
import { defaultShell, PtyManager } from './pty'
import { RulesLoader } from './rules'
import { SessionStore } from './store'

const APP_ID = 'io.github.perorin0418.nagaya'

// 2つ目を起動したら、1つ目のウィンドウを前に出して終わる（同じセッションが二重に起動しないように）
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  main()
}

function main(): void {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

  let win: BrowserWindow | null = null
  /** 表示しているタブ（通知を出すかの判断に使う） */
  let selectedTabId: string | null = null
  /** タブごとの状態 */
  const states = new Map<string, AgentState>()
  // 通知は参照を持っておかないと GC されてクリックが効かなくなる
  const notifications = new Map<string, Notification>()

  const store = new SessionStore(join(app.getPath('userData'), 'sessions.json'))
  const bundledRules = app.isPackaged ? join(process.resourcesPath, 'rules') : join(app.getAppPath(), 'rules')
  const rules = new RulesLoader(bundledRules, join(app.getPath('userData'), 'rules'))

  const send = (channel: string, ...args: unknown[]): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }

  const ptys = new PtyManager(
    (id, data) => send('pty:data', id, data),
    (id, exitCode, signal) => send('pty:exit', { id, exitCode, signal }),
  )

  const THEME_LABEL: Record<ThemeSetting, string> = { system: 'システムに合わせる', light: 'ライト', dark: 'ダーク' }

  function backgroundColor(): string {
    return nativeTheme.shouldUseDarkColors ? '#1c1c1b' : '#f7f6f2'
  }

  /** テーマを切り替える。renderer の prefers-color-scheme も追従する */
  function applyTheme(theme: ThemeSetting): void {
    store.setTheme(theme)
    nativeTheme.themeSource = theme
    win?.setBackgroundColor(backgroundColor())
    buildMenu()
    send('settings:changed', store.settings)
  }

  function updateTitle(): void {
    if (!win) return
    const n = [...states.values()].filter((s) => s === 'blocked').length
    win.setTitle(n > 0 ? `nagaya（確認待ち ${n}）` : 'nagaya')
  }

  function showTab(sessionId: string, tabId: string): void {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    send('select-session', sessionId, tabId)
  }

  /** タブの状態を忘れる（タブ・セッションを消したとき） */
  function forgetTab(tabId: string): void {
    ptys.kill(tabId)
    states.delete(tabId)
    notifications.get(tabId)?.close()
    notifications.delete(tabId)
  }

  function onStateChanged(id: string, state: AgentState): void {
    const prev = states.get(id)
    states.set(id, state)
    updateTitle()
    if (state !== 'blocked') {
      notifications.get(id)?.close()
      notifications.delete(id)
      return
    }
    if (prev === 'blocked') return
    // 見ている最中のセッションなら通知しない
    const watching = win?.isFocused() && selectedTabId === id
    if (watching) return
    const found = store.tab(id)
    if (!found) return
    const { session, tab } = found
    if (win && !win.isFocused()) win.flashFrame(true)
    if (!Notification.isSupported()) return
    notifications.get(id)?.close()
    // タブが1枚なら「ホスト / セッション」、複数なら「セッション / タブ（ホスト）」
    const where =
      session.tabs.length > 1
        ? `${session.name} / ${tabLabel(tab)}${tab.host && tab.name ? `（${tab.host}）` : ''}`
        : `${tab.host ? `${tab.host} / ` : ''}${session.name}`
    const n = new Notification({
      title: `確認待ち: ${where}`,
      body: 'Claude Code が許可・回答を待っています。クリックで切り替えます。',
    })
    n.on('click', () => {
      notifications.delete(id)
      showTab(session.id, id)
    })
    n.on('close', () => {
      if (notifications.get(id) === n) notifications.delete(id)
    })
    notifications.set(id, n)
    n.show()
  }

  // アプリのショートカット。端末（xterm.js）にキーを取られないよう、ページに届く前に横取りする
  const shortcuts: { key: string; ctrl: boolean; shift: boolean; action: string }[] = [
    { key: 't', ctrl: true, shift: true, action: 'new-session' },
    { key: 'tab', ctrl: true, shift: false, action: 'next-session' },
    { key: 'tab', ctrl: true, shift: true, action: 'prev-session' },
    { key: 'pagedown', ctrl: true, shift: false, action: 'next-tab' },
    { key: 'pageup', ctrl: true, shift: false, action: 'prev-tab' },
    { key: 's', ctrl: true, shift: true, action: 'save-screen' },
    { key: 'd', ctrl: true, shift: true, action: 'toggle-explain' },
    { key: 'r', ctrl: true, shift: true, action: 'reload-rules' },
  ]

  function runAction(action: string): void {
    if (action === 'reload-rules') send('rules:changed', rules.reload())
    else send('menu', action)
  }

  function buildMenu(): void {
    const isMac = process.platform === 'darwin'
    // アクセラレーターは表示だけ（実際の処理は before-input-event で行う）
    const menu = (action: string) => () => runAction(action)
    const acc = (accelerator: string) => ({ accelerator, registerAccelerator: false })
    const template: MenuItemConstructorOptions[] = [
      ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
      {
        label: 'ファイル',
        submenu: [
          { label: '新しいセッション…', ...acc('CmdOrCtrl+Shift+T'), click: menu('new-session') },
          { label: '新しいグループ…', click: menu('new-group') },
          { label: '新しいタブ…', click: menu('new-tab') },
          { type: 'separator' },
          { label: '次のセッション', ...acc('Ctrl+Tab'), click: menu('next-session') },
          { label: '前のセッション', ...acc('Ctrl+Shift+Tab'), click: menu('prev-session') },
          { label: '次のタブ', ...acc('CmdOrCtrl+PageDown'), click: menu('next-tab') },
          { label: '前のタブ', ...acc('CmdOrCtrl+PageUp'), click: menu('prev-tab') },
          { type: 'separator' },
          { label: '画面をテキストで保存…', ...acc('CmdOrCtrl+Shift+S'), click: menu('save-screen') },
          { type: 'separator' },
          isMac ? { role: 'close', label: '閉じる' } : { role: 'quit', label: '終了' },
        ],
      },
      // macOS はコピー・貼り付けをメニュー経由で行うので編集メニューが必要。
      // Windows・Linux では端末側で Ctrl+C / Ctrl+V を扱うので、ショートカットのない編集メニューにしない
      ...(isMac ? [{ role: 'editMenu' } as MenuItemConstructorOptions] : []),
      {
        label: '表示',
        submenu: [
          { label: '判定の詳細', ...acc('CmdOrCtrl+Shift+D'), click: menu('toggle-explain') },
          { type: 'separator' },
          {
            label: 'テーマ',
            submenu: (['system', 'light', 'dark'] as ThemeSetting[]).map((t) => ({
              label: THEME_LABEL[t],
              type: 'radio' as const,
              checked: store.settings.theme === t,
              click: () => applyTheme(t),
            })),
          },
          { label: '端末のフォント…', click: menu('font-settings') },
          { type: 'separator' },
          { role: 'resetZoom', label: '実際のサイズ' },
          { role: 'zoomIn', label: '拡大' },
          { role: 'zoomOut', label: '縮小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全画面表示' },
          { role: 'toggleDevTools', label: '開発者ツール' },
        ],
      },
      {
        label: 'ルール',
        submenu: [
          {
            label: 'ルールを再読み込み',
            ...acc('CmdOrCtrl+Shift+R'),
            click: menu('reload-rules'),
          },
          {
            label: 'ルールのフォルダーを開く',
            click: () => {
              rules.ensureUserDir()
              void shell.openPath(rules.userDir)
            },
          },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  function createWindow(): void {
    win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 640,
      minHeight: 400,
      title: 'nagaya',
      backgroundColor: backgroundColor(),
      // Windows・macOS の配布物は実行ファイルのアイコンが使われる。開発中と Linux 用にここでも指定する
      icon,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    win.on('ready-to-show', () => win?.show())
    win.on('focus', () => win?.flashFrame(false))
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.alt) return
      const ctrl = process.platform === 'darwin' ? input.meta || input.control : input.control
      const key = input.key.toLowerCase()
      const hit = shortcuts.find((s) => s.key === key && s.ctrl === ctrl && s.shift === input.shift)
      if (!hit) return
      event.preventDefault()
      runAction(hit.action)
    })
    win.on('closed', () => {
      win = null
    })
    // 外部リンクはブラウザで開く
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  // ---- IPC ----
  ipcMain.handle('info', () => ({ platform: process.platform, defaultShell: defaultShell(), version: app.getVersion() }))

  ipcMain.handle('layout:get', () => ({ ...store.layout(), selectedId: store.selectedId }))
  ipcMain.handle('sessions:create', (_e, input: NewSessionInput) => {
    const session = store.create(input)
    return { session, layout: store.layout() }
  })
  ipcMain.handle('sessions:update', (_e, id: string, meta: SessionMeta) => store.update(id, meta))
  ipcMain.handle('sessions:duplicate', (_e, id: string, meta: SessionMeta) => {
    const session = store.duplicate(id, meta)
    return { session, layout: store.layout() }
  })
  ipcMain.handle('sessions:remove', (_e, id: string) => {
    for (const t of store.get(id)?.tabs ?? []) forgetTab(t.id)
    store.remove(id)
    updateTitle()
    return store.layout()
  })
  ipcMain.handle('sessions:move', (_e, id: string, groupId: string | null, beforeId: string | null) =>
    store.moveSession(id, groupId, beforeId),
  )

  /** メニューを出して、選ばれた値を返す（何も選ばれなければ null） */
  function popup<T>(build: (choose: (v: T) => void) => MenuItemConstructorOptions[]): Promise<T | null> {
    return new Promise((resolve) => {
      let chosen: T | null = null
      Menu.buildFromTemplate(build((v) => (chosen = v))).popup({ window: win!, callback: () => resolve(chosen) })
    })
  }

  async function confirm(message: string, detail: string, ok: string): Promise<boolean> {
    if (!win) return false
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [ok, 'キャンセル'],
      defaultId: 1,
      cancelId: 1,
      message,
      detail,
    })
    return r.response === 0
  }

  ipcMain.handle('sessions:menu', async (_e, id: string): Promise<SessionMenuAction> => {
    const cfg = store.get(id)
    if (!win || !cfg) return null
    const { groups } = store.layout()
    const picked = await popup<NonNullable<SessionMenuAction>>((choose) => [
      { label: '編集…', click: () => choose({ type: 'edit' }) },
      { label: '複製…', click: () => choose({ type: 'duplicate' }) },
      { label: '新しいタブ…', click: () => choose({ type: 'new-tab' }) },
      { label: cfg.tabs.length > 1 ? 'すべてのタブを再起動' : '再起動', click: () => choose({ type: 'restart' }) },
      {
        label: 'グループへ移動',
        submenu: [
          ...groups.map((g) => ({
            label: g.name,
            type: 'checkbox' as const,
            checked: cfg.groupId === g.id,
            enabled: cfg.groupId !== g.id,
            click: () => choose({ type: 'move', groupId: g.id }),
          })),
          ...(groups.length ? [{ type: 'separator' as const }] : []),
          { label: '新しいグループ…', click: () => choose({ type: 'move-new-group' }) },
          {
            label: 'グループから外す',
            enabled: cfg.groupId !== null,
            click: () => choose({ type: 'move', groupId: null }),
          },
        ],
      },
      { type: 'separator' },
      { label: '削除…', click: () => choose({ type: 'delete' }) },
    ])
    if (picked?.type === 'delete') {
      const ok = await confirm(`セッション「${cfg.name}」を削除しますか？`, '実行中のプロセスは終了します。', '削除')
      return ok ? picked : null
    }
    return picked
  })

  // ---- タブ ----
  ipcMain.handle('tabs:add', (_e, sessionId: string, input: NewTabInput, afterId: string | null) => {
    const tab = store.addTab(sessionId, input, afterId)
    return { tab, layout: store.layout() }
  })
  ipcMain.handle('tabs:update', (_e, cfg: TabConfig) => store.updateTab(cfg))
  ipcMain.handle('tabs:remove', (_e, id: string) => {
    if ((store.tab(id)?.session.tabs.length ?? 0) > 1) forgetTab(id)
    const layout = store.removeTab(id)
    updateTitle()
    return layout
  })
  ipcMain.handle('tabs:menu', async (_e, id: string): Promise<TabMenuAction> => {
    const found = store.tab(id)
    if (!win || !found) return null
    const last = found.session.tabs.length <= 1
    const picked = await popup<NonNullable<TabMenuAction>>((choose) => [
      { label: '編集…', click: () => choose({ type: 'edit' }) },
      { label: '複製…', click: () => choose({ type: 'duplicate' }) },
      { label: '再起動', click: () => choose({ type: 'restart' }) },
      { type: 'separator' },
      {
        label: last ? 'タブを閉じる（最後の1枚は閉じられません）' : 'タブを閉じる…',
        enabled: !last,
        click: () => choose({ type: 'close' }),
      },
    ])
    if (picked?.type === 'close') {
      const ok = await confirm(`タブ「${tabLabel(found.tab)}」を閉じますか？`, '実行中のプロセスは終了します。', '閉じる')
      return ok ? picked : null
    }
    return picked
  })

  // ---- グループ ----
  ipcMain.handle('groups:create', (_e, name: string) => {
    const group = store.createGroup(name)
    return { group, layout: store.layout() }
  })
  ipcMain.handle('groups:rename', (_e, id: string, name: string) => store.renameGroup(id, name))
  ipcMain.handle('groups:remove', (_e, id: string) => store.removeGroup(id))
  ipcMain.handle('groups:collapse', (_e, id: string, collapsed: boolean) => store.setGroupCollapsed(id, collapsed))
  ipcMain.handle('groups:move', (_e, id: string, beforeId: string | null) => store.moveGroup(id, beforeId))
  ipcMain.handle('groups:menu', async (_e, id: string): Promise<GroupMenuAction> => {
    const g = store.group(id)
    if (!win || !g) return null
    const picked = await popup<NonNullable<GroupMenuAction>>((choose) => [
      { label: 'このグループに新しいセッション…', click: () => choose({ type: 'new-session' }) },
      { label: '名前を変更…', click: () => choose({ type: 'rename' }) },
      { type: 'separator' },
      { label: 'グループを削除…', click: () => choose({ type: 'delete' }) },
    ])
    if (picked?.type === 'delete') {
      const ok = await confirm(
        `グループ「${g.name}」を削除しますか？`,
        '中のセッションは消えずに「グループなし」に移ります。',
        '削除',
      )
      return ok ? picked : null
    }
    return picked
  })

  // ---- 設定 ----
  ipcMain.handle('settings:get', () => store.settings)
  ipcMain.handle('settings:font', (_e, font: FontSetting) => {
    store.setFont(font)
    send('settings:changed', store.settings)
  })

  ipcMain.handle('pty:start', (_e, id: string, cols: number, rows: number, reconnect: boolean) => {
    const cfg = store.tab(id)?.tab
    if (!cfg) return { ok: false, error: 'タブが見つかりません' }
    try {
      ptys.start(cfg, cols, rows, reconnect)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id))

  ipcMain.handle('rules:get', () => rules.get())
  ipcMain.handle('rules:reload', () => rules.reload())
  ipcMain.handle('rules:open-folder', () => {
    rules.ensureUserDir()
    return shell.openPath(rules.userDir)
  })

  ipcMain.on('state', (_e, id: string, state: AgentState) => onStateChanged(id, state))
  ipcMain.on('selected', (_e, sessionId: string | null, tabId: string | null) => {
    selectedTabId = tabId
    store.setSelected(sessionId)
    if (tabId) {
      notifications.get(tabId)?.close()
      notifications.delete(tabId)
    }
  })

  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('screen:save', async (_e, defaultName: string, text: string) => {
    if (!win) return null
    const r = await dialog.showSaveDialog(win, {
      title: '画面をテキストで保存',
      defaultPath: join(app.getPath('documents'), defaultName),
      filters: [{ name: 'テキスト', extensions: ['txt'] }],
    })
    if (r.canceled || !r.filePath) return null
    writeFileSync(r.filePath, text, 'utf8')
    return r.filePath
  })

  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  nativeTheme.themeSource = store.settings.theme

  app.whenReady().then(() => {
    buildMenu()
    rules.watch((p) => send('rules:changed', p))
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // ウィンドウを閉じたら、実行中のセッションも終わる（未決事項 1。今は保持しない）
  app.on('window-all-closed', () => {
    ptys.killAll()
    rules.close()
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', () => ptys.killAll())
}
