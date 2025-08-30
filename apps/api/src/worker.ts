import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'

export { LedgerDO } from './ledger-do'

const app = new Hono<{ Bindings: Env; Variables: { userId?: string; email?: string } }>()

app.use('*', cors())

// In real app, derive from session. For now, accept `x-user-id` and `x-email` for skeleton/demo.
app.use('*', async (c, next) => {
  const cookie = c.req.header('cookie') ?? ''
  const sid = parseCookie(cookie)['dom_session']
  const userId = sid ?? c.req.header('x-user-id') ?? 'demo-user-1'
  const email = c.req.header('x-email') ?? 'demo@example.com'
  c.set('userId', userId)
  c.set('email', email)
  await next()
})

function ledgerStub(c: any) {
  const env = c.env as Env
  const id = env.LEDGER_DO.idFromName('global')
  return env.LEDGER_DO.get(id)
}

// Auth: Magic Link (stubs)
app.post('/api/auth/magic-link', async (c) => {
  const { email } = await c.req.json()
  if (!email || typeof email !== 'string') return c.json({ ok: false, error: 'BAD_REQUEST' }, 400)
  // disposable domain block
  const domain = (email.split('@')[1] || '').toLowerCase()
  const block = (c.env.DISPOSABLE_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (domain && block.includes(domain)) return c.json({ ok: false, error: 'DISPOSABLE_EMAIL' }, 400)
  const now = Date.now()
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? ''
  // simple rate: 1 per 60s
  const recent = await c.env.DOM_DB.prepare('SELECT created_at FROM magic_links WHERE email = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1')
    .bind(email, now - 60_000).first<{ created_at: number }>()
  if (recent) return c.json({ ok: false, error: 'RATE_LIMIT', retry_after_sec: Math.ceil((recent.created_at + 60_000 - now)/1000) }, 429)
  // IP-based hourly rate limit
  const maxPerHour = Number(c.env.MAGIC_LINK_RATE_LIMIT_PER_HOUR || '10')
  if (ip) {
    const countRow = await c.env.DOM_DB.prepare('SELECT COUNT(*) as n FROM magic_links WHERE ip = ? AND created_at > ?')
      .bind(ip, now - 3600_000).first<{ n: number }>()
    if ((countRow?.n || 0) >= maxPerHour) return c.json({ ok: false, error: 'IP_RATE_LIMIT' }, 429)
  }
  // token
  const token = await randomToken()
  const tokenHash = await sha256Hex(token)
  const ttlMin = Number(c.env.MAGIC_LINK_TTL_MIN || '10')
  const expires = now + ttlMin * 60_000
  await c.env.DOM_DB.prepare('INSERT INTO magic_links (token_hash,email,created_at,expires_at,ip) VALUES (?,?,?,?,?)')
    .bind(tokenHash, email, now, expires, ip).run()
  const base = c.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const url = new URL('/api/auth/callback', base)
  url.searchParams.set('token', token)
  // Send via MailChannels if MAIL_FROM is set
  if (c.env.MAIL_FROM) {
    const res = await sendMagicLinkMail(c.env.MAIL_FROM, c.env.MAIL_FROM_NAME ?? 'Department of Mysteries', email, url.toString())
    if (!res.ok) return c.json({ ok: false, error: 'MAIL_SEND_FAILED' }, 500)
    return c.json({ ok: true })
  }
  // dev fallback: return link
  return c.json({ ok: true, link: url.toString() })
})

app.get('/api/auth/callback', async (c) => {
  const token = new URL(c.req.url).searchParams.get('token')
  if (!token) return c.json({ ok: false, error: 'BAD_REQUEST' }, 400)
  const now = Date.now()
  const tokenHash = await sha256Hex(token)
  const row = await c.env.DOM_DB.prepare('SELECT email, expires_at, used_at FROM magic_links WHERE token_hash = ?')
    .bind(tokenHash).first<{ email: string, expires_at: number, used_at: number | null }>()
  if (!row || row.used_at || row.expires_at < now) return c.json({ ok: false, error: 'TOKEN_INVALID' }, 400)
  await c.env.DOM_DB.prepare('UPDATE magic_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
    .bind(now, tokenHash).run()
  const email = row.email
  const userId = await userIdFromEmail(email)
  // Ensure user
  const stub = ledgerStub(c)
  await stub.fetch(new URL('/set-membership', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, membership: 'NONE' }) })
  // Session cookie
  const cookie = `dom_session=${userId}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`
  return new Response(JSON.stringify({ ok: true, userId }), { status: 200, headers: { 'set-cookie': cookie, 'content-type': 'application/json' } })
})

