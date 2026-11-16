import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { NewSessionInput, SessionGroup } from '@shared/types'

export const NEW_GROUP = '__new__'

export interface SessionDialogResult {
  input: NewSessionInput
  /** 「新しいグループ」を選んだときのグループ名 */
  newGroupName: string | null
}

interface Props {
  mode: 'new' | 'edit' | 'duplicate'
  initial: Partial<NewSessionInput>
  groups: SessionGroup[]
  agents: string[]
  defaultShell: string
  onCancel(): void
  onSubmit(result: SessionDialogResult): Promise<void>
}

/** SSH が切れたことに気づけるよう、生存確認を付ける（付けないと、切れても ssh が終わらないことがある） */
const sshCommand = (host: string, extra = '') =>
  `ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -t ${host} koya run claude -- claude${extra}`

const TITLE = { new: '新しいセッション', edit: 'セッションを編集', duplicate: 'セッションを複製' }
const SUBMIT = { new: '作成', edit: '保存', duplicate: '作成' }

export function SessionDialog({ mode, initial, groups, agents, defaultShell, onCancel, onSubmit }: Props) {
  const [name, setName] = useState(initial.name ?? '')
  const [host, setHost] = useState(initial.host ?? '')
  const [groupId, setGroupId] = useState<string>(initial.groupId ?? '')
  const [newGroupName, setNewGroupName] = useState('')
  const [command, setCommand] = useState(initial.command ?? '')
  const [cwd, setCwd] = useState(initial.cwd ?? '')
  const [agent, setAgent] = useState(initial.agent ?? (agents.includes('claude') ? 'claude' : (agents[0] ?? '')))
  const [autoReconnect, setAutoReconnect] = useState(initial.autoReconnect ?? true)
  const [reconnectCommand, setReconnectCommand] = useState(initial.reconnectCommand ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => first.current?.focus(), [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('名前を入れてください')
      return
    }
    if (groupId === NEW_GROUP && !newGroupName.trim()) {
      setError('新しいグループの名前を入れてください')
      return
    }
    setBusy(true)
    try {
      await onSubmit({
        input: {
          name: name.trim(),
          host: host.trim(),
          groupId: groupId && groupId !== NEW_GROUP ? groupId : null,
          command: command.trim(),
          cwd: cwd.trim(),
          agent,
          autoReconnect,
          reconnectCommand: reconnectCommand.trim(),
        },
        newGroupName: groupId === NEW_GROUP ? newGroupName.trim() : null,
      })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  // ホストを入れたら、コマンド・再接続のコマンドのホスト部分も一緒に変える（ひな形のままなら）
  function changeHost(next: string) {
    const h = host.trim()
    if (h && command === sshCommand(h)) setCommand(next.trim() ? sshCommand(next.trim()) : '')
    if (h && reconnectCommand === sshCommand(h, ' --continue'))
      setReconnectCommand(next.trim() ? sshCommand(next.trim(), ' --continue') : '')
    setHost(next)
  }

  const agentOptions = agent && !agents.includes(agent) ? [...agents, agent] : agents
  const h = host.trim()

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <form className="dialog" onSubmit={submit}>
        <h2>{TITLE[mode]}</h2>
        <label>
          <span>名前</span>
          <input ref={first} value={name} onChange={(e) => setName(e.target.value)} placeholder="myapp" />
        </label>
        <label>
          <span>グループ</span>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">（グループなし）</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value={NEW_GROUP}>新しいグループ…</option>
          </select>
        </label>
        {groupId === NEW_GROUP ? (
          <label>
            <span>グループの名前</span>
            <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="認証の作り直し" />
          </label>
        ) : null}
        <label>
          <span>ホスト</span>
          <input value={host} onChange={(e) => changeHost(e.target.value)} placeholder="linux-a（表示とコマンドのひな形に使う。空ならローカル）" />
        </label>
        <label>
          <span>コマンド</span>
          <input
            className="mono"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={`空欄ならシェル（${defaultShell}）`}
          />
        </label>
        {h && command.trim() !== sshCommand(h) ? (
          <button type="button" className="link hint" onClick={() => setCommand(sshCommand(h))}>
            「{sshCommand(h)}」を入れる
          </button>
        ) : null}
        <label>
          <span>作業ディレクトリ</span>
          <input className="mono" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="空欄ならホーム" />
        </label>
        <label>
          <span>判定ルール</span>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            {agentOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
            <option value="">判定しない</option>
          </select>
        </label>
        <label className="check">
          <span>自動再接続</span>
          <span className="check-body">
            <input type="checkbox" checked={autoReconnect} onChange={(e) => setAutoReconnect(e.target.checked)} />
            SSH が切れたら（終了コード 255）自動で再接続する
          </span>
        </label>
        {autoReconnect ? (
          <>
            <label>
              <span>再接続のコマンド</span>
              <input
                className="mono"
                value={reconnectCommand}
                onChange={(e) => setReconnectCommand(e.target.value)}
                placeholder="空欄ならコマンドと同じ"
              />
            </label>
            {h && reconnectCommand.trim() !== sshCommand(h, ' --continue') ? (
              <button type="button" className="link hint" onClick={() => setReconnectCommand(sshCommand(h, ' --continue'))}>
                前の会話の続きから始める（claude --continue）
              </button>
            ) : null}
          </>
        ) : null}
        {error ? <div className="error">{error}</div> : null}
        <div className="buttons">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {SUBMIT[mode]}
          </button>
        </div>
      </form>
    </div>
  )
}
