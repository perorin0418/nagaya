import { useEffect, useRef, useState, type FormEvent } from 'react'

interface Props {
  title: string
  label: string
  initial?: string
  submitLabel: string
  onCancel(): void
  onSubmit(value: string): void
}

/** 名前を1つだけ入れてもらう小さなダイアログ（Electron では window.prompt が使えないため） */
export function PromptDialog({ title, label, initial = '', submitLabel, onCancel, onSubmit }: Props) {
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (value.trim()) onSubmit(value.trim())
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
      <form className="dialog small" onSubmit={submit}>
        <h2>{title}</h2>
        <label>
          <span>{label}</span>
          <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="buttons">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit" className="primary" disabled={!value.trim()}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
