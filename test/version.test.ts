import { describe, expect, it } from 'vitest'
import { isNewer, parseRelease, parseVersion } from '../src/shared/version'

describe('parseVersion（版を読む）', () => {
  it('先頭の v はあってもなくてもよい', () => {
    expect(parseVersion('v0.3.0')).toEqual([0, 3, 0])
    expect(parseVersion('1.10.2')).toEqual([1, 10, 2])
  })

  it('プレリリースや形の違うものは読まない', () => {
    expect(parseVersion('v1.0.0-beta.1')).toBeNull()
    expect(parseVersion('1.0')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
  })
})

describe('isNewer（新しい版か）', () => {
  it('数として比べる', () => {
    expect(isNewer('v0.4.0', '0.3.0')).toBe(true)
    expect(isNewer('v0.10.0', '0.9.9')).toBe(true)
    expect(isNewer('v1.0.0', '0.99.99')).toBe(true)
  })

  it('同じ・古い・読めないときは false', () => {
    expect(isNewer('v0.3.0', '0.3.0')).toBe(false)
    expect(isNewer('v0.2.0', '0.3.0')).toBe(false)
    expect(isNewer('v0.4.0-beta', '0.3.0')).toBe(false)
  })
})

describe('parseRelease（GitHub の応答を読む）', () => {
  const base = {
    tag_name: 'v0.4.0',
    html_url: 'https://github.com/perorin0418/nagaya/releases/tag/v0.4.0',
    draft: false,
    prerelease: false,
  }

  it('版とページを取り出す', () => {
    expect(parseRelease(base)).toEqual({
      version: '0.4.0',
      url: 'https://github.com/perorin0418/nagaya/releases/tag/v0.4.0',
    })
  })

  it('下書き・プレリリース・github.com 以外のページは使わない', () => {
    expect(parseRelease({ ...base, draft: true })).toBeNull()
    expect(parseRelease({ ...base, prerelease: true })).toBeNull()
    expect(parseRelease({ ...base, html_url: 'https://example.com/' })).toBeNull()
    expect(parseRelease({ message: 'Not Found' })).toBeNull()
    expect(parseRelease(null)).toBeNull()
  })
})
