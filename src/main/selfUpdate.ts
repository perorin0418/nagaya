/**
 * 再起動して更新する（Windows の zip 版）。
 *
 * 1. リリースの zip を一時フォルダーにダウンロードし、大きさと SHA-256 を確かめる
 * 2. PowerShell のスクリプトを切り離して起動し、nagaya は終わる
 * 3. スクリプトは nagaya が終わるのを待って zip を展開し、今のフォルダーに上書きして、nagaya を起動し直す
 *    - 待っても nagaya のフォルダーの実行ファイル（nagaya.exe・OpenConsole.exe など）が残っていれば、強制終了する
 *    - 上書きのあと、nagaya.exe と app.asar が新しい版と同じか確かめる
 *    - 古い nagaya がまだ動いていれば、起動し直さない（二重起動の防止で新しい版がすぐ終わるため）
 * 4. 結果（ok・エラー）は userData/update-result.txt に書き、次に起動した nagaya が読む
 *
 * 前の版にしかないファイルは消さない（展開したフォルダーに利用者が置いたものを消さないように）。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net } from 'electron'
import type { ReleaseAsset } from '@shared/version'

/** 更新したあとの結果のファイル（スクリプトが書き、次に起動したときに読んで消す） */
const resultFile = (): string => join(app.getPath('userData'), 'update-result.txt')
const workDir = (): string => join(app.getPath('temp'), 'nagaya-update')

/** 再起動して更新できるか。できなければ、その理由 */
export function selfUpdateUnsupported(): string | null {
  if (process.platform !== 'win32') return 'Windows の版だけが対応しています'
  if (!app.isPackaged) return '開発中の起動では使えません'
  if (basename(process.execPath).toLowerCase() !== 'nagaya.exe') return '実行ファイルの名前が nagaya.exe ではありません'
  try {
    accessSync(dirname(process.execPath), constants.W_OK)
  } catch {
    return `nagaya のフォルダーに書き込めません（${dirname(process.execPath)}）`
  }
  return null
}

/** zip をダウンロードして確かめ、置いた場所を返す */
export async function downloadUpdate(asset: ReleaseAsset, onProgress: (ratio: number) => void): Promise<string> {
  const dir = workDir()
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const file = join(dir, asset.name)
  const res = await net.fetch(asset.url, { headers: { 'User-Agent': 'nagaya' }, cache: 'no-store' })
  if (!res.ok || !res.body) throw new Error(`ダウンロードできませんでした（${res.status}）`)
  const hash = createHash('sha256')
  let received = 0
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>)
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    received += chunk.length
    onProgress(Math.min(received / asset.size, 1))
  })
  await pipeline(body, createWriteStream(file))
  if (received !== asset.size) throw new Error(`大きさが合いません（${received} / ${asset.size} バイト）`)
  if (asset.sha256 && hash.digest('hex') !== asset.sha256) throw new Error('SHA-256 が合いません（ダウンロードが壊れています）')
  return file
}

