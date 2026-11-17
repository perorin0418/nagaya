import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_FONT, normalizeFont } from '@shared/font'
import { moveGroup, moveSession, removeGroup } from '@shared/layout'
import type {
  FontSetting,
  Layout,
  NewSessionInput,
  NewTabInput,
  SessionConfig,
  SessionGroup,
  SessionMeta,
  Settings,
  TabConfig,
  ThemeSetting,
} from '@shared/types'

const VERSION = 3

interface StoreFile {
  version: typeof VERSION
  groups: SessionGroup[]
  sessions: SessionConfig[]
  selectedId: string | null
  settings: Settings
}

const THEMES: ThemeSetting[] = ['system', 'light', 'dark']

const cloneSession = (s: SessionConfig): SessionConfig => ({ ...s, tabs: s.tabs.map((t) => ({ ...t })) })

/** セッション一覧・グループ・設定を JSON ファイルに保存する */
export class SessionStore {
  private data: StoreFile = {
    version: VERSION,
    groups: [],
    sessions: [],
    selectedId: null,
    settings: { theme: 'system', font: { ...DEFAULT_FONT } },
  }

  constructor(private readonly file: string) {
    this.load()
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>
      this.data = parseStore(raw)
      if (raw.version !== VERSION) this.save() // 古い形式なら新しい形式で書き直す
    } catch (e) {
      // 壊れていたら退避して空から始める
      console.error('セッション一覧を読めませんでした', e)
      try {
        renameSync(this.file, `${this.file}.broken-${Date.now()}`)
      } catch {
        /* 無視 */
      }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.file)
  }

  layout(): Layout {
    return {
      groups: this.data.groups.map((g) => ({ ...g })),
      sessions: this.data.sessions.map(cloneSession),
    }
  }

  private setLayout(l: Layout): Layout {
    this.data.groups = l.groups
    this.data.sessions = l.sessions
    this.save()
    return this.layout()
  }

  get(id: string): SessionConfig | undefined {
    return this.data.sessions.find((s) => s.id === id)
  }

  /** タブと、それを持つセッション */
  tab(tabId: string): { session: SessionConfig; tab: TabConfig } | undefined {
    for (const session of this.data.sessions) {
      const tab = session.tabs.find((t) => t.id === tabId)
      if (tab) return { session, tab }
    }
    return undefined
  }

  group(id: string): SessionGroup | undefined {
    return this.data.groups.find((g) => g.id === id)
  }

  get selectedId(): string | null {
    const id = this.data.selectedId
    return id && this.get(id) ? id : null
  }

  setSelected(id: string | null): void {
    if (this.data.selectedId === id) return
    this.data.selectedId = id
    this.save()
  }

  get settings(): Settings {
    return { ...this.data.settings, font: { ...this.data.settings.font } }
  }

  setTheme(theme: ThemeSetting): void {
    if (!THEMES.includes(theme)) return
    this.data.settings.theme = theme
    this.save()
  }

  setFont(font: FontSetting): void {
    this.data.settings.font = normalizeFont(font)
    this.save()
  }

  // ---- セッション ----

  create(input: NewSessionInput): SessionConfig {
    const s = normalizeSession({ ...input, tabs: [{ ...input.tab, id: randomUUID() }] }, randomUUID(), this.groupIds())
    this.data.sessions.push(s)
    this.save()
    return cloneSession(s)
  }

  /** 名前とグループを変える */
  update(id: string, meta: SessionMeta): Layout {
    const s = this.get(id)
    if (!s) throw new Error('セッションが見つかりません')
    s.name = meta.name.trim() || '無題'
    const groupId = meta.groupId && this.groupIds().has(meta.groupId) ? meta.groupId : null
    // グループを変えたら、移った先のグループの最後に並べる
    if (groupId !== s.groupId) return this.setLayout(moveSession(this.layout(), id, groupId, null))
    this.save()
    return this.layout()
  }

  /** タブごと写したセッションを、元のセッションのすぐ後ろに作る */
  duplicate(id: string, meta: SessionMeta): SessionConfig {
    const src = this.get(id)
    if (!src) throw new Error('セッションが見つかりません')
    const s = normalizeSession(
      { ...meta, tabs: src.tabs.map((t) => ({ ...t, id: randomUUID() })) },
      randomUUID(),
      this.groupIds(),
    )
    this.data.sessions.push(s)
    // 同じグループなら元のすぐ後ろ、違うグループならそのグループの最後
    const next = this.data.sessions[this.data.sessions.indexOf(src) + 1]
    const beforeId = s.groupId === src.groupId && next && next.groupId === src.groupId ? next.id : null
    this.setLayout(moveSession(this.layout(), s.id, s.groupId, beforeId === s.id ? null : beforeId))
    return cloneSession(this.get(s.id)!)
  }

  remove(id: string): void {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id)
    if (this.data.selectedId === id) this.data.selectedId = null
    this.save()
  }

  moveSession(id: string, groupId: string | null, beforeId: string | null): Layout {
    return this.setLayout(moveSession(this.layout(), id, groupId, beforeId))
  }

  // ---- タブ ----

  /** タブを足す（afterId のタブの後ろ。null なら最後） */
  addTab(sessionId: string, input: NewTabInput, afterId: string | null): TabConfig {
    const s = this.get(sessionId)
    if (!s) throw new Error('セッションが見つかりません')
    const tab = normalizeTab(input, randomUUID())
    const i = afterId ? s.tabs.findIndex((t) => t.id === afterId) : -1
    s.tabs.splice(i >= 0 ? i + 1 : s.tabs.length, 0, tab)
    this.save()
    return { ...tab }
  }

  updateTab(cfg: TabConfig): Layout {
    const found = this.tab(cfg.id)
    if (!found) throw new Error('タブが見つかりません')
    const tabs = found.session.tabs
    tabs[tabs.indexOf(found.tab)] = normalizeTab(cfg, cfg.id)
    this.save()
    return this.layout()
  }

  /** タブを閉じる（最後の1枚は閉じない） */
  removeTab(tabId: string): Layout {
    const found = this.tab(tabId)
    if (found && found.session.tabs.length > 1) {
      found.session.tabs = found.session.tabs.filter((t) => t.id !== tabId)
      this.save()
    }
    return this.layout()
  }

  // ---- グループ ----

  createGroup(name: string): SessionGroup {
    const g: SessionGroup = { id: randomUUID(), name: name.trim() || '新しいグループ', collapsed: false }
    this.data.groups.push(g)
    this.save()
    return { ...g }
  }

  renameGroup(id: string, name: string): Layout {
    const g = this.group(id)
    if (g && name.trim()) g.name = name.trim()
    this.save()
    return this.layout()
  }

  setGroupCollapsed(id: string, collapsed: boolean): Layout {
    const g = this.group(id)
    if (g) g.collapsed = collapsed
    this.save()
    return this.layout()
  }

  removeGroup(id: string): Layout {
    return this.setLayout(removeGroup(this.layout(), id))
  }

  moveGroup(id: string, beforeId: string | null): Layout {
    return this.setLayout(moveGroup(this.layout(), id, beforeId))
  }

  private groupIds(): Set<string> {
    return new Set(this.data.groups.map((g) => g.id))
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function normalizeTab(t: Partial<TabConfig>, id: string): TabConfig {
  return {
    id,
    name: str(t.name),
    host: str(t.host),
    command: str(t.command),
    cwd: str(t.cwd),
    agent: t.agent === undefined ? 'claude' : str(t.agent),
    autoReconnect: t.autoReconnect === undefined ? true : t.autoReconnect === true,
    reconnectCommand: str(t.reconnectCommand),
  }
}

/**
 * セッションを正しい形に直す。版 2 まで（タブがなく、ホストやコマンドをセッションが持っていた）は、
 * その設定のタブを1枚持つセッションにする
 */
export function normalizeSession(
  s: Partial<SessionConfig> & Partial<Omit<TabConfig, 'id' | 'name'>>,
  id: string,
  groupIds: Set<string>,
): SessionConfig {
  const groupId = typeof s.groupId === 'string' && groupIds.has(s.groupId) ? s.groupId : null
  const rawTabs = Array.isArray(s.tabs) ? s.tabs.filter((t) => t && typeof t === 'object') : []
  const seen = new Set<string>()
  const tabs = rawTabs.map((t) => {
    const tid = typeof t.id === 'string' && t.id && !seen.has(t.id) ? t.id : randomUUID()
    seen.add(tid)
    return normalizeTab(t, tid)
  })
  if (tabs.length === 0) {
    // 版 2 まで: セッションの設定をそのまま1枚目のタブにする
    const { name: _n, ...legacy } = s
    tabs.push(normalizeTab({ ...legacy, name: '' } as Partial<TabConfig>, randomUUID()))
  }
  return { id, name: str(s.name) || '無題', groupId, tabs }
}

/** 保存ファイルを読む。版 1（ホストでまとめていたころ）は、ホストごとのグループに移す */
export function parseStore(raw: Record<string, unknown>): StoreFile {
  type RawSession = Partial<SessionConfig> & Partial<Omit<TabConfig, 'id' | 'name'>> & { id: string }
  const rawSessions = (Array.isArray(raw.sessions) ? raw.sessions : []).filter(
    (s): s is RawSession => !!s && typeof (s as SessionConfig).id === 'string',
  )
  let groups: SessionGroup[]
  if (typeof raw.version === 'number' && raw.version >= 2 && Array.isArray(raw.groups)) {
    groups = (raw.groups as Partial<SessionGroup>[])
      .filter((g) => g && typeof g.id === 'string')
      .map((g) => ({ id: g.id!, name: str(g.name) || '無題', collapsed: g.collapsed === true }))
  } else {
    // 版 1: 同じホストのセッションを1つのグループにする（見た目を変えないため）
    groups = []
    const byHost = new Map<string, string>()
    for (const s of rawSessions) {
      const host = str(s.host)
      if (!host || byHost.has(host)) continue
      const id = randomUUID()
      byHost.set(host, id)
      groups.push({ id, name: host, collapsed: false })
    }
    for (const s of rawSessions) s.groupId = byHost.get(str(s.host)) ?? null
  }
  const ids = new Set(groups.map((g) => g.id))
  const settings = (raw.settings ?? {}) as Partial<Settings>
  return {
    version: VERSION,
    groups,
    sessions: rawSessions.map((s) => normalizeSession(s, s.id, ids)),
    selectedId: typeof raw.selectedId === 'string' ? raw.selectedId : null,
    settings: {
      theme: THEMES.includes(settings.theme as ThemeSetting) ? (settings.theme as ThemeSetting) : 'system',
      font: normalizeFont(settings.font),
    },
  }
}
