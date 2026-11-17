/**
 * 端末のフォントの設定（純粋な関数）。main の保存処理・renderer・単体テストで使う。
 */
import type { FontSetting } from './types'

/** 既定のフォント。指定したフォントにない文字（日本語など）もこれで出す */
export const DEFAULT_FONT_STACK = [
  '"Cascadia Mono"',
  'Consolas',
  '"BIZ UDGothic"',
  '"MS Gothic"',
  '"Noto Sans Mono CJK JP"',
  'ui-monospace',
  'monospace',
]

export const DEFAULT_FONT_SIZE = 13
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 32

export const DEFAULT_FONT: FontSetting = {
  family: '',
  size: DEFAULT_FONT_SIZE,
}

/** 選びやすいように候補に出すフォント名（入っていないものは既定のフォントで出る） */
export const FONT_SUGGESTIONS = [
  'Cascadia Mono',
  'Cascadia Code',
  'Consolas',
  'BIZ UDGothic',
  'MS Gothic',
  'HackGen Console NF',
  'PlemolJP Console',
  'UDEV Gothic',
  'Myrica M',
  'Source Han Code JP',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro',
  'Noto Sans Mono CJK JP',
  'Menlo',
  'SF Mono',
  'DejaVu Sans Mono',
  'Ubuntu Mono',
]

const GENERIC = new Set(['monospace', 'ui-monospace', 'serif', 'sans-serif', 'system-ui', 'cursive', 'fantasy'])

/** 保存されていた値を正しい形に直す */
export function normalizeFont(v: unknown): FontSetting {
  const f = (v && typeof v === 'object' ? v : {}) as Partial<FontSetting>
  const family = typeof f.family === 'string' ? f.family.trim() : ''
  const n = typeof f.size === 'number' && Number.isFinite(f.size) ? Math.round(f.size) : DEFAULT_FONT_SIZE
  return { family, size: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, n)) }
}

/**
 * xterm.js に渡す font-family を作る。利用者の書いたフォント名を引用符で囲み、後ろに既定のフォントを付ける
 * （入っていないフォントや、日本語のないフォントを選んでも文字が出るように）
 */
export function fontFamilyCss(family: string): string {
  const names = family
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => {
      if (/^(["']).*\1$/.test(n) || GENERIC.has(n.toLowerCase())) return n
      return `"${n.replace(/["\\]/g, '')}"`
    })
  const seen = new Set(names)
  return [...names, ...DEFAULT_FONT_STACK.filter((n) => !seen.has(n))].join(', ')
}
