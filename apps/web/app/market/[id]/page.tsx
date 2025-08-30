"use client"
import Link from 'next/link'
import { useEffect, useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8787'

export default function MarketPage({ params }: { params: { id: string } }) {
  const id = params.id
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<{ name: string, mp_cost: number, owned: boolean } | null>(null)
  const [advise, setAdvise] = useState<any | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ text: string; onOk: () => void } | null>(null)

  useEffect(() => {
    (async () => {
      // Fetch product info
      const r = await fetch(`${API}/api/market/${id}`, { headers: { 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' } })
      const product = await r.json()
      setInfo(product)
      // Owned? no CTA
      if (product.owned) {
        setLoading(false)
        return
      }
      // Dry-run for CTA
      const d = await fetch(`${API}/api/mp/dryrun`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' },
        body: JSON.stringify({ required: product.mp_cost })
      })
      setAdvise(await d.json())
      setLoading(false)
    })()
  }, [id])

  const doPurchase = async () => {
    if (!info) return
    setLoading(true)
    const res = await fetch(`${API}/api/market/${id}/purchase`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': 'demo-user-1', 'x-email': 'demo@example.com' },
      body: JSON.stringify({ cost: info.mp_cost })
    })
    const data = await res.json()
    if (res.status === 200) setDownloadUrl(data?.purchase?.download_url ?? null)
    else setAdvise(data?.advise)
    setLoading(false)
  }

  if (loading || !info) return <main style={{ padding: 24 }}><p>読み込み中...</p></main>
  if (downloadUrl) {
    return (
      <main style={{ padding: 24 }}>
        <h2>マーケット: {info.name} ({id})</h2>
        <p style={{ color: '#00b894' }}>購入完了（-{info.mp_cost}MP / +{Math.floor((3*info.mp_cost+1)/2)}XP）。</p>
        {downloadUrl && <p><a href={downloadUrl}>ダウンロードする</a></p>}
        <Link href="/members">メンバーズへ</Link>
      </main>
    )
  }
  return (
    <main style={{ padding: 24 }}>
      <h2>マーケット: {info.name} ({id})</h2>
      <p>この商品は {info.mp_cost} MP で購入できます。</p>
      <Cta advise={advise} id={id} cost={info.mp_cost} onPurchase={() => setConfirm({ text: `この商品を ${info.mp_cost}MP で購入します。よろしいですか？`, onOk: doPurchase })} onConfirm={(cfg) => setConfirm(cfg)} />
      <p style={{ marginTop: 16 }}><Link href="/">戻る</Link></p>
      {confirm && (
        <Modal text={confirm.text} onCancel={() => setConfirm(null)} onOk={() => { const fn = confirm.onOk; setConfirm(null); fn() }} />
      )}
    </main>
  )
}

function Cta({ advise, id, cost, onPurchase, onConfirm }: { advise: any, id: string, cost: number, onPurchase: () => void, onConfirm: (cfg: { text: string; onOk: () => void }) => void }) {
  if (!advise) return <p>読み込みエラー</p>
  if (advise.enough) return <button onClick={onPurchase}>MPで購入（{cost}MP）</button>
  if (advise.membership === 'ACTIVE') {
    const k = advise.k
    const price = (advise.price_cents / 100).toFixed(2)
    return (
      <form action={`${API}/api/mp/buy`} method="post" onSubmit={(e) => { e.preventDefault(); onConfirm({ text: `エーテル ×${k}（${k * 333}MP / $${price}）を購入します。よろしいですか？`, onOk: () => (e.currentTarget as HTMLFormElement).submit() }) }}>
        <input type="hidden" name="quantity" value={k} />
        <input type="hidden" name="cost" value={cost} />
        <input type="hidden" name="refType" value="product" />
        <input type="hidden" name="refId" value={id} />
        <input type="hidden" name="xpKind" value="market" />
        <button>エーテル ×{k}（{k*333}MP / ${price}）購入して決済</button>
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
