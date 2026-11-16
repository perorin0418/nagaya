import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { moveGroup, moveSession, removeGroup } from '@shared/layout'
import type { Layout, NewSessionInput, SessionConfig, SessionGroup, Settings, ThemeSetting } from '@shared/types'

interface StoreFile {
  version: 2
  groups: SessionGroup[]
  sessions: SessionConfig[]
  selectedId: string | null
  settings: Settings
}

const THEMES: ThemeSetting[] = ['system', 'light', 'dark']

/** セッション一覧・グループ・設定を JSON ファイルに保存する */
export class SessionStore {
  private data: StoreFile = { version: 2, groups: [], sessions: [], selectedId: null, settings: { theme: 'system' } }

  constructor(private readonly file: string) {
    this.load()
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>
      this.data = parseStore(raw)
      if (raw.version !== 2) this.save() // 古い形式なら新しい形式で書き直す
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
      sessions: this.data.sessions.map((s) => ({ ...s })),
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
    return { ...this.data.settings }
  }

  setTheme(theme: ThemeSetting): void {
    if (!THEMES.includes(theme)) return
    this.data.settings.theme = theme
    this.save()
  }

  // ---- セッション ----

  create(input: NewSessionInput): SessionConfig {
    const s = normalizeSession(input, randomUUID(), this.groupIds())
    this.data.sessions.push(s)
    this.save()
    return { ...s }
  }

  update(cfg: SessionConfig): void {
    const i = this.data.sessions.findIndex((s) => s.id === cfg.id)
    if (i < 0) throw new Error('セッションが見つかりません')
    const next = normalizeSession(cfg, cfg.id, this.groupIds())
    const prevGroup = this.data.sessions[i].groupId
    this.data.sessions[i] = next
    // グループを変えたら、移った先のグループの最後に並べる
    if (prevGroup !== next.groupId) {
      this.setLayout(moveSession(this.layout(), next.id, next.groupId, null))
    } else {
      this.save()
    }
  }

  remove(id: string): void {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id)
    if (this.data.selectedId === id) this.data.selectedId = null
    this.save()
  }

  moveSession(id: string, groupId: string | null, beforeId: string | null): Layout {
    return this.setLayout(moveSession(this.layout(), id, groupId, beforeId))
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

export function normalizeSession(s: Partial<SessionConfig>, id: string, groupIds: Set<string>): SessionConfig {
  const groupId = typeof s.groupId === 'string' && groupIds.has(s.groupId) ? s.groupId : null
  return {
    id,
    name: str(s.name) || '無題',
    host: str(s.host),
    groupId,
    command: str(s.command),
    cwd: str(s.cwd),
    agent: s.agent === undefined ? 'claude' : str(s.agent),
    autoReconnect: s.autoReconnect === undefined ? true : s.autoReconnect === true,
    reconnectCommand: str(s.reconnectCommand),
  }
}

/** 保存ファイルを読む。版 1（ホストでまとめていたころ）は、ホストごとのグループに移す */
export function parseStore(raw: Record<string, unknown>): StoreFile {
  const rawSessions = (Array.isArray(raw.sessions) ? raw.sessions : []).filter(
    (s): s is Partial<SessionConfig> & { id: string } => !!s && typeof (s as SessionConfig).id === 'string',
  )
  let groups: SessionGroup[]
  if (raw.version === 2 && Array.isArray(raw.groups)) {
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
    version: 2,
    groups,
    sessions: rawSessions.map((s) => normalizeSession(s, s.id, ids)),
    selectedId: typeof raw.selectedId === 'string' ? raw.selectedId : null,
    settings: { theme: THEMES.includes(settings.theme as ThemeSetting) ? (settings.theme as ThemeSetting) : 'system' },
  }
}