// Subscription webhooks (Stripe) — stubs with event type
app.post('/api/stripe/subscription-webhook', async (c) => {
  const sig = c.req.header('stripe-signature')
  const secret = c.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET
  const raw = await c.req.text()
  if (secret && !(await verifyStripeSig(raw, sig, secret))) return c.json({ ok: false, error: 'SIG_INVALID' }, 400)
  const body = JSON.parse(raw)
  const type = body?.type as string
  const userId = body?.data?.object?.metadata?.userId as string | undefined
  if (!type || !userId) return c.json({ ok: false, error: 'BAD_REQUEST' }, 400)
  const stub = ledgerStub(c)
  if (type === 'invoice.paid') {
    // Mark ACTIVE, then grant monthly free MP (idempotent by invoice id)
    await stub.fetch(new URL('/set-membership', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, membership: 'ACTIVE' }) })
    const res = await stub.fetch(new URL('/grant', 'http://do'), {
      method: 'POST', body: JSON.stringify({ userId, kind: 'free', amount: Number(c.env.MP_GRANT_MONTHLY), idempotencyKey: body?.data?.object?.id })
    })
    return c.json(await res.json<any>())
  }
  if (type === 'customer.subscription.deleted') {
    const res = await stub.fetch(new URL('/set-membership', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, membership: 'NONE' }) })
    return c.json(await res.json<any>())
  }
  if (type === 'customer.subscription.created') {
    const res = await stub.fetch(new URL('/set-membership', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, membership: 'ACTIVE' }) })
    return c.json(await res.json<any>())
  }
  if (type === 'checkout.session.completed') {
    const obj = body?.data?.object
    if (obj?.mode === 'subscription') {
      const uid = obj?.metadata?.userId as string | undefined
      if (uid) await stub.fetch(new URL('/set-membership', 'http://do'), { method: 'POST', body: JSON.stringify({ userId: uid, membership: 'ACTIVE' }) })
    }
    return c.json({ ok: true })
  }
  return c.json({ ok: true })
})

// Wallet APIs
app.get('/api/mp/wallet', async (c) => {
  const userId = c.get('userId')!
  const res = await ledgerStub(c).fetch(new URL(`/wallet/${userId}`, 'http://do'))
  return c.json(await res.json<any>())
})

app.get('/api/mp/ledger', async (c) => {
  const userId = c.get('userId')!
  const url = new URL(c.req.url)
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50)))
  const res = await ledgerStub(c).fetch(new URL(`/ledger/${userId}?limit=${limit}`, 'http://do'))
  return c.json(await res.json<any>())
})

// Dry-run proxy: compute suggested ether quantity / overflow / cap for UI
app.post('/api/mp/dryrun', async (c) => {
  const userId = c.get('userId')!
  const { required } = await c.req.json()
  const res = await ledgerStub(c).fetch(new URL('/dryrun', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, required }) })
  return c.json(await res.json<any>())
})

app.get('/api/mp/store', async (c) => {
  // Only ACTIVE may buy ether; check profile via wallet route
  const userId = c.get('userId')!
  const w = await ledgerStub(c).fetch(new URL(`/wallet/${userId}`, 'http://do'))
  const data: any = await w.json()
  if (data.membership !== 'ACTIVE') return c.json({ error: 'MEMBERSHIP_REQUIRED' }, 403)
  return c.json({ pack: 'ether', grant: Number(c.env.ETHER_GRANT), price_cents: Number(c.env.ETHER_PRICE_CENTS) })
})

