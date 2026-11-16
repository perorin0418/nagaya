/**
 * 画面のテキストから状態を判定する純粋な関数群。
 * UI（xterm.js）や Electron には依存しない。単体テストはフィクスチャのテキストで行う。
 */
import type { AgentState, RuleFile, RuleSetFile } from './types'

export const DEFAULT_SCAN_LINES = 25
export const DEFAULT_STABLE_MS = 500

export interface CompiledRule {
  index: number
  name: string
  state: Exclude<AgentState, 'unknown'>
  anyOf: RegExp[]
  allOf: RegExp[]
  noneOf: RegExp[]
}

export interface CompiledRuleSet {
  agent: string
  scanLines: number
  stableMs: number
  rules: CompiledRule[]
}

export interface ScannedLine {
  /** 画面上の行番号（0 始まり） */
  row: number
  text: string
}

export interface PatternHit {
  kind: 'anyOf' | 'allOf'
  pattern: string
  row: number
  text: string
}

export interface DetectResult {
  state: AgentState
  /** 当たったルール（なければ null） */
  rule: { index: number; name: string } | null
  /** ルールを成立させたパターンと、当たった行 */
  hits: PatternHit[]
  /** 判定に使った行 */
  scanned: ScannedLine[]
}

const STATES = new Set(['working', 'blocked', 'idle'])

function compilePatterns(list: unknown, where: string, flags: string): RegExp[] {
  if (list === undefined) return []
  if (!Array.isArray(list)) throw new Error(`${where} は文字列の配列にしてください`)
  return list.map((p, i) => {
    if (typeof p !== 'string') throw new Error(`${where}[${i}] が文字列ではありません`)
    try {
      return new RegExp(p, flags)
    } catch (e) {
      throw new Error(`${where}[${i}] の正規表現が不正です: ${p} (${(e as Error).message})`)
    }
  })
}

/** ルールファイルの中身を検証し、正規表現をコンパイルする。不正なら日本語のメッセージで例外を投げる */
export function compileRuleSet(raw: unknown, source = 'ルール'): CompiledRuleSet {
  if (!raw || typeof raw !== 'object') throw new Error(`${source}: オブジェクトではありません`)
  const r = raw as RuleSetFile
  if (typeof r.agent !== 'string' || !r.agent) throw new Error(`${source}: agent がありません`)
  if (!Array.isArray(r.rules)) throw new Error(`${source}: rules は配列にしてください`)
  const scanLines = r.scanLines ?? DEFAULT_SCAN_LINES
  if (!Number.isInteger(scanLines) || scanLines < 1) throw new Error(`${source}: scanLines は 1 以上の整数にしてください`)
  const stableMs = r.stableMs ?? DEFAULT_STABLE_MS
  if (typeof stableMs !== 'number' || stableMs < 0) throw new Error(`${source}: stableMs は 0 以上の数にしてください`)

  const rules = r.rules.map((rule: RuleFile, index) => {
    const where = `${source}: rules[${index}]`
    if (!STATES.has(rule.state)) throw new Error(`${where}.state は working / blocked / idle のどれかにしてください`)
    // m: ^ $ を行頭・行末に。u: 絵文字や罫線を1文字として扱う
    const flags = 'mu' + (rule.ignoreCase ? 'i' : '')
    const compiled: CompiledRule = {
      index,
      name: rule.name ?? `rules[${index}] (${rule.state})`,
      state: rule.state,
      anyOf: compilePatterns(rule.anyOf, `${where}.anyOf`, flags),
      allOf: compilePatterns(rule.allOf, `${where}.allOf`, flags),
      noneOf: compilePatterns(rule.noneOf, `${where}.noneOf`, flags),
    }
    if (compiled.anyOf.length === 0 && compiled.allOf.length === 0) {
      throw new Error(`${where}: anyOf か allOf のどちらかが必要です`)
    }
    return compiled
  })
  return { agent: r.agent, scanLines, stableMs, rules }
}

/**
 * 判定に使う行を取り出す。画面の末尾の空行を除いたうえで、下から scanLines 行。
 * （起動直後など、画面の下の方が空のときにも中身のある行を見るため）
 */
export function selectScanLines(screen: string[], scanLines: number): ScannedLine[] {
  let end = screen.length
  while (end > 0 && screen[end - 1].trim() === '') end--
  const start = Math.max(0, end - scanLines)
  const out: ScannedLine[] = []
  for (let row = start; row < end; row++) out.push({ row, text: screen[row].replace(/\s+$/, '') })
  return out
}

/** パターンが当たった最初の行を探す（行をまたぐパターンにも対応するため、まず全体で探してから行を特定する） */
function findHit(re: RegExp, text: string, lines: ScannedLine[]): ScannedLine | null {
  re.lastIndex = 0
  const m = re.exec(text)
  if (!m) return null
  const before = text.slice(0, m.index)
  const lineIdx = before.split('\n').length - 1
  return lines[lineIdx] ?? null
}

/** 画面（行の配列）を判定する */
export function detect(screen: string[], ruleSet: CompiledRuleSet): DetectResult {
  const scanned = selectScanLines(screen, ruleSet.scanLines)
  const text = scanned.map((l) => l.text).join('\n')

  for (const rule of ruleSet.rules) {
    if (rule.noneOf.some((re) => findHit(re, text, scanned))) continue
    const hits: PatternHit[] = []
    let ok = true
    for (const re of rule.allOf) {
      const hit = findHit(re, text, scanned)
      if (!hit) {
        ok = false
        break
      }
      hits.push({ kind: 'allOf', pattern: re.source, row: hit.row, text: hit.text })
    }
    if (!ok) continue
    if (rule.anyOf.length > 0) {
      let any: PatternHit | null = null
      for (const re of rule.anyOf) {
        const hit = findHit(re, text, scanned)
        if (hit) {
          any = { kind: 'anyOf', pattern: re.source, row: hit.row, text: hit.text }
          break
        }
      }
      if (!any) continue
      hits.push(any)
    }
    return { state: rule.state, rule: { index: rule.index, name: rule.name }, hits, scanned }
  }
  return { state: 'unknown', rule: null, hits: [], scanned }
}

/** テキスト（改行区切り）をそのまま判定する。フィクスチャ用 */
export function detectText(text: string, ruleSet: CompiledRuleSet): DetectResult {
  return detect(text.replace(/\r\n/g, '\n').split('\n'), ruleSet)
}

/**
 * 状態がぱたぱた変わらないようにする。
 * 新しい判定が stableMs 以上続いたときだけ確定値を変える。
 */
export class Stabilizer {
  private candidate: AgentState
  private since: number
  current: AgentState

  constructor(
    public stableMs: number,
    initial: AgentState = 'unknown',
  ) {
    this.current = initial
    this.candidate = initial
    this.since = 0
  }

  /** 判定結果を入れる。確定値が変わったら新しい値を、変わらなければ null を返す */
  push(state: AgentState, now: number): AgentState | null {
    if (state !== this.candidate) {
      this.candidate = state
      this.since = now
    }
    if (this.candidate !== this.current && now - this.since >= this.stableMs) {
      this.current = this.candidate
      return this.current
    }
    return null
  }

  /** 確定待ちの候補があるか（タイマーを回し続ける必要があるか） */
  get pending(): boolean {
    return this.candidate !== this.current
  }

  reset(state: AgentState = 'unknown'): void {
    this.current = state
    this.candidate = state
    this.since = 0
  }
}
