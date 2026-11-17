import { tabLabel, type AgentState, type TabConfig } from '@shared/types'
import type { ConnEvent } from './terminals'

interface Props {
  tabs: TabConfig[]
  activeId: string
  /** タブごとの状態・未読・接続（キーはタブの id） */
  states: Record<string, AgentState>
  unread: Record<string, true>
  conns: Record<string, ConnEvent>
  onSelect(id: string): void
  onMenu(tab: TabConfig): void
  onNew(): void
}

/** 端末の上のタブ列（状態の点・未読の印つき） */
export function TabBar({ tabs, activeId, states, unread, conns, onSelect, onMenu, onNew }: Props) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => {
        const st = states[t.id] ?? 'unknown'
        const conn = conns[t.id]?.status
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            className={`tab${t.id === activeId ? ' active' : ''}${unread[t.id] ? ' unread' : ''}`}
            onClick={() => onSelect(t.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              onMenu(t)
            }}
            title={`${t.host ? `${t.host}: ` : ''}${t.command || 'シェル'}\n右クリックでメニュー`}
          >
            <span className={`dot ${st}`} />
            <span className="tab-name">{tabLabel(t)}</span>
            {t.name && t.host ? <span className="tab-host">{t.host}</span> : null}
            {conn === 'reconnecting' ? <span className="tab-conn warn">再接続中</span> : null}
            {conn === 'exited' ? <span className="tab-conn">終了</span> : null}
            {unread[t.id] ? <span className="unread-mark" aria-label="未読" /> : null}
          </button>
        )
      })}
      <button className="tab-new" onClick={onNew} title="新しいタブ" aria-label="新しいタブ">
        +
      </button>
    </div>
  )
}
