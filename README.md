# nagaya

複数のマシン上で動く Claude Code のセッションを1つのウィンドウに並べ、それぞれの状態
（作業中・確認待ち・入力待ち）をひと目で分かるようにするデスクトップアプリ。

名前は「長屋」。作者の別ツール [koya](https://github.com/perorin0418/koya)（小屋）が並んだもの、という意味。

```
┌ セッション      [+] ┬ linux-a / myapp   ssh linux-a -t koya run claude -- claude   [確認待ち] ┐
│ linux-a             │                                                                      │
│  ● myapp   blocked  │  Do you want to make this edit to auth.ts?                           │
│  ● api     working  │  ❯ 1. Yes                                                            │
│ linux-b             │    2. Yes, allow all edits this session                              │
│  ● infra   idle     │    3. No, and tell Claude what to do differently                     │
└─────────────────────┴──────────────────────────────────────────────────────────────────────┘
  ● 黄 = blocked（確認待ち・通知を出す）  ● 青 = working（作業中）  ● 灰 = idle（入力待ち）
```

- 左のサイドバーにホストごとにセッションが並び、状態の色の点が付く
- セッションを選ぶと右側にその端末（xterm.js）が出る。切り替えても裏のセッションは動き続ける
- 確認待ちになったら通知を出す。通知をクリックするとそのセッションに切り替わる
- 状態は **端末に流れてくる画面そのもの** から判定する。間に SSH・koya・コンテナが何段挟まっていても判定できる

## 使い方

1. 左上の「+」（または Ctrl+Shift+T）で新しいセッションを作る
   - **名前**: サイドバーに出す名前
   - **ホスト**: サイドバーのまとまりに使う名前（空なら「ローカル」）。入れると「`ssh <ホスト> -t koya run claude -- claude` を入れる」ボタンが出る
   - **コマンド**: 実行するコマンド。空ならシェル（Windows は PowerShell、それ以外はログインシェル）。シェル経由で実行するので、引用符や PATH はふつうに使える
   - **作業ディレクトリ**: 空ならホーム
   - **判定ルール**: ふつうは `claude`
2. セッションの右クリックで「編集・再起動・削除」
3. プロセスが終わった端末で Enter を押すと起動し直す
4. セッション一覧は保存され、次に起動したときに復元される（中のプロセスは起動し直し）

| 操作 | キー |
|---|---|
| 新しいセッション | Ctrl+Shift+T |
| 次 / 前のセッション | Ctrl+Tab / Ctrl+Shift+Tab |
| 判定の詳細を表示 | Ctrl+Shift+D |
| 画面をテキストで保存 | Ctrl+Shift+S |
| ルールを再読み込み | Ctrl+Shift+R |
| コピー | 選択して Ctrl+C（選択がなければ ^C を送る）、Ctrl+Shift+C、右クリック |
| 貼り付け | Ctrl+V、Ctrl+Shift+V、右クリック（選択がないとき） |
| 入力欄で改行 | Shift+Enter |

（macOS では Ctrl の代わりに Cmd。コピー・貼り付けは Cmd+C / Cmd+V）

設定ファイルの場所（Electron の `userData`）:

- Windows: `%APPDATA%\nagaya\`
- macOS: `~/Library/Application Support/nagaya/`
- Linux: `~/.config/nagaya/`

ここに `sessions.json`（セッション一覧）と `rules/`（利用者の判定ルール）が置かれる。

## 状態の判定

| 状態 | 意味 | 印 |
|---|---|---|
| `working` | Claude Code が作業中 | 青 |
| `blocked` | 許可・質問への回答待ち | 黄（通知を出す） |
| `idle` | 入力待ち | 灰 |
| `unknown` | Claude Code の画面と判定できない（シェルにいる、接続中など） | なし |

仕組み:

1. xterm.js が持つ「今の画面」（スクロールバックを除いた一番下の1画面分）を 200ms ごとに読む（画面が更新されたセッションだけ）
2. 末尾の空行を除いたうえで **下から `scanLines` 行だけ** を見る（会話の本文に同じ文字列があっても誤判定しないように）
3. ルールを上から順に当て、最初に当たったものを採用する。どれにも当たらなければ `unknown`
4. 同じ判定が `stableMs`（既定 500ms）続いたら確定する（ぱたぱた変わらないように）
5. 確定した状態が `blocked` に変わったとき、そのセッションを見ていなければ（裏にある、またはウィンドウが前面にない）通知を出す。ウィンドウのタイトルにも確認待ちの数が出る

非表示のセッションも判定を続ける。

### 判定の詳細（デバッグ）

ヘッダーの「判定の詳細」（Ctrl+Shift+D）で、判定に使った行・当たったルール・当たった行（色付き）・確定した状態を表示する。
herdr の `agent explain` に相当する。

### ルールファイルの書き方

ルールは JSON ファイル。同梱の [rules/claude.json](rules/claude.json):

```json
{
  "agent": "claude",
  "scanLines": 25,
  "stableMs": 500,
  "rules": [
    {
      "name": "選択肢（許可の確認・質問・フォルダーの信頼）",
      "state": "blocked",
      "anyOf": ["^\\s*❯\\s*\\d+\\.\\s", "Enter to select"]
    },
    {
      "name": "作業中（esc to interrupt）",
      "state": "working",
      "anyOf": ["esc to interrupt"],
      "ignoreCase": true
    },
    {
      "name": "入力欄",
      "state": "idle",
      "anyOf": ["^\\s*│\\s*[>❯]", "^\\s*[>❯](?:\\s(?!\\s*✔)|$)", "\\? for shortcuts"]
    }
  ]
}
```

| 項目 | 意味 |
|---|---|
| `agent` | ルールの名前。セッションの「判定ルール」で選ぶ |
| `scanLines` | 画面の下から何行を見るか（既定 25） |
| `stableMs` | 同じ判定が何ミリ秒続いたら確定するか（既定 500） |
| `rules[].state` | `working` / `blocked` / `idle` |
| `rules[].anyOf` | どれか1つが当たれば成立（正規表現） |
| `rules[].allOf` | すべて当たれば成立（正規表現） |
| `rules[].noneOf` | どれか1つでも当たればこのルールは不成立（正規表現） |
| `rules[].ignoreCase` | 大文字小文字を区別しない |
| `rules[].name` | 判定の詳細に出す名前（省略可） |

- `anyOf` と `allOf` の両方を書いたら、両方を満たしたときに成立する。どちらか一方は必須
- 正規表現は JavaScript のもの。`m`（`^` `$` が行頭・行末）と `u` フラグ付きで、判定に使う行を改行でつないだテキストに当てる
- 各行の行末の空白は取り除かれる。行末の空白に頼るパターン（例: `^> `）は当たらないので `^>(\s|$)` のように書く
- JSON の中なので `\` は `\\` と書く

ルールの置き場所と読み込み:

- 同梱のルール（インストール先の `resources/rules/`、開発中はリポジトリの `rules/`）を読み、次に `userData/rules/*.json` を読む。同じ `agent` 名なら利用者のものが優先
- メニューの「ルール → ルールのフォルダーを開く」でフォルダーが開く（空なら同梱のルールが写される）。ここのファイルを直す
- `userData/rules/` の変更は監視しているので、保存すると自動で読み直す（Ctrl+Shift+R でも読み直せる）。アプリの再起動は不要
- 書き方の誤りはサイドバーの下に表示される

Claude Code 以外のエージェントも、ルールファイルを足せば同じように判定できる。

### 実際の画面からフィクスチャを作る

判定ルールは Claude Code のバージョンで変わりうるので、**実際の画面で確かめてから** 直す。

1. nagaya で Claude Code を動かし、確かめたい状態（例: 確認待ち）にする
2. ヘッダーの「画面を保存」（Ctrl+Shift+S）で今の画面をテキストに書き出す
3. 期待する状態のフォルダー（`test/fixtures/blocked/` など）に `real-<バージョン>-<内容>.txt` の名前で置く
4. `npm test` で確かめる。落ちたらルールを直す

GUI のない Linux では `npm run capture` でも取れる:

```bash
npm run capture -- --out captures -- claude
```

いつもの端末と同じように操作でき、Ctrl+] を押すとその時点の画面を `captures/screen-001.txt` … に保存する。
終了時に、保存したファイルと同梱ルールでの判定結果を一覧で表示する。

## 開発

### 構成

```
src/
  main/       Electron の main プロセス
    index.ts    ウィンドウ・IPC・メニュー・通知
    pty.ts      node-pty でセッションごとの PTY を起動（Windows は ConPTY）
    store.ts    セッション一覧の保存（userData/sessions.json）
    rules.ts    判定ルールの読み込みと監視
  preload/    renderer に公開する API（window.nagaya）
  renderer/   React の画面
    src/terminals.ts  セッションごとの xterm.js と状態の判定ループ（React の外で持つ）
  shared/
    detect.ts   判定ロジック（純粋な関数。UI・Electron に依存しない）
    types.ts / api.ts
rules/        同梱の判定ルール
test/         判定ロジックの単体テストとフィクスチャ
scripts/      capture.mjs（画面の保存）、smoke.cjs（Xvfb 上の動作確認）
```

- node-pty は main プロセスだけで使う。PTY の入出力は IPC で renderer とつなぐ
- renderer は `contextIsolation` + `sandbox` で動かし、preload で必要な API だけを出す

### electron-vite を選んだ理由

雛形は [electron-vite](https://electron-vite.org/) + [electron-builder](https://www.electron.build/) にした。

- main・preload・renderer の3つを1つの設定ファイルで Vite でビルドでき、React + TypeScript の構成が素直に書ける
- Electron Forge の Vite 対応はまだ実験的な扱いで、ネイティブモジュール（node-pty）の扱いに Forge 独自の設定が要る
- 配布は electron-builder に任せられる。Windows の NSIS インストーラーと zip を1つの設定で作れ、Linux から Windows 向けにも作れる（zip。NSIS は wine が要る）

### node-pty（ネイティブモジュール）の扱い

- node-pty 1.1 は N-API で作られていて、**Windows（x64 / arm64）と macOS 向けのビルド済みバイナリを同梱** している。N-API なので Electron のバージョンに合わせて作り直す必要がない。そのため electron-builder の `npmRebuild` は切ってある
- Windows で開発する場合、Visual Studio のビルドツールは不要（同梱のバイナリが使われる）
- Linux は同梱のバイナリがないので、`npm install` のときにビルドされる（`gcc-c++` と `make`、`python3` が要る）
- パッケージには対象 OS のバイナリだけを入れ（[electron-builder.yml](electron-builder.yml)）、node-pty は asar の外に出す

### 開発環境の作り方

Node.js の LTS（22 以上）を入れて:

```bash
npm install
```

- Linux では先に `sudo dnf install -y gcc-c++ make`（Fedora）などでビルドツールを入れる
- npm 11 以降はインストールスクリプトに許可が要る。`electron`（本体のダウンロード）と `node-pty`（Linux でのビルド）は `package.json` の `allowScripts` で許可してある

### 起動

```bash
npm run dev
```

ビルドしたものを起動するには:

```bash
npm run build
```

```bash
npm start
```

### テスト・型チェック

```bash
npm test
```

```bash
npm run typecheck
```

`npm test` は [test/fixtures](test/fixtures) の下の画面テキストを、フォルダー名（期待する状態）と照らし合わせる。

GUI のない Linux（コンテナなど）で、実際にアプリを起動して確かめるには Xvfb を使う:

```bash
npm run build && xvfb-run -a npx electron --no-sandbox scripts/smoke.cjs <userData のフォルダー> shot.png 8000
```

数秒後にスクリーンショットとサイドバーの状態を書き出して終わる。

### 配布物を作る

Windows で:

```bash
npm run dist:win
```

`dist/` に NSIS のインストーラー（`nagaya-<版>-setup.exe`）と zip（`nagaya-<版>-win-x64.zip`）ができる。

Linux から Windows 向けの zip だけを作るには:

```bash
npm run dist:win:zip
```

（Linux から NSIS も作るには 32 ビット版も含めた wine が要る。作者のコンテナでは wine の中でインストーラーの生成が止まったので、NSIS は Windows で作る）

## 未決事項・制限

- **アプリを閉じると、中のセッションも終わる**（SSH が切れ、Claude Code も止まる）。閉じても動き続けるようにするには Linux 側でセッションを保持する必要がある（koya にセッション機能を足し、nagaya は開くたびにつなぎ直す案）。koya 側の変更が要るので別作業
- アイコンは未設定（Electron の既定のもの）
- コード署名はしていない。Windows では初回起動時に SmartScreen の警告が出る
- 同梱のフィクスチャのうち `real-*` 以外は、Claude Code 2.x の画面を手で再現したもの。実際の画面で取り直すこと（[test/fixtures/README.md](test/fixtures/README.md)）

## 参考

- [Orca](https://github.com/stablyai/orca)（見た目の参考）
- [herdr のエージェント検出](https://herdr.dev/docs/agents/)（判定ルールの考え方の参考）
- [xterm.js](https://xtermjs.org/) / [node-pty](https://github.com/microsoft/node-pty)

## ライセンス

MIT
