import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileRuleSet, detectText, selectScanLines, Stabilizer } from '../src/shared/detect'

const root = join(__dirname, '..')
const claude = compileRuleSet(JSON.parse(readFileSync(join(root, 'rules/claude.json'), 'utf8')), 'rules/claude.json')
const fixtures = join(__dirname, 'fixtures')

describe('フィクスチャ（フォルダー名 = 期待する状態）', () => {
  for (const state of ['blocked', 'working', 'idle', 'unknown'] as const) {
    for (const file of readdirSync(join(fixtures, state)).filter((f) => f.endsWith('.txt'))) {
      it(`${state}/${file}`, () => {
        const r = detectText(readFileSync(join(fixtures, state, file), 'utf8'), claude)
        expect(r.state, `当たったルール: ${r.rule?.name ?? 'なし'} / ${JSON.stringify(r.hits)}`).toBe(state)
      })
    }
  }
})

describe('selectScanLines', () => {
  it('末尾の空行を除いて下から数える', () => {
    const lines = selectScanLines(['a', 'b', 'c', '', '  '], 2)
    expect(lines).toEqual([
      { row: 1, text: 'b' },
      { row: 2, text: 'c' },
    ])
  })
})

describe('detect', () => {
  const rs = compileRuleSet({
    agent: 't',
    scanLines: 3,
    rules: [
      { state: 'blocked', allOf: ['^A', '^B'] },
      { state: 'working', anyOf: ['work'], noneOf: ['skip'] },
      { state: 'idle', anyOf: ['^>'], ignoreCase: true },
    ],
  })
  it('上から順に最初に当たったルールを採用する', () => {
    const r = detectText('A\nB\n> work', rs)
    expect(r.state).toBe('blocked')
    expect(r.rule?.index).toBe(0)
    expect(r.hits.map((h) => h.row)).toEqual([0, 1])
  })
  it('noneOf に当たるとそのルールは不成立', () => {
    expect(detectText('work skip\n> ', rs).state).toBe('idle')
  })
  it('scanLines より上の行は見ない', () => {
    expect(detectText('work\nx\ny\n> ', rs).state).toBe('idle')
  })
  it('どれにも当たらなければ unknown', () => {
    expect(detectText('hello', rs).state).toBe('unknown')
  })
})

describe('compileRuleSet', () => {
  it('不正な正規表現は日本語のエラーになる', () => {
    expect(() => compileRuleSet({ agent: 'x', rules: [{ state: 'idle', anyOf: ['('] }] })).toThrow(/正規表現が不正/)
  })
  it('不正な state はエラー', () => {
    expect(() => compileRuleSet({ agent: 'x', rules: [{ state: 'busy', anyOf: ['a'] }] })).toThrow(/state/)
  })
  it('anyOf も allOf もないルールはエラー', () => {
    expect(() => compileRuleSet({ agent: 'x', rules: [{ state: 'idle' }] })).toThrow(/anyOf か allOf/)
  })
})

describe('Stabilizer', () => {
  it('stableMs 続いたら確定する', () => {
    const s = new Stabilizer(500)
    expect(s.push('working', 0)).toBeNull()
    expect(s.push('working', 499)).toBeNull()
    expect(s.push('working', 500)).toBe('working')
    expect(s.current).toBe('working')
  })
  it('途中で変わったら数え直す', () => {
    const s = new Stabilizer(500)
    s.push('working', 0)
    s.push('idle', 300)
    expect(s.push('working', 600)).toBeNull()
    expect(s.push('working', 1100)).toBe('working')
  })
  it('元の状態に戻ったら確定待ちは解消される', () => {
    const s = new Stabilizer(500, 'idle')
    s.push('working', 0)
    expect(s.push('idle', 100)).toBeNull()
    expect(s.pending).toBe(false)
  })
})
