/** 版の比較（GitHub のリリースのタグ「v0.3.0」とアプリの版「0.3.0」を比べる） */

/** 「v1.2.3」「1.2.3」を [1, 2, 3] にする。読めなければ null。プレリリース（-beta など）は null（通知しない） */
export function parseVersion(text: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** latest が current より新しいか。どちらかが読めなければ false */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/** GitHub の「最新のリリース」API の応答から、要るものだけを取り出す */
export interface ReleaseInfo {
  /** 「0.4.0」（先頭の v は外す） */
  version: string
  /** リリースのページ */
  url: string
}

export function parseRelease(json: unknown): ReleaseInfo | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (r.draft === true || r.prerelease === true) return null
  if (typeof r.tag_name !== 'string' || typeof r.html_url !== 'string') return null
  if (!parseVersion(r.tag_name)) return null
  if (!/^https:\/\/github\.com\//.test(r.html_url)) return null
  return { version: r.tag_name.trim().replace(/^v/, ''), url: r.html_url }
}
