#!/usr/bin/env node
// 端末の画面をテキストで保存する道具（フィクスチャ作り用。GUI のない Linux でも使える）
//
//   npm run capture -- [--out <フォルダー>] [--] <コマンド> [引数...]
//   例: npm run capture -- --out captures -- claude
//
// コマンドをいつもの端末と同じように操作できる。Ctrl+] を押すと、その時点の画面
// （nagaya が判定に使うのと同じ、いちばん下の 1 画面分）を <フォルダー>/screen-<番号>.txt に保存し、
// 同梱のルールでの判定結果を表示する。コマンドが終わると capture も終わる。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const pty = require('node-pty')
const { Terminal } = require('@xterm/headless')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let args = process.argv.slice(2)
let outDir = 'captures'
while (args.length) {
  if (args[0] === '--out') {
    outDir = args[1]
    args = args.slice(2)
  } else if (args[0] === '--') {
    args = args.slice(1)
    break
  } else break
}
if (args.length === 0) {
  console.error('使い方: npm run capture -- [--out <フォルダー>] [--] <コマンド> [引数...]')
  process.exit(2)
}

// 判定ロジックは TypeScript なので、ここでは簡易に正規表現だけを当てて結果を見せる
const rules = JSON.parse(readFileSync(join(root, 'rules/claude.json'), 'utf8'))
function judge(lines) {
  let end = lines.length
  while (end > 0 && lines[end - 1].trim() === '') end--
  const text = lines.slice(Math.max(0, end - (rules.scanLines ?? 25)), end).join('\n')
  for (const r of rules.rules) {
    const f = 'mu' + (r.ignoreCase ? 'i' : '')
    const t = (p) => new RegExp(p, f).test(text)
    if ((r.noneOf ?? []).some(t)) continue
    if (!(r.allOf ?? []).every(t)) continue
    if ((r.anyOf ?? []).length && !r.anyOf.some(t)) continue
    return `${r.state}（${r.name ?? ''}）`
  }
  return 'unknown'
}

const cols = process.stdout.columns || 100
const rows = process.stdout.rows || 30
const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 1000 })
const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
const p = pty.spawn(args[0], args.slice(1), { name: 'xterm-256color', cols, rows, cwd: process.cwd(), env })

p.onData((d) => {
  term.write(d)
  process.stdout.write(d)
})
p.onExit(({ exitCode }) => {
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
  process.exit(exitCode)
})
process.stdout.on('resize', () => {
  const c = process.stdout.columns
  const r = process.stdout.rows
  term.resize(c, r)
  p.resize(c, r)
})

let n = 0
function save() {
  const b = term.buffer.active
  const lines = []
  for (let i = 0; i < term.rows; i++) lines.push(b.getLine(b.baseY + i)?.translateToString(true) ?? '')
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `screen-${String(++n).padStart(3, '0')}.txt`)
  writeFileSync(file, lines.join('\n').replace(/\s+$/, '') + '\n')
  // 画面を壊さないよう、ウィンドウのタイトルに結果を出す
  process.stdout.write(`\x1b]0;capture: ${file} → ${judge(lines)}\x07`)
  saved.push(`${file} → ${judge(lines)}`)
}
const saved = []
process.on('exit', () => {
  if (saved.length) console.log(`\n保存した画面:\n${saved.map((s) => '  ' + s).join('\n')}`)
})

if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.on('data', (d) => {
  const s = d.toString('utf8')
  if (s.includes('\x1d')) {
    // Ctrl+]
    save()
    const rest = s.replaceAll('\x1d', '')
    if (rest) p.write(rest)
    return
  }
  p.write(s)
})
