/** エージェント（Claude Code）の状態 */
export type AgentState = 'working' | 'blocked' | 'idle' | 'unknown'

export const STATE_LABEL: Record<AgentState, string> = {
  working: '作業中',
  blocked: '確認待ち',
  idle: '入力待ち',
  unknown: '不明',
}

/** サイドバーのグループ（利用者が自由に作る） */
export interface SessionGroup {
  id: string
  name: string
  /** 折りたたんでいるか */
  collapsed: boolean
}

/** 保存されるセッションの設定 */
export interface SessionConfig {
  id: string
  /** サイドバーに出す名前 */
  name: string
  /** 接続先のホスト名（表示と ssh コマンドのひな形に使う。空ならローカル） */
  host: string
  /** 入っているグループ（null ならグループなし） */
  groupId: string | null
  /** 実行するコマンド（空ならシェル） */
  command: string
  /** 作業ディレクトリ（空ならホーム） */
  cwd: string
  /** 判定ルールのエージェント名（rules/*.json の agent） */
  agent: string
  /** SSH が切れた（終了コード 255）ときに自動で再接続するか */
  autoReconnect: boolean
  /** 再接続のときに使うコマンド（空なら command と同じ） */
  reconnectCommand: string
}

export type NewSessionInput = Omit<SessionConfig, 'id'>

/** サイドバーの並び（グループとセッション。どちらも配列の順に並ぶ） */
export interface Layout {
  groups: SessionGroup[]
  sessions: SessionConfig[]
}

export type ThemeSetting = 'system' | 'light' | 'dark'

/** 端末のフォント */
export interface FontSetting {
  /** フォント名（カンマ区切りで複数可。空なら既定のフォント） */
  family: string
  /** 文字の大きさ（px） */
  size: number
}

export interface Settings {
  theme: ThemeSetting
  font: FontSetting
}

/** SSH が接続エラーで終わったときの終了コード */
export const SSH_CONNECTION_ERROR = 255

/** 判定ルールファイルの形（JSON） */
export interface RuleSetFile {
  agent: string
  /** 画面の下から何行を見るか */
  scanLines?: number
  /** 同じ判定が何ミリ秒続いたら確定するか */
  stableMs?: number
  rules: RuleFile[]
}

export interface RuleFile {
  /** ルールの名前（デバッグ表示用。省略可） */
  name?: string
  state: Exclude<AgentState, 'unknown'>
  /** どれか1つが当たれば OK（正規表現） */
  anyOf?: string[]
  /** すべて当たれば OK（正規表現） */
  allOf?: string[]
  /** どれか1つでも当たればこのルールは不成立（正規表現） */
  noneOf?: string[]
  /** 大文字小文字を区別しない */
  ignoreCase?: boolean
}

/** PTY の状態（main → renderer） */
export interface PtyExit {
  id: string
  exitCode: number
  signal?: number
}

/** ルールの読み込み結果（main → renderer） */
export interface RulesPayload {
  dir: string
  ruleSets: RuleSetFile[]
  errors: string[]
}
