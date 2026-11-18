import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseStore, SessionStore } from '../src/main/store'
import { leaves } from '../src/shared/split'

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

  it('分割は、知らないタブを外して読む（分割のない版 3 の保存ファイルは分割なし）', () => {
    const d = parseStore({
      version: 3,
      groups: [],
      sessions: [
        {
          id: 'a',
          name: 'x',
          groupId: null,
          tabs: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
          splits: [{ dir: 'row', ratio: 0.5, a: { tabId: 't1' }, b: { dir: 'column', ratio: 0.5, a: { tabId: 'gone' }, b: { tabId: 't3' } } }],
        },
        { id: 'b', name: 'y', groupId: null, tabs: [{ id: 'u1' }] },
      ],
    })
    expect(d.sessions[0].splits).toEqual([{ dir: 'row', ratio: 0.5, a: { tabId: 't1' }, b: { tabId: 't3' } }])
    expect(d.sessions[1].splits).toEqual([])
  })
})

describe('SessionStore の分割', () => {
  const tab = { name: '', host: '', command: '', cwd: '', agent: 'claude', autoReconnect: true, reconnectCommand: '' }
  const newStore = () => new SessionStore(join(mkdtempSync(join(tmpdir(), 'nagaya-test-')), 'sessions.json'))

  it('分割すると、タブが後ろに足され、組ができる', () => {
    const store = newStore()
    const s = store.create({ name: 's', groupId: null, tab })
    const a = s.tabs[0].id
    const b = store.splitTab(s.id, tab, a, 'row')
    const c = store.splitTab(s.id, tab, a, 'column')
    const got = store.get(s.id)!
    expect(got.tabs.map((t) => t.id)).toEqual([a, c.id, b.id])
    expect(leaves(got.splits[0])).toEqual([a, c.id, b.id])
  })

  it('タブを閉じると分割からも外れる。複製すると新しいタブの id で組ができる', () => {
    const store = newStore()
    const s = store.create({ name: 's', groupId: null, tab })
    const a = s.tabs[0].id
    const b = store.splitTab(s.id, tab, a, 'row')
    const dup = store.duplicate(s.id, { name: 'copy', groupId: null })
    expect(leaves(dup.splits[0])).toEqual(dup.tabs.map((t) => t.id))
    store.removeTab(b.id)
    expect(store.get(s.id)!.splits).toEqual([])
  })
})