// Subscription: create Checkout Session for rejoin
app.post('/api/sub/checkout', async (c) => {
  const userId = c.get('userId')!
  const price = c.env.STRIPE_PRICE_SUB
  const sk = c.env.STRIPE_SECRET_KEY
  if (!price || !sk) return c.json({ error: 'SUBSCRIPTION_NOT_CONFIGURED' }, 500)
  const success = (c.env.PUBLIC_BASE_URL ?? 'http://localhost:3000') + '/members'
  const cancel = (c.env.PUBLIC_BASE_URL ?? 'http://localhost:3000') + '/members'
  const body = new URLSearchParams()
  body.set('mode', 'subscription')
  body.set('success_url', success)
  body.set('cancel_url', cancel)
  body.set('line_items[0][price]', price)
  body.set('line_items[0][quantity]', '1')
  body.set('metadata[userId]', userId)
  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sk}`, 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data: any = await resp.json()
  if (!resp.ok) return c.json({ error: 'STRIPE_ERROR', detail: data }, 502)
  await c.env.DOM_DB.prepare('INSERT INTO audit_logs (user_id, action, meta, ts) VALUES (?,?,?,?)')
    .bind(userId, 'sub_checkout_created', JSON.stringify({ session_id: data.id }), Date.now()).run()
  return c.json({ checkout_url: data.url, session_id: data.id })
})

app.post('/api/mp/buy', async (c) => {
  const userId = c.get('userId')!
  let quantity = 1, cost = 0, refType = 'system', refId = 'ether', xpKind = 'article'
  const ct = c.req.header('content-type') || ''
  if (ct.includes('application/x-www-form-urlencoded')) {
    const fd = await c.req.formData()
    quantity = Number(fd.get('quantity') ?? 1)
    cost = Number(fd.get('cost') ?? 0)
    refType = String(fd.get('refType') ?? 'system')
    refId = String(fd.get('refId') ?? 'ether')
    xpKind = String(fd.get('xpKind') ?? 'article')
  } else {
    const body = await c.req.json()
    quantity = Number(body.quantity ?? 1)
    cost = Number(body.cost ?? 0)
    refType = body.refType ?? 'system'
    refId = body.refId ?? 'ether'
    xpKind = body.xpKind ?? 'article'
  }
  // Only ACTIVE can buy Ether
  const wres = await ledgerStub(c).fetch(new URL(`/wallet/${userId}`, 'http://do'))
  const wdata: any = await wres.json()
  if (wdata.membership !== 'ACTIVE') return c.json({ error: 'MEMBERSHIP_REQUIRED' }, 403)
  // If Stripe configured, create Checkout; else fallback to mock URL
  const price = c.env.STRIPE_PRICE_ETHER
  const sk = c.env.STRIPE_SECRET_KEY
  const success = (c.env.PUBLIC_BASE_URL ?? 'http://localhost:3000') + '/members'
  const cancel = (c.env.PUBLIC_BASE_URL ?? 'http://localhost:3000') + '/members'
  if (price && sk) {
    const body = new URLSearchParams()
    body.set('mode', 'payment')
    body.set('success_url', success)
    body.set('cancel_url', cancel)
    body.set('line_items[0][price]', price)
    body.set('line_items[0][quantity]', String(quantity))
    body.set('metadata[userId]', userId)
    body.set('metadata[quantity]', String(quantity))
    body.set('metadata[refType]', refType)
    body.set('metadata[refId]', refId)
    body.set('metadata[xpKind]', xpKind)
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sk}`, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data: any = await resp.json()
    // Track pending tx with session_id; payment_intent becomes known after completion
    await ledgerStub(c).fetch(new URL('/tx/start', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, cost, refType, refId, xpKind, session_id: data.id }) })
    await c.env.DOM_DB.prepare('INSERT INTO audit_logs (user_id, action, meta, ts) VALUES (?,?,?,?)')
      .bind(userId, 'ether_checkout_created', JSON.stringify({ session_id: data.id, quantity }), Date.now()).run()
    return c.json({ checkout_url: data.url, session_id: data.id })
  }
  // Fallback mock
  const payment_intent = `pi_${crypto.randomUUID()}`
  await ledgerStub(c).fetch(new URL('/tx/start', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, cost, refType, refId, xpKind, payment_intent }) })
  await c.env.DOM_DB.prepare('INSERT INTO audit_logs (user_id, action, meta, ts) VALUES (?,?,?,?)')
    .bind(userId, 'ether_checkout_mock', JSON.stringify({ payment_intent, quantity }), Date.now()).run()
  return c.json({ checkout_url: `https://checkout.stripe.com/mock?qty=${quantity}` })
})