// スクリプトは ASCII だけで書く（Windows PowerShell 5.1 は BOM のない .ps1 を UTF-8 として読まない）
const SCRIPT = String.raw`param(
  [int]$ProcId,
  [string]$Zip,
  [string]$Dest,
  [string]$Exe,
  [string]$Result,
  [string]$Version
)
$ErrorActionPreference = 'Stop'
$log = Join-Path (Split-Path $Zip) 'update.log'
function Log($m) { Add-Content -LiteralPath $log -Value ("[" + (Get-Date -Format s) + "] " + $m) -Encoding UTF8 }
# processes whose executable is under the nagaya folder (nagaya.exe, OpenConsole.exe, winpty-agent.exe, ...)
$prefix = $Dest.TrimEnd('\') + '\'
function Left {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Id -ne $PID -and $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
  })
}
try {
  Log "wait for pid $ProcId"
  try { Wait-Process -Id $ProcId -Timeout 60 -ErrorAction Stop } catch { }
  # wait for the other processes (renderer, gpu, console hosts, ...) to exit
  for ($i = 0; $i -lt 20; $i++) {
    if ((Left).Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }
  # (1) force-kill what is still running; otherwise the files stay locked and the old version keeps running
  $left = Left
  if ($left.Count -gt 0) {
    foreach ($p in $left) {
      Log ("kill " + $p.Name + " (pid " + $p.Id + ", " + $p.Path + ")")
      try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { Log ("kill failed: " + $_) }
    }
    for ($i = 0; $i -lt 20; $i++) {
      if ((Left).Count -eq 0) { break }
      Start-Sleep -Milliseconds 500
    }
    $left = Left
    if ($left.Count -gt 0) {
      throw ("processes are still running: " + (($left | ForEach-Object { $_.Name + " (pid " + $_.Id + ")" }) -join ", "))
    }
  }
  $stage = Join-Path (Split-Path $Zip) 'stage'
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  Log "expand $Zip"
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  # tar.exe (Windows 10 1803+) is much faster than Expand-Archive
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  $expanded = $false
  if (Test-Path -LiteralPath $tar) {
    & $tar -xf $Zip -C $stage
    $expanded = ($LASTEXITCODE -eq 0)
    if (-not $expanded) { Log "tar failed ($LASTEXITCODE), use Expand-Archive" }
  }
  if (-not $expanded) { Expand-Archive -LiteralPath $Zip -DestinationPath $stage -Force }
  $src = $stage
  if (-not (Test-Path -LiteralPath (Join-Path $src 'nagaya.exe'))) {
    $dirs = @(Get-ChildItem -LiteralPath $stage -Directory)
    if ($dirs.Count -eq 1) { $src = $dirs[0].FullName }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $src 'nagaya.exe'))) { throw 'nagaya.exe was not found in the zip' }
  Log "copy $src -> $Dest"
  & robocopy $src $Dest /E /R:20 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw ("robocopy failed (exit code " + $LASTEXITCODE + ")") }
  # (3) make sure the main files were really replaced
  foreach ($rel in @('nagaya.exe', 'resources\app.asar')) {
    $a = Join-Path $src $rel
    if (-not (Test-Path -LiteralPath $a)) { continue }
    $b = Join-Path $Dest $rel
    if (-not (Test-Path -LiteralPath $b)) { throw ($rel + " was not copied") }
    if ((Get-FileHash -LiteralPath $a -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $b -Algorithm SHA256).Hash) {
      throw ($rel + " was not replaced (still the old version)")
    }
  }
  Set-Content -LiteralPath $Result -Value ("ok " + $Version) -Encoding UTF8
  Log "done"
} catch {
  Log ("error: " + $_)
  Set-Content -LiteralPath $Result -Value ("error " + $_ + " (log: " + $log + ")") -Encoding UTF8
}
# (3) do not start nagaya while an old one is still running (the new one would exit at the single instance lock)
$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Exe })
if ($running.Count -gt 0) {
  Log ("not started: nagaya is still running (pid " + (($running | ForEach-Object { $_.Id }) -join ", ") + ")")
} else {
  Start-Process -FilePath $Exe
  Log "started $Exe"
}
`

/** 更新のスクリプトを切り離して起動する（この後 nagaya を終わらせること） */
export function launchUpdater(zip: string, version: string): void {
  const script = join(dirname(zip), 'update.ps1')
  writeFileSync(script, SCRIPT, 'ascii')
  rmSync(resultFile(), { force: true })
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      script,
      '-ProcId',
      String(process.pid),
      '-Zip',
      zip,
      '-Dest',
      dirname(process.execPath),
      '-Exe',
      process.execPath,
      '-Result',
      resultFile(),
      '-Version',
      version,
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  )
  child.unref()
}

export type UpdateResult = { type: 'ok'; version: string } | { type: 'error'; message: string }

/** 前回の更新の結果を読んで消す（なければ null） */
export function takeUpdateResult(): UpdateResult | null {
  let text: string
  try {
    text = readFileSync(resultFile(), 'utf8').replace(/^﻿/, '').trim()
  } catch {
    return null
  }
  rmSync(resultFile(), { force: true })
  if (text.startsWith('ok ')) {
    // うまくいったら、ダウンロードした zip などを片付ける（失敗したときはログを見られるように残す）
    rmSync(workDir(), { recursive: true, force: true })
    return { type: 'ok', version: text.slice(3).trim() }
  }
  return { type: 'error', message: text.replace(/^error\s*/, '') }
}
