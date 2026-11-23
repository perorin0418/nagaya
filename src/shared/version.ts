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
  /** Windows 用の zip（なければ null。再起動して更新するときに使う） */
  winZip: ReleaseAsset | null
}

export interface ReleaseAsset {
  name: string
  /** ダウンロードの URL（このリポジトリのリリースのものだけ） */
  url: string
  size: number
  /** SHA-256（16進の小文字。GitHub が出していなければ null） */
  sha256: string | null
}

const DOWNLOAD_PREFIX = 'https://github.com/perorin0418/nagaya/releases/download/'

/** リリースの添付から、その版の Windows 用の zip（nagaya-<版>-win-x64.zip）を探す */
export function findWinZip(assets: unknown, version: string): ReleaseAsset | null {
  if (!Array.isArray(assets)) return null
  const name = `nagaya-${version}-win-x64.zip`
  for (const a of assets) {
    if (!a || typeof a !== 'object') continue
    const r = a as Record<string, unknown>
    if (r.name !== name || typeof r.browser_download_url !== 'string') continue
    if (!r.browser_download_url.startsWith(DOWNLOAD_PREFIX)) continue
    if (typeof r.size !== 'number' || !(r.size > 0)) continue
    const m = typeof r.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(r.digest) : null
    return { name, url: r.browser_download_url, size: r.size, sha256: m ? m[1].toLowerCase() : null }
  }
  return null
}

export function parseRelease(json: unknown): ReleaseInfo | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (r.draft === true || r.prerelease === true) return null
  if (typeof r.tag_name !== 'string' || typeof r.html_url !== 'string') return null
  if (!parseVersion(r.tag_name)) return null
  if (!/^https:\/\/github\.com\//.test(r.html_url)) return null
  const version = r.tag_name.trim().replace(/^v/, '')
  return { version, url: r.html_url, winZip: findWinZip(r.assets, version) }
}
