import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { compileRuleSet } from '@shared/detect'
import type { RuleSetFile, RulesPayload } from '@shared/types'

/**
 * 判定ルールの読み込み。
 * 1. アプリに同梱のルール（bundledDir）
 * 2. 利用者のルール（userDir。同じ agent 名なら同梱のものを置き換える）
 * の順に読む。userDir の変更は監視して自動で読み直す。
 */
export class RulesLoader {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private current: RulesPayload

  constructor(
    private readonly bundledDir: string,
    readonly userDir: string,
  ) {
    this.current = this.load()
  }

  get(): RulesPayload {
    return this.current
  }

  reload(): RulesPayload {
    this.current = this.load()
    return this.current
  }

  private readDir(dir: string, errors: string[]): Map<string, RuleSetFile> {
    const out = new Map<string, RuleSetFile>()
    if (!existsSync(dir)) return out
    for (const f of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort()) {
      const path = join(dir, f)
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as RuleSetFile
        compileRuleSet(raw, f) // 検証だけ。renderer 側で改めてコンパイルする
        out.set(raw.agent, raw)
      } catch (e) {
        errors.push(`${path}: ${(e as Error).message}`)
      }
    }
    return out
  }

  private load(): RulesPayload {
    const errors: string[] = []
    const merged = this.readDir(this.bundledDir, errors)
    for (const [agent, rs] of this.readDir(this.userDir, errors)) merged.set(agent, rs)
    return { dir: this.userDir, ruleSets: [...merged.values()], errors }
  }

  /** 利用者のルールフォルダーを用意する（空なら同梱のルールを写す） */
  ensureUserDir(): void {
    mkdirSync(this.userDir, { recursive: true })
    const has = readdirSync(this.userDir).some((f) => f.toLowerCase().endsWith('.json'))
    if (!has && existsSync(this.bundledDir)) {
      for (const f of readdirSync(this.bundledDir).filter((f) => f.endsWith('.json'))) {
        copyFileSync(join(this.bundledDir, f), join(this.userDir, f))
      }
    }
  }

  watch(onChange: (p: RulesPayload) => void): void {
    mkdirSync(this.userDir, { recursive: true })
    try {
      this.watcher = watch(this.userDir, () => {
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => onChange(this.reload()), 300)
      })
    } catch (e) {
      console.error('ルールフォルダーを監視できません', e)
    }
  }

  close(): void {
    this.watcher?.close()
    if (this.timer) clearTimeout(this.timer)
  }
}
