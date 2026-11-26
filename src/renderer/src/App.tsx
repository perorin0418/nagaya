import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo } from '@shared/api'
import { DEFAULT_FONT } from '@shared/font'
import { sections as toSections } from '@shared/layout'
import { findSplit, paneLayout, setRatio, type PanePath } from '@shared/split'
import {
  tabLabel,
  type AgentState,
  type FontSetting,
  type Layout,
  type SessionConfig,
  type SessionGroup,
  type Settings,
  type SplitDir,
  type TabConfig,
} from '@shared/types'
import { Dashboard } from './Dashboard'
import { ExplainPanel } from './ExplainPanel'
import { FontDialog } from './FontDialog'
import { PromptDialog } from './PromptDialog'
import { SessionDialog, type SessionDialogInitial, type SessionDialogMode, type SessionDialogResult } from './SessionDialog'
import { Sidebar } from './Sidebar'
import { SplitDividers } from './SplitDividers'
import { StateBadge } from './StateBadge'
import { TabBar } from './TabBar'
import { TerminalSlot } from './TerminalSlot'
import { terminals, type ConnEvent } from './terminals'

const api = window.nagaya

type DialogState =
  | {
      kind: 'session'
      mode: SessionDialogMode
      initial: SessionDialogInitial
      /** edit・duplicate: 対象のセッション。tab-*: タブを足す・変えるセッション */
      sessionId?: string
      /** tab-edit: 変えるタブ。tab-new・tab-duplicate: このタブの後ろに足す。tab-split: 分割するタブ */
      tabId?: string
      /** tab-split: 分割の向き */
      split?: SplitDir
    }
  | { kind: 'new-group'; moveSessionId?: string }
  | { kind: 'rename-group'; group: SessionGroup }
  | { kind: 'font' }
  | null

/** タブの設定から、ダイアログの初期値にする部分 */
const tabInput = ({ id: _id, ...rest }: TabConfig) => rest

