/**
 * 分割の配置（純粋な関数）。main の保存処理・renderer の表示・単体テストで使う。
 *
 * セッションは分割の配置（PaneNode の木）をいくつか持てる。木の葉はタブ1枚で、
 * 同じ木に入っているタブは並べて表示する。どの木にも入っていないタブは、今までどおり1枚で表示する。
 * 1枚のタブが入る木は1つだけ。
 */
import type { PaneNode, SplitDir } from './types'

/** 区切りを動かせる範囲（片側がこれより狭くならないようにする） */
export const MIN_RATIO = 0.1
export const MAX_RATIO = 0.9

/** 分割の中での位置（根から a・b をたどる） */
export type PanePath = ('a' | 'b')[]

const clampRatio = (r: number): number =>
  Number.isFinite(r) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, r)) : 0.5

const isLeaf = (n: PaneNode): n is { tabId: string } => 'tabId' in n

/** 木に入っているタブ（左上から順に） */
export function leaves(n: PaneNode): string[] {
  return isLeaf(n) ? [n.tabId] : [...leaves(n.a), ...leaves(n.b)]
}

/** tabId のタブが入っている木（なければ undefined） */
export function findSplit(splits: PaneNode[], tabId: string): PaneNode | undefined {
  return splits.find((s) => leaves(s).includes(tabId))
}

/** 葉 tabId を置き換える（見つからなければそのまま） */
function replaceLeaf(n: PaneNode, tabId: string, f: (leaf: PaneNode) => PaneNode): PaneNode {
  if (isLeaf(n)) return n.tabId === tabId ? f(n) : n
  return { ...n, a: replaceLeaf(n.a, tabId, f), b: replaceLeaf(n.b, tabId, f) }
}

/**
 * tabId のタブを dir の向きに分割し、右（下）に newTabId のタブを置く。
 * tabId がまだどの木にも入っていなければ、2枚の木を新しく作る
 */
export function splitTab(splits: PaneNode[], tabId: string, newTabId: string, dir: SplitDir): PaneNode[] {
  const add = (leaf: PaneNode): PaneNode => ({ dir, ratio: 0.5, a: leaf, b: { tabId: newTabId } })
  const tree = findSplit(splits, tabId)
  if (!tree) return [...splits, add({ tabId })]
  return splits.map((s) => (s === tree ? replaceLeaf(s, tabId, add) : s))
}

/** 葉 tabId を外す。残った側が親の位置に上がる（葉しか残らなければ null） */
function removeLeaf(n: PaneNode, tabId: string): PaneNode | null {
  if (isLeaf(n)) return n.tabId === tabId ? null : n
  const a = removeLeaf(n.a, tabId)
  const b = removeLeaf(n.b, tabId)
  if (a === null) return b
  if (b === null) return a
  return { ...n, a, b }
}

/** tabId のタブを分割から外す（タブはそのまま残り、1枚で表示されるようになる） */
export function unsplitTab(splits: PaneNode[], tabId: string): PaneNode[] {
  return splits
    .map((s) => removeLeaf(s, tabId))
    .filter((s): s is PaneNode => s !== null && !isLeaf(s))
}

/** 分割の区切りを動かす（root はその木の最初のタブ、path は区切りの位置） */
export function setRatio(splits: PaneNode[], root: string, path: PanePath, ratio: number): PaneNode[] {
  const walk = (n: PaneNode, p: PanePath): PaneNode => {
    if (isLeaf(n)) return n
    if (p.length === 0) return { ...n, ratio: clampRatio(ratio) }
    const [head, ...rest] = p
    return head === 'a' ? { ...n, a: walk(n.a, rest) } : { ...n, b: walk(n.b, rest) }
  }
  return splits.map((s) => (leaves(s)[0] === root ? walk(s, path) : s))
}

/** タブの id を付け替える（セッションを複製したとき） */
export function renameTabs(splits: PaneNode[], map: Map<string, string>): PaneNode[] {
  const walk = (n: PaneNode): PaneNode =>
    isLeaf(n) ? { tabId: map.get(n.tabId) ?? n.tabId } : { ...n, a: walk(n.a), b: walk(n.b) }
  return splits.map(walk)
}

/**
 * 保存ファイルから読んだ分割を正しい形に直す。知らないタブ・2つ目以降に出てきたタブは外し、
 * タブが1枚しか残らない木は捨てる
 */
export function normalizeSplits(raw: unknown, tabIds: string[]): PaneNode[] {
  if (!Array.isArray(raw)) return []
  const known = new Set(tabIds)
  const seen = new Set<string>()
  const walk = (v: unknown, depth: number): PaneNode | null => {
    if (!v || typeof v !== 'object' || depth > 32) return null
    const o = v as Record<string, unknown>
    if (typeof o.tabId === 'string') {
      if (!known.has(o.tabId) || seen.has(o.tabId)) return null
      seen.add(o.tabId)
      return { tabId: o.tabId }
    }
    if (o.dir !== 'row' && o.dir !== 'column') return null
    const a = walk(o.a, depth + 1)
    const b = walk(o.b, depth + 1)
    if (a === null) return b
    if (b === null) return a
    return { dir: o.dir, ratio: clampRatio(typeof o.ratio === 'number' ? o.ratio : 0.5), a, b }
  }
  return raw.map((s) => walk(s, 0)).filter((s): s is PaneNode => s !== null && !isLeaf(s))
}

/** 表示の範囲（0〜1 の割合） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 区切り（ドラッグで動かす）。rect は区切りで分けている範囲全体 */
export interface Divider {
  path: PanePath
  dir: SplitDir
  rect: Rect
  ratio: number
}

/** 木を並べたときの、タブごとの範囲と区切り */
export function paneLayout(n: PaneNode): { panes: { tabId: string; rect: Rect }[]; dividers: Divider[] } {
  const panes: { tabId: string; rect: Rect }[] = []
  const dividers: Divider[] = []
  const walk = (node: PaneNode, rect: Rect, path: PanePath): void => {
    if (isLeaf(node)) {
      panes.push({ tabId: node.tabId, rect })
      return
    }
    dividers.push({ path, dir: node.dir, rect, ratio: node.ratio })
    if (node.dir === 'row') {
      const wa = rect.w * node.ratio
      walk(node.a, { ...rect, w: wa }, [...path, 'a'])
      walk(node.b, { ...rect, x: rect.x + wa, w: rect.w - wa }, [...path, 'b'])
    } else {
      const ha = rect.h * node.ratio
      walk(node.a, { ...rect, h: ha }, [...path, 'a'])
      walk(node.b, { ...rect, y: rect.y + ha, h: rect.h - ha }, [...path, 'b'])
    }
  }
  walk(n, { x: 0, y: 0, w: 1, h: 1 }, [])
  return { panes, dividers }
}
