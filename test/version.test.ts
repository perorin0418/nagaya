import { describe, expect, it } from 'vitest'
import { findWinZip, isNewer, parseRelease, parseVersion } from '../src/shared/version'

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
      winZip: null,
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

describe('findWinZip（Windows 用の zip を探す）', () => {
  const zip = {
    name: 'nagaya-0.5.0-win-x64.zip',
    size: 154785740,
    digest: 'sha256:4463DD9CDB6D7109289DBD6C1E7E2BADD6452F4F56979551CD172206002F9691',
    browser_download_url: 'https://github.com/perorin0418/nagaya/releases/download/v0.5.0/nagaya-0.5.0-win-x64.zip',
  }

  it('その版の zip を見つけ、SHA-256 を小文字にする', () => {
    expect(findWinZip([{ name: 'other.txt' }, zip], '0.5.0')).toEqual({
      name: 'nagaya-0.5.0-win-x64.zip',
      url: zip.browser_download_url,
      size: 154785740,
      sha256: '4463dd9cdb6d7109289dbd6c1e7e2badd6452f4f56979551cd172206002f9691',
    })
  })

  it('digest がなければ sha256 は null', () => {
    expect(findWinZip([{ ...zip, digest: undefined }], '0.5.0')?.sha256).toBeNull()
  })

  it('版の違う zip・よそからのダウンロード・大きさのないものは使わない', () => {
    expect(findWinZip([zip], '0.6.0')).toBeNull()
    expect(findWinZip([{ ...zip, browser_download_url: 'https://example.com/nagaya-0.5.0-win-x64.zip' }], '0.5.0')).toBeNull()
    expect(findWinZip([{ ...zip, size: 0 }], '0.5.0')).toBeNull()
    expect(findWinZip(undefined, '0.5.0')).toBeNull()
  })

  it('parseRelease でも読む', () => {
    const r = parseRelease({
      tag_name: 'v0.5.0',
      html_url: 'https://github.com/perorin0418/nagaya/releases/tag/v0.5.0',
      assets: [zip],
    })
    expect(r?.winZip?.name).toBe('nagaya-0.5.0-win-x64.zip')
  })
})
