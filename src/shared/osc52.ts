/**
 * OSC 52（クリップボード）の中身を読み、書き込む文字列を返す。
 * 形式は「<対象>;<base64>」（対象は c・p・s など。空でもよい）。
 * 読み出しの要求（?）や壊れた値には null を返す。
 */
export function decodeOsc52(data: string): string | null {
  const sep = data.indexOf(';')
  if (sep < 0) return null
  const payload = data.slice(sep + 1)
  if (payload === '?') return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null
  try {
    const bin = atob(payload)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}
