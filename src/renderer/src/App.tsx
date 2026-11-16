import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo } from '@shared/api'
import { sections as toSections } from '@shared/layout'
import type { AgentState, Layout, NewSessionInput, SessionConfig, SessionGroup, ThemeSetting } from '@shared/types'
import { ExplainPanel } from './ExplainPanel'
import { PromptDialog } from './PromptDialog'
import { SessionDialog, type SessionDialogResult } from './SessionDialog'
import { Sidebar } from './Sidebar'
import { StateBadge } from './StateBadge'
import { TerminalSlot } from './TerminalSlot'
import { terminals, type ConnEvent } from './terminals'

const api = window.nagaya

type DialogState =
  | { kind: 'session'; mode: 'new' | 'duplicate'; initial: Partial<NewSessionInput> }
  | { kind: 'session'; mode: 'edit'; session: SessionConfig }
  | { kind: 'new-group'; moveSessionId?: string }
  | { kind: 'rename-group'; group: SessionGroup }
  | null

export function App() {
  const [layout, setLayout] = useState<Layout>({ groups: [], sessions: [] })
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [states, setStates] = useState<Record<string, AgentState>>({})
  const [conns, setConns] = useState<Record<string, ConnEvent>>({})
  const [dialog, setDialog] = useState<DialogState>(null)
  const [explain, setExplain] = useState(false)
  const [ruleErrors, setRuleErrors] = useState<string[]>([])
  const [agents, setAgents] = useState<string[]>([])
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [theme, setTheme] = useState<ThemeSetting>('system')
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const { sessions, groups } = layout

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  // 起動時: ルール・設定・セッション一覧を読む
  useEffect(() => {
    void (async () => {
      setInfo(await api.info())
      setTheme((await api.getSettings()).theme)
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
    const offState = terminals.onState(({ id, state }) => setStates((s) => ({ ...s, [id]: state })))
    const offConn = terminals.onConn((ev) => setConns((c) => ({ ...c, [ev.id]: ev })))
    const offSelect = api.onSelectSession((id) => setSelectedId(id))
    const offSettings = api.onSettingsChanged((s) => setTheme(s.theme))
    return () => {
      offRules()
      offState()
      offConn()
      offSelect()
      offSettings()
    }
  }, [showToast])

  // 選択を main に知らせ、端末にフォーカスを移す
  useEffect(() => {
    if (!loaded) return
    api.reportSelected(selectedId)
    if (selectedId) requestAnimationFrame(() => terminals.focus(selectedId))
  }, [selectedId, loaded])

  const selected = sessions.find((s) => s.id === selectedId) ?? null
  const secs = useMemo(() => toSections(layout), [layout])

  // サイドバーと同じ並びで前後のセッションへ（折りたたんだグループの中も含める）
  const ordered = useMemo(() => secs.flatMap((s) => s.sessions), [secs])
  const step = useCallback(
    (d: number) => {
      if (ordered.length === 0) return
      const i = ordered.findIndex((s) => s.id === selectedId)
      setSelectedId(ordered[(i + d + ordered.length) % ordered.length].id)
    },
    [ordered, selectedId],
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

  const saveScreen = useCallback(async () => {
    if (!selected) return
    const text = terminals.screenLines(selected.id).join('\n').replace(/\s+$/, '') + '\n'
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const guess = terminals.candidate(selected.id)
    const path = await api.saveScreen(`${guess}-${selected.name}-${stamp}.txt`, text)
    if (path) showToast(`保存しました: ${path}`)
  }, [selected, showToast])

  // メニュー・ショートカット
  useEffect(
    () =>
      api.onMenu((action) => {
        if (action === 'new-session') newSession()
        else if (action === 'new-group') setDialog({ kind: 'new-group' })
        else if (action === 'toggle-explain') setExplain((v) => !v)
        else if (action === 'save-screen') void saveScreen()
        else if (action === 'next-session') step(1)
        else if (action === 'prev-session') step(-1)
      }),
    [saveScreen, step, newSession],
  )

  async function submitSession(r: SessionDialogResult) {
    if (dialog?.kind !== 'session') return
    let input = r.input
    if (r.newGroupName) {
      const { group } = await api.createGroup(r.newGroupName)
      input = { ...input, groupId: group.id }
    }
    if (dialog.mode === 'edit') {
      const prev = dialog.session
      const cfg = { ...prev, ...input }
      setLayout(await api.updateSession(cfg))
      setDialog(null)
      const changed = cfg.command !== prev.command || cfg.cwd !== prev.cwd
      if (changed) showToast('コマンド・作業ディレクトリの変更は、右クリック →「再起動」で反映されます')
    } else {
      const { session, layout } = await api.createSession(input)
      setLayout(layout)
      setSelectedId(session.id)
      setDialog(null)
    }
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
        setDialog({ kind: 'session', mode: 'edit', session: cfg })
        break
      case 'duplicate': {
        // 同じ作業を別のホストでも動かすため。名前・グループ・コマンドなどを写し、ホストは入れ直してもらう
        const { id: _id, ...rest } = cfg
        setDialog({ kind: 'session', mode: 'duplicate', initial: rest })
        break
      }
      case 'restart':
        setSelectedId(id)
        await terminals.restart(id)
        break
      case 'move':
        setLayout(await api.moveSession(id, action.groupId, null))
        break
      case 'move-new-group':
        setDialog({ kind: 'new-group', moveSessionId: id })
        break
      case 'delete': {
        terminals.dispose(id)
        setLayout(await api.removeSession(id))
        setStates(({ [id]: _s, ...rest }) => rest)
        setConns(({ [id]: _c, ...rest }) => rest)
        if (selectedId === id) setSelectedId(ordered.find((s) => s.id !== id)?.id ?? null)
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

  const state: AgentState = selected ? (states[selected.id] ?? 'unknown') : 'unknown'
  const conn = selected ? conns[selected.id] : undefined
  const group = selected?.groupId ? groups.find((g) => g.id === selected.groupId) : undefined

  return (
    <div className="app">
      <Sidebar
        sections={secs}
        hasGroups={groups.length > 0}
        states={states}
        conns={conns}
        selectedId={selectedId}
        theme={theme}
        onSelect={setSelectedId}
        onNewSession={() => newSession()}
        onNewGroup={() => setDialog({ kind: 'new-group' })}
        onSessionMenu={sessionMenu}
        onGroupMenu={groupMenu}
        onToggleGroup={(g) => void api.setGroupCollapsed(g.id, !g.collapsed).then(setLayout)}
        onMoveSession={(id, groupId, beforeId) => void api.moveSession(id, groupId, beforeId).then(setLayout)}
        onMoveGroup={(id, beforeId) => void api.moveGroup(id, beforeId).then(setLayout)}
        onTheme={(t) => void api.setTheme(t)}
        ruleErrors={ruleErrors}
        onOpenRules={() => void api.openRulesFolder()}
      />
      <section className="main">
        {selected ? (
          <div className="bar">
            <strong className="title">
              {group ? <span className="title-group">{group.name} / </span> : null}
              {selected.host ? `${selected.host} / ` : ''}
              {selected.name}
            </strong>
            <span className="cmd" title={selected.command || info?.defaultShell}>
              {selected.command || info?.defaultShell}
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
        ) : null}
        {selected && explain ? <ExplainPanel session={selected} committed={state} /> : null}
        <div className="terms">
          {sessions.map((s) => (
            <TerminalSlot key={s.id} session={s} visible={s.id === selectedId} />
          ))}
          {loaded && sessions.length === 0 ? (
            <div className="empty">
              <p>セッションがありません。</p>
              <button className="primary" onClick={() => newSession()}>
                新しいセッション
              </button>
            </div>
          ) : null}
        </div>
      </section>
      {dialog?.kind === 'session' ? (
        <SessionDialog
          mode={dialog.mode}
          initial={dialog.mode === 'edit' ? dialog.session : dialog.initial}
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
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
