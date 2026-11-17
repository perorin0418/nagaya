import { describe, expect, it } from 'vitest'
import { parseStore } from '../src/main/store'

describe('parseStore（保存ファイルの読み込み）', () => {
  it('版 1 はホストごとのグループに移す', () => {
    const d = parseStore({
      version: 1,
      selectedId: 'b',
      sessions: [
        { id: 'a', name: 'myapp', host: 'linux-a', command: 'ssh linux-a', cwd: '', agent: 'claude' },
        { id: 'b', name: 'api', host: 'linux-b', command: '', cwd: '', agent: 'claude' },
        { id: 'c', name: 'docs', host: 'linux-a', command: '', cwd: '', agent: 'claude' },
        { id: 'd', name: 'local', host: '', command: '', cwd: '', agent: 'claude' },
      ],
    })
    expect(d.version).toBe(3)
    expect(d.groups.map((g) => g.name)).toEqual(['linux-a', 'linux-b'])
    const gid = (name: string) => d.groups.find((g) => g.name === name)!.id
    expect(d.sessions.map((s) => s.groupId)).toEqual([gid('linux-a'), gid('linux-b'), gid('linux-a'), null])
    expect(d.sessions.every((s) => s.tabs.length === 1 && s.tabs[0].autoReconnect)).toBe(true)
    expect(d.selectedId).toBe('b')
    expect(d.settings.theme).toBe('system')
  })

  it('版 2 はそのまま読む（知らないグループはグループなしにする）', () => {
    const d = parseStore({
      version: 2,
      groups: [{ id: 'g', name: 'リファクタリング', collapsed: true }],
      sessions: [
        { id: 'a', name: 'x', host: 'linux-a', groupId: 'g', autoReconnect: false },
        { id: 'b', name: 'y', host: 'linux-b', groupId: 'gone' },
      ],
      settings: { theme: 'dark' },
    })
    expect(d.groups).toEqual([{ id: 'g', name: 'リファクタリング', collapsed: true }])
    expect(d.sessions[0].groupId).toBe('g')
    expect(d.sessions[0].tabs[0].autoReconnect).toBe(false)
    expect(d.sessions[1].groupId).toBeNull()
    expect(d.settings.theme).toBe('dark')
  })
})

describe('タブ（版 3）', () => {
  it('版 2 のセッションは、その設定のタブを1枚持つセッションにする', () => {
    const d = parseStore({
      version: 2,
      groups: [],
      sessions: [
        {
          id: 'a',
          name: 'auth-api',
          host: 'linux-a',
          command: 'ssh linux-a',
          cwd: '~/w',
          agent: 'claude',
          autoReconnect: false,
          reconnectCommand: 'ssh linux-a --continue',
        },
      ],
    })
    expect(d.version).toBe(3)
    const s = d.sessions[0]
    expect(s).toMatchObject({ id: 'a', name: 'auth-api', groupId: null })
    expect(s).not.toHaveProperty('host')
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0]).toMatchObject({
      name: '',
      host: 'linux-a',
      command: 'ssh linux-a',
      cwd: '~/w',
      agent: 'claude',
      autoReconnect: false,
      reconnectCommand: 'ssh linux-a --continue',
    })
    expect(typeof s.tabs[0].id).toBe('string')
  })

  it('版 3 のタブはそのまま読む（id が重なっていたら振り直す）', () => {
    const d = parseStore({
      version: 3,
      groups: [],
      sessions: [
        {
          id: 'a',
          name: 'x',
          groupId: null,
          tabs: [
            { id: 't1', name: 'claude', host: 'linux-a', command: 'ssh linux-a' },
            { id: 't1', name: '', host: 'linux-b', agent: '' },
          ],
        },
      ],
    })
    const tabs = d.sessions[0].tabs
    expect(tabs.map((t) => t.host)).toEqual(['linux-a', 'linux-b'])
    expect(tabs[0].id).toBe('t1')
    expect(tabs[1].id).not.toBe('t1')
    expect(tabs[0].agent).toBe('claude')
    expect(tabs[1].agent).toBe('')
  })
})
