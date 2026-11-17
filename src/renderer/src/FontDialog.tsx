import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  DEFAULT_FONT,
  FONT_SUGGESTIONS,
  fontFamilyCss,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  normalizeFont,
} from '@shared/font'
import type { FontSetting } from '@shared/types'

interface Props {
  initial: FontSetting
  /** 入力が変わるたびに呼ぶ（開いている端末にすぐ反映して見てもらう） */
  onPreview(font: FontSetting): void
  onCancel(): void
  onSubmit(font: FontSetting): void
}

/** 端末のフォントを選ぶダイアログ */
export function FontDialog({ initial, onPreview, onCancel, onSubmit }: Props) {
  const [family, setFamily] = useState(initial.family)
  const [size, setSize] = useState(String(initial.size))
  const input = useRef<HTMLInputElement>(null)
  const font = normalizeFont({ family, size: Number(size) })

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  useEffect(() => {
    onPreview(font)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font.family, font.size])

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit(font)
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <form className="dialog" onSubmit={submit}>
        <h2>端末のフォント</h2>
        <label>
          <span>フォント</span>
          <input
            ref={input}
            list="font-suggestions"
            value={family}
            placeholder="既定（Cascadia Mono, Consolas, BIZ UDGothic …）"
            onChange={(e) => setFamily(e.target.value)}
          />
          <datalist id="font-suggestions">
            {FONT_SUGGESTIONS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <div className="hint">
          PC に入っているフォントの名前。カンマで区切って複数書ける。入っていない文字は既定のフォントで出る
        </div>
        <label>
          <span>大きさ（px）</span>
          <input
            type="number"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </label>
        <div
          className="font-preview"
          style={{
            fontFamily: fontFamilyCss(font.family),
            fontSize: `${font.size}px`,
          }}
        >
          {'❯ 1. Yes  ●  0O1lI|  =>  != \n日本語の表示: 認証の作り直し（確認待ち）'}
        </div>
        <div className="buttons">
          <button
            type="button"
            className="reset"
            onClick={() => {
              setFamily(DEFAULT_FONT.family)
              setSize(String(DEFAULT_FONT.size))
            }}
          >
            既定に戻す
          </button>
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit" className="primary">
            保存
          </button>
        </div>
      </form>
    </div>
  )
}
