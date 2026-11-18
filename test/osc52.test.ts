import { describe, expect, it } from 'vitest'
import { decodeOsc52 } from '../src/shared/osc52'

const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64')

describe('decodeOsc52（OSC 52 のクリップボードへの書き込み）', () => {
  it('base64 を戻す', () => {
    expect(decodeOsc52(`c;${b64('hello')}`)).toBe('hello')
  })
  it('日本語や改行もそのまま', () => {
    expect(decodeOsc52(`c;${b64('長屋\nnagaya')}`)).toBe('長屋\nnagaya')
  })
  it('対象が空でもよい', () => {
    expect(decodeOsc52(`;${b64('x')}`)).toBe('x')
  })
  it('空の中身は空文字', () => {
    expect(decodeOsc52('c;')).toBe('')
  })
  it('読み出しの要求には応じない', () => {
    expect(decodeOsc52('c;?')).toBeNull()
  })
  it('壊れた値は捨てる', () => {
    expect(decodeOsc52('no-separator')).toBeNull()
    expect(decodeOsc52('c;***')).toBeNull()
  })
})
