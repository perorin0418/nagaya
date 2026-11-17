import { useEffect, useState } from 'react'
import type { DetectResult } from '@shared/detect'
import type { AgentState, TabConfig } from '@shared/types'
import { terminals } from './terminals'

/** 判定のデバッグ表示（herdr の agent explain に相当） */
export function ExplainPanel({ tab, committed }: { tab: TabConfig; committed: AgentState }) {
  const [result, setResult] = useState<DetectResult | null>(null)

  useEffect(() => terminals.explain(tab.id, ({ result }) => setResult(result)), [tab.id])

  const hitRows = new Set(result?.hits.map((h) => h.row))
  return (
    <div className="explain">
      <div className="explain-head">
        <span>
          ルール: <code>{tab.agent || '（なし）'}</code>
        </span>
        <span>
          今の判定: <code>{result?.state ?? 'unknown'}</code>
        </span>
        <span>
          確定: <code>{committed}</code>
        </span>
        <span>
          当たったルール: <code>{result?.rule?.name ?? 'なし'}</code>
        </span>
      </div>
      {!result ? (
        <div className="explain-note">
          {tab.agent ? `ルール「${tab.agent}」が読み込まれていません。` : 'このタブは判定しません。'}
        </div>
      ) : (
        <>
          {result.hits.length > 0 ? (
            <div className="explain-hits">
              {result.hits.map((h, i) => (
                <div key={i}>
                  {h.kind} <code>/{h.pattern}/</code> → {h.row + 1} 行目
                </div>
              ))}
            </div>
          ) : null}
          <pre className="explain-lines">
            {result.scanned.map((l) => (
              <div key={l.row} className={hitRows.has(l.row) ? 'hit' : undefined}>
                <span className="ln">{String(l.row + 1).padStart(3, ' ')}</span>
                {l.text || ' '}
              </div>
            ))}
          </pre>
        </>
      )}
    </div>
  )
}
