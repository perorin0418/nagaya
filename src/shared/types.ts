/** エージェント（Claude Code）の状態 */
export type AgentState = 'working' | 'blocked' | 'idle' | 'unknown'

export const STATE_LABEL: Record<AgentState, string> = {
  working: '作業中',
  blocked: '確認待ち',
  idle: '入力待ち',
  unknown: '不明',
}

/** 保存されるセッションの設定 */
export interface SessionConfig {
  id: string
  /** サイドバーに出す名前 */
  name: string
  /** グループ化に使うホスト名（空ならローカル） */
  host: string
  /** 実行するコマンド（空ならシェル） */
  command: string
  /** 作業ディレクトリ（空ならホーム） */
  cwd: string
  /** 判定ルールのエージェント名（rules/*.json の agent） */
  agent: string
}

export type NewSessionInput = Omit<SessionConfig, 'id'>

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
