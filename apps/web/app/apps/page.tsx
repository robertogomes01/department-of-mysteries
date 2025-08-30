"use client"
import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

export default function AppsPage() {
  const [apps, setApps] = useState<any[]>([])
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const r = await fetch(`${API}/api/apps`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } })
      const data = await r.json()
      setApps(data.items || [])
    })()
  }, [])

  const launch = async (id: string) => {
    const r = await fetch(`${API}/api/apps/${id}/sso-token`, { method: 'POST', headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } })
    const data = await r.json()
    setToken(data.token || null)
  }

  return (
    <main style={{ padding: 24 }}>
      <h2>Apps</h2>
      <ul>
        {apps.map(ap => (
          <li key={ap.id}>
            <strong>{ap.name}</strong>
            <button style={{ marginLeft: 8 }} onClick={() => launch(ap.id)}>Launch (get SSO token)</button>
          </li>
        ))}
      </ul>
      {token && (
        <div style={{ marginTop: 12 }}>
          <div>SSO Token（デモ用、未署名）:</div>
          <textarea readOnly value={token} style={{ width: '100%', height: 80 }} />
        </div>
      )}
    </main>
  )
}