// Stripe webhook for MP purchase
app.post('/api/stripe/mp-webhook', async (c) => {
  const sig = c.req.header('stripe-signature')
  const secret = c.env.STRIPE_MP_WEBHOOK_SECRET
  const raw = await c.req.text()
  if (secret && !(await verifyStripeSig(raw, sig, secret))) return c.json({ error: 'SIG_INVALID' }, 400)
  const evt = JSON.parse(raw)
  const type = evt.type as string
  const obj = evt.data?.object
  const stub = ledgerStub(c)
  if (type === 'checkout.session.completed') {
    const userId = obj?.metadata?.userId as string | undefined
    const qty = Number(obj?.metadata?.quantity ?? 1)
    const session_id = obj?.id as string | undefined
    const payment_intent = obj?.payment_intent as string | undefined
    if (!userId || !session_id) return c.json({ error: 'BAD_REQUEST' }, 400)
    if (payment_intent) {
      await stub.fetch(new URL('/tx/update', 'http://do'), { method: 'POST', body: JSON.stringify({ session_id, payment_intent }) })
      const amount = Number(c.env.ETHER_GRANT) * qty
      await stub.fetch(new URL('/grant', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, kind: 'paid', amount, idempotencyKey: payment_intent }) })
      await stub.fetch(new URL('/tx/finalize', 'http://do'), { method: 'POST', body: JSON.stringify({ payment_intent }) })
      await c.env.DOM_DB.prepare('INSERT INTO audit_logs (user_id, action, meta, ts) VALUES (?,?,?,?)')
        .bind(userId, 'mp_webhook_finalize', JSON.stringify({ payment_intent, qty }), Date.now()).run()
    }
  }
  return c.json({ ok: true })
})

async function verifyStripeSig(raw: string, header: string | undefined, secret: string): Promise<boolean> {
  if (!header) return false
  // header: t=timestamp, v1=signature
  const parts = Object.fromEntries(header.split(',').map(kv => kv.split('='))) as any
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return false
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const payload = encoder.encode(`${t}.${raw}`)
  // Workers crypto subtle
  try {
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sigBuf = await crypto.subtle.sign('HMAC', key, payload)
    const sigHex = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('')
    return sigHex === v1
  } catch {
    return false
  }
}

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  header.split(';').forEach(p => {
    const [k, ...rest] = p.trim().split('=')
    if (!k) return
    out[k] = rest.join('=')
  })
  return out
}

async function userIdFromEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.toLowerCase())
  const hash = await crypto.subtle.digest('SHA-256', data)
  const b = Array.from(new Uint8Array(hash)).map(x => x.toString(16).padStart(2, '0')).join('')
  return 'u_' + b.slice(0, 24)
}

