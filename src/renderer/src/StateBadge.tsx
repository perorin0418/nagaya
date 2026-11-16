import { STATE_LABEL, type AgentState } from '@shared/types'

export function StateBadge({ state }: { state: AgentState }) {
  if (state === 'unknown') return <span className="badge unknown">—</span>
  return <span className={`badge ${state}`}>{STATE_LABEL[state]}</span>
}
