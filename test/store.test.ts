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
    expect(d.version).toBe(2)
    expect(d.groups.map((g) => g.name)).toEqual(['linux-a', 'linux-b'])
    const gid = (name: string) => d.groups.find((g) => g.name === name)!.id
    expect(d.sessions.map((s) => s.groupId)).toEqual([gid('linux-a'), gid('linux-b'), gid('linux-a'), null])
    expect(d.sessions.every((s) => s.autoReconnect)).toBe(true)
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
    expect(d.sessions[0].autoReconnect).toBe(false)
    expect(d.sessions[1].groupId).toBeNull()
    expect(d.settings.theme).toBe('dark')
  })
})
