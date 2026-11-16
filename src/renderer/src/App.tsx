import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo } from '@shared/api'
import type { AgentState, NewSessionInput, SessionConfig } from '@shared/types'
import { ExplainPanel } from './ExplainPanel'
import { SessionDialog } from './SessionDialog'
import { Sidebar } from './Sidebar'
import { StateBadge } from './StateBadge'
import { TerminalSlot } from './TerminalSlot'
import { terminals } from './terminals'

const api = window.nagaya

type DialogState = { mode: 'new' } | { mode: 'edit'; session: SessionConfig } | null

export function App() {
  const [sessions, setSessions] = useState<SessionConfig[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [states, setStates] = useState<Record<string, AgentState>>({})
  const [dialog, setDialog] = useState<DialogState>(null)
  const [explain, setExplain] = useState(false)
  const [ruleErrors, setRuleErrors] = useState<string[]>([])
  const [agents, setAgents] = useState<string[]>([])
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  // 起動時: ルールとセッション一覧を読む
  useEffect(() => {
    void (async () => {
      setInfo(await api.info())
      const rules = await api.getRules()
      terminals.setRules(rules)
      setRuleErrors(terminals.errors)
      setAgents(terminals.agents)
      const { sessions, selectedId } = await api.listSessions()
      setSessions(sessions)
      setSelectedId(selectedId ?? sessions[0]?.id ?? null)
      setLoaded(true)
    })()
    const offRules = api.onRulesChanged((p) => {
      terminals.setRules(p)
      setRuleErrors(terminals.errors)
      setAgents(terminals.agents)
      showToast(p.errors.length ? 'ルールを読み込みました（エラーあり）' : 'ルールを読み込みました')
    })
    const offState = terminals.onState(({ id, state }) => setStates((s) => ({ ...s, [id]: state })))
    const offSelect = api.onSelectSession((id) => setSelectedId(id))
    return () => {
      offRules()
      offState()
      offSelect()
    }
  }, [showToast])

  // 選択を main に知らせ、端末にフォーカスを移す
  useEffect(() => {
    if (!loaded) return
    api.reportSelected(selectedId)
    if (selectedId) requestAnimationFrame(() => terminals.focus(selectedId))
  }, [selectedId, loaded])

  const selected = sessions.find((s) => s.id === selectedId) ?? null

  // サイドバーと同じ並び（ホストごと）で前後のセッションへ
  const ordered = useMemo(() => groupByHost(sessions).flatMap((g) => g.sessions), [sessions])
  const step = useCallback(
    (d: number) => {
      if (ordered.length === 0) return
      const i = ordered.findIndex((s) => s.id === selectedId)
      setSelectedId(ordered[(i + d + ordered.length) % ordered.length].id)
    },
    [ordered, selectedId],
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
        if (action === 'new-session') setDialog({ mode: 'new' })
        else if (action === 'toggle-explain') setExplain((v) => !v)
        else if (action === 'save-screen') void saveScreen()
        else if (action === 'next-session') step(1)
        else if (action === 'prev-session') step(-1)
      }),
    [saveScreen, step],
  )

  async function submitDialog(input: NewSessionInput) {
    if (dialog?.mode === 'edit') {
      const cfg = { ...dialog.session, ...input }
      await api.updateSession(cfg)
      setSessions((list) => list.map((s) => (s.id === cfg.id ? cfg : s)))
      terminals.setAgent(cfg.id, cfg.agent)
      const changed = cfg.command !== dialog.session.command || cfg.cwd !== dialog.session.cwd
      setDialog(null)
      if (changed) showToast('コマンド・作業ディレクトリの変更は、右クリック →「再起動」で反映されます')
    } else {
      const cfg = await api.createSession(input)
      setSessions((list) => [...list, cfg])
      setSelectedId(cfg.id)
      setDialog(null)
    }
  }

  async function openMenu(id: string) {
    const action = await api.sessionMenu(id)
    const cfg = sessions.find((s) => s.id === id)
    if (!cfg) return
    if (action === 'edit') setDialog({ mode: 'edit', session: cfg })
    else if (action === 'restart') {
      setSelectedId(id)
      await terminals.restart(id)
    } else if (action === 'delete') {
      terminals.dispose(id)
      await api.removeSession(id)
      setSessions((list) => list.filter((s) => s.id !== id))
      setStates(({ [id]: _, ...rest }) => rest)
      if (selectedId === id) {
        const rest = ordered.filter((s) => s.id !== id)
        setSelectedId(rest[0]?.id ?? null)
      }
    }
  }

  const state: AgentState = selected ? (states[selected.id] ?? 'unknown') : 'unknown'

  return (
    <div className="app">
      <Sidebar
        groups={groupByHost(sessions)}
        states={states}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNew={() => setDialog({ mode: 'new' })}
        onMenu={openMenu}
        ruleErrors={ruleErrors}
        onOpenRules={() => void api.openRulesFolder()}
      />
      <section className="main">
        {selected ? (
          <div className="bar">
            <strong className="title">
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
            <StateBadge state={state} />
          </div>
        ) : null}
        {selected && explain ? <ExplainPanel session={selected} committed={state} /> : null}
        <div className="terms">
          {sessions.map((s) => (
            <TerminalSlot key={s.id} id={s.id} agent={s.agent} visible={s.id === selectedId} />
          ))}
          {loaded && sessions.length === 0 ? (
            <div className="empty">
              <p>セッションがありません。</p>
              <button className="primary" onClick={() => setDialog({ mode: 'new' })}>
                新しいセッション
              </button>
            </div>
          ) : null}
        </div>
      </section>
      {dialog ? (
        <SessionDialog
          initial={dialog.mode === 'edit' ? dialog.session : null}
          agents={agents}
          defaultShell={info?.defaultShell ?? ''}
          onCancel={() => setDialog(null)}
          onSubmit={submitDialog}
        />
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}

export interface HostGroup {
  host: string
  sessions: SessionConfig[]
}

/** ホストごとにまとめる（最初に出てきた順） */
export function groupByHost(sessions: SessionConfig[]): HostGroup[] {
  const map = new Map<string, SessionConfig[]>()
  for (const s of sessions) {
    const key = s.host || ''
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  return [...map.entries()].map(([host, sessions]) => ({ host, sessions }))
}
