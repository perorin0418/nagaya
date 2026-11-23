/**
 * 終了したときの端末の表示を、タブごとのファイルに残す（次に起動したときに出すため）。
 * 置き場は userData/screens/<タブの id>.json。
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SavedScreen } from '@shared/types'

/** タブの id として受け付ける形（ファイル名に使うので、パスの区切りなどを入れさせない） */
const ID = /^[A-Za-z0-9_-]{1,64}$/

export class ScreenStore {
  constructor(readonly dir: string) {}

  private file(id: string): string | null {
    return ID.test(id) ? join(this.dir, `${id}.json`) : null
  }

  load(id: string): SavedScreen | null {
    const f = this.file(id)
    if (!f) return null
    try {
      const raw = JSON.parse(readFileSync(f, 'utf8')) as Partial<SavedScreen>
      if (typeof raw.data !== 'string' || typeof raw.savedAt !== 'number') return null
      return { data: raw.data, savedAt: raw.savedAt }
    } catch {
      return null
    }
  }

  save(id: string, screen: SavedScreen): void {
    const f = this.file(id)
    if (!f) return
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(f, JSON.stringify(screen), 'utf8')
  }

  remove(id: string): void {
    const f = this.file(id)
    if (f) rmSync(f, { force: true })
  }

  /** keep に入っていないタブのファイルを消す（消したタブ・セッションの分） */
  prune(keep: Set<string>): void {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      return
    }
    for (const name of names) {
      const id = name.replace(/\.json$/, '')
      if (name.endsWith('.json') && !keep.has(id)) rmSync(join(this.dir, name), { force: true })
    }
  }

  /** すべて消す（保存をやめたとき） */
  clear(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}
