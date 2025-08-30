"use client"
import Link from 'next/link'
import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

export default function ArticlePage({ params }: { params: { slug: string } }) {
  const slug = params.slug
  const [loading, setLoading] = useState(true)
  const [unlocked, setUnlocked] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState<string | null>(null)
  const [cost, setCost] = useState<number>(0)
  const [advise, setAdvise] = useState<any | null>(null)
  const [confirm, setConfirm] = useState<{ text: string; onOk: () => void } | null>(null)

  useEffect(() => {
    (async () => {
      // SSR guard fetch
      const r = await fetch(`${API}/api/articles/${slug}`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } })
      const g = await r.json()
      setTitle(g.post?.title ?? slug)
      if (g.unlocked) {
        setUnlocked(true)
        setBody(g.post?.body ?? '')
        setLoading(false)
        return
      }
      setUnlocked(false)
      setCost(g.cost ?? 0)
      // Dry-run for CTA
      const d = await fetch(`${API}/api/mp/dryrun`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' },
        body: JSON.stringify({ required: g.cost ?? 0 })
      })
      setAdvise(await d.json())
      setLoading(false)
    })()
  }, [slug])

  const tryUnlock = async () => {
    setLoading(true)
    const res = await fetch(`${API}/api/articles/${slug}/unlock`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' },
      body: JSON.stringify({ cost })
    })
    if (res.status === 200) location.reload()
    else {
      const data = await res.json()
      setAdvise(data?.advise)
      setLoading(false)
    }
  }

  if (loading) return <main style={{ padding: 24 }}><p>読み込み中...</p></main>
  if (unlocked) {
    return (
      <main style={{ padding: 24 }}>
        <h2>{title}</h2>
        <div style={{ whiteSpace: 'pre-wrap' }}>{body}</div>
        <p style={{ marginTop: 16 }}><Link href="/">戻る</Link></p>
      </main>
    )
  }
  return (
    <main style={{ padding: 24 }}>
      <h2>記事: {title || slug}</h2>
      <p>このコンテンツは {cost} MP で解放できます。</p>
      <Cta advise={advise} slug={slug} cost={cost} onUnlock={() => setConfirm({ text: `このコンテンツを ${cost}MP で解放します。よろしいですか？`, onOk: tryUnlock })} onConfirm={(cfg) => setConfirm(cfg)} />
      <p style={{ marginTop: 16 }}><Link href="/">戻る</Link></p>
      {confirm && (
        <Modal text={confirm.text} onCancel={() => setConfirm(null)} onOk={() => { const fn = confirm.onOk; setConfirm(null); fn() }} />
      )}
    </main>
  )
}

function Cta({ advise, slug, cost, onUnlock, onConfirm }: { advise: any, slug: string, cost: number, onUnlock: () => void, onConfirm: (cfg: { text: string; onOk: () => void }) => void }) {
  if (!advise) return <p>読み込みエラー</p>
  if (advise.enough) return <button onClick={onUnlock}>MPで解放（{cost}MP）</button>
  if (advise.membership === 'ACTIVE') {
    const k = advise.k
    const price = (advise.price_cents / 100).toFixed(2)
    return (
      <form action={`${API}/api/mp/buy`} method="post" onSubmit={(e) => { e.preventDefault(); onConfirm({ text: `エーテル ×${k}（${k * 333}MP / $${price}）を購入して解放します。よろしいですか？`, onOk: () => (e.currentTarget as HTMLFormElement).submit() }) }}>
        <input type="hidden" name="quantity" value={k} />
        <input type="hidden" name="cost" value={cost} />
        <input type="hidden" name="refType" value="post" />
        <input type="hidden" name="refId" value={slug} />
        <input type="hidden" name="xpKind" value="article" />
        <button>エーテル ×{k}（{k*333}MP / ${price}）購入して解放</button>
      </form>
    )
  }
  return <button onClick={async (e) => {
    e.preventDefault()
    onConfirm({ text: '再加入して月 999MP を受け取ります。よろしいですか？', onOk: async () => {
      const r = await fetch(`${API}/api/sub/checkout`, { method: 'POST', headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } })
      const data = await r.json()
      if (data.checkout_url) location.href = data.checkout_url
    } })
  }}>再加入して月 999MP を受け取る</button>
}

function Modal({ text, onOk, onCancel }: { text: string; onOk: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center' }}>
      <div style={{ background: '#2b3342', color: '#fff', padding: 16, borderRadius: 8, width: 'min(480px, 90%)', border: '1px solid rgba(255,255,255,0.12)' }}>
        <p style={{ margin: 0 }}>{text}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onCancel}>キャンセル</button>
          <button onClick={onOk} style={{ background: '#00b894', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: 6 }}>OK</button>
        </div>
      </div>
    </div>
  )
}
