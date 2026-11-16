import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { NewSessionInput, SessionConfig } from '@shared/types'

interface Props {
  initial: SessionConfig | null
  agents: string[]
  defaultShell: string
  onCancel(): void
  onSubmit(input: NewSessionInput): Promise<void>
}

const SSH_TEMPLATE = (host: string) => `ssh ${host} -t koya run claude -- claude`

export function SessionDialog({ initial, agents, defaultShell, onCancel, onSubmit }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [host, setHost] = useState(initial?.host ?? '')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [cwd, setCwd] = useState(initial?.cwd ?? '')
  const [agent, setAgent] = useState(initial?.agent ?? (agents.includes('claude') ? 'claude' : (agents[0] ?? '')))
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
    setBusy(true)
    try {
      await onSubmit({ name: name.trim(), host: host.trim(), command: command.trim(), cwd: cwd.trim(), agent })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const agentOptions = agent && !agents.includes(agent) ? [...agents, agent] : agents

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
        <h2>{initial ? 'セッションを編集' : '新しいセッション'}</h2>
        <label>
          <span>名前</span>
          <input ref={first} value={name} onChange={(e) => setName(e.target.value)} placeholder="myapp" />
        </label>
        <label>
          <span>ホスト</span>
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="linux-a（サイドバーのまとまりに使う。空ならローカル）" />
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
        {host.trim() && !command.trim() ? (
          <button type="button" className="link hint" onClick={() => setCommand(SSH_TEMPLATE(host.trim()))}>
            「{SSH_TEMPLATE(host.trim())}」を入れる
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
        {error ? <div className="error">{error}</div> : null}
        <div className="buttons">
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {initial ? '保存' : '作成'}
          </button>
        </div>
      </form>
    </div>
  )
}
