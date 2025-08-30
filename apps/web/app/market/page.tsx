"use client"
import Link from 'next/link'
import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

export default function MarketIndex() {
  const [items, setItems] = useState<any[]>([])
  useEffect(() => {
    ;(async () => {
      const r = await fetch(`${API}/api/market`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } })
      const data = await r.json()
      setItems(data.items || [])
    })()
  }, [])
  return (
    <main style={{ padding: 24 }}>
      <h2>Market</h2>
      <ul>
        {items.map((p) => (
          <li key={p.id}>
            <Link href={`/market/${p.id}`}>{p.name}</Link> {p.owned ? '🛒' : `(${p.mp_cost}MP)`}
          </li>
        ))}
      </ul>
    </main>
  )
}

