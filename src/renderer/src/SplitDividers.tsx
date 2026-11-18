import type { Divider, PanePath } from '@shared/split'

const pct = (v: number): string => `${v * 100}%`

/**
 * 分割の区切り。ドラッグで動かす。動かしているあいだは onMove を呼び続け、離したら onCommit を呼ぶ
 */
export function SplitDividers({
  dividers,
  container,
  onMove,
  onCommit,
}: {
  dividers: Divider[]
  /** 端末を並べている要素（ポインターの位置を割合に直すのに使う） */
  container: HTMLElement | null
  onMove: (path: PanePath, ratio: number) => void
  onCommit: () => void
}) {
  return (
    <>
      {dividers.map((d) => {
        const row = d.dir === 'row'
        const at = row ? d.rect.x + d.rect.w * d.ratio : d.rect.y + d.rect.h * d.ratio
        const style = row
          ? { left: pct(at), top: pct(d.rect.y), height: pct(d.rect.h) }
          : { top: pct(at), left: pct(d.rect.x), width: pct(d.rect.w) }
        return (
          <div
            key={d.path.join('') || 'root'}
            className={`split-divider ${d.dir}`}
            style={style}
            role="separator"
            aria-orientation={row ? 'vertical' : 'horizontal'}
            title="ドラッグで大きさを変える"
            onPointerDown={(ev) => {
              if (ev.button !== 0 || !container) return
              ev.preventDefault()
              const el = ev.currentTarget
              el.setPointerCapture(ev.pointerId)
              const box = container.getBoundingClientRect()
              const move = (e: PointerEvent): void => {
                const r = row
                  ? ((e.clientX - box.left) / box.width - d.rect.x) / d.rect.w
                  : ((e.clientY - box.top) / box.height - d.rect.y) / d.rect.h
                onMove(d.path, r)
              }
              const up = (): void => {
                el.removeEventListener('pointermove', move)
                el.removeEventListener('pointerup', up)
                el.removeEventListener('pointercancel', up)
                onCommit()
              }
              el.addEventListener('pointermove', move)
              el.addEventListener('pointerup', up)
              el.addEventListener('pointercancel', up)
            }}
          />
        )
      })}
    </>
  )
}
