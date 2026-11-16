import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  shell,
  type MenuItemConstructorOptions,
} from 'electron'
import type { SessionMenuAction } from '@shared/api'
import type { AgentState, NewSessionInput, SessionConfig } from '@shared/types'
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
  let selectedId: string | null = null
  const states = new Map<string, AgentState>()
  // 通知は参照を持っておかないと GC されてクリックが効かなくなる
  const notifications = new Map<string, Notification>()

  const store = new SessionStore(join(app.getPath('userData'), 'sessions.json'))
  selectedId = store.selectedId
  const bundledRules = app.isPackaged ? join(process.resourcesPath, 'rules') : join(app.getAppPath(), 'rules')
  const rules = new RulesLoader(bundledRules, join(app.getPath('userData'), 'rules'))

  const send = (channel: string, ...args: unknown[]): void => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }

  const ptys = new PtyManager(
    (id, data) => send('pty:data', id, data),
    (id, exitCode, signal) => send('pty:exit', { id, exitCode, signal }),
  )

  function updateTitle(): void {
    if (!win) return
    const n = [...states.values()].filter((s) => s === 'blocked').length
    win.setTitle(n > 0 ? `nagaya（確認待ち ${n}）` : 'nagaya')
  }

  function showSession(id: string): void {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    send('select-session', id)
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
    const watching = win?.isFocused() && selectedId === id
    if (watching) return
    const cfg = store.get(id)
    if (!cfg) return
    if (win && !win.isFocused()) win.flashFrame(true)
    if (!Notification.isSupported()) return
    notifications.get(id)?.close()
    const n = new Notification({
      title: `確認待ち: ${cfg.host ? `${cfg.host} / ` : ''}${cfg.name}`,
      body: 'Claude Code が許可・回答を待っています。クリックで切り替えます。',
    })
    n.on('click', () => {
      notifications.delete(id)
      showSession(id)
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
          { type: 'separator' },
          { label: '次のセッション', ...acc('Ctrl+Tab'), click: menu('next-session') },
          { label: '前のセッション', ...acc('Ctrl+Shift+Tab'), click: menu('prev-session') },
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
      backgroundColor: '#1c1c1b',
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

  ipcMain.handle('sessions:list', () => ({ sessions: store.list(), selectedId: store.selectedId }))
  ipcMain.handle('sessions:create', (_e, input: NewSessionInput) => store.create(input))
  ipcMain.handle('sessions:update', (_e, cfg: SessionConfig) => store.update(cfg))
  ipcMain.handle('sessions:remove', (_e, id: string) => {
    ptys.kill(id)
    store.remove(id)
    states.delete(id)
    notifications.get(id)?.close()
    notifications.delete(id)
    updateTitle()
  })
  ipcMain.handle('sessions:menu', async (_e, id: string): Promise<SessionMenuAction> => {
    const cfg = store.get(id)
    if (!win || !cfg) return null
    const picked = await new Promise<SessionMenuAction>((resolve) => {
      let chosen: SessionMenuAction = null
      Menu.buildFromTemplate([
        { label: '編集…', click: () => (chosen = 'edit') },
        { label: '再起動', click: () => (chosen = 'restart') },
        { type: 'separator' },
        { label: '削除…', click: () => (chosen = 'delete') },
      ]).popup({ window: win!, callback: () => resolve(chosen) })
    })
    if (picked === 'delete') {
      const r = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['削除', 'キャンセル'],
        defaultId: 1,
        cancelId: 1,
        message: `セッション「${cfg.name}」を削除しますか？`,
        detail: '実行中のプロセスは終了します。',
      })
      return r.response === 0 ? 'delete' : null
    }
    return picked
  })

  ipcMain.handle('pty:start', (_e, id: string, cols: number, rows: number) => {
    const cfg = store.get(id)
    if (!cfg) return { ok: false, error: 'セッションが見つかりません' }
    try {
      ptys.start(cfg, cols, rows)
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
  ipcMain.on('selected', (_e, id: string | null) => {
    selectedId = id
    store.setSelected(id)
    if (id) {
      notifications.get(id)?.close()
      notifications.delete(id)
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
