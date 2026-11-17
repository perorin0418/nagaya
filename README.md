# nagaya

複数のマシン上で動く Claude Code のセッションを1つのウィンドウに並べ、それぞれの状態
（作業中・確認待ち・入力待ち）をひと目で分かるようにするデスクトップアプリ。

名前は「長屋」。作者の別ツール [koya](https://github.com/perorin0418/koya)（小屋）が並んだもの、という意味。

```
┌ セッション            [⊞][+] ┬ 認証の作り直し / linux-a / auth-api   ssh … linux-a koya run claude -- claude  [確認待ち] ┐
│ ⌄ 認証の作り直し             │                                                                              │
│  ● auth-api  linux-a blocked │  Do you want to make this edit to auth.ts?                                   │
│  ● auth-web  linux-b working │  ❯ 1. Yes                                                                    │
│  ● auth-test linux-c idle    │    2. Yes, allow all edits this session                                      │
│ › ドキュメント          ● 2  │    3. No, and tell Claude what to do differently                             │
└──────────────────────────────┴──────────────────────────────────────────────────────────────────────────────┘
  ● 黄 = blocked（確認待ち・通知を出す）  ● 青 = working（作業中）  ● 灰 = idle（入力待ち）
```

- 左のサイドバーに、自由に作ったグループごとにセッションが並び、状態の色の点が付く（同じ作業を複数の Linux に分けて動かすときも1つのグループにまとめられる）
- セッションを選ぶと右側にその端末（xterm.js）が出る。切り替えても裏のセッションは動き続ける
- 確認待ちになったら通知を出す。通知をクリックするとそのセッションに切り替わる
- 見ていないあいだに作業が終わった（作業中 → 入力待ち）セッションや、確認待ちになったセッションは **未読** になり、サイドバーで名前が太字になって「未読」の印が付く。そのセッションを選んで表示すると既読になる（アプリを起動し直すと消える）
- 状態は **端末に流れてくる画面そのもの** から判定する。間に SSH・koya・コンテナが何段挟まっていても判定できる
- SSH が不意に切れたら自動で再接続する
- ライト・ダークのテーマを切り替えられる

## 使い方

1. 左上の「+」（または Ctrl+Shift+T）で新しいセッションを作る
   - **名前**: サイドバーに出す名前
   - **グループ**: 入れるグループ。「新しいグループ…」を選ぶとその場で作れる
   - **ホスト**: 接続先のホスト名。サイドバーで名前の横に小さく出る。入れると「`ssh … <ホスト> koya run claude -- claude` を入れる」ボタンが出る
   - **コマンド**: 実行するコマンド。空ならシェル（Windows は PowerShell、それ以外はログインシェル）。シェル経由で実行するので、引用符や PATH はふつうに使える
   - **作業ディレクトリ**: 空ならホーム
   - **判定ルール**: ふつうは `claude`
   - **自動再接続** と **再接続のコマンド**: 後述
2. セッションの右クリックで「編集・複製・再起動・グループへ移動・削除」。
   **複製** は、同じ作業を別のホストでも動かすときに使う（設定を写したダイアログが開くので、ホストだけ変える）
3. プロセスが終わった端末で Enter を押すと起動し直す
4. セッション一覧は保存され、次に起動したときに復元される（中のプロセスは起動し直し）

### グループ

- サイドバー右上のフォルダーのボタン（またはメニューの「ファイル → 新しいグループ…」）でグループを作る
- セッションは **ドラッグ＆ドロップ** で並べ替え・グループ間の移動ができる。グループの見出しに落とすとそのグループの最後に入る。何もない所に落とすと「グループなし」に移る
- グループの見出しもドラッグで並べ替えられる。クリックで開閉する。閉じているときは、中で一番注意が要る状態の点と、確認待ち・未読の数が出る
- グループの見出しの右クリックで「このグループに新しいセッション・名前を変更・削除」。グループを消しても中のセッションは消えず「グループなし」に移る
- 以前の版（ホストごとに自動でまとめていた版）の設定を読むと、ホストごとのグループに置き換える（見た目は変わらない）

### 自動再接続

SSH が不意に切れたとき（ssh の終了コードが **255** のとき）、自動で再接続する。

- 待ち時間は 2 → 5 → 10 → 20 → 30 秒と延ばし、その後は 30 秒おきに試し続ける。60 秒以上つながっていたら回数を数え直す
- 待っている間は端末に案内が出る。**Enter ですぐに再接続、Esc で中止**。サイドバーとヘッダーには「再接続中」と出る
- 再接続しても端末の画面は消さずに続ける
- **再接続のコマンド** を入れると、再接続のときだけそちらを使う（空なら最初のコマンドと同じ）。ホストを入れていると「前の会話の続きから始める（claude --continue）」ボタンで入れられる。
  ただし Claude Code の会話の履歴がコンテナの外に残っていないと続きからは始まらない（koya の設定による）
- Claude Code を終えたとき（終了コード 0 など）や、自動再接続を切ったセッションは再接続しない
- 回線が切れても ssh がすぐに気づかないことがある。ひな形のコマンドには `-o ServerAliveInterval=15 -o ServerAliveCountMax=3` を付けてあり、45 秒ほどで切断に気づいて終わる。自分でコマンドを書くときも付けておくとよい（`~/.ssh/config` に書いてもよい）
- Windows の PowerShell 経由でも ssh の終了コードが伝わるようにしてある
- アプリを閉じたときは再接続ではなく、セッションごと終わる（下の「未決事項・制限」）

### テーマ

メニューの「表示 → テーマ」で **システム / ライト / ダーク** を選ぶ。選んだものは保存される。
端末の色もテーマに合わせて変わる（Claude Code 自体の配色は Claude Code の `/theme` で選ぶ）。

### フォント

メニューの「表示 → 端末のフォント…」で、端末のフォントと大きさを変える。

- **フォント**: PC に入っているフォントの名前（例 `HackGen Console NF`）。カンマで区切って複数書ける。空なら既定（Cascadia Mono, Consolas, BIZ UDGothic …）
- **大きさ**: 8〜32 px（既定は 13）
- 入力している間も開いている端末にすぐ反映される。「キャンセル」で元に戻り、「保存」で次の起動からも使われる
- 指定したフォントが入っていないときや、日本語のないフォントのときは、その文字だけ既定のフォントで出る
- 画面全体（サイドバーなども含めて）を大きくしたいときは「表示 → 拡大 / 縮小」

| 操作 | キー |
|---|---|
| 新しいセッション | Ctrl+Shift+T |
| 次 / 前のセッション | Ctrl+Tab / Ctrl+Shift+Tab |
| 判定の詳細を表示 | Ctrl+Shift+D |
| 画面をテキストで保存 | Ctrl+Shift+S |
| ルールを再読み込み | Ctrl+Shift+R |
| コピー | 選択するだけでコピーされる。ほかに Ctrl+C（選択がなければ ^C を送る）、Ctrl+Shift+C、右クリック |
| 貼り付け | Ctrl+V、Ctrl+Shift+V、右クリック（選択がないとき） |
| 入力欄で改行 | Shift+Enter |

（macOS では Ctrl の代わりに Cmd。コピー・貼り付けは Cmd+C / Cmd+V）

設定ファイルの場所（Electron の `userData`）:

- Windows: `%APPDATA%\nagaya\`
- macOS: `~/Library/Application Support/nagaya/`
- Linux: `~/.config/nagaya/`

ここに `sessions.json`（セッション・グループの一覧とテーマの設定）と `rules/`（利用者の判定ルール）が置かれる。

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
    store.ts    セッション・グループ・設定の保存（userData/sessions.json）
    rules.ts    判定ルールの読み込みと監視
  preload/    renderer に公開する API（window.nagaya）
  renderer/   React の画面
    src/terminals.ts  セッションごとの xterm.js、状態の判定ループ、自動再接続（React の外で持つ）
  shared/
    detect.ts   判定ロジック（純粋な関数。UI・Electron に依存しない）
    layout.ts   サイドバーの並び替え（純粋な関数）
    types.ts / api.ts
rules/        同梱の判定ルール
test/         判定ロジック・並び替え・設定の読み込みの単体テストとフィクスチャ
scripts/      capture.mjs（画面の保存）、smoke.cjs（Xvfb 上の動作確認）、make-icons.sh（アイコンの書き出し）
build/        アイコンの元の絵と書き出したもの（配布物の作成に使う）
resources/    実行中に使うファイル（ウィンドウのアイコン）
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
ほかに、サイドバーの並び替えと、保存ファイルの読み込み（古い版からの移し替えを含む）のテストがある。

GUI のない Linux（コンテナなど）で、実際にアプリを起動して確かめるには Xvfb を使う:

```bash
npm run build && xvfb-run -a npx electron --no-sandbox scripts/smoke.cjs <userData のフォルダー> shot.png 8000
```

数秒後にスクリーンショットとサイドバーの状態を書き出して終わる。4つ目の引数に `explain`（判定の詳細を開く）か `js:<コード>`（ページで実行してから撮る。ドラッグ＆ドロップの確認など）を渡せる。

### アイコン

元の絵は [build/icon.svg](build/icon.svg)（大きいサイズ用）と [build/icon-small.svg](build/icon-small.svg)（32px 以下用。線を太く、点を大きくしてある）。
屋根の下に、状態の色（黄・青・灰）の点が3つ並ぶ。直したら、次で PNG と ICO を書き出し直す（`rsvg-convert` と ImageMagick が要る）。

```bash
scripts/make-icons.sh
```

`build/icon.ico`（Windows）、`build/icon.png`（macOS・Linux）、`resources/icon.png`（実行中のウィンドウ）ができる。

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
- コード署名はしていない。Windows では初回起動時に SmartScreen の警告が出る
- 同梱のフィクスチャのうち `real-*` 以外は、Claude Code 2.x の画面を手で再現したもの。実際の画面で取り直すこと（[test/fixtures/README.md](test/fixtures/README.md)）

## 参考

- [Orca](https://github.com/stablyai/orca)（見た目の参考）
- [herdr のエージェント検出](https://herdr.dev/docs/agents/)（判定ルールの考え方の参考）
- [xterm.js](https://xtermjs.org/) / [node-pty](https://github.com/microsoft/node-pty)

## ライセンス

MIT
