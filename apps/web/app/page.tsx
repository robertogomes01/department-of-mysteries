"use client"
import Link from 'next/link'
import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

export default function Home() {
  const [articles, setArticles] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [apps, setApps] = useState<any[]>([])
  useEffect(() => {
    ;(async () => {
      try {
        const a = await fetch(`${API}/api/articles`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } }).then(r => r.json())
        setArticles(a.items || [])
      } catch {}
      try {
        const m = await fetch(`${API}/api/market`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } }).then(r => r.json())
        setProducts(m.items || [])
      } catch {}
      try {
        const ap = await fetch(`${API}/api/apps`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } }).then(r => r.json())
        setApps(ap.items || [])
      } catch {}
    })()
  }, [])

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 16 }}>Department of Mysteries</h1>
      <p style={{ opacity: 0.85, marginBottom: 20 }}>入口は3つ。封印UIは出しません。</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <Link href="/articles" style={btnStyle}>Articles</Link>
        <Link href="/market" style={btnStyle}>Market</Link>
        <Link href="/apps" style={btnStyle}>Apps</Link>
      </div>
      {process.env.NEXT_PUBLIC_SHOW_DEV_LINKS === '1' && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <Link href="/members" style={btnStyle}>Members</Link>
          <Link href="/login" style={btnStyle}>Login</Link>
          <Link href="/admin" style={btnStyle}>Admin</Link>
        </div>
      )}
    </main>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  background: '#3344aa',
  color: 'white',
  textDecoration: 'none'
}
