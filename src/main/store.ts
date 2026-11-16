import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { NewSessionInput, SessionConfig } from '@shared/types'

interface StoreFile {
  version: 1
  sessions: SessionConfig[]
  selectedId: string | null
}

/** セッション一覧を JSON ファイルに保存する */
export class SessionStore {
  private data: StoreFile = { version: 1, sessions: [], selectedId: null }

  constructor(private readonly file: string) {
    this.load()
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoreFile>
      const sessions = Array.isArray(raw.sessions) ? raw.sessions.filter((s) => s && typeof s.id === 'string') : []
      this.data = {
        version: 1,
        sessions: sessions.map((s) => normalize(s, s.id)),
        selectedId: typeof raw.selectedId === 'string' ? raw.selectedId : null,
      }
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

  get path(): string {
    return this.file
  }

  list(): SessionConfig[] {
    return this.data.sessions.map((s) => ({ ...s }))
  }

  get(id: string): SessionConfig | undefined {
    return this.data.sessions.find((s) => s.id === id)
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

  create(input: NewSessionInput): SessionConfig {
    const s = normalize(input, randomUUID())
    this.data.sessions.push(s)
    this.save()
    return { ...s }
  }

  update(cfg: SessionConfig): void {
    const i = this.data.sessions.findIndex((s) => s.id === cfg.id)
    if (i < 0) throw new Error('セッションが見つかりません')
    this.data.sessions[i] = normalize(cfg, cfg.id)
    this.save()
  }

  remove(id: string): void {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id)
    if (this.data.selectedId === id) this.data.selectedId = null
    this.save()
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function normalize(s: Partial<SessionConfig>, id: string): SessionConfig {
  return {
    id,
    name: str(s.name) || '無題',
    host: str(s.host),
    command: str(s.command),
    cwd: str(s.cwd),
    agent: s.agent === undefined ? 'claude' : str(s.agent),
  }
}
