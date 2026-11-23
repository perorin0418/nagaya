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

/** タブ1枚の設定（1枚につき端末が1つ。タブごとにホストが違ってもよい） */
export interface TabConfig {
  id: string
  /** タブに出す名前（空ならホスト名、ホストもなければ「ローカル」） */
  name: string
  /** 接続先のホスト名（表示と ssh コマンドのひな形に使う。空ならローカル） */
  host: string
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

export type NewTabInput = Omit<TabConfig, 'id'>

/** 分割の向き（row は左右に、column は上下に並べる） */
export type SplitDir = 'row' | 'column'

/**
 * 分割の配置（木）。葉がタブ1枚。分けたところでは a が左（上）、b が右（下）で、
 * ratio は a が占める割合
 */
export type PaneNode = { tabId: string } | { dir: SplitDir; ratio: number; a: PaneNode; b: PaneNode }

/** 保存されるセッションの設定（サイドバーの1行。中にタブを1枚以上持つ） */
export interface SessionConfig {
  id: string
  /** サイドバーに出す名前 */
  name: string
  /** 入っているグループ（null ならグループなし） */
  groupId: string | null
  /** タブ（1枚以上。配列の順に並ぶ） */
  tabs: TabConfig[]
  /** 並べて表示するタブの組（それぞれ2枚以上。1枚のタブが入るのは1つだけ） */
  splits: PaneNode[]
}

/** 新しいセッション（最初のタブを1枚持つ） */
export interface NewSessionInput {
  name: string
  groupId: string | null
  tab: NewTabInput
}

/** セッションの名前とグループ（セッションの編集で変えられるもの） */
export type SessionMeta = Pick<SessionConfig, 'name' | 'groupId'>

/** タブに出す名前 */
export function tabLabel(t: Pick<TabConfig, 'name' | 'host'>): string {
  return t.name || t.host || 'ローカル'
}

/** サイドバーに出すホスト名（1つならそのまま、複数なら「最初のホスト +残りの数」） */
export function hostsLabel(tabs: Pick<TabConfig, 'host'>[]): string {
  const hosts = [...new Set(tabs.map((t) => t.host).filter(Boolean))]
  if (hosts.length <= 1) return hosts[0] ?? ''
  return `${hosts[0]} +${hosts.length - 1}`
}

/** 注意が要る順（大きいほど注意が要る） */
export const STATE_RANK: Record<AgentState, number> = { blocked: 3, working: 2, idle: 1, unknown: 0 }

/** いくつかの状態のうち、一番注意が要るもの */
export function worstState(states: AgentState[]): AgentState {
  return states.reduce<AgentState>((w, s) => (STATE_RANK[s] > STATE_RANK[w] ? s : w), 'unknown')
}

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
  /** 終了したときの端末の表示を残し、次に起動したときに出すか */
  keepScreen: boolean
}

/** 終了したときに残した、端末1枚分の表示 */
export interface SavedScreen {
  /** xterm.js の表示を書き出したもの（色などのエスケープシーケンスを含む） */
  data: string
  /** 残した時刻（Date.now()） */
  savedAt: number
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
