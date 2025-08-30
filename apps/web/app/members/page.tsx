"use client"
const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'
import { useEffect, useMemo, useRef, useState } from 'react'

export default function MembersPage() {
  const [wallet, setWallet] = useState<any>(null)
  const [ledger, setLedger] = useState<any>({ items: [] })
  const [lastSeenTs, setLastSeenTs] = useState<number>(0)
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([])
  const pushToast = useToast(setToasts)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const prevMembershipRef = useRef<string | undefined>(undefined)
  const [redirecting, setRedirecting] = useState(false)
  useEffect(() => {
    ;(async () => {
      const wres = await fetch(`${API}/api/mp/wallet`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' }, cache: 'no-store' })
      setWallet(await wres.json())
      const lres = await fetch(`${API}/api/mp/ledger`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' }, cache: 'no-store' })
      const ldata = await lres.json()
      setLedger(ldata)
      const latest = ldata.items?.[0]?.created_at ?? 0
      if (latest) setLastSeenTs(latest)
      // initialize seen ids
      for (const e of ldata.items ?? []) seenIdsRef.current.add(e.id)
      prevMembershipRef.current = (await wres.json?.())?.membership ?? prevMembershipRef.current
    })()
    // short polling after load (reflect webhook changes)
    const t0 = Date.now()
    const id = setInterval(async () => {
      if (Date.now() - t0 > 30000) return clearInterval(id)
      const wres = await fetch(`${API}/api/mp/wallet`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' }, cache: 'no-store' })
      const nw = await wres.json()
      if (prevMembershipRef.current && prevMembershipRef.current !== nw.membership) {
        pushToast(nw.membership === 'ACTIVE' ? '会員状態: ACTIVE（再加入）' : '会員状態: NONE（解約）')
      }
      setWallet(nw)
      prevMembershipRef.current = nw.membership
      const lres = await fetch(`${API}/api/mp/ledger`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' }, cache: 'no-store' })
      const ldata = await lres.json()
      setLedger(ldata)
      const news = (ldata.items || []).filter((e: any) => e.created_at > lastSeenTs && !seenIdsRef.current.has(e.id))
      if (news.length) {
        for (const e of news.reverse()) {
          if (e.kind === 'grant') {
            const kind = e.mp_kind === 'free' ? 'free' : 'paid'
            pushToast(`+${e.amount}MP (${kind})`)
          } else if (e.kind === 'spend') {
            const spent = Math.abs(e.amount)
            const xp = e.ref_type === 'product' ? xpFromMarket(spent) : spent
            pushToast(`-${spent}MP / +${xp}XP`)
          }
          seenIdsRef.current.add(e.id)
        }
        const latest = news[news.length - 1].created_at
        if (latest) setLastSeenTs(latest)
      }
    }, 3000)
    return () => clearInterval(id)
  }, [])
  if (!wallet) return <main style={{ padding: 24 }}><p>読み込み中...</p></main>
  const badgeColor = wallet.membership === 'ACTIVE' ? badgeFromLevel(wallet.level) : 'gray'
  const capLeft = wallet.cap - wallet.total
  const req = reqXP(wallet.level)
  const xpPct = wallet.level >= 100 ? 0 : Math.max(0, Math.min(100, Math.round((wallet.currentXp / req) * 100)))
  return (
    <main style={{ padding: 24 }}>
      <h2>Members</h2>
      <div style={{ display: 'flex', gap: 24 }}>
        <div>
          <div>バッジ: <span style={{ color: badgeColor }}>{wallet.membership === 'ACTIVE' ? 'ACTIVE' : '停止中'}</span></div>
          <div>残高: free {wallet.free} / paid {wallet.paid} / total {wallet.total}</div>
          <div>レベル: Lv{wallet.level}{wallet.level >= 100 ? '（MAX）' : `（XP ${wallet.currentXp} / req ${req}）`}</div>
          <div style={{ width: 240, height: 12, background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ width: `${xpPct}%`, height: '100%', background: 'linear-gradient(90deg, #56ccf2, #2f80ed)' }} />
          </div>
          <div>上限: cap {wallet.cap}（残容量 {capLeft}）</div>
          <div style={{ marginTop: 6 }}>
            <button onClick={async () => {
              const wres = await fetch(`${API}/api/mp/wallet`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' }, cache: 'no-store' })
              const nw = await wres.json()
              setWallet(nw)
              const lres = await fetch(`${API}/api/mp/ledger`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' }, cache: 'no-store' })
              const ldata = await lres.json()
              setLedger(ldata)
              const latest = ldata.items?.[0]?.created_at ?? 0
              if (latest) setLastSeenTs(latest)
              // refresh seen ids snapshot
              seenIdsRef.current = new Set((ldata.items ?? []).map((e: any) => e.id))
              prevMembershipRef.current = nw.membership
            }}>更新</button>
          </div>
          {wallet.membership !== 'ACTIVE' && (
            <div style={{ marginTop: 12 }}>
              <button disabled={redirecting} onClick={async () => {
                setRedirecting(true)
                const r = await fetch(`${API}/api/sub/checkout`, { method: 'POST', headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } })
                const data = await r.json()
                if (data.checkout_url) location.href = data.checkout_url
                else setRedirecting(false)
              }}>再加入して月 999MP を受け取る（$）</button>
            </div>
          )}
        </div>
        {wallet.membership === 'ACTIVE' && (
          <form action={`${API}/api/mp/buy`} method="post" style={{ alignSelf: 'flex-start' }}>
            <input type="hidden" name="quantity" value={1} />
            <input type="hidden" name="cost" value={0} />
            <input type="hidden" name="refType" value="system" />
            <input type="hidden" name="refId" value="ether" />
            <input type="hidden" name="xpKind" value="article" />
            <button>エーテル ×1（+333MP / $3）購入</button>
          </form>
        )}
      </div>
      <h3 style={{ marginTop: 24 }}>履歴</h3>
      <ul>
        {ledger.items?.map((e: any) => (
          <li key={e.id}>{new Date(e.created_at).toLocaleString()} — {e.kind} {e.amount} → bal {e.balance_after} {e.ref_type ? `(${e.ref_type}:${e.ref_id})` : ''}</li>
        ))}
      </ul>
      <ToastHost toasts={toasts} onClose={(id) => setToasts((t) => t.filter(x => x.id !== id))} />
    </main>
  )
}

function reqXP(L: number) { return Math.round((9*L*L + 9*L + 3)/10) }
function badgeFromLevel(L: number) {
  if (L <= 33) return '#cd7f32' // bronze
  if (L <= 66) return '#c0c0c0' // silver
  return '#ffd700' // gold
}

function xpFromMarket(spent: number) { return Math.floor((3*spent + 1)/2) }

function ToastHost({ toasts, onClose }: { toasts: { id: string, text: string }[], onClose: (id: string) => void }) {
  return (
    <div style={{ position: 'fixed', right: 12, bottom: 12, display: 'grid', gap: 8, zIndex: 1000 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ background: '#2b3342', color: '#fff', border: '1px solid rgba(255,255,255,0.12)', padding: '8px 10px', borderRadius: 8, minWidth: 160 }}>
          <span>{t.text}</span>
          <button onClick={() => onClose(t.id)} style={{ marginLeft: 8, float: 'right', background: 'transparent', color: '#fff', border: 'none', cursor: 'pointer' }}>×</button>
        </div>
      ))}
    </div>
  )
}

function useToast(setter: React.Dispatch<React.SetStateAction<{ id: string; text: string }[]>>) {
  return useMemo(() => (text: string) => {
    const id = Math.random().toString(36).slice(2)
    setter((arr) => [...arr, { id, text }])
    setTimeout(() => setter((arr) => arr.filter((t) => t.id !== id)), 5000)
  }, [setter])
}
