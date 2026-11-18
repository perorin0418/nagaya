import { useEffect, useRef } from 'react'
import type { Rect } from '@shared/split'
import type { TabConfig } from '@shared/types'
import { terminals } from './terminals'

const pct = (v: number): string => `${v * 100}%`

/**
 * タブ1枚分の端末の置き場。全タブ分を重ねて置き、表示しているタブだけ見せる。
 * 分割しているときは rect の範囲に置く（rect が null なら隠す）。
 * （display: none にすると大きさが測れず、裏の PTY の大きさが合わなくなるので visibility で隠す）
 */
export function TerminalSlot({
  tab,
  rect,
  split,
  focused,
  onActivate,
}: {
  tab: TabConfig
  rect: Rect | null
  /** 分割の中の1枚か（枠を付ける） */
  split: boolean
  /** 分割の中で、操作の対象になっているか */
  focused: boolean
  /** クリックで操作の対象にする */
  onActivate: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) terminals.attach(tab, ref.current)
    // 削除のときは App 側で terminals.dispose を呼ぶ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => terminals.updateConfig(tab), [tab])

  const r = rect ?? { x: 0, y: 0, w: 1, h: 1 }
  return (
    <div
      ref={ref}
      className={`term-slot${rect ? ' visible' : ''}${split ? ' split' : ''}${focused ? ' focused' : ''}`}
      style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
      aria-hidden={!rect}
      // 右クリックでも対象を移す（メニューの操作はクリックした端末に効く）
      onMouseDown={onActivate}
    />
  )
}
