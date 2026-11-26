import { memo, useEffect, useRef, useState } from 'react'
import {
  groupEntries,
  GROUPING_LABEL,
  isToolActive,
  matchesFilter,
  parseChoices,
  type DashboardFilter,
  type DashboardGrouping,
  type GroupableEntry,
} from '@shared/dashboard'
import type { SidebarSection } from '@shared/layout'
import { STATE_LABEL, tabLabel, type AgentState, type SessionConfig, type TabConfig } from '@shared/types'
import { StateBadge } from './StateBadge'
import { terminals, type ConnEvent } from './terminals'

/** 表示が変わったかを見る間隔（確認待ちの選択肢を読み直すため） */
const POLL_MS = 400
/** 絞り込み・まとめ方・列数を覚えておく場所（この PC のこのアプリだけ） */
const PREFS_KEY = 'nagaya.dashboard'

type Columns = 1 | 2 | 3
const COLUMNS: Columns[] = [1, 2, 3]

interface Prefs {
  /** ツールが動いているタブだけを出すか */
  toolsOnly: boolean
  grouping: DashboardGrouping
  /** カードを横に何枚並べるか（少ないほどカードが大きい） */
  columns: Columns
}

const DEFAULT_PREFS: Prefs = { toolsOnly: false, grouping: 'none', columns: 2 }

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null
    return {
      toolsOnly: typeof raw?.toolsOnly === 'boolean' ? raw.toolsOnly : DEFAULT_PREFS.toolsOnly,
      grouping: raw?.grouping && raw.grouping in GROUPING_LABEL ? raw.grouping : DEFAULT_PREFS.grouping,
      columns: COLUMNS.includes(raw?.columns as Columns) ? (raw!.columns as Columns) : DEFAULT_PREFS.columns,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // 覚えておけなくても、今の表示には効く
  }
}

interface Props {
  /** 出しているか（隠しているあいだは、端末をいつもの置き場に戻す） */
  visible: boolean
  sections: SidebarSection[]
  states: Record<string, AgentState>
  unread: Record<string, true>
  conns: Record<string, ConnEvent>
  /** 別ウィンドウで開いているタブ */
  popped: Record<string, true>
  /** タブを端末で開く（ダッシュボードを閉じる） */
  onOpen(sessionId: string, tabId: string): void
  /** タブを既読にする */
  onRead(tabIds: string[]): void
  /** キーボードの入力先になっているカードが変わった（見ているタブとして扱う。null ならなし） */
  onWatch(tabId: string | null): void
  onClose(): void
}

interface Item extends GroupableEntry {
  session: SessionConfig
  tab: TabConfig
}

const FILTERS: { key: DashboardFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'blocked', label: STATE_LABEL.blocked },
  { key: 'working', label: STATE_LABEL.working },
  { key: 'idle', label: STATE_LABEL.idle },
  { key: 'unread', label: '未読' },
]

/**
 * セッションを一覧する画面。カード1枚がタブ1枚で、カードの中にはそのタブの端末そのものを置く
 * （出しているあいだ、端末の桁数・行数はカードに合わせる）
 */