async function randomToken(): Promise<string> {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  // base64url encode
  const b64 = btoa(String.fromCharCode(...buf))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function presignR2GetUrl(opts: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; region: string; key: string; expiresSeconds: number }): Promise<string> {
  const { accountId, accessKeyId, secretAccessKey, bucket, region, key, expiresSeconds } = opts
  const host = `${accountId}.r2.cloudflarestorage.com`
  const path = `/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|/g, '').slice(0, 15) + 'Z' // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8) // YYYYMMDD
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`
  const params = new URLSearchParams()
  params.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  params.set('X-Amz-Credential', `${accessKeyId}/${credentialScope}`)
  params.set('X-Amz-Date', amzDate)
  params.set('X-Amz-Expires', String(expiresSeconds))
  params.set('X-Amz-SignedHeaders', 'host')
  // Canonical request
  const qp: string[] = []
  params.forEach((v, k) => {
    qp.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  })
  const canonicalQuery = qp.sort().join('&')
  const canonicalHeaders = `host:${host}\n`
  const signedHeaders = 'host'
  const payloadHash = 'UNSIGNED-PAYLOAD'
  const canonicalRequest = `GET\n${path}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const hash = await sha256Hex(canonicalRequest)
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${hash}`
  const kDate = await hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, 's3')
  const kSigning = await hmac(kService, 'aws4_request')
  const signature = await hmacHex(kSigning, stringToSign)
  const url = `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`
  return url
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hmac(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const rawKey = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

async function hmacHex(key: ArrayBuffer, data: string): Promise<string> {
  const res = await hmac(key, data)
  return [...new Uint8Array(res)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// duplicate removed: sha256Hex defined above

async function sendMagicLinkMail(from: string, fromName: string, to: string, link: string): Promise<Response> {
  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: fromName },
    subject: 'Your magic login link',
    content: [{ type: 'text/plain', value: `Sign in: ${link}\nThis link expires in 10 minutes and can be used once.` }]
  }
  return fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  })
}

// Articles unlock
app.post('/api/articles/:slug/unlock', async (c) => {
  const userId = c.get('userId')!
  const slug = c.req.param('slug')
  const { cost } = await c.req.json()
  const res = await ledgerStub(c).fetch(new URL('/spend', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, amount: cost, refType: 'post', refId: slug, xpKind: 'article' }) })
  const data: any = await res.json()
  if (data.error !== 'INSUFFICIENT_MP') {
    return c.json({ ok: true, unlock: { slug }, profile: data.profile })
  }
  // Not enough: provide dry-run to guide CTA
  const dry = await ledgerStub(c).fetch(new URL('/dryrun', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, required: cost }) })
  const advise: any = await dry.json()
  return c.json({ error: 'INSUFFICIENT_MP', advise }, 402)
})

// Market purchase
app.post('/api/market/:id/purchase', async (c) => {
  const userId = c.get('userId')!
  const id = c.req.param('id')
  const { cost } = await c.req.json()
  const res = await ledgerStub(c).fetch(new URL('/spend', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, amount: cost, refType: 'product', refId: id, xpKind: 'market' }) })
  const data: any = await res.json()
  if (data.error !== 'INSUFFICIENT_MP') {
    const token = data.downloadToken
    const origin = new URL(c.req.url).origin
    const download_url = token ? `${origin}/api/market/${id}/download?token=${token}` : undefined
    // Optionally return R2 signed URL (short TTL). Single-useはDBトークン側で担保。
    let signed_url: string | undefined
    if (token && c.env.R2_ACCESS_KEY_ID && c.env.R2_SECRET_ACCESS_KEY && c.env.R2_ACCOUNT_ID) {
      const key = await c.env.DOM_DB.prepare('SELECT asset_key FROM products WHERE id = ?').bind(id).first<{ asset_key: string }>()
      if (key?.asset_key) {
        signed_url = await presignR2GetUrl({
          accountId: c.env.R2_ACCOUNT_ID!,
          accessKeyId: c.env.R2_ACCESS_KEY_ID!,
          secretAccessKey: c.env.R2_SECRET_ACCESS_KEY!,
          bucket: c.env.R2_BUCKET || 'dom-assets',
          region: c.env.R2_REGION || 'auto',
          key: key.asset_key,
          expiresSeconds: Number(c.env.R2_PRESIGN_TTL_SEC || '60'),
        })
      }
    }
    return c.json({ ok: true, purchase: { id, download_url, signed_url } })
  }
  const dry = await ledgerStub(c).fetch(new URL('/dryrun', 'http://do'), { method: 'POST', body: JSON.stringify({ userId, required: cost }) })
  const advise: any = await dry.json()
  return c.json({ error: 'INSUFFICIENT_MP', advise }, 402)
})

