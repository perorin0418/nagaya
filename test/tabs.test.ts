import { describe, expect, it } from 'vitest'
import { hostsLabel, tabLabel, worstState } from '../src/shared/types'

describe('タブの表示', () => {
  it('タブの名前は、名前・ホスト・「ローカル」の順', () => {
    expect(tabLabel({ name: 'claude', host: 'linux-a' })).toBe('claude')
    expect(tabLabel({ name: '', host: 'linux-a' })).toBe('linux-a')
    expect(tabLabel({ name: '', host: '' })).toBe('ローカル')
  })

  it('サイドバーのホスト名は、重ならないホストが複数なら「最初 +残り」', () => {
    expect(hostsLabel([{ host: '' }])).toBe('')
    expect(hostsLabel([{ host: 'linux-a' }, { host: 'linux-a' }, { host: '' }])).toBe('linux-a')
    expect(hostsLabel([{ host: 'linux-a' }, { host: 'linux-b' }, { host: 'linux-c' }])).toBe('linux-a +2')
  })

  it('一番注意が要る状態', () => {
    expect(worstState([])).toBe('unknown')
    expect(worstState(['idle', 'working'])).toBe('working')
    expect(worstState(['working', 'blocked', 'idle'])).toBe('blocked')
  })
})
