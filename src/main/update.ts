import { net } from 'electron'
import { isNewer, parseRelease, type ReleaseInfo } from '@shared/version'

const LATEST_URL = 'https://api.github.com/repos/perorin0418/nagaya/releases/latest'
/** 確かめる間隔（6時間） */
const INTERVAL_MS = 6 * 60 * 60 * 1000
/** 起動してから最初に確かめるまで（起動の邪魔をしない） */
const FIRST_DELAY_MS = 30 * 1000

export type CheckResult = { type: 'newer'; release: ReleaseInfo } | { type: 'latest' } | { type: 'error'; message: string }

/** GitHub のリリースを定期的に見て、新しい版が出ていたら onNewer を呼ぶ（同じ版では1回だけ） */
export class UpdateChecker {
  private timer: NodeJS.Timeout | null = null
  private notified: string | null = null
  /** 見つかった新しい版（メニューに出す） */
  latest: ReleaseInfo | null = null

  constructor(
    private readonly current: string,
    private readonly onNewer: (release: ReleaseInfo) => void,
  ) {}

  start(): void {
    if (this.timer) return
    const tick = (): void => void this.check()
    this.timer = setTimeout(() => {
      tick()
      this.timer = setInterval(tick, INTERVAL_MS)
    }, FIRST_DELAY_MS)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer) // setInterval の戻り値も clearTimeout で止まる
    this.timer = null
  }

  async check(): Promise<CheckResult> {
    let release: ReleaseInfo | null
    try {
      const res = await net.fetch(LATEST_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nagaya' },
        cache: 'no-store',
      })
      if (!res.ok) return { type: 'error', message: `GitHub が ${res.status} を返しました` }
      release = parseRelease(await res.json())
    } catch (e) {
      // オフラインなど。次の回にまた確かめる
      return { type: 'error', message: (e as Error).message }
    }
    if (!release || !isNewer(release.version, this.current)) return { type: 'latest' }
    this.latest = release
    if (this.notified !== release.version) {
      this.notified = release.version
      this.onNewer(release)
    }
    return { type: 'newer', release }
  }
}