// Apps SSO token
app.post('/api/apps/:id/sso-token', async (c) => {
  const userId = c.get('userId')!
  const email = c.get('email')!
  const id = c.req.param('id')
  const ttlMin = Number(c.env.JWT_TTL_MIN ?? '5')
  const now = Math.floor(Date.now() / 1000)
  const payload = { iss: 'dom', aud: id, sub: userId, email, iat: now, exp: now + ttlMin * 60, jti: crypto.randomUUID() }
  const pem = c.env.APP_SSO_PRIVATE_KEY_PEM
  if (pem) {
    const token = await signJwtRS256(payload, pem)
    return c.json({ token, alg: 'RS256' })
  }
  const token = `stub.${btoa(JSON.stringify(payload))}.stub`
  return c.json({ token, note: 'unsigned stub token - set APP_SSO_PRIVATE_KEY_PEM for RS256' })
})

app.get('/', (c) => c.text('Department of Mysteries API'))

export default app

// SSR guard for articles: return full body only if unlocked
app.get('/api/articles/:slug', async (c) => {
  const userId = c.get('userId')!
  const slug = c.req.param('slug')
  const row = await c.env.DOM_DB.prepare('SELECT id, title, body_mdx, mp_cost FROM posts WHERE slug = ?').bind(slug).first<{ id: string, title: string, body_mdx: string, mp_cost: number }>()
  if (!row) return c.json({ error: 'NOT_FOUND' }, 404)
  const unlocked = await c.env.DOM_DB.prepare('SELECT 1 FROM post_unlocks WHERE user_id = ? AND post_id = ?').bind(userId, row.id).first()
  if (unlocked) return c.json({ unlocked: true, post: { title: row.title, body: row.body_mdx } })
  return c.json({ unlocked: false, post: { title: row.title }, cost: row.mp_cost })
})

// One-time asset download via R2 and DB token
app.get('/api/market/:id/download', async (c) => {
  const id = c.req.param('id')
  const token = new URL(c.req.url).searchParams.get('token')
  if (!token) return c.json({ error: 'BAD_REQUEST' }, 400)
  const now = Date.now()
  const row = await c.env.DOM_DB.prepare('SELECT token,user_id,product_id,asset_key,expires_at,used_at FROM download_tokens WHERE token = ?').bind(token).first<{
    token: string, user_id: string, product_id: string, asset_key: string, expires_at: number, used_at: number | null
  }>()
  if (!row || row.product_id !== id || row.expires_at < now || row.used_at) return c.json({ error: 'TOKEN_INVALID' }, 403)
  await c.env.DOM_DB.prepare('UPDATE download_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL').bind(now, token).run()
  const obj = await c.env.R2_ASSETS.get(row.asset_key)
  if (!obj) return c.json({ error: 'ASSET_NOT_FOUND' }, 404)
  const headers = new Headers()
  // apply basic metadata if present
  const md = obj.httpMetadata
  if (md?.contentType) headers.set('Content-Type', md.contentType)
  if (md?.contentLanguage) headers.set('Content-Language', md.contentLanguage)
  if (md?.contentDisposition) headers.set('Content-Disposition', md.contentDisposition)
  if (md?.contentEncoding) headers.set('Content-Encoding', md.contentEncoding)
  if (md?.cacheControl) headers.set('Cache-Control', md.cacheControl)
  if (md?.cacheExpiry) headers.set('Expires', new Date(md.cacheExpiry).toUTCString())
  headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(row.asset_key.split('/').pop() || 'download.bin')}"`)
  return new Response(obj.body, { status: 200, headers })
})

