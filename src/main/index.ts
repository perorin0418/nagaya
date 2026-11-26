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
import type {
  GroupMenuAction,
  PopoutMenuAction,
  PopoutMessage,
  SessionMenuAction,
  TabMenuAction,
  TerminalMenuAction,
} from '@shared/api'
import { leaves } from '@shared/split'
import {
  tabLabel,
  type AgentState,
  type FontSetting,
  type NewSessionInput,
  type NewTabInput,
  type PaneNode,
  type SavedScreen,
  type SessionMeta,
  type SplitDir,
  type TabConfig,
  type ThemeSetting,
} from '@shared/types'
import icon from '../../resources/icon.png?asset'
import { defaultShell, PtyManager } from './pty'
import { RulesLoader } from './rules'
import { ScreenStore } from './screens'
import { downloadUpdate, launchUpdater, selfUpdateUnsupported, takeUpdateResult } from './selfUpdate'
import { SessionStore } from './store'
import { UpdateChecker } from './update'
import type { ReleaseInfo } from '@shared/version'

const APP_ID = 'io.github.perorin0418.nagaya'
/** 新しい版の通知を notifications に持つときのキー（タブの id とは重ならない） */
const UPDATE_NOTIFICATION = 'update'
/** 終了するときに、端末の表示を renderer から集めるのを待つ時間 */
const COLLECT_SCREENS_TIMEOUT_MS = 3000

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
  /** 画面に出ているタブ（分割していればその全部） */
  let visibleTabIds: string[] = []
  /** タブごとの状態 */
  const states = new Map<string, AgentState>()
  // 通知は参照を持っておかないと GC されてクリックが効かなくなる
  const notifications = new Map<string, Notification>()

  const store = new SessionStore(join(app.getPath('userData'), 'sessions.json'))
  const bundledRules = app.isPackaged ? join(process.resourcesPath, 'rules') : join(app.getAppPath(), 'rules')
  const rules = new RulesLoader(bundledRules, join(app.getPath('userData'), 'rules'))
  const screens = new ScreenStore(join(app.getPath('userData'), 'screens'))
  /** 閉じてよいと決まったか（確認と表示の保存を終えてから閉じ直す） */
  let closeReady = false
  let preparingClose: Promise<boolean> | null = null
  let savingScreens: Promise<void> | null = null
  /** 別ウィンドウで開いているタブ（キーはタブの id）。ready までは送るものを queue に溜める */
  const popouts = new Map<string, { win: BrowserWindow; ready: boolean; queue: PopoutMessage[] }>()

  // 新しい版が出ていないか、GitHub のリリースを6時間ごとに確かめる
  const updates = new UpdateChecker(app.getVersion(), (release) => {
    buildMenu()
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: `nagaya ${release.version} が出ています`,
      body:
        `今の版は ${app.getVersion()} です。クリックでリリースのページを開きます。` +
        (!selfUpdateUnsupported() && release.winZip ? '「ヘルプ → 再起動して更新」でも更新できます。' : ''),
    })
    n.on('click', () => {
      notifications.delete(UPDATE_NOTIFICATION)
      void shell.openExternal(release.url)
    })
    n.on('close', () => {
      if (notifications.get(UPDATE_NOTIFICATION) === n) notifications.delete(UPDATE_NOTIFICATION)
    })
    notifications.get(UPDATE_NOTIFICATION)?.close()
    notifications.set(UPDATE_NOTIFICATION, n)
    n.show()
  })

  /** 「更新を確認」をメニューから選んだとき。結果をダイアログで出す */
  async function checkUpdateNow(): Promise<void> {
    const r = await updates.check()
    if (!win) return
    if (r.type === 'newer') {
      const canUpdate = !selfUpdateUnsupported() && r.release.winZip !== null
      const buttons = canUpdate ? ['再起動して更新…', 'リリースのページを開く', '閉じる'] : ['リリースのページを開く', '閉じる']
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        buttons,
        defaultId: 0,
        cancelId: buttons.length - 1,
        message: `nagaya ${r.release.version} が出ています`,
        detail: `今の版は ${app.getVersion()} です。`,
      })
      if (buttons[response] === '再起動して更新…') void updateAndRestart(r.release, false)
      else if (buttons[response] === 'リリースのページを開く') void shell.openExternal(r.release.url)
    } else if (r.type === 'latest') {
      await dialog.showMessageBox(win, { type: 'info', message: '最新の版です', detail: `nagaya ${app.getVersion()}` })
    } else {
      await dialog.showMessageBox(win, { type: 'warning', message: '更新を確認できませんでした', detail: r.message })
    }
  }

  /** 更新のダウンロードの進み具合（していなければ null） */
  let updateProgress: number | null = null

  /**
   * 再起動して更新する。確認 → zip をダウンロード → 表示を残す → 更新のスクリプトを起動して終わる。
   * confirmed が true なら、最初の確認を省く（すでに確かめたとき）
   */
  async function updateAndRestart(release: ReleaseInfo, confirmed: boolean): Promise<void> {
    if (!win || updateProgress !== null) return
    const unsupported = selfUpdateUnsupported() ?? (release.winZip ? null : 'このリリースには Windows 用の zip がありません')
    if (unsupported) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['リリースのページを開く', '閉じる'],
        defaultId: 0,
        cancelId: 1,
        message: '再起動して更新できません',
        detail: `${unsupported}。リリースのページから入手してください。`,
      })
      if (response === 0) void shell.openExternal(release.url)
      return
    }
    const asset = release.winZip!
    if (!confirmed) {
      const n = ptys.count
      const ok = await confirm(
        `nagaya ${release.version} に更新しますか？`,
        `zip（${Math.round(asset.size / 1024 / 1024)} MB）をダウンロードしてから、nagaya を再起動します。` +
          (n > 0 ? `\n動いているタブ（${n} 枚）のプロセスはすべて終了します（SSH が切れ、Claude Code も止まります）。` : '') +
          (store.settings.keepScreen ? '\n端末の表示は、再起動したあとに出ます。' : ''),
        '更新する',
      )
      if (!ok) return
    }
    updateProgress = 0
    buildMenu()
    let zip: string
    try {
      let shown = -1
      zip = await downloadUpdate(asset, (ratio) => {
        updateProgress = ratio
        win?.setProgressBar(ratio)
        const pct = Math.floor(ratio * 100)
        if (pct !== shown && pct % 5 === 0) {
          shown = pct
          buildMenu()
        }
      })
    } catch (e) {
      updateProgress = null
      win?.setProgressBar(-1)
      buildMenu()
      if (win) {
        await dialog.showMessageBox(win, {
          type: 'error',
          message: '更新をダウンロードできませんでした',
          detail: (e as Error).message,
        })
      }
      return
    }
    win?.setProgressBar(-1)
    // 閉じるときの確認は済んでいるので省き、表示を残してから終わる
    await prepareClose(false)
    try {
      launchUpdater(zip, release.version)
    } catch (e) {
      closeReady = false
      updateProgress = null
      buildMenu()
      if (win) await dialog.showMessageBox(win, { type: 'error', message: '更新を始められませんでした', detail: (e as Error).message })
      return
    }
    app.quit()
  }

  /** 前回の更新の結果を知らせる（更新のあとに起動したとき） */
  function reportUpdateResult(): void {
    const r = takeUpdateResult()
    if (!r || !win) return
    if (r.type === 'ok') {
      if (Notification.isSupported()) {
        new Notification({ title: `nagaya ${app.getVersion()} に更新しました`, body: '' }).show()
      }
    } else {
      void dialog.showMessageBox(win, {
        type: 'error',
        message: '更新できませんでした',
        detail: `${r.message}\n今の版は ${app.getVersion()} です。`,
      })
    }
  }

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

  /** 終了したときの画面を残すか。やめたら、残してある分も消す */
  function setKeepScreen(keep: boolean): void {
    store.setKeepScreen(keep)
    if (!keep) screens.clear()
    buildMenu()
    send('settings:changed', store.settings)
  }

  /**
   * renderer から端末の表示を集めて、ファイルに残す。
   * 返ってこなければ（renderer が固まっているなど）COLLECT_SCREENS_TIMEOUT_MS で諦める
   */
  function saveScreens(): Promise<void> {
    if (savingScreens) return savingScreens
    savingScreens = new Promise<void>((resolve) => {
      const w = win
      if (!store.settings.keepScreen || !w || w.isDestroyed() || w.webContents.isCrashed()) return resolve()
      const timer = setTimeout(done, COLLECT_SCREENS_TIMEOUT_MS)
      function done(): void {
        clearTimeout(timer)
        ipcMain.removeListener('screens:collected', onCollected)
        resolve()
      }
      function onCollected(e: Electron.IpcMainEvent, list: unknown): void {
        if (e.sender !== w!.webContents) return
        const keep = store.tabIds()
        const savedAt = Date.now()
        for (const item of Array.isArray(list) ? list : []) {
          const { id, data } = (item ?? {}) as { id?: unknown; data?: unknown }
          if (typeof id !== 'string' || typeof data !== 'string' || !keep.has(id)) continue
          try {
            screens.save(id, { data, savedAt })
          } catch {
            // 書けなくても終了は止めない
          }
        }
        screens.prune(keep)
        done()
      }
      ipcMain.on('screens:collected', onCollected)
      w.webContents.send('screens:collect')
    })
    return savingScreens
  }

  /**
   * 閉じる前の準備。動いているプロセスがあれば確認し、よければ表示を残す。
   * 閉じてよければ true（キャンセルされたら false）
   */
  function prepareClose(confirmFirst = true): Promise<boolean> {
    if (closeReady) return Promise.resolve(true)
    if (preparingClose) return preparingClose
    preparingClose = (async () => {
      const n = ptys.count
      if (confirmFirst && n > 0 && win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        const ok = await confirm(
          'nagaya を閉じますか？',
          `動いているタブ（${n} 枚）のプロセスはすべて終了します（SSH が切れ、Claude Code も止まります）。` +
            (store.settings.keepScreen ? '\n端末の表示は、次に起動したときに出ます。' : ''),
          '閉じる',
        )
        if (!ok) return false
      }
      await saveScreens()
      closeReady = true
      return true
    })().finally(() => {
      preparingClose = null
    })
    return preparingClose
  }

  function updateTitle(): void {
    if (!win) return
    const n = [...states.values()].filter((s) => s === 'blocked').length
    win.setTitle(n > 0 ? `nagaya（確認待ち ${n}）` : 'nagaya')
  }

  function showTab(sessionId: string, tabId: string): void {
    const p = popouts.get(tabId)
    if (p && !p.win.isDestroyed()) return focusWindow(p.win)
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    send('select-session', sessionId, tabId)
  }

  /** タブの状態を忘れる（タブ・セッションを消したとき） */
  function forgetTab(tabId: string): void {
    closePopout(tabId)
    ptys.kill(tabId)
    screens.remove(tabId)
    states.delete(tabId)
    notifications.get(tabId)?.close()
    notifications.delete(tabId)
  }

  function onStateChanged(id: string, state: AgentState): void {
    const prev = states.get(id)
    states.set(id, state)
    updateTitle()
    const pop = popouts.get(id)
    if (pop && !pop.win.isDestroyed()) pop.win.setTitle(popoutTitle(id))
    if (state !== 'blocked') {
      notifications.get(id)?.close()
      notifications.delete(id)
      return
    }
    if (prev === 'blocked') return
    // 見ている最中のセッションなら通知しない
    const watching = (win?.isFocused() && visibleTabIds.includes(id)) || (pop && !pop.win.isDestroyed() && pop.win.isFocused())
    if (watching) return
    if (pop && !pop.win.isDestroyed() && !pop.win.isFocused()) pop.win.flashFrame(true)
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
    { key: 'o', ctrl: true, shift: true, action: 'toggle-dashboard' },
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
          { label: 'ダッシュボード', ...acc('CmdOrCtrl+Shift+O'), click: menu('toggle-dashboard') },
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
          {
            label: '終了したときの画面を次の起動でも出す',
            type: 'checkbox',
            checked: store.settings.keepScreen,
            click: (item) => setKeepScreen(item.checked),
          },
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
      {
        label: 'ヘルプ',
        submenu: [
          ...(updates.latest
            ? [
                ...(updateProgress !== null
                  ? [{ label: `nagaya ${updates.latest.version} をダウンロード中…（${Math.floor(updateProgress * 100)}%）`, enabled: false }]
                  : !selfUpdateUnsupported() && updates.latest.winZip
                    ? [
                        {
                          label: `再起動して nagaya ${updates.latest.version} に更新…`,
                          click: () => void updateAndRestart(updates.latest!, false),
                        },
                      ]
                    : []),
                {
                  label: `nagaya ${updates.latest.version} を入手…`,
                  click: () => void shell.openExternal(updates.latest!.url),
                },
              ]
            : []),
          { label: '更新を確認…', click: () => void checkUpdateNow() },
          { type: 'separator' },
          { label: `nagaya ${app.getVersion()}`, enabled: false },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  function createWindow(): void {
    // macOS ではウィンドウを閉じた後に開き直せるので、閉じるたびに表示を残し直す
    closeReady = false
    savingScreens = null
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
      webPreferences: webPreferences(),
    })
    win.on('ready-to-show', () => {
      win?.show()
      reportUpdateResult()
    })
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
    // 閉じる前に確認し、端末の表示を残す（終えたら閉じ直す）
    win.on('close', (ev) => {
      if (closeReady) return
      ev.preventDefault()
      void prepareClose().then((ok) => {
        if (ok) win?.close()
      })
    })
    win.on('closed', () => {
      win = null
      // 別ウィンドウはメインのウィンドウがないと動かない（判定・入力はメインのウィンドウが受け持つ）
      for (const p of popouts.values()) if (!p.win.isDestroyed()) p.win.destroy()
      popouts.clear()
    })
    loadRenderer(win)
  }

  function webPreferences(): Electron.WebPreferences {
    return {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    }
  }

  /** 画面を読み込む。popout を渡すと、そのタブだけを出す別ウィンドウの画面になる */
  function loadRenderer(w: BrowserWindow, popout?: string): void {
    // 外部リンクはブラウザで開く（http・https・mailto だけ。file: などは開かない）
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    const query = popout ? { popout } : undefined
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      const url = new URL(process.env.ELECTRON_RENDERER_URL)
      if (popout) url.searchParams.set('popout', popout)
      void w.loadURL(url.toString())
    } else {
      void w.loadFile(join(__dirname, '../renderer/index.html'), { query })
    }
  }

  // ---- 別ウィンドウ ----
  // タブを別ウィンドウに出す。端末（xterm.js）と判定はメインのウィンドウに残したまま、
  // そこに書いたものを別ウィンドウへ送り、別ウィンドウで打った文字はメインのウィンドウの端末に入れる

  function popoutTitle(tabId: string): string {
    const found = store.tab(tabId)
    if (!found) return 'nagaya'
    const { session, tab } = found
    const name = session.tabs.length > 1 ? `${session.name} / ${tabLabel(tab)}` : session.name
    const host = tab.host ? `（${tab.host}）` : ''
    return `${states.get(tabId) === 'blocked' ? '[確認待ち] ' : ''}${name}${host} - nagaya`
  }

  function popoutOf(sender: Electron.WebContents): string | null {
    for (const [id, p] of popouts) if (!p.win.isDestroyed() && p.win.webContents === sender) return id
    return null
  }

  function sendPopout(tabId: string, msg: PopoutMessage): void {
    const p = popouts.get(tabId)
    if (!p || p.win.isDestroyed()) return
    if (p.ready) p.win.webContents.send('popout:data', msg)
    else p.queue.push(msg)
  }

  function focusWindow(w: BrowserWindow): void {
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }

  /** タブを別ウィンドウで開く（開いていれば前に出す） */
  function openPopout(tabId: string): void {
    const opened = popouts.get(tabId)
    if (opened && !opened.win.isDestroyed()) return focusWindow(opened.win)
    if (!win || !store.tab(tabId)) return
    const b = win.getBounds()
    const pw = new BrowserWindow({
      width: Math.max(480, Math.round(b.width * 0.7)),
      height: Math.max(320, Math.round(b.height * 0.8)),
      minWidth: 320,
      minHeight: 200,
      title: popoutTitle(tabId),
      backgroundColor: backgroundColor(),
      icon,
      show: false,
      autoHideMenuBar: true,
      webPreferences: webPreferences(),
    })
    if (process.platform !== 'darwin') pw.setMenu(null)
    popouts.set(tabId, { win: pw, ready: false, queue: [] })
    // タイトルはこちらで決める（ページの <title> で上書きさせない）
    pw.on('page-title-updated', (e) => e.preventDefault())
    pw.on('ready-to-show', () => pw.show())
    pw.on('focus', () => {
      pw.flashFrame(false)
      notifications.get(tabId)?.close()
      notifications.delete(tabId)
      send('popout:focus', tabId, true)
    })
    pw.on('blur', () => send('popout:focus', tabId, false))
    pw.on('closed', () => {
      if (popouts.get(tabId)?.win === pw) popouts.delete(tabId)
      send('popout:closed', tabId)
    })
    loadRenderer(pw, tabId)
    // メインのウィンドウに、表示を送り始めてもらう（別ウィンドウの準備ができるまでは queue に溜める）
    send('popout:opened', tabId)
  }

  function closePopout(tabId: string): void {
    const p = popouts.get(tabId)
    if (p && !p.win.isDestroyed()) p.win.close()
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
      popoutMenuItem(id),
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

  // ---- 分割 ----
  ipcMain.handle('tabs:split', (_e, sessionId: string, input: NewTabInput, targetId: string, dir: SplitDir) => {
    const tab = store.splitTab(sessionId, input, targetId, dir === 'column' ? 'column' : 'row')
    return { tab, layout: store.layout() }
  })
  ipcMain.handle('tabs:unsplit', (_e, id: string) => store.unsplitTab(id))
  ipcMain.handle('sessions:splits', (_e, sessionId: string, splits: PaneNode[]) => store.setSplits(sessionId, splits))
  ipcMain.handle('terminal:menu', async (_e, id: string, hasSelection: boolean): Promise<TerminalMenuAction> => {
    const found = store.tab(id)
    if (!win || !found) return null
    const inSplit = found.session.splits.some((s) => leaves(s).includes(id))
    return popup<NonNullable<TerminalMenuAction>>((choose) => [
      { label: 'コピー', enabled: hasSelection === true, click: () => choose({ type: 'copy' }) },
      { label: '貼り付け', click: () => choose({ type: 'paste' }) },
      { type: 'separator' },
      { label: '右に分割…', click: () => choose({ type: 'split', dir: 'row' }) },
      { label: '下に分割…', click: () => choose({ type: 'split', dir: 'column' }) },
      {
        label: '分割から外す（別のタブにする）',
        enabled: inSplit,
        click: () => choose({ type: 'unsplit' }),
      },
      { type: 'separator' },
      popoutMenuItem(id),
    ])
  })

  /** 「新しいウィンドウで開く」（開いていれば「別ウィンドウを前に出す」） */
  function popoutMenuItem(tabId: string): MenuItemConstructorOptions {
    const opened = popouts.has(tabId)
    return {
      label: opened ? '別ウィンドウを前に出す' : '新しいウィンドウで開く',
      click: () => openPopout(tabId),
    }
  }

  ipcMain.on('popout:relay', (e, tabId: string, msg: PopoutMessage) => {
    if (e.sender !== win?.webContents) return
    sendPopout(tabId, msg)
  })
  ipcMain.on('popout:close', (e, tabId: string) => {
    if (e.sender === win?.webContents) closePopout(tabId)
  })
  ipcMain.on('popout:show', (e, tabId: string) => {
    if (e.sender !== win?.webContents) return
    const p = popouts.get(tabId)
    if (p && !p.win.isDestroyed()) focusWindow(p.win)
  })
  ipcMain.on('popout:ready', (e) => {
    const id = popoutOf(e.sender)
    const p = id ? popouts.get(id) : undefined
    if (!id || !p) return
    if (p.ready) {
      // 別ウィンドウを読み込み直した: 表示を送り直してもらう
      send('popout:opened', id)
      return
    }
    p.ready = true
    for (const msg of p.queue.splice(0)) e.sender.send('popout:data', msg)
  })
  ipcMain.on('popout:input', (e, data: string) => {
    const id = popoutOf(e.sender)
    if (id && typeof data === 'string') send('popout:input', id, data)
  })
  ipcMain.on('popout:resize', (e, cols: number, rows: number) => {
    const id = popoutOf(e.sender)
    if (id && Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) send('popout:resize', id, cols, rows)
  })
  ipcMain.handle('popout:menu', async (e, hasSelection: boolean): Promise<PopoutMenuAction> => {
    const id = popoutOf(e.sender)
    const p = id ? popouts.get(id) : undefined
    if (!p) return null
    return new Promise((resolve) => {
      let chosen: PopoutMenuAction = null
      const choose = (v: PopoutMenuAction) => () => (chosen = v)
      Menu.buildFromTemplate([
        { label: 'コピー', enabled: hasSelection === true, click: choose('copy') },
        { label: '貼り付け', click: choose('paste') },
        { type: 'separator' },
        { label: '元のウィンドウに戻す', click: choose('return') },
      ]).popup({ window: p.win, callback: () => resolve(chosen) })
    })
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
  ipcMain.handle('screens:load', (_e, id: string): SavedScreen | null =>
    store.settings.keepScreen && store.tab(id) ? screens.load(id) : null,
  )

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
  ipcMain.on('selected', (_e, sessionId: string | null, _tabId: string | null, visibleIds: unknown) => {
    visibleTabIds = Array.isArray(visibleIds) ? visibleIds.filter((v): v is string => typeof v === 'string') : []
    store.setSelected(sessionId)
    for (const id of visibleTabIds) {
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

  nativeTheme.themeSource = store.settings.theme

  app.whenReady().then(() => {
    buildMenu()
    rules.watch((p) => send('rules:changed', p))
    createWindow()
    updates.start()
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
  app.on('before-quit', (ev) => {
    // 確認してから終わる。先にプロセスを止めると「プロセスが終了しました」が画面に混ざるので、表示を残してから止める
    if (!closeReady && win) {
      ev.preventDefault()
      void prepareClose().then((ok) => {
        if (ok) app.quit()
      })
      return
    }
    updates.stop()
    ptys.killAll()
  })
}
