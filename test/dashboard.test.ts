import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { groupEntries, isToolActive, matchesFilter, parseChoices } from '../src/shared/dashboard'
import type { AgentState } from '../src/shared/types'

const fixture = (name: string): string[] =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8').replace(/\r\n/g, '\n').split('\n')

describe('parseChoices（確認待ちの画面のフィクスチャ）', () => {
  it('編集の許可', () => {
    expect(parseChoices(fixture('blocked/edit-permission.txt'))).toEqual([
      { key: '1', label: 'Yes', current: true },
      { key: '2', label: 'Yes, allow all edits during this session (shift+tab)', current: false },
      { key: '3', label: 'No, and tell Claude what to do differently (esc)', current: false },
    ])
  })

  it('カーソルが 2 番目にある', () => {
    const c = parseChoices(fixture('blocked/bash-permission-cursor-on-2.txt'))
    expect(c.map((x) => x.key)).toEqual(['1', '2', '3'])
    expect(c.map((x) => x.current)).toEqual([false, true, false])
  })

  it('質問（選択肢の下に説明の行がある）', () => {
    expect(parseChoices(fixture('blocked/ask-user-question.txt')).map((x) => x.label)).toEqual([
      'Cookie',
      'localStorage',
      'Type something.',
    ])
  })

  it('フォルダーの信頼', () => {
    expect(parseChoices(fixture('blocked/trust-folder.txt')).map((x) => x.label)).toEqual(['Yes, proceed', 'No, exit'])
  })

  it('ログイン方法（中黒を含む）', () => {
    expect(parseChoices(fixture('blocked/real-v2.1.325-login-method.txt'))).toHaveLength(3)
  })
})

describe('parseChoices', () => {
  it('枠（│）の中の選択肢', () => {
    const screen = ['│ Do you want to proceed?        │', '│ ❯ 1. Yes                       │', '│   2. No                        │']
    expect(parseChoices(screen)).toEqual([
      { key: '1', label: 'Yes', current: true },
      { key: '2', label: 'No', current: false },
    ])
  })

  it('いちばん下の組だけを返す（上の箇条書きは拾わない）', () => {
    const screen = ['1. 調べる', '2. 直す', '', 'Do you want to proceed?', '❯ 1. Yes', '  2. No', '']
    expect(parseChoices(screen).map((x) => x.label)).toEqual(['Yes', 'No'])
  })

  it('1 から始まっていなければ空', () => {
    expect(parseChoices(['  2. b', '  3. c'])).toEqual([])
  })

  it('選択肢が1つだけなら空', () => {
    expect(parseChoices(['❯ 1. Yes'])).toEqual([])
  })

  it('選択肢がなければ空', () => {
    expect(parseChoices(['> ', '? for shortcuts'])).toEqual([])
  })
})

describe('matchesFilter', () => {
  it('状態と未読で絞り込む', () => {
    expect(matchesFilter('all', 'unknown', false)).toBe(true)
    expect(matchesFilter('blocked', 'blocked', false)).toBe(true)
    expect(matchesFilter('blocked', 'idle', true)).toBe(false)
    expect(matchesFilter('unread', 'idle', true)).toBe(true)
    expect(matchesFilter('unread', 'blocked', false)).toBe(false)
  })
})

describe('isToolActive', () => {
  it('状態が付いていて、終了・再接続中でなければ動いている', () => {
    expect(isToolActive('working')).toBe(true)
    expect(isToolActive('blocked', 'running')).toBe(true)
    expect(isToolActive('idle', 'running')).toBe(true)
    expect(isToolActive('unknown', 'running')).toBe(false)
    expect(isToolActive('idle', 'exited')).toBe(false)
    expect(isToolActive('working', 'reconnecting')).toBe(false)
  })
})

describe('groupEntries', () => {
  const e = (sessionId: string, groupId: string | null, host: string, state: AgentState) => ({
    sessionId,
    sessionName: `s-${sessionId}`,
    groupId,
    groupName: groupId ? `g-${groupId}` : null,
    host,
    state,
  })
  const items = [e('1', 'a', 'h1', 'idle'), e('2', null, '', 'blocked'), e('3', 'a', 'h2', 'unknown'), e('3', 'a', 'h1', 'working')]

  it('まとめない', () => {
    expect(groupEntries(items, 'none')).toEqual([{ key: 'all', label: '', items }])
    expect(groupEntries([], 'none')).toEqual([])
  })

  it('グループ（最初に出てきた順。グループなしも1つのまとまり）', () => {
    const g = groupEntries(items, 'group')
    expect(g.map((x) => [x.label, x.items.length])).toEqual([
      ['g-a', 3],
      ['グループなし', 1],
    ])
  })

  it('セッション', () => {
    expect(groupEntries(items, 'session').map((x) => [x.label, x.items.length])).toEqual([
      ['s-1', 1],
      ['s-2', 1],
      ['s-3', 2],
    ])
  })

  it('ホスト（空はローカル）', () => {
    expect(groupEntries(items, 'host').map((x) => [x.label, x.items.length])).toEqual([
      ['h1', 2],
      ['ローカル', 1],
      ['h2', 1],
    ])
  })

  it('状態（注意が要る順）', () => {
    expect(groupEntries(items, 'state').map((x) => x.label)).toEqual(['確認待ち', '作業中', '入力待ち', 'ツールなし・不明'])
  })
})
