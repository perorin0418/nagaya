import { useState, type DragEvent, type ReactNode } from 'react'
import type { SidebarSection } from '@shared/layout'
import type { AgentState, SessionGroup, ThemeSetting } from '@shared/types'
import type { ConnEvent } from './terminals'

const SESSION_MIME = 'application/x-nagaya-session'
const GROUP_MIME = 'application/x-nagaya-group'

interface Props {
  sections: SidebarSection[]
  /** グループが1つ以上あるか（「グループなし」の見出しを出すか） */
  hasGroups: boolean
  states: Record<string, AgentState>
  conns: Record<string, ConnEvent>
  selectedId: string | null
  theme: ThemeSetting
  onSelect(id: string): void
  onNewSession(): void
  onNewGroup(): void
  onSessionMenu(id: string): void
  onGroupMenu(id: string): void
  onToggleGroup(g: SessionGroup): void
  onMoveSession(id: string, groupId: string | null, beforeId: string | null): void
  onMoveGroup(id: string, beforeId: string | null): void
  onTheme(t: ThemeSetting): void
  ruleErrors: string[]
  onOpenRules(): void
}

/** ドロップ先の目印（どの行の上・下か） */
type DropMark = { kind: 'session' | 'group' | 'section'; id: string; pos: 'before' | 'after' | 'into' } | null

const RANK: Record<AgentState, number> = { blocked: 3, working: 2, idle: 1, unknown: 0 }

function half(e: DragEvent): 'before' | 'after' {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return e.clientY < r.top + r.height / 2 ? 'before' : 'after'
}

