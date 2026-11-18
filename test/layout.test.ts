import { describe, expect, it } from 'vitest'
import { moveGroup, moveSession, removeGroup, sections } from '../src/shared/layout'
import type { Layout, SessionConfig } from '../src/shared/types'

function s(id: string, groupId: string | null): SessionConfig {
  return {
    id,
    name: id,
    groupId,
    tabs: [
      { id: `${id}-t`, name: '', host: '', command: '', cwd: '', agent: 'claude', autoReconnect: true, reconnectCommand: '' },
    ],
    splits: [],
  }
}

const base: Layout = {
  groups: [
    { id: 'A', name: 'A', collapsed: false },
    { id: 'B', name: 'B', collapsed: false },
  ],
  sessions: [s('a1', 'A'), s('b1', 'B'), s('a2', 'A'), s('x', null)],
}

const order = (l: Layout) => sections(l).map((sec) => `${sec.group?.id ?? '-'}:${sec.sessions.map((x) => x.id).join(',')}`)

describe('sections', () => {
  it('グループの順に並べ、最後にグループなし', () => {
    expect(order(base)).toEqual(['A:a1,a2', 'B:b1', '-:x'])
  })
  it('グループがなければグループなしだけ', () => {
    expect(order({ groups: [], sessions: [] })).toEqual(['-:'])
  })
  it('存在しないグループのセッションはグループなしに出す', () => {
    expect(order({ groups: [], sessions: [s('z', 'gone')] })).toEqual(['-:z'])
  })
})

describe('moveSession', () => {
  it('別のグループの最後へ', () => {
    expect(order(moveSession(base, 'a1', 'B', null))).toEqual(['A:a2', 'B:b1,a1', '-:x'])
  })
  it('指定したセッションの前へ', () => {
    expect(order(moveSession(base, 'x', 'A', 'a2'))).toEqual(['A:a1,x,a2', 'B:b1'])
  })
  it('同じグループの中で並べ替え', () => {
    expect(order(moveSession(base, 'a2', 'A', 'a1'))).toEqual(['A:a2,a1', 'B:b1', '-:x'])
  })
  it('グループなしへ', () => {
    expect(order(moveSession(base, 'b1', null, null))).toEqual(['A:a1,a2', 'B:', '-:x,b1'])
  })
  it('空のグループへ', () => {
    const l = { ...base, groups: [...base.groups, { id: 'C', name: 'C', collapsed: false }] }
    expect(order(moveSession(l, 'x', 'C', null))).toEqual(['A:a1,a2', 'B:b1', 'C:x'])
  })
  it('存在しないグループへは移さない', () => {
    expect(moveSession(base, 'a1', 'nope', null)).toBe(base)
  })
})

describe('moveGroup / removeGroup', () => {
  it('グループの並べ替え', () => {
    expect(moveGroup(base, 'B', 'A').groups.map((g) => g.id)).toEqual(['B', 'A'])
    expect(moveGroup(base, 'A', null).groups.map((g) => g.id)).toEqual(['B', 'A'])
  })
  it('グループを消すと中身はグループなしになる', () => {
    expect(order(removeGroup(base, 'A'))).toEqual(['B:b1', '-:a1,a2,x'])
  })
})
