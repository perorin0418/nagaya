// 開発用のスモークテスト（GUI のない環境で Xvfb の上で動かす）
//   xvfb-run -a npx electron --no-sandbox scripts/smoke.cjs <userData> <出力 png> [待つミリ秒] [explain | js:<コード>]
// out/ のアプリを起動し、数秒後に画面のスクリーンショットとサイドバーの状態を書き出して終わる。
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const path = require('node:path')
const [userData, png, waitMs = '9000', extra = ''] = process.argv.slice(process.argv.findIndex((a) => a.endsWith('smoke.cjs')) + 1)
app.setPath('userData', path.resolve(userData))
require(path.join(__dirname, '../out/main/index.js'))
app.whenReady().then(() => {
  setTimeout(async () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (extra === 'explain') {
      // 判定の詳細を開いてから撮る
      await win.webContents.executeJavaScript(`document.querySelector('.bar-actions button')?.click()`)
      await new Promise((r) => setTimeout(r, 500))
    } else if (extra.startsWith('js:')) {
      // 任意の操作をしてから撮る（ドラッグ＆ドロップの確認など）
      await win.webContents.executeJavaScript(extra.slice(3))
      await new Promise((r) => setTimeout(r, 500))
    }
    const img = await win.webContents.capturePage()
    writeFileSync(png, img.toPNG())
    const side = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.group-head, .sess')].map(e => (e.classList.contains('group-head') ? '[' + e.textContent + '] ' : '') + (e.classList.contains('sess') ? e.textContent : '')).join(' | ') +
        ' || badge=' + (document.querySelector('.bar .badge')?.textContent ?? '') +
        ' || screen=' + JSON.stringify([...document.querySelectorAll('.term-slot.visible .xterm-rows > div')].map(d => d.textContent.trim()).filter(Boolean).slice(-4))`,
    )
    console.log('SMOKE', side, '|| winTitle=' + win.getTitle())
    app.exit(0)
  }, Number(waitMs))
})