export function Sidebar(p: Props) {
  const [mark, setMark] = useState<DropMark>(null)
  const dragging = (e: DragEvent, mime: string) => e.dataTransfer.types.includes(mime)

  /** セッションの行に落としたとき: その行の前か後ろへ */
  function dropOnSession(e: DragEvent, sec: SidebarSection, index: number) {
    const id = e.dataTransfer.getData(SESSION_MIME)
    setMark(null)
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    const target = sec.sessions[index]
    let beforeId: string | null = target.id
    if (half(e) === 'after') {
      // 後ろへ: 次のセッション（自分自身は飛ばす）の前。なければグループの最後
      const next = sec.sessions.slice(index + 1).find((s) => s.id !== id)
      beforeId = next?.id ?? null
    }
    if (beforeId === id) return
    p.onMoveSession(id, sec.group?.id ?? null, beforeId)
  }

  /** グループの見出しに落としたとき: セッションならそのグループの最後へ、グループなら並べ替え */
  function dropOnHeader(e: DragEvent, sec: SidebarSection) {
    setMark(null)
    const sid = e.dataTransfer.getData(SESSION_MIME)
    const gid = e.dataTransfer.getData(GROUP_MIME)
    e.preventDefault()
    e.stopPropagation()
    if (sid) {
      p.onMoveSession(sid, sec.group?.id ?? null, null)
    } else if (gid && sec.group && gid !== sec.group.id) {
      const groups = p.sections.flatMap((s) => (s.group ? [s.group] : []))
      const i = groups.findIndex((g) => g.id === sec.group!.id)
      const beforeId = half(e) === 'before' ? sec.group.id : (groups.slice(i + 1).find((g) => g.id !== gid)?.id ?? null)
      if (beforeId !== gid) p.onMoveGroup(gid, beforeId)
    }
  }

  return (
    <nav className="side">
      <div className="side-head">
        <span>セッション</span>
        <span className="side-head-buttons">
          <button className="icon" onClick={p.onNewGroup} title="新しいグループ" aria-label="新しいグループ">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z M10 7.5v4 M8 9.5h4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button className="icon" onClick={p.onNewSession} title="新しいセッション（Ctrl+Shift+T）" aria-label="新しいセッション">
            +
          </button>
        </span>
      </div>
      <div
        className="side-list"
        onDragOver={(e) => {
          if (dragging(e, SESSION_MIME)) e.preventDefault()
        }}
        onDrop={(e) => {
          // 何もない所に落としたら「グループなし」の最後へ
          const id = e.dataTransfer.getData(SESSION_MIME)
          setMark(null)
          if (id) p.onMoveSession(id, null, null)
        }}
      >
        {p.sections.map((sec) => {
          const key = sec.group?.id ?? '__none__'
          const collapsed = sec.group?.collapsed ?? false
          const showHeader = sec.group !== null || p.hasGroups
          const worst = sec.sessions.reduce<AgentState>(
            (w, s) => (RANK[p.states[s.id] ?? 'unknown'] > RANK[w] ? (p.states[s.id] ?? 'unknown') : w),
            'unknown',
          )
          const blocked = sec.sessions.filter((s) => p.states[s.id] === 'blocked').length
          const headerMark = mark?.kind === 'group' && mark.id === key ? mark.pos : null
          return (
            <div key={key} className="group">
              {showHeader ? (
                <div
                  className={`group-head${headerMark ? ` drop-${headerMark}` : ''}${sec.group ? '' : ' loose'}`}
                  draggable={sec.group !== null}
                  onDragStart={(e) => {
                    if (!sec.group) return
                    e.dataTransfer.setData(GROUP_MIME, sec.group.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(e) => {
                    if (dragging(e, SESSION_MIME)) {
                      e.preventDefault()
                      e.stopPropagation()
                      setMark({ kind: 'group', id: key, pos: 'into' })
                    } else if (dragging(e, GROUP_MIME) && sec.group) {
                      e.preventDefault()
                      e.stopPropagation()
                      setMark({ kind: 'group', id: key, pos: half(e) })
                    }
                  }}
                  onDragLeave={() => setMark(null)}
                  onDrop={(e) => dropOnHeader(e, sec)}
                  onClick={() => sec.group && p.onToggleGroup(sec.group)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (sec.group) p.onGroupMenu(sec.group.id)
                  }}
                  title={sec.group ? 'クリックで開閉・ドラッグで並べ替え・右クリックでメニュー' : undefined}
                >
                  {sec.group ? (
                    <svg className={`chev${collapsed ? '' : ' open'}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                      <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                  <span className="group-name">{sec.group?.name ?? 'グループなし'}</span>
                  {collapsed ? (
                    <span className="group-sum">
                      {worst !== 'unknown' ? <span className={`dot ${worst}`} /> : null}
                      {blocked > 0 ? `確認待ち ${blocked}` : sec.sessions.length}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {!collapsed &&
                sec.sessions.map((s, i) => {
                  const st = p.states[s.id] ?? 'unknown'
                  const conn = p.conns[s.id]
                  const m = mark?.kind === 'session' && mark.id === s.id ? mark.pos : null
                  let status: ReactNode = st !== 'unknown' ? <span className="st">{st}</span> : null
                  if (conn?.status === 'reconnecting') status = <span className="st warn">再接続中</span>
                  else if (conn?.status === 'exited') status = <span className="st">終了</span>
                  return (
                    <div
                      key={s.id}
                      className={`sess${s.id === p.selectedId ? ' sel' : ''}${m ? ` drop-${m}` : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(SESSION_MIME, s.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragOver={(e) => {
                        if (!dragging(e, SESSION_MIME)) return
                        e.preventDefault()
                        e.stopPropagation()
                        setMark({ kind: 'session', id: s.id, pos: half(e) })
                      }}
                      onDragLeave={() => setMark(null)}
                      onDrop={(e) => dropOnSession(e, sec, i)}
                      onDragEnd={() => setMark(null)}
                      onClick={() => p.onSelect(s.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        p.onSessionMenu(s.id)
                      }}
                      title={`${s.host ? `${s.host}: ` : ''}${s.command || 'シェル'}`}
                    >
                      <span className={`dot ${st}`} />
                      <span className="name">{s.name}</span>
                      {s.host ? <span className="host-tag">{s.host}</span> : null}
                      {status}
                    </div>
                  )
                })}
              {!collapsed && sec.group && sec.sessions.length === 0 ? (
                <div className="group-empty">セッションをここへドラッグ</div>
              ) : null}
            </div>
          )
        })}
      </div>
      {p.ruleErrors.length > 0 ? (
        <div className="rule-errors" title={p.ruleErrors.join('\n')}>
          ルールの読み込みでエラーがあります（{p.ruleErrors.length} 件）
          <button className="link" onClick={p.onOpenRules}>
            フォルダーを開く
          </button>
          <ul>
            {p.ruleErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="side-foot">
        <label className="theme">
          テーマ
          <select value={p.theme} onChange={(e) => p.onTheme(e.target.value as ThemeSetting)}>
            <option value="system">システム</option>
            <option value="light">ライト</option>
            <option value="dark">ダーク</option>
          </select>
        </label>
        <div>ドラッグで並べ替え</div>
      </div>
    </nav>
  )
}
