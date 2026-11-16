import type { AgentState } from '@shared/types'
import type { HostGroup } from './App'

interface Props {
  groups: HostGroup[]
  states: Record<string, AgentState>
  selectedId: string | null
  onSelect(id: string): void
  onNew(): void
  onMenu(id: string): void
  ruleErrors: string[]
  onOpenRules(): void
}

export function Sidebar({ groups, states, selectedId, onSelect, onNew, onMenu, ruleErrors, onOpenRules }: Props) {
  return (
    <nav className="side">
      <div className="side-head">
        <span>セッション</span>
        <button className="icon" onClick={onNew} title="新しいセッション（Ctrl+Shift+T）" aria-label="新しいセッション">
          +
        </button>
      </div>
      <div className="side-list">
        {groups.map((g) => (
          <div key={g.host} className="group">
            <div className="host">{g.host || 'ローカル'}</div>
            {g.sessions.map((s) => {
              const st = states[s.id] ?? 'unknown'
              return (
                <div
                  key={s.id}
                  className={`sess${s.id === selectedId ? ' sel' : ''}`}
                  onClick={() => onSelect(s.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onMenu(s.id)
                  }}
                  title={s.command || 'シェル'}
                >
                  <span className={`dot ${st}`} />
                  <span className="name">{s.name}</span>
                  {st !== 'unknown' ? <span className="st">{st}</span> : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {ruleErrors.length > 0 ? (
        <div className="rule-errors" title={ruleErrors.join('\n')}>
          ルールの読み込みでエラーがあります（{ruleErrors.length} 件）
          <button className="link" onClick={onOpenRules}>
            フォルダーを開く
          </button>
          <ul>
            {ruleErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="side-foot">右クリックで編集・再起動・削除</div>
    </nav>
  )
}
