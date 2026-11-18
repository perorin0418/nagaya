import { describe, expect, it } from 'vitest'
import {
  findSplit,
  leaves,
  normalizeSplits,
  paneLayout,
  renameTabs,
  setRatio,
  splitTab,
  unsplitTab,
} from '../src/shared/split'
import type { PaneNode } from '../src/shared/types'

describe('分割の配置', () => {
  it('分割していないタブを分けると、2枚の組ができる', () => {
    const s = splitTab([], 'a', 'b', 'row')
    expect(s).toEqual([{ dir: 'row', ratio: 0.5, a: { tabId: 'a' }, b: { tabId: 'b' } }])
    expect(findSplit(s, 'b')).toBe(s[0])
    expect(findSplit(s, 'x')).toBeUndefined()
  })

  it('組の中のタブを分けると、そのタブの場所が2つに分かれる', () => {
    let s = splitTab([], 'a', 'b', 'row')
    s = splitTab(s, 'b', 'c', 'column')
    expect(leaves(s[0])).toEqual(['a', 'b', 'c'])
    expect(s[0]).toMatchObject({ dir: 'row', b: { dir: 'column', a: { tabId: 'b' }, b: { tabId: 'c' } } })
  })

  it('組に入っていない別のタブを分けると、別の組になる', () => {
    let s = splitTab([], 'a', 'b', 'row')
    s = splitTab(s, 'x', 'y', 'column')
    expect(s.map(leaves)).toEqual([
      ['a', 'b'],
      ['x', 'y'],
    ])
  })

  it('分割から外すと、残った側が上がる。1枚しか残らない組は消える', () => {
    let s = splitTab([], 'a', 'b', 'row')
    s = splitTab(s, 'b', 'c', 'column')
    const without = unsplitTab(s, 'b')
    expect(without).toEqual([{ dir: 'row', ratio: 0.5, a: { tabId: 'a' }, b: { tabId: 'c' } }])
    expect(unsplitTab(without, 'c')).toEqual([])
  })

  it('区切りを動かす（端に寄りすぎないようにする）', () => {
    let s = splitTab([], 'a', 'b', 'row')
    s = splitTab(s, 'b', 'c', 'column')
    s = setRatio(s, 'a', [], 0.3)
    s = setRatio(s, 'a', ['b'], 0.99)
    expect(s[0]).toMatchObject({ ratio: 0.3, b: { ratio: 0.9 } })
    expect(setRatio(s, 'a', [], Number.NaN)[0]).toMatchObject({ ratio: 0.5 })
  })

  it('並べたときの範囲と区切り', () => {
    let s = splitTab([], 'a', 'b', 'row')
    s = splitTab(s, 'b', 'c', 'column')
    s = setRatio(s, 'a', [], 0.25)
    const { panes, dividers } = paneLayout(s[0])
    expect(panes).toEqual([
      { tabId: 'a', rect: { x: 0, y: 0, w: 0.25, h: 1 } },
      { tabId: 'b', rect: { x: 0.25, y: 0, w: 0.75, h: 0.5 } },
      { tabId: 'c', rect: { x: 0.25, y: 0.5, w: 0.75, h: 0.5 } },
    ])
    expect(dividers.map((d) => [d.path.join(''), d.dir])).toEqual([
      ['', 'row'],
      ['b', 'column'],
    ])
  })

  it('タブの id を付け替える', () => {
    const s = splitTab([], 'a', 'b', 'row')
    expect(leaves(renameTabs(s, new Map([['a', 'A']]))[0])).toEqual(['A', 'b'])
  })

  it('保存ファイルの分割を直す（知らないタブ・重なったタブ・壊れた値は外す）', () => {
    const raw: unknown = [
      {
        dir: 'row',
        ratio: 5,
        a: { tabId: 'a' },
        b: { dir: 'column', ratio: 0.5, a: { tabId: 'gone' }, b: { tabId: 'b' } },
      },
      { dir: 'row', ratio: 0.5, a: { tabId: 'a' }, b: { tabId: 'c' } },
      { dir: 'diagonal', a: { tabId: 'c' }, b: { tabId: 'd' } },
      'x',
    ]
    const want: PaneNode[] = [{ dir: 'row', ratio: 0.9, a: { tabId: 'a' }, b: { tabId: 'b' } }]
    expect(normalizeSplits(raw, ['a', 'b', 'c', 'd'])).toEqual(want)
    expect(normalizeSplits(undefined, ['a'])).toEqual([])
  })
})
