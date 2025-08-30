"use client"
import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

export default function AdminPage() {
  const [secret, setSecret] = useState('')
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<{ user_id?: string; action?: string; from?: string; to?: string }>({})

  useEffect(() => {
    const saved = localStorage.getItem('dom:admin_secret')
    if (saved) setSecret(saved)
  }, [])

  const fetchLogs = async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ limit: '200' })
      if (filters.user_id) qs.set('user_id', filters.user_id)
      if (filters.action) qs.set('action', filters.action)
      if (filters.from) qs.set('from', toEpochMs(filters.from))
      if (filters.to) qs.set('to', toEpochMs(filters.to))
      const r = await fetch(`${API}/api/admin/audit?` + qs.toString(), { headers: { 'x-admin-secret': secret } })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'failed')
      setLogs(data.items || [])
      localStorage.setItem('dom:admin_secret', secret)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ padding: 24 }}>
      <h2>Admin / Audit Logs</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="password" placeholder="admin secret" value={secret} onChange={(e) => setSecret(e.target.value)} />
        <input placeholder="user_id" value={filters.user_id ?? ''} onChange={(e) => setFilters({ ...filters, user_id: e.target.value })} />
        <select value={filters.action ?? ''} onChange={(e) => setFilters({ ...filters, action: e.target.value || undefined })}>
          <option value="">action (any)</option>
          <option value="grant">grant</option>
          <option value="spend">spend</option>
          <option value="tx_finalize">tx_finalize</option>
          <option value="ether_checkout_created">ether_checkout_created</option>
          <option value="ether_checkout_mock">ether_checkout_mock</option>
          <option value="mp_webhook_finalize">mp_webhook_finalize</option>
          <option value="invoice_paid">invoice_paid</option>
          <option value="subscription_created">subscription_created</option>
          <option value="subscription_deleted">subscription_deleted</option>
          <option value="sub_checkout_created">sub_checkout_created</option>
          <option value="sub_checkout_completed">sub_checkout_completed</option>
        </select>
        <label>from <input type="datetime-local" value={filters.from ?? ''} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>to <input type="datetime-local" value={filters.to ?? ''} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <button disabled={!secret || loading} onClick={fetchLogs}>Fetch</button>
      </div>
      {error && <p style={{ color: 'tomato' }}>{error}</p>}
      <ul style={{ marginTop: 12 }}>
        {logs.map((l, i) => (
          <li key={i}>
            {new Date(l.ts).toLocaleString()} — [{l.user_id}] {l.action} {formatMeta(l.meta)}
          </li>
        ))}
      </ul>
    </main>
  )
}

function formatMeta(meta: any): string {
  try { return JSON.stringify(meta) } catch { return '' }
}

function toEpochMs(dtLocal: string): string {
  // datetime-local is local time; convert to epoch ms
  const d = new Date(dtLocal)
  if (Number.isNaN(d.getTime())) return ''
  return String(d.getTime())
}
