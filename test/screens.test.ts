import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScreenStore } from '../src/main/screens'
import { parseStore, SessionStore } from '../src/main/store'

const newStore = (): ScreenStore => new ScreenStore(join(mkdtempSync(join(tmpdir(), 'nagaya-screens-')), 'screens'))
const ID_A = '0b5c2f1e-1111-4a4a-8888-000000000001'
const ID_B = '0b5c2f1e-1111-4a4a-8888-000000000002'

describe('ScreenStore（終了したときの表示）', () => {
  it('残したものを読める。残していなければ null', () => {
    const s = newStore()
    expect(s.load(ID_A)).toBeNull()
    s.save(ID_A, { data: '\x1b[31mred\x1b[0m', savedAt: 123 })
    expect(s.load(ID_A)).toEqual({ data: '\x1b[31mred\x1b[0m', savedAt: 123 })
  })

  it('ファイル名に使えない id は扱わない', () => {
    const s = newStore()
    s.save('../evil', { data: 'x', savedAt: 1 })
    expect(existsSync(s.dir)).toBe(false)
    expect(s.load('../evil')).toBeNull()
  })

  it('壊れたファイルは null', () => {
    const s = newStore()
    s.save(ID_A, { data: 'x', savedAt: 1 })
    writeFileSync(join(s.dir, `${ID_A}.json`), '{', 'utf8')
    expect(s.load(ID_A)).toBeNull()
  })

  it('prune は残すタブ以外を消し、remove・clear で消える', () => {
    const s = newStore()
    s.save(ID_A, { data: 'a', savedAt: 1 })
    s.save(ID_B, { data: 'b', savedAt: 1 })
    s.prune(new Set([ID_A]))
    expect(readdirSync(s.dir)).toEqual([`${ID_A}.json`])
    s.remove(ID_A)
    expect(readdirSync(s.dir)).toEqual([])
    s.save(ID_B, { data: 'b', savedAt: 1 })
    s.clear()
    expect(existsSync(s.dir)).toBe(false)
  })
})

describe('設定 keepScreen', () => {
  it('既定はオン。false のときだけオフ', () => {
    expect(parseStore({ version: 3, sessions: [] }).settings.keepScreen).toBe(true)
    expect(parseStore({ version: 3, sessions: [], settings: { keepScreen: false } }).settings.keepScreen).toBe(false)
  })

  it('setKeepScreen は保存され、tabIds はすべてのタブを返す', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nagaya-store-')), 'sessions.json')
    const st = new SessionStore(file)
    const { tabs } = st.create({
      name: 'x',
      groupId: null,
      tab: { name: '', host: '', command: '', cwd: '', agent: 'claude', autoReconnect: true, reconnectCommand: '' },
    })
    st.setKeepScreen(false)
    const again = new SessionStore(file)
    expect(again.settings.keepScreen).toBe(false)
    expect([...again.tabIds()]).toEqual([tabs[0].id])
  })
})