export function Dashboard(p: Props) {
  const [filter, setFilter] = useState<DashboardFilter>('all')
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const updatePrefs = (patch: Partial<Prefs>): void =>
    setPrefs((cur) => {
      const next = { ...cur, ...patch }
      savePrefs(next)
      return next
    })
  /** タブごとの表示の版（確認待ちのカードの選択肢を読み直す） */
  const [revs, setRevs] = useState<Record<string, number>>({})
  /** キーボードの入力先になっているカード */
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // サイドバーと同じ並び（折りたたんだグループの中も出す）
  const items: Item[] = p.sections.flatMap((sec) =>
    sec.sessions.flatMap((session) =>
      session.tabs.map((tab) => ({
        session,
        tab,
        sessionId: session.id,
        sessionName: session.name,
        groupId: sec.group?.id ?? null,
        groupName: sec.group?.name ?? null,
        host: tab.host,
        state: p.states[tab.id] ?? 'unknown',
      })),
    ),
  )
  const blockedKey = items
    .filter((x) => x.state === 'blocked')
    .map((x) => x.tab.id)
    .join(',')

  // 出しているあいだ、確認待ちのタブの表示が変わったかを見る
  useEffect(() => {
    if (!p.visible || !blockedKey) return
    const ids = blockedKey.split(',')
    const poll = (): void =>
      setRevs((cur) => {
        if (ids.every((id) => cur[id] === terminals.revision(id))) return cur
        const next = { ...cur }
        for (const id of ids) next[id] = terminals.revision(id)
        return next
      })
    poll()
    const t = window.setInterval(poll, POLL_MS)
    return () => window.clearInterval(t)
  }, [p.visible, blockedKey])

  // 開いたら、いつもの画面の端末からキーボードの入力を外す
  useEffect(() => {
    if (!p.visible) return
    const active = document.activeElement as HTMLElement | null
    if (active && !rootRef.current?.contains(active)) active.blur()
    rootRef.current?.focus()
  }, [p.visible])

  // キーボードの入力先のカードを知らせる（そのタブは見ていることにする）
  const watchId = p.visible ? focusedId : null
  const { onWatch } = p
  useEffect(() => onWatch(watchId), [watchId, onWatch])

  // ツールが動いているものだけに絞ってから、状態・未読で絞り込む（数も絞った後のもの）
  const base = prefs.toolsOnly ? items.filter((x) => isToolActive(x.state, p.conns[x.tab.id]?.status)) : items
  const count = (f: DashboardFilter): number => base.filter((x) => matchesFilter(f, x.state, !!p.unread[x.tab.id])).length
  const shown = base.filter((x) => matchesFilter(filter, x.state, !!p.unread[x.tab.id]))
  const groups = groupEntries(shown, prefs.grouping)

  return (
    <div
      className="dash"
      ref={rootRef}
      hidden={!p.visible}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && e.target === rootRef.current) p.onClose()
      }}
    >
      <div className="dash-head">
        <strong>ダッシュボード</strong>
        <div className="dash-filters" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className={`chip${filter === f.key ? ' on' : ''}${f.key !== 'all' ? ` ${f.key}` : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label} <span className="chip-count">{count(f.key)}</span>
            </button>
          ))}
        </div>
        <label
          className="dash-opt"
          title="Claude Code などが動いている（作業中・確認待ち・入力待ちの）タブだけを出す。シェルだけのタブや終了したタブは出さない"
        >
          <input type="checkbox" checked={prefs.toolsOnly} onChange={(e) => updatePrefs({ toolsOnly: e.target.checked })} />
          ツールが動いているものだけ
        </label>
        <label className="dash-opt">
          まとめ方
          <select value={prefs.grouping} onChange={(e) => updatePrefs({ grouping: e.target.value as DashboardGrouping })}>
            {(Object.keys(GROUPING_LABEL) as DashboardGrouping[]).map((g) => (
              <option key={g} value={g}>
                {GROUPING_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="dash-opt" title="横に並べる枚数。少ないほどカード（端末）が大きくなる">
          列
          <select value={prefs.columns} onChange={(e) => updatePrefs({ columns: Number(e.target.value) as Columns })}>
            {COLUMNS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button className="tool" onClick={p.onClose} title="いつもの画面に戻る（Ctrl+Shift+O）">
          閉じる
        </button>
      </div>
      {items.length === 0 ? (
        <div className="dash-empty">セッションがありません。</div>
      ) : shown.length === 0 ? (
        <div className="dash-empty">
          {prefs.toolsOnly && base.length === 0 ? 'ツールが動いているタブはありません。' : '当てはまるセッションはありません。'}
        </div>
      ) : (
        <div className="dash-body">
          {groups.map((g) => (
            <section key={g.key} className="dash-section">
              {g.label ? (
                <h3 className="dash-section-head">
                  {g.label} <span className="chip-count">{g.items.length}</span>
                </h3>
              ) : null}
              <div className="dash-grid" style={{ gridTemplateColumns: `repeat(${prefs.columns}, minmax(0, 1fr))` }}>
                {g.items.map(({ session, tab, groupName, state }) => (
                  <Card
                    key={tab.id}
                    session={session}
                    tab={tab}
                    groupName={prefs.grouping === 'group' ? null : groupName}
                    state={state}
                    unread={!!p.unread[tab.id]}
                    conn={p.conns[tab.id]?.status}
                    attempt={p.conns[tab.id]?.attempt}
                    popped={!!p.popped[tab.id]}
                    visible={p.visible}
                    rev={revs[tab.id] ?? -1}
                    onOpen={p.onOpen}
                    onRead={p.onRead}
                    onFocusChange={setFocusedId}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

interface CardProps {
  session: SessionConfig
  tab: TabConfig
  groupName: string | null
  state: AgentState
  unread: boolean
  conn: ConnEvent['status'] | undefined
  attempt: number | undefined
  popped: boolean
  /** ダッシュボードを出しているか（隠したら端末を返す） */
  visible: boolean
  /** 表示の版（確認待ちのとき、変わったら選択肢を読み直す） */
  rev: number
  onOpen(sessionId: string, tabId: string): void
  onRead(tabIds: string[]): void
  /** キーボードの入力先になった・外れた */
  onFocusChange(update: (cur: string | null) => string | null): void
}

const Card = memo(function Card(c: CardProps) {
  const id = c.tab.id
  const termRef = useRef<HTMLDivElement>(null)

  // 端末そのものをカードに借りてくる（桁数・行数はカードに合わせる）。隠したら・カードが消えたら返す
  useEffect(() => {
    if (!c.visible || c.popped || !termRef.current) return
    if (!terminals.borrow(id, termRef.current)) return
    return () => terminals.giveBack(id)
  }, [id, c.visible, c.popped])

  const running = c.conn !== 'exited' && c.conn !== 'reconnecting' && terminals.isRunning(id)
  const choices = running && c.state === 'blocked' ? parseChoices(terminals.liveLines(id)) : []
  const title = c.session.tabs.length > 1 ? `${c.session.name} / ${tabLabel(c.tab)}` : c.session.name
  const read = (): void => {
    if (c.unread) c.onRead([id])
  }
  function key(data: string): void {
    terminals.input(id, data)
    read()
    terminals.focus(id)
  }

  let status = <StateBadge state={c.state} />
  if (c.conn === 'reconnecting') status = <span className="badge reconnecting">再接続中（{c.attempt ?? 1} 回目）</span>
  else if (c.conn === 'exited') status = <span className="badge unknown">終了</span>

  return (
    <div
      className={`card ${c.state}${c.unread ? ' unread' : ''}`}
      onMouseDown={read}
      onFocus={() => {
        read()
        c.onFocusChange(() => id)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) c.onFocusChange((cur) => (cur === id ? null : cur))
      }}
    >
      <div className="card-head">
        <span className={`dot ${c.state}`} />
        <span className="card-title">
          {c.groupName ? <span className="card-group">{c.groupName} / </span> : null}
          {title}
        </span>
        {c.tab.host ? <span className="host-tag">{c.tab.host}</span> : null}
        {c.unread ? <span className="unread-tag">未読</span> : null}
        <span className="card-status">{status}</span>
        <button className="tool" onClick={() => c.onOpen(c.session.id, id)} title="ダッシュボードを閉じて、いつもの画面で表示する">
          端末で開く
        </button>
      </div>
      {choices.length > 0 ? (
        <div className="choices">
          {choices.map((ch) => (
            <button
              key={ch.key}
              className={`choice${ch.current ? ' current' : ''}`}
              title={`${ch.key}. ${ch.label}（${ch.key} キーを送ります）`}
              onClick={() => key(ch.key)}
            >
              <span className="choice-key">{ch.key}</span>
              <span className="choice-label">{ch.label}</span>
            </button>
          ))}
          <button className="choice esc" onClick={() => key('\x1b')} title="Esc を送ります">
            取り消し（Esc）
          </button>
        </div>
      ) : null}
      <div className="card-term" ref={termRef}>
        {c.popped ? (
          <div className="popped-cover">
            <p>このタブは別のウィンドウで開いています</p>
            <div className="buttons">
              <button onClick={() => window.nagaya.popoutShow(id)}>ウィンドウを前に出す</button>
              <button onClick={() => window.nagaya.popoutClose(id)}>このウィンドウに戻す</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
})
