"use client"
import Link from 'next/link'
import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

export default function ArticlesIndex() {
  const [items, setItems] = useState<any[]>([])
  useEffect(() => {
    ;(async () => {
      const r = await fetch(`${API}/api/articles`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } })
      const data = await r.json()
      setItems(data.items || [])
    })()
  }, [])
  return (
    <main style={{ padding: 24 }}>
      <h2>Articles</h2>
      <ul>
        {items.map((a) => (
          <li key={a.id}>
            <Link href={`/articles/${a.slug}`}>{a.title}</Link> {a.unlocked ? '✅' : `(${a.mp_cost}MP)`}
          </li>
        ))}
      </ul>
    </main>
  )
}

