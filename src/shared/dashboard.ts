/**
 * ダッシュボード（セッションを一覧して、その場で返事をする画面）で使う純粋な関数群。
 * UI（xterm.js）や Electron には依存しない。
 */
import type { AgentState } from './types'

/** 確認待ちの画面に出ている選択肢の1つ */
export interface Choice {
  /** 番号（押すキー） */
  key: string
  /** 選択肢の文言 */
  label: string
  /** カーソル（❯）が付いているか */
  current: boolean
}

/** 選択肢の行（「❯ 1. Yes」「  2. No」。枠（│）の中にあってもよい） */
const CHOICE_RE = /^\s*│?\s*(❯\s*)?(\d{1,2})\.\s+(.*?)\s*│?\s*$/u

/** 選択肢を探す範囲（画面の下から何行か） */
const CHOICE_SCAN_LINES = 30

/**
 * 画面の下の方から、番号付きの選択肢（1. 2. 3. …）を取り出す。
 * いちばん下にある、1 から順に並んだ組だけを返す（会話の中の番号付きの箇条書きを拾わないように）。
 * 見つからなければ空の配列。
 */
export function parseChoices(screen: string[]): Choice[] {
  const lines = trimTail(screen).slice(-CHOICE_SCAN_LINES)
  const found: { n: number; choice: Choice }[] = []
  for (const line of lines) {
    const m = CHOICE_RE.exec(line)
    if (!m) continue
    found.push({ n: Number(m[2]), choice: { key: m[2], label: m[3], current: !!m[1] } })
  }
  // 下から、番号が 1 ずつ減っていく組をたどる（間の説明の行は飛ばす）
  const out: Choice[] = []
  let want: number | null = null
  for (let i = found.length - 1; i >= 0; i--) {
    const f = found[i]
    if (want === null || f.n === want) {
      out.unshift(f.choice)
      if (f.n === 1) return out.length >= 2 ? out : []
      want = f.n - 1
    } else {
      // 番号が飛んだ: 組が途切れたので、ここから数え直す
      out.length = 0
      out.unshift(f.choice)
      if (f.n === 1) return []
      want = f.n - 1
    }
  }
  return []
}

/** 末尾の空行を除き、各行の右の空白も除く */
export function trimTail(screen: string[]): string[] {
  let end = screen.length
  while (end > 0 && screen[end - 1].trim() === '') end--
  return screen.slice(0, end).map((l) => l.replace(/\s+$/, ''))
}

/** ダッシュボードの絞り込み */
export type DashboardFilter = 'all' | 'blocked' | 'working' | 'idle' | 'unread'

/** 絞り込みに当たるか */
export function matchesFilter(filter: DashboardFilter, state: AgentState, unread: boolean): boolean {
  if (filter === 'all') return true
  if (filter === 'unread') return unread
  return state === filter
}

/**
 * Claude Code などのツールが動いているか。
 * 判定ルールで状態（作業中・確認待ち・入力待ち）が付いていれば、ツールの画面が出ているとみなす
 * （シェルのプロンプトや、ツールが終わった後の画面は「不明」になる）
 */
export function isToolActive(state: AgentState, conn?: 'running' | 'exited' | 'reconnecting'): boolean {
  return state !== 'unknown' && conn !== 'exited' && conn !== 'reconnecting'
}

/** カードのまとめ方 */
export type DashboardGrouping = 'none' | 'group' | 'session' | 'host' | 'state'

export const GROUPING_LABEL: Record<DashboardGrouping, string> = {
  none: 'まとめない',
  group: 'グループ',
  session: 'セッション',
  host: 'ホスト',
  state: '状態',
}

/** まとめるのに使う、カード1枚分の情報 */
export interface GroupableEntry {
  sessionId: string
  sessionName: string
  groupId: string | null
  groupName: string | null
  host: string
  state: AgentState
}

export interface EntryGroup<T> {
  key: string
  /** 見出し（まとめないときは空） */
  label: string
  items: T[]
}

/** 状態でまとめるときの並び（注意が要る順） */
const STATE_ORDER: AgentState[] = ['blocked', 'working', 'idle', 'unknown']
const STATE_GROUP_LABEL: Record<AgentState, string> = {
  blocked: '確認待ち',
  working: '作業中',
  idle: '入力待ち',
  unknown: 'ツールなし・不明',
}

/**
 * カードをまとめる。並びは渡した順（サイドバーの順）で、最初に出てきたまとまりから並べる。
 * 状態でまとめるときだけ、注意が要る順（確認待ち → 作業中 → 入力待ち → 不明）に並べる。
 * 空のまとまりは返さない
 */
export function groupEntries<T extends GroupableEntry>(items: T[], mode: DashboardGrouping): EntryGroup<T>[] {
  if (mode === 'none') return items.length > 0 ? [{ key: 'all', label: '', items }] : []
  const keyOf = (x: T): { key: string; label: string } => {
    switch (mode) {
      case 'group':
        return { key: x.groupId ?? '', label: x.groupName ?? 'グループなし' }
      case 'session':
        return { key: x.sessionId, label: x.sessionName }
      case 'host':
        return { key: x.host, label: x.host || 'ローカル' }
      case 'state':
        return { key: x.state, label: STATE_GROUP_LABEL[x.state] }
    }
  }
  const map = new Map<string, EntryGroup<T>>()
  for (const x of items) {
    const { key, label } = keyOf(x)
    let g = map.get(key)
    if (!g) {
      g = { key, label, items: [] }
      map.set(key, g)
    }
    g.items.push(x)
  }
  const groups = [...map.values()]
  if (mode === 'state') groups.sort((a, b) => STATE_ORDER.indexOf(a.key as AgentState) - STATE_ORDER.indexOf(b.key as AgentState))
  return groups
}
