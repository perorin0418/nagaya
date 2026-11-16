/**
 * サイドバーの並び替え（純粋な関数）。main の保存処理と単体テストで使う。
 */
import type { Layout, SessionConfig, SessionGroup } from './types'

/**
 * セッションを groupId のグループへ移す。beforeId のセッションの前に入れる（null ならグループの最後）。
 * 並びは sessions 配列の順で表すので、配列の中での位置を決める。
 */
export function moveSession(layout: Layout, id: string, groupId: string | null, beforeId: string | null): Layout {
  const moving = layout.sessions.find((s) => s.id === id)
  if (!moving) return layout
  if (groupId !== null && !layout.groups.some((g) => g.id === groupId)) return layout
  if (beforeId === id) return layout
  const rest = layout.sessions.filter((s) => s.id !== id)
  const moved: SessionConfig = { ...moving, groupId }
  let index: number
  const before = beforeId ? rest.findIndex((s) => s.id === beforeId && s.groupId === groupId) : -1
  if (before >= 0) {
    index = before
  } else {
    // グループの最後のセッションの直後。グループが空なら配列の最後
    let last = -1
    rest.forEach((s, i) => {
      if (s.groupId === groupId) last = i
    })
    index = last >= 0 ? last + 1 : rest.length
  }
  rest.splice(index, 0, moved)
  return { ...layout, sessions: rest }
}

/** グループを beforeId のグループの前に移す（null なら最後） */
export function moveGroup(layout: Layout, id: string, beforeId: string | null): Layout {
  const moving = layout.groups.find((g) => g.id === id)
  if (!moving || beforeId === id) return layout
  const rest = layout.groups.filter((g) => g.id !== id)
  const i = beforeId ? rest.findIndex((g) => g.id === beforeId) : -1
  rest.splice(i >= 0 ? i : rest.length, 0, moving)
  return { ...layout, groups: rest }
}

/** グループを消す。中のセッションはグループなしになる */
export function removeGroup(layout: Layout, id: string): Layout {
  return {
    groups: layout.groups.filter((g) => g.id !== id),
    sessions: layout.sessions.map((s) => (s.groupId === id ? { ...s, groupId: null } : s)),
  }
}

export interface SidebarSection {
  /** null はグループなし */
  group: SessionGroup | null
  sessions: SessionConfig[]
}

/** サイドバーの表示順。グループの順に並べ、最後にグループなし（あれば） */
export function sections(layout: Layout): SidebarSection[] {
  const known = new Set(layout.groups.map((g) => g.id))
  const out: SidebarSection[] = layout.groups.map((g) => ({
    group: g,
    sessions: layout.sessions.filter((s) => s.groupId === g.id),
  }))
  const loose = layout.sessions.filter((s) => s.groupId === null || !known.has(s.groupId))
  if (loose.length > 0 || layout.groups.length === 0) out.push({ group: null, sessions: loose })
  return out
}
