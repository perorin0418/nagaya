import { useEffect, useRef } from 'react'
import type { SessionConfig } from '@shared/types'
import { terminals } from './terminals'

/**
 * 1セッション分の端末の置き場。全セッション分を重ねて置き、選択中のものだけ見せる。
 * （display: none にすると大きさが測れず、裏の PTY の大きさが合わなくなるので visibility で隠す）
 */
export function TerminalSlot({ session, visible }: { session: SessionConfig; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) terminals.attach(session, ref.current)
    // 削除のときは App 側で terminals.dispose を呼ぶ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  useEffect(() => terminals.updateConfig(session), [session])

  return <div ref={ref} className={`term-slot${visible ? ' visible' : ''}`} aria-hidden={!visible} />
}
