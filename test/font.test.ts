import { describe, expect, it } from 'vitest'
import { DEFAULT_FONT_SIZE, fontFamilyCss, MAX_FONT_SIZE, MIN_FONT_SIZE, normalizeFont } from '../src/shared/font'
import { parseStore } from '../src/main/store'

describe('normalizeFont（フォントの設定を直す）', () => {
  it('ないときは既定にする', () => {
    expect(normalizeFont(undefined)).toEqual({
      family: '',
      size: DEFAULT_FONT_SIZE,
    })
    expect(normalizeFont({ family: 3, size: 'x' })).toEqual({
      family: '',
      size: DEFAULT_FONT_SIZE,
    })
  })

  it('大きさは整数にして範囲に収める', () => {
    expect(normalizeFont({ family: ' Consolas ', size: 14.6 })).toEqual({
      family: 'Consolas',
      size: 15,
    })
    expect(normalizeFont({ size: 1 }).size).toBe(MIN_FONT_SIZE)
    expect(normalizeFont({ size: 999 }).size).toBe(MAX_FONT_SIZE)
  })

  it('保存ファイルにフォントがなければ既定にする', () => {
    expect(parseStore({ version: 2, settings: { theme: 'dark' } }).settings.font).toEqual({
      family: '',
      size: DEFAULT_FONT_SIZE,
    })
    expect(
      parseStore({
        version: 2,
        settings: { font: { family: 'HackGen', size: 16 } },
      }).settings.font,
    ).toEqual({
      family: 'HackGen',
      size: 16,
    })
  })
})

describe('fontFamilyCss（xterm.js に渡す font-family）', () => {
  it('空なら既定のフォントだけ', () => {
    expect(fontFamilyCss('')).toBe(
      '"Cascadia Mono", Consolas, "BIZ UDGothic", "MS Gothic", "Noto Sans Mono CJK JP", ui-monospace, monospace',
    )
  })

  it('名前を引用符で囲み、既定のフォントを後ろに付ける', () => {
    expect(fontFamilyCss('HackGen Console NF, monospace')).toBe(
      '"HackGen Console NF", monospace, "Cascadia Mono", Consolas, "BIZ UDGothic", "MS Gothic", "Noto Sans Mono CJK JP", ui-monospace',
    )
  })

  it('引用符で囲んだ名前はそのまま。名前の中の引用符は消す', () => {
    expect(fontFamilyCss("'My Font'").startsWith("'My Font', ")).toBe(true)
    expect(fontFamilyCss('a"b').startsWith('"ab", ')).toBe(true)
  })
})