export function App() {
  const [layout, setLayout] = useState<Layout>({ groups: [], sessions: [] })
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** セッションごとに表示しているタブ（なければ最初のタブ。保存しない） */
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({})
  /** タブごとの状態（キーはタブの id） */
  const [states, setStates] = useState<Record<string, AgentState>>({})
  /** 見ていないあいだに作業が終わった・確認待ちになったタブ（表示したら消える） */
  const [unread, setUnread] = useState<Record<string, true>>({})
  const statesRef = useRef<Record<string, AgentState>>({})
  /** 画面に出ているタブ（分割していればその全部） */
  const visibleRef = useRef<string[]>([])
  const termsRef = useRef<HTMLDivElement>(null)
  const [conns, setConns] = useState<Record<string, ConnEvent>>({})
  const [dialog, setDialog] = useState<DialogState>(null)
  const [explain, setExplain] = useState(false)
  const [ruleErrors, setRuleErrors] = useState<string[]>([])
  const [agents, setAgents] = useState<string[]>([])
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [font, setFont] = useState<FontSetting>(DEFAULT_FONT)
  const [toast, setToast] = useState<string | null>(null)
  /** 別ウィンドウで開いているタブ */
  const [popped, setPopped] = useState<Record<string, true>>({})
  /** ダッシュボードを出しているか（端末の上に重ねて出す。保存しない） */
  const [dashboard, setDashboard] = useState(false)
  /** ダッシュボードで、キーボードの入力先になっているカードのタブ */
  const [panelTab, setPanelTab] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const { sessions, groups } = layout

  const applySettings = useCallback((s: Settings) => {
    setFont(s.font)
    terminals.setFont(s.font)
  }, [])

  const markRead = useCallback((tabIds: string[]) => {
    setUnread((u) => {
      if (!tabIds.some((id) => u[id])) return u
      const rest = { ...u }
      for (const id of tabIds) delete rest[id]
      return rest
    })
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  /** セッション（とタブ）を表示する */
  const show = useCallback((sessionId: string, tabId?: string | null) => {
    setDashboard(false)
    setSelectedId(sessionId)
    if (tabId) setActiveTabs((a) => (a[sessionId] === tabId ? a : { ...a, [sessionId]: tabId }))
  }, [])

  // 起動時: ルール・設定・セッション一覧を読む
  useEffect(() => {
    void (async () => {
      setInfo(await api.info())
      applySettings(await api.getSettings())
      const rules = await api.getRules()
      terminals.setRules(rules)
      setRuleErrors(terminals.errors)
      setAgents(terminals.agents)
      const { selectedId, ...l } = await api.getLayout()
      setLayout(l)
      setSelectedId(selectedId ?? toSections(l)[0]?.sessions[0]?.id ?? null)
      setLoaded(true)
    })()
    const offRules = api.onRulesChanged((p) => {
      terminals.setRules(p)
      setRuleErrors(terminals.errors)
      setAgents(terminals.agents)
      showToast(p.errors.length ? 'ルールを読み込みました（エラーあり）' : 'ルールを読み込みました')
    })
    const offState = terminals.onState(({ id, state }) => {
      const prev = statesRef.current[id]
      statesRef.current = { ...statesRef.current, [id]: state }
      setStates(statesRef.current)
      // 見ていないあいだに作業が終わった（作業中 → 入力待ち）・確認待ちになったら未読にする
      const done = (state === 'idle' && prev === 'working') || (state === 'blocked' && prev !== 'blocked')
      const watching = (visibleRef.current.includes(id) && document.hasFocus()) || terminals.isPopoutFocused(id)
      if (done && !watching) setUnread((u) => ({ ...u, [id]: true }))
    })
    // ウィンドウに戻ってきたら、表示しているタブは既読にする
    const onFocus = (): void => markRead(visibleRef.current)
    window.addEventListener('focus', onFocus)
    const offConn = terminals.onConn((ev) => setConns((c) => ({ ...c, [ev.id]: ev })))
    const offPopout = terminals.onPopout(({ id, popped: p, focused }) => {
      setPopped((cur) => {
        if (!!cur[id] === p) return cur
        const next = { ...cur }
        if (p) next[id] = true
        else delete next[id]
        return next
      })
      // 別ウィンドウで見たら既読にする
      if (focused) markRead([id])
    })
    const offSelect = api.onSelectSession((sessionId, tabId) => show(sessionId, tabId))
    const offSettings = api.onSettingsChanged(applySettings)
    return () => {
      offRules()
      offState()
      offConn()
      offPopout()
      offSelect()
      offSettings()
      window.removeEventListener('focus', onFocus)
    }
  }, [showToast, applySettings, markRead, show])

  const selected = sessions.find((s) => s.id === selectedId) ?? null
  const activeTab = (s: SessionConfig): TabConfig => s.tabs.find((t) => t.id === activeTabs[s.id]) ?? s.tabs[0]
  const tab = selected ? activeTab(selected) : null
  const tabId = tab?.id ?? null
  /** 表示しているタブが分割に入っていれば、その並び */
  const view = useMemo(() => {
    const tree = selected && tabId ? findSplit(selected.splits, tabId) : undefined
    return tree ? paneLayout(tree) : null
  }, [selected, tabId])
  const visibleIds = view ? view.panes.map((p) => p.tabId) : tabId ? [tabId] : []
  const visibleKey = visibleIds.join(',')

  const allTabIds = sessions.flatMap((s) => s.tabs.map((t) => t.id)).join(',')

  // 選択を main に知らせ、端末にフォーカスを移す
  useEffect(() => {
    if (!loaded) return
    if (dashboard) {
      // ダッシュボードでは端末を見ていないので、未読はそのまま付ける（カードに出す）。
      // 確認待ちはカードに出るので、ウィンドウが前面にあれば通知は出さない（main にはすべてのタブを見ていると伝える）
      // ただしキーボードの入力先になっているカードのタブは、見ているものとして扱う
      visibleRef.current = panelTab ? [panelTab] : []
      api.reportSelected(selectedId, tabId, allTabIds ? allTabIds.split(',') : [])
      if (panelTab && document.hasFocus()) markRead([panelTab])
      return
    }
    const ids = visibleKey ? visibleKey.split(',') : []
    api.reportSelected(selectedId, tabId, ids)
    visibleRef.current = ids
    if (document.hasFocus()) markRead(ids)
    if (tabId) requestAnimationFrame(() => terminals.focus(tabId))
  }, [selectedId, tabId, visibleKey, loaded, markRead, dashboard, allTabIds, panelTab])

  const secs = useMemo(() => toSections(layout), [layout])

  // サイドバーと同じ並びで前後のセッションへ（折りたたんだグループの中も含める）
  const ordered = useMemo(() => secs.flatMap((s) => s.sessions), [secs])
  const step = useCallback(
    (d: number) => {
      if (ordered.length === 0) return
      const i = ordered.findIndex((s) => s.id === selectedId)
      setDashboard(false)
      setSelectedId(ordered[(i + d + ordered.length) % ordered.length].id)
    },
    [ordered, selectedId],
  )

  // 前後のタブへ
  const stepTab = useCallback(
    (d: number) => {
      if (!selected || !tabId || selected.tabs.length < 2) return
      const i = selected.tabs.findIndex((t) => t.id === tabId)
      show(selected.id, selected.tabs[(i + d + selected.tabs.length) % selected.tabs.length].id)
    },
    [selected, tabId, show],
  )

  // 選んだセッションが折りたたんだグループの中なら開く（通知のクリックなどで選ばれたとき）。
  // 選択が変わったときだけ見る（選択中のセッションのグループも折りたためるように）
  useEffect(() => {
    const g = selected?.groupId ? groups.find((x) => x.id === selected.groupId) : undefined
    if (g?.collapsed) void api.setGroupCollapsed(g.id, false).then(setLayout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const newSession = useCallback(
    (groupId?: string | null) => {
      setDialog({
        kind: 'session',
        mode: 'new',
        // 既定のグループは、選んでいるセッションのグループ
        initial: { groupId: groupId === undefined ? (selected?.groupId ?? null) : groupId },
      })
    },
    [selected],
  )

  /** タブを足すダイアログ（表示しているタブの設定を写しておく。名前は空にする） */
  const newTab = useCallback(
    (s: SessionConfig | null) => {
      if (!s) return
      const from = activeTab(s)
      setDialog({
        kind: 'session',
        mode: 'tab-new',
        initial: { tab: { ...tabInput(from), name: '' } },
        sessionId: s.id,
        tabId: from.id,
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTabs],
  )

  const saveScreen = useCallback(async () => {
    if (!selected || !tab) return
    const text = terminals.screenLines(tab.id).join('\n').replace(/\s+$/, '') + '\n'
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const guess = terminals.candidate(tab.id)
    const name = selected.tabs.length > 1 ? `${selected.name}-${tabLabel(tab)}` : selected.name
    const path = await api.saveScreen(`${guess}-${name}-${stamp}.txt`, text)
    if (path) showToast(`保存しました: ${path}`)
  }, [selected, tab, showToast])

  // メニュー・ショートカット
  useEffect(
    () =>
      api.onMenu((action) => {
        if (action === 'new-session') newSession()
        else if (action === 'new-group') setDialog({ kind: 'new-group' })
        else if (action === 'new-tab') newTab(selected)
        else if (action === 'toggle-explain') setExplain((v) => !v)
        else if (action === 'save-screen') void saveScreen()
        else if (action === 'next-session') step(1)
        else if (action === 'prev-session') step(-1)
        else if (action === 'next-tab') stepTab(1)
        else if (action === 'prev-tab') stepTab(-1)
        else if (action === 'font-settings') setDialog({ kind: 'font' })
        else if (action === 'toggle-dashboard') setDashboard((v) => !v)
      }),
    [saveScreen, step, stepTab, newSession, newTab, selected],
  )

  // 端末の右クリックメニューの「右に分割・下に分割・分割から外す」
  useEffect(
    () =>
      terminals.onPaneMenu(({ id, action }) => {
        const s = sessions.find((x) => x.tabs.some((t) => t.id === id))
        const t = s?.tabs.find((x) => x.id === id)
        if (!s || !t) return
        if (action.type === 'unsplit') {
          void api.unsplitTab(id).then(setLayout)
          return
        }
        show(s.id, id)
        // 分割した端末の設定を写したダイアログを出す（名前は空にする）
        setDialog({
          kind: 'session',
          mode: 'tab-split',
          initial: { tab: { ...tabInput(t), name: '' } },
          sessionId: s.id,
          tabId: id,
          split: action.dir,
        })
      }),
    [sessions, show],
  )

  // 分割の区切りのドラッグ。動かしているあいだは画面だけ変え、離したら保存する
  const dragSplits = useRef<{ sessionId: string; splits: SessionConfig['splits'] } | null>(null)
  const moveDivider = useCallback(
    (path: PanePath, ratio: number) => {
      if (!selected || !view) return
      const root = view.panes[0].tabId
      const splits = setRatio(selected.splits, root, path, ratio)
      dragSplits.current = { sessionId: selected.id, splits }
      setLayout((l) => ({ ...l, sessions: l.sessions.map((x) => (x.id === selected.id ? { ...x, splits } : x)) }))
    },
    [selected, view],
  )
  const commitDivider = useCallback(() => {
    const d = dragSplits.current
    dragSplits.current = null
    if (d) void api.setSplits(d.sessionId, d.splits).then(setLayout)
  }, [])

  /** タブを忘れる（端末を閉じ、状態・未読・接続を消す） */
  function forgetTabs(ids: string[]) {
    if (ids.length === 0) return
    const drop = <T,>(r: Record<string, T>): Record<string, T> => {
      const next = { ...r }
      for (const id of ids) delete next[id]
      return next
    }
    for (const id of ids) terminals.dispose(id)
    statesRef.current = drop(statesRef.current)
    setStates(statesRef.current)
    setUnread(drop)
    setConns(drop)
  }

  async function submitSession(r: SessionDialogResult) {
    if (dialog?.kind !== 'session') return
    let groupId = r.groupId
    if (r.newGroupName) groupId = (await api.createGroup(r.newGroupName)).group.id
    const meta = { name: r.name, groupId }
    switch (dialog.mode) {
      case 'new': {
        const { session, layout } = await api.createSession({ ...meta, tab: r.tab })
        setLayout(layout)
        setSelectedId(session.id)
        break
      }
      case 'edit':
        setLayout(await api.updateSession(dialog.sessionId!, meta))
        break
      case 'duplicate': {
        const { session, layout } = await api.duplicateSession(dialog.sessionId!, meta)
        setLayout(layout)
        setSelectedId(session.id)
        break
      }
      case 'tab-new':
      case 'tab-duplicate': {
        const { tab, layout } = await api.addTab(dialog.sessionId!, r.tab, dialog.tabId ?? null)
        setLayout(layout)
        show(dialog.sessionId!, tab.id)
        break
      }
      case 'tab-split': {
        const { tab, layout } = await api.splitTab(dialog.sessionId!, r.tab, dialog.tabId!, dialog.split ?? 'row')
        setLayout(layout)
        show(dialog.sessionId!, tab.id)
        break
      }
      case 'tab-edit': {
        const prev = sessions.flatMap((s) => s.tabs).find((t) => t.id === dialog.tabId)
        setLayout(await api.updateTab({ ...r.tab, id: dialog.tabId! }))
        if (prev && (prev.command !== r.tab.command || prev.cwd !== r.tab.cwd))
          showToast('コマンド・作業ディレクトリの変更は、タブの右クリック →「再起動」で反映されます')
        break
      }
    }
    setDialog(null)
  }

  async function submitGroup(name: string) {
    if (dialog?.kind === 'new-group') {
      const { group, layout } = await api.createGroup(name)
      setLayout(dialog.moveSessionId ? await api.moveSession(dialog.moveSessionId, group.id, null) : layout)
    } else if (dialog?.kind === 'rename-group') {
      setLayout(await api.renameGroup(dialog.group.id, name))
    }
    setDialog(null)
  }

  async function sessionMenu(id: string) {
    const action = await api.sessionMenu(id)
    const cfg = sessions.find((s) => s.id === id)
    if (!cfg || !action) return
    switch (action.type) {
      case 'edit':
        setDialog({ kind: 'session', mode: 'edit', initial: { name: cfg.name, groupId: cfg.groupId }, sessionId: id })
        break
      case 'duplicate':
        setDialog({ kind: 'session', mode: 'duplicate', initial: { name: cfg.name, groupId: cfg.groupId }, sessionId: id })
        break
      case 'new-tab':
        setSelectedId(id)
        newTab(cfg)
        break
      case 'restart':
        setSelectedId(id)
        for (const t of cfg.tabs) await terminals.restart(t.id)
        break
      case 'move':
        setLayout(await api.moveSession(id, action.groupId, null))
        break
      case 'move-new-group':
        setDialog({ kind: 'new-group', moveSessionId: id })
        break
      case 'delete': {
        forgetTabs(cfg.tabs.map((t) => t.id))
        setLayout(await api.removeSession(id))
        setActiveTabs(({ [id]: _a, ...rest }) => rest)
        if (selectedId === id) setSelectedId(ordered.find((s) => s.id !== id)?.id ?? null)
        break
      }
    }
  }

  async function tabMenu(session: SessionConfig, t: TabConfig) {
    const action = await api.tabMenu(t.id)
    if (!action) return
    switch (action.type) {
      case 'edit':
        setDialog({ kind: 'session', mode: 'tab-edit', initial: { tab: tabInput(t) }, sessionId: session.id, tabId: t.id })
        break
      case 'duplicate':
        setDialog({
          kind: 'session',
          mode: 'tab-duplicate',
          initial: { tab: tabInput(t) },
          sessionId: session.id,
          tabId: t.id,
        })
        break
      case 'restart':
        show(session.id, t.id)
        await terminals.restart(t.id)
        break
      case 'close': {
        // 閉じたタブを表示していたら、隣のタブへ
        const i = session.tabs.findIndex((x) => x.id === t.id)
        const next = session.tabs[i + 1] ?? session.tabs[i - 1]
        if (activeTab(session).id === t.id && next) show(session.id, next.id)
        forgetTabs([t.id])
        setLayout(await api.removeTab(t.id))
        break
      }
    }
  }

  async function groupMenu(id: string) {
    const action = await api.groupMenu(id)
    const g = groups.find((x) => x.id === id)
    if (!g || !action) return
    if (action.type === 'new-session') newSession(id)
    else if (action.type === 'rename') setDialog({ kind: 'rename-group', group: g })
    else if (action.type === 'delete') setLayout(await api.removeGroup(id))
  }

  const state: AgentState = tab ? (states[tab.id] ?? 'unknown') : 'unknown'
  const conn = tab ? conns[tab.id] : undefined
  const group = selected?.groupId ? groups.find((g) => g.id === selected.groupId) : undefined

  return (
    <div className="app">
      <Sidebar
        sections={secs}
        hasGroups={groups.length > 0}
        states={states}
        unread={unread}
        conns={conns}
        selectedId={selectedId}
        onSelect={(id) => {
          setDashboard(false)
          setSelectedId(id)
        }}
        dashboard={dashboard}
        onToggleDashboard={() => setDashboard((v) => !v)}
        onNewSession={() => newSession()}
        onNewGroup={() => setDialog({ kind: 'new-group' })}
        onSessionMenu={sessionMenu}
        onGroupMenu={groupMenu}
        onToggleGroup={(g) => void api.setGroupCollapsed(g.id, !g.collapsed).then(setLayout)}
        onMoveSession={(id, groupId, beforeId) => void api.moveSession(id, groupId, beforeId).then(setLayout)}
        onMoveGroup={(id, beforeId) => void api.moveGroup(id, beforeId).then(setLayout)}
        ruleErrors={ruleErrors}
        onOpenRules={() => void api.openRulesFolder()}
      />
      <section className="main">
        {selected && tab ? (
          <>
            <div className="bar">
              <strong className="title">
                {group ? <span className="title-group">{group.name} / </span> : null}
                {tab.host ? `${tab.host} / ` : ''}
                {selected.name}
              </strong>
              <span className="cmd" title={tab.command || info?.defaultShell}>
                {tab.command || info?.defaultShell}
              </span>
              <span className="bar-actions">
                <button
                  className={`tool${explain ? ' on' : ''}`}
                  onClick={() => setExplain((v) => !v)}
                  title="判定に使った行と当たったルールを表示（Ctrl+Shift+D）"
                >
                  判定の詳細
                </button>
                <button className="tool" onClick={() => void saveScreen()} title="今の画面をテキストで保存（Ctrl+Shift+S）">
                  画面を保存
                </button>
              </span>
              {conn?.status === 'reconnecting' ? (
                <span className="badge reconnecting" title="Enter ですぐに再接続、Esc で中止">
                  再接続中（{conn.attempt} 回目）
                </span>
              ) : conn?.status === 'exited' ? (
                <span className="badge unknown">終了</span>
              ) : (
                <StateBadge state={state} />
              )}
            </div>
            <TabBar
              tabs={selected.tabs}
              activeId={tab.id}
              states={states}
              unread={unread}
              conns={conns}
              visibleIds={visibleIds}
              onSelect={(id) => show(selected.id, id)}
              onMenu={(t) => void tabMenu(selected, t)}
              onNew={() => newTab(selected)}
            />
          </>
        ) : null}
        {tab && explain ? <ExplainPanel tab={tab} committed={state} /> : null}
        <div className="terms" ref={termsRef}>
          {sessions.flatMap((s) =>
            s.tabs.map((t) => {
              const shown = s.id === selectedId
              const rect = !shown
                ? null
                : view
                  ? (view.panes.find((p) => p.tabId === t.id)?.rect ?? null)
                  : t.id === tabId
                    ? { x: 0, y: 0, w: 1, h: 1 }
                    : null
              const inView = !!view && rect !== null
              return (
                <TerminalSlot
                  key={t.id}
                  tab={t}
                  rect={rect}
                  split={inView}
                  focused={inView && t.id === tabId}
                  popped={!!popped[t.id]}
                  onActivate={() => {
                    if (inView && t.id !== tabId) show(s.id, t.id)
                  }}
                />
              )
            }),
          )}
          {view ? (
            <SplitDividers
              dividers={view.dividers}
              container={termsRef.current}
              onMove={moveDivider}
              onCommit={commitDivider}
            />
          ) : null}
          {loaded && sessions.length === 0 ? (
            <div className="empty">
              <p>セッションがありません。</p>
              <button className="primary" onClick={() => newSession()}>
                新しいセッション
              </button>
            </div>
          ) : null}
        </div>
        <Dashboard
          visible={dashboard && loaded}
          sections={secs}
          states={states}
          unread={unread}
          conns={conns}
          onOpen={show}
          onRead={markRead}
          popped={popped}
          onWatch={setPanelTab}
          onClose={() => setDashboard(false)}
        />
      </section>
      {dialog?.kind === 'session' ? (
        <SessionDialog
          mode={dialog.mode}
          initial={dialog.initial}
          groups={groups}
          agents={agents}
          defaultShell={info?.defaultShell ?? ''}
          onCancel={() => setDialog(null)}
          onSubmit={submitSession}
        />
      ) : null}
      {dialog?.kind === 'new-group' ? (
        <PromptDialog
          title="新しいグループ"
          label="グループの名前"
          submitLabel="作成"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => void submitGroup(name)}
        />
      ) : null}
      {dialog?.kind === 'rename-group' ? (
        <PromptDialog
          title="グループの名前を変更"
          label="グループの名前"
          initial={dialog.group.name}
          submitLabel="変更"
          onCancel={() => setDialog(null)}
          onSubmit={(name) => void submitGroup(name)}
        />
      ) : null}
      {dialog?.kind === 'font' ? (
        <FontDialog
          initial={font}
          onPreview={(f) => terminals.setFont(f)}
          onCancel={() => {
            terminals.setFont(font)
            setDialog(null)
          }}
          onSubmit={(f) => {
            setDialog(null)
            void api.setFont(f)
          }}
        />
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