// Exchange token for short-lived R2 presigned URL (optional)
app.get('/api/market/:id/presign', async (c) => {
  const id = c.req.param('id')
  const token = new URL(c.req.url).searchParams.get('token')
  if (!token) return c.json({ error: 'BAD_REQUEST' }, 400)
  if (!c.env.R2_ACCESS_KEY_ID || !c.env.R2_SECRET_ACCESS_KEY || !c.env.R2_ACCOUNT_ID) return c.json({ error: 'NOT_CONFIGURED' }, 500)
  const now = Date.now()
  const row = await c.env.DOM_DB.prepare('SELECT token,user_id,product_id,asset_key,expires_at,used_at FROM download_tokens WHERE token = ?').bind(token).first<{
    token: string, user_id: string, product_id: string, asset_key: string, expires_at: number, used_at: number | null
  }>()
  if (!row || row.product_id !== id || row.expires_at < now || row.used_at) return c.json({ error: 'TOKEN_INVALID' }, 403)
  // mark used to preserve single-use semantics on our side
  await c.env.DOM_DB.prepare('UPDATE download_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL').bind(now, token).run()
  const signed = await presignR2GetUrl({
    accountId: c.env.R2_ACCOUNT_ID!,
    accessKeyId: c.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY!,
    bucket: c.env.R2_BUCKET || 'dom-assets',
    region: c.env.R2_REGION || 'auto',
    key: row.asset_key,
    expiresSeconds: Number(c.env.R2_PRESIGN_TTL_SEC || '60'),
  })
  return c.json({ url: signed })
})

