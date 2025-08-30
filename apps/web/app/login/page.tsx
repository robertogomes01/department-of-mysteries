"use client"
import { useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSent(null)
    const res = await fetch(`${API}/api/auth/magic-link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
    const data = await res.json()
    if (res.ok) {
      setSent(data.link ?? 'メールを確認してください。')
    } else {
      setError(data.error ?? '送信に失敗しました')
    }
  }
  return (
    <main style={{ padding: 24 }}>
      <h2>ログイン</h2>
      <form onSubmit={submit} style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
        <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit">マジックリンクを送る</button>
      </form>
      {sent && (
        <p style={{ marginTop: 12 }}>リンクを送信しました。{sent.startsWith('http') ? (<><br/>開発用リンク: <a href={sent}>{sent}</a></>) : null}</p>
      )}
      {error && <p style={{ color: 'tomato' }}>{error}</p>}
    </main>
  )
}

