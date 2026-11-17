import { useEffect, useRef } from 'react'
import type { TabConfig } from '@shared/types'
import { terminals } from './terminals'

/**
 * タブ1枚分の端末の置き場。全タブ分を重ねて置き、表示しているタブだけ見せる。
 * （display: none にすると大きさが測れず、裏の PTY の大きさが合わなくなるので visibility で隠す）
 */
export function TerminalSlot({ tab, visible }: { tab: TabConfig; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) terminals.attach(tab, ref.current)
    // 削除のときは App 側で terminals.dispose を呼ぶ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  useEffect(() => terminals.updateConfig(tab), [tab])

  return <div ref={ref} className={`term-slot${visible ? ' visible' : ''}`} aria-hidden={!visible} />
}