function b64u(input: ArrayBuffer | string): string {
  let b64: string
  if (typeof input === 'string') b64 = btoa(input)
  else b64 = btoa(String.fromCharCode(...new Uint8Array(input)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function parsePkcs8Pem(pem: string): ArrayBuffer {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

async function signJwtRS256(payload: Record<string, any>, privateKeyPem: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const encHeader = b64u(JSON.stringify(header))
  const encPayload = b64u(JSON.stringify(payload))
  const data = new TextEncoder().encode(`${encHeader}.${encPayload}`)
  const keyData = parsePkcs8Pem(privateKeyPem)
  const key = await crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data)
  const encSig = b64u(sig)
  return `${encHeader}.${encPayload}.${encSig}`
}

// Product info (SSR guard-like): returns minimal info; does not expose asset
app.get('/api/market/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DOM_DB.prepare('SELECT id, name, mp_cost FROM products WHERE id = ? AND (visible IS NULL OR visible = 1)')
    .bind(id).first<{ id: string, name: string, mp_cost: number }>()
  if (!row) return c.json({ error: 'NOT_FOUND' }, 404)
  const userId = c.get('userId')!
  const owned = await c.env.DOM_DB.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND product_id = ?').bind(userId, id).first()
  return c.json({ id: row.id, name: row.name, mp_cost: row.mp_cost, owned: !!owned })
})

// List products (visible)
app.get('/api/market', async (c) => {
  const userId = c.get('userId')!
  const rows = await c.env.DOM_DB.prepare('SELECT id, name, mp_cost FROM products WHERE visible IS NULL OR visible = 1 ORDER BY created_at DESC NULLS LAST, id').all()
  const results = [] as any[]
  for (const r of rows?.results ?? []) {
    const owned = await c.env.DOM_DB.prepare('SELECT 1 FROM purchases WHERE user_id = ? AND product_id = ?').bind(userId, (r as any).id).first()
    results.push({ id: (r as any).id, name: (r as any).name, mp_cost: (r as any).mp_cost, owned: !!owned })
  }
  return c.json({ items: results })
})

// List posts
app.get('/api/articles', async (c) => {
  const userId = c.get('userId')!
  const rows = await c.env.DOM_DB.prepare('SELECT id, slug, title, mp_cost FROM posts ORDER BY date DESC NULLS LAST, id').all()
  const results = [] as any[]
  for (const r of rows?.results ?? []) {
    const unlocked = await c.env.DOM_DB.prepare('SELECT 1 FROM post_unlocks WHERE user_id = ? AND post_id = ?')
      .bind(userId, (r as any).id).first()
    results.push({ id: (r as any).id, slug: (r as any).slug, title: (r as any).title, mp_cost: (r as any).mp_cost, unlocked: !!unlocked })
  }
  return c.json({ items: results })
})

// List apps (visible)
app.get('/api/apps', async (c) => {
  const rows = await c.env.DOM_DB.prepare('SELECT id, name, manifest_url, icon_key FROM apps WHERE visible IS NULL OR visible = 1 ORDER BY created_at DESC NULLS LAST, id').all()
  return c.json({ items: rows?.results ?? [] })
})

// Admin: seed minimal content (requires x-admin-secret)
app.post('/api/admin/seed', async (c) => {
  const sec = c.req.header('x-admin-secret')
  if ((c.env.ADMIN_SECRET ?? 'dev') !== (sec ?? '')) return c.json({ error: 'FORBIDDEN' }, 403)
  const now = Date.now()
  // Seed posts
  const postId = 'post-hello'
  await c.env.DOM_DB.prepare('INSERT OR IGNORE INTO posts (id, slug, title, date, body_mdx, mp_cost) VALUES (?,?,?,?,?,?)')
    .bind(postId, 'hello', 'はじめてのDOM', now, '# Hello\n\nこれはサンプル記事本文です。', 15).run()
  // Seed product
  const prodId = 'demo-product'
  await c.env.DOM_DB.prepare('INSERT OR IGNORE INTO products (id, name, mp_cost, asset_key, visible) VALUES (?,?,?,?,1)')
    .bind(prodId, 'デモプロダクト', 40, 'assets/demo.txt').run()
  // Seed app
  const appId = 'demo-app'
  await c.env.DOM_DB.prepare('INSERT OR IGNORE INTO apps (id, name, manifest_url, icon_key, visible, created_at) VALUES (?,?,?,?,1,?)')
    .bind(appId, 'Demo App', 'https://example.com/app.json', 'assets/app.png', now).run()
  // Put demo asset to R2 if missing
  const key = 'assets/demo.txt'
  const head = await c.env.R2_ASSETS.head(key)
  if (!head) {
    await c.env.R2_ASSETS.put(key, 'This is a demo asset for Department of Mysteries.\n', { httpMetadata: { contentType: 'text/plain' } })
  }
  return c.json({ ok: true, posts: ['hello'], products: [prodId], asset: key })
})

// Admin: audit logs (requires x-admin-secret)
app.get('/api/admin/audit', async (c) => {
  const sec = c.req.header('x-admin-secret')
  if ((c.env.ADMIN_SECRET ?? 'dev') !== (sec ?? '')) return c.json({ error: 'FORBIDDEN' }, 403)
  const url = new URL(c.req.url)
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? 100)))
  const userId = url.searchParams.get('user_id')
  const action = url.searchParams.get('action')
  const from = url.searchParams.get('from') // ms epoch or ISO
  const to = url.searchParams.get('to')
  const conds: string[] = []
  const params: any[] = []
  if (userId) { conds.push('user_id = ?'); params.push(userId) }
  if (action) { conds.push('action = ?'); params.push(action) }
  const parseTs = (v: string | null) => {
    if (!v) return undefined
    const n = Number(v)
    if (!Number.isNaN(n) && n > 0) return n
    const d = Date.parse(v)
    return Number.isNaN(d) ? undefined : d
  }
  const fromTs = parseTs(from)
  const toTs = parseTs(to)
  if (fromTs) { conds.push('ts >= ?'); params.push(fromTs) }
  if (toTs) { conds.push('ts <= ?'); params.push(toTs) }
  let q = 'SELECT user_id, action, meta, ts FROM audit_logs'
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' ORDER BY ts DESC LIMIT ?'; params.push(limit)
  const rows = await c.env.DOM_DB.prepare(q).bind(...params).all()
  const items = (rows?.results ?? []).map((r: any) => ({ ...r, meta: safeParseJson(r.meta) }))
  return c.json({ items })
})

function safeParseJson(s: any) { try { return JSON.parse(s ?? '{}') } catch { return {} } }
