import { Hono } from 'hono'
// @ts-ignore - consuming compiled domain output without types
import { awardXp, walletCap, xpFromArticle, xpFromMarket } from '../../packages/domain/dist/index.js'
import type { Env } from './types'

type Membership = 'ACTIVE' | 'NONE'

export class LedgerDO implements DurableObject {
  state: DurableObjectState
  app: Hono<{ Bindings: Env }>
  env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
    this.app = new Hono<{ Bindings: Env }>()

    // Grant (free/paid) with idempotency and cap check
    this.app.post('/grant', async (c) => {
      const { userId, kind, amount, idempotencyKey } = await c.req.json()
      if (!userId || !kind || !amount) return c.json({ error: 'BAD_REQUEST' }, 400)
      if (idempotencyKey) {
        const ok = await this.tryInsertIdem(idempotencyKey)
        if (!ok) return c.json({ ok: true, idempotent: true })
      }
      await this.ensureUser(userId)
      const p = await this.dbGetProfile(userId)
      const w = await this.dbGetWallet(userId)
      const cap = walletCap(p.level)
      if (w.free + w.paid + amount > cap) return c.json({ error: 'CAP_EXCEEDED' }, 409)
      const now = Date.now()
      if (kind === 'free') {
        await this.env.DOM_DB.prepare('UPDATE mp_wallets SET free_balance = free_balance + ? WHERE user_id = ?').bind(amount, userId).run()
      } else {
        await this.env.DOM_DB.prepare('UPDATE mp_wallets SET paid_balance = paid_balance + ? WHERE user_id = ?').bind(amount, userId).run()
      }
      const total = w.free + w.paid + amount
      await this.env.DOM_DB.prepare('INSERT INTO mp_ledger (id,user_id,kind,mp_kind,amount,balance_after,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), userId, 'grant', kind, amount, total, now).run()
      await this.env.DOM_DB.prepare('INSERT INTO audit_logs (user_id, action, meta, ts) VALUES (?,?,?,?)')
        .bind(userId, 'grant', JSON.stringify({ kind, amount, idempotencyKey }), now).run()
      const newWallet = await this.dbGetWallet(userId)
      return c.json({ ok: true, wallet: { free: newWallet.free, paid: newWallet.paid, level: p.level } })
    })

    // Spend in free->paid order and award XP
    this.app.post('/spend', async (c) => {
      const { userId, amount, refType, refId, xpKind } = await c.req.json()
      if (!userId || !amount) return c.json({ error: 'BAD_REQUEST' }, 400)
      await this.ensureUser(userId)
      const p = await this.dbGetProfile(userId)
      const w = await this.dbGetWallet(userId)
      let remaining = amount
      const takeFree = Math.min(w.free, remaining)
      remaining -= takeFree
      const takePaid = Math.min(w.paid, remaining)
      remaining -= takePaid
      if (remaining > 0) return c.json({ error: 'INSUFFICIENT_MP' }, 402)
      const now = Date.now()
      await this.env.DOM_DB.prepare('BEGIN').run()
      try {
        await this.env.DOM_DB.prepare('UPDATE mp_wallets SET free_balance = free_balance - ?, paid_balance = paid_balance - ? WHERE user_id = ?')
          .bind(takeFree, takePaid, userId).run()
        const after = w.free + w.paid - amount
        await this.env.DOM_DB.prepare('INSERT INTO mp_ledger (id,user_id,kind,mp_kind,amount,balance_after,ref_type,ref_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(crypto.randomUUID(), userId, 'spend', null, -amount, after, refType ?? null, refId ?? null, now).run()
        await this.env.DOM_DB.prepare('INSERT INTO audit_logs (user_id, action, meta, ts) VALUES (?,?,?,?)')
          .bind(userId, 'spend', JSON.stringify({ amount, refType, refId }), now).run()
        // Commit unlock/purchase
        if (refType === 'post' && refId) {
          await this.env.DOM_DB.prepare('INSERT OR IGNORE INTO post_unlocks (user_id, post_id, unlocked_at, method) VALUES (?,?,?,?)')
            .bind(userId, refId, now, 'mp').run()
        }
        if (refType === 'product' && refId) {
          await this.env.DOM_DB.prepare('INSERT OR IGNORE INTO purchases (user_id, product_id, created_at) VALUES (?,?,?)')
            .bind(userId, refId, now).run()
          const prod = await this.env.DOM_DB.prepare('SELECT asset_key FROM products WHERE id = ?').bind(refId).first<{ asset_key: string }>()
          const assetKey = prod?.asset_key ?? ''
          const token = crypto.randomUUID()
          const exp = now + (Number(this.env.DOWNLOAD_TOKEN_TTL_SEC || '300') * 1000)
          await this.env.DOM_DB.prepare('INSERT INTO download_tokens (token,user_id,product_id,asset_key,expires_at) VALUES (?,?,?,?,?)')
            .bind(token, userId, refId, assetKey, exp).run()
          ;(c as any).var = { ...(c as any).var, downloadToken: token }
        }
        const base = xpKind === 'market' ? xpFromMarket(amount) : xpFromArticle(amount)
        const leveled = awardXp({ level: p.level, currentXp: p.currentXp }, base)
        await this.env.DOM_DB.prepare('UPDATE profiles SET level = ?, current_xp = ?, updated_at = ? WHERE user_id = ?')
          .bind(leveled.level, leveled.currentXp, now, userId).run()
        await this.env.DOM_DB.prepare('COMMIT').run()
        const newW = await this.dbGetWallet(userId)
        const dt = (c as any).var?.downloadToken
        return c.json({ ok: true, wallet: { free: newW.free, paid: newW.paid, level: p.level }, profile: { level: leveled.level, currentXp: leveled.currentXp }, xpAdded: leveled.added, downloadToken: dt })
      } catch (e) {
        await this.env.DOM_DB.prepare('ROLLBACK').run()
        return c.json({ error: 'TX_FAILED' }, 500)
      }
    })

    // Membership set
    this.app.post('/set-membership', async (c) => {
      const { userId, membership } = await c.req.json()
      await this.ensureUser(userId)
      await this.env.DOM_DB.prepare('UPDATE profiles SET membership = ?, updated_at = ? WHERE user_id = ?')
        .bind(membership, Date.now(), userId).run()
      const p = await this.dbGetProfile(userId)
      return c.json({ ok: true, profile: p })
    })

    // Dry-run for auto top-up UI
    this.app.post('/dryrun', async (c) => {
      const { userId, required } = await c.req.json()
      if (!userId || typeof required !== 'number') return c.json({ error: 'BAD_REQUEST' }, 400)
      await this.ensureUser(userId)
      const w = await this.dbGetWallet(userId)
      const p = await this.dbGetProfile(userId)
      const total = w.free + w.paid
      const need = Math.max(required - total, 0)
      const k = Math.ceil(need / Number(this.env.ETHER_GRANT || '333'))
      const grant = k * Number(this.env.ETHER_GRANT || '333')
      const price_cents = k * Number(this.env.ETHER_PRICE_CENTS || '300')
      const cap = walletCap(p.level)
      const overflow = total + grant > cap
      return c.json({ membership: p.membership, enough: need === 0, required, balance: total, need, k, grant, price_cents, cap, overflow })
    })

    // Start a pending auto-topup transaction
    this.app.post('/tx/start', async (c) => {
      const { userId, cost, refType, refId, xpKind, payment_intent, session_id } = await c.req.json()
      if (!userId || !refType || !refId || typeof cost !== 'number' || (xpKind !== 'article' && xpKind !== 'market')) {
        return c.json({ error: 'BAD_REQUEST' }, 400)
      }
      await this.env.DOM_DB.prepare('INSERT OR IGNORE INTO pending_tx (payment_intent,session_id,user_id,cost,ref_type,ref_id,xp_kind,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(payment_intent ?? null, session_id ?? null, userId, cost, refType, refId, xpKind, Date.now()).run()
      return c.json({ ok: true })
    })

    // Update a pending tx with payment_intent once known (from Checkout session)
    this.app.post('/tx/update', async (c) => {
      const { session_id, payment_intent } = await c.req.json()
      if (!session_id || !payment_intent) return c.json({ error: 'BAD_REQUEST' }, 400)
      await this.env.DOM_DB.prepare('UPDATE pending_tx SET payment_intent = ? WHERE session_id = ? AND (payment_intent IS NULL OR payment_intent = "")')
        .bind(payment_intent, session_id).run()
      return c.json({ ok: true })
    })

    // Finalize TX after paid webhook grant
    this.app.post('/tx/finalize', async (c) => {
      const { payment_intent } = await c.req.json()
      if (!payment_intent) return c.json({ error: 'BAD_REQUEST' }, 400)
      const ok = await this.tryInsertIdem(`final:${payment_intent}`)
      if (!ok) return c.json({ ok: true, idempotent: true })
      const row = await this.env.DOM_DB.prepare('SELECT user_id,cost,ref_type,ref_id,xp_kind FROM pending_tx WHERE payment_intent = ?').bind(payment_intent).first<{
        user_id: string; cost: number; ref_type: string; ref_id: string; xp_kind: 'article'|'market'
      }>()
      if (!row) return c.json({ error: 'TX_NOT_FOUND' }, 404)
      const { user_id: userId, cost, ref_type: refType, ref_id: refId, xp_kind: xpKind } = row
      const p = await this.dbGetProfile(userId)
      const w = await this.dbGetWallet(userId)
      let remaining = cost
      const takeFree = Math.min(w.free, remaining)
      remaining -= takeFree
      const takePaid = Math.min(w.paid, remaining)
      remaining -= takePaid
      if (remaining > 0) return c.json({ error: 'INSUFFICIENT_AFTER_GRANT' }, 409)
      const now = Date.now()
      await this.env.DOM_DB.prepare('BEGIN').run()
      try {
        await this.env.DOM_DB.prepare('UPDATE mp_wallets SET free_balance = free_balance - ?, paid_balance = paid_balance - ? WHERE user_id = ?')
          .bind(takeFree, takePaid, userId).run()
        const after = w.free + w.paid - cost
        await this.env.DOM_DB.prepare('INSERT INTO mp_ledger (id,user_id,kind,mp_kind,amount,balance_after,ref_type,ref_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(crypto.randomUUID(), userId, 'spend', null, -cost, after, refType, refId, now).run()
        await this.env.DOM_DB.prepare('INSERT INTO audit_logs (user_id, action, meta, ts) VALUES (?,?,?,?)')
          .bind(userId, 'tx_finalize', JSON.stringify({ payment_intent, refType, refId, cost }), now).run()
        if (refType === 'post' && refId) {
          await this.env.DOM_DB.prepare('INSERT OR IGNORE INTO post_unlocks (user_id, post_id, unlocked_at, method) VALUES (?,?,?,?)')
            .bind(userId, refId, now, 'mp').run()
        }
        if (refType === 'product' && refId) {
          await this.env.DOM_DB.prepare('INSERT OR IGNORE INTO purchases (user_id, product_id, created_at) VALUES (?,?,?)')
            .bind(userId, refId, now).run()
          const prod = await this.env.DOM_DB.prepare('SELECT asset_key FROM products WHERE id = ?').bind(refId).first<{ asset_key: string }>()
          const assetKey = prod?.asset_key ?? ''
          const token = crypto.randomUUID()
          const exp = now + (Number(this.env.DOWNLOAD_TOKEN_TTL_SEC || '300') * 1000)
          await this.env.DOM_DB.prepare('INSERT INTO download_tokens (token,user_id,product_id,asset_key,expires_at) VALUES (?,?,?,?,?)')
            .bind(token, userId, refId, assetKey, exp).run()
          ;(c as any).var = { ...(c as any).var, downloadToken: token }
        }
        const base = xpKind === 'market' ? xpFromMarket(cost) : xpFromArticle(cost)
        const leveled = awardXp({ level: p.level, currentXp: p.currentXp }, base)
        await this.env.DOM_DB.prepare('UPDATE profiles SET level = ?, current_xp = ?, updated_at = ? WHERE user_id = ?')
          .bind(leveled.level, leveled.currentXp, now, userId).run()
        await this.env.DOM_DB.prepare('DELETE FROM pending_tx WHERE payment_intent = ?').bind(payment_intent).run()
        await this.env.DOM_DB.prepare('COMMIT').run()
        const newW = await this.dbGetWallet(userId)
        const dt = (c as any).var?.downloadToken
        return c.json({ ok: true, wallet: { free: newW.free, paid: newW.paid, level: leveled.level }, profile: { level: leveled.level, currentXp: leveled.currentXp }, downloadToken: dt })
      } catch (e) {
        await this.env.DOM_DB.prepare('ROLLBACK').run()
        return c.json({ error: 'TX_FAILED' }, 500)
      }
    })

    // Wallet
    this.app.get('/wallet/:userId', async (c) => {
      const userId = c.req.param('userId')
      await this.ensureUser(userId)
      const w = await this.dbGetWallet(userId)
      const p = await this.dbGetProfile(userId)
      const total = w.free + w.paid
      const cap = walletCap(p.level)
      return c.json({ free: w.free, paid: w.paid, total, cap, level: p.level, currentXp: p.currentXp, membership: p.membership })
    })

    // Ledger (recent) with limit
    this.app.get('/ledger/:userId', async (c) => {
      const userId = c.req.param('userId')
      const url = new URL(c.req.url)
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50)))
      const rows = await this.env.DOM_DB.prepare('SELECT id,kind,mp_kind,amount,balance_after,ref_type,ref_id,created_at FROM mp_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
        .bind(userId, limit).all()
      return c.json({ items: rows?.results ?? [] })
    })
  }

  private async ensureUser(userId: string) {
    const now = Date.now()
    await this.env.DOM_DB.prepare('INSERT OR IGNORE INTO users (id,email,created_at) VALUES (?,?,?)')
      .bind(userId, `${userId}@example.local`, now).run()
    await this.env.DOM_DB.prepare('INSERT OR IGNORE INTO profiles (user_id,membership,level,current_xp,updated_at) VALUES (?,?,?,?,?)')
      .bind(userId, 'NONE', 1, 0, now).run()
    await this.env.DOM_DB.prepare('INSERT OR IGNORE INTO mp_wallets (user_id,free_balance,paid_balance) VALUES (?,?,?)')
      .bind(userId, 0, 0).run()
  }

  private async dbGetWallet(userId: string): Promise<{ free: number; paid: number; level: number }> {
    const w = await this.env.DOM_DB.prepare('SELECT free_balance as free, paid_balance as paid FROM mp_wallets WHERE user_id = ?').bind(userId).first<{ free: number; paid: number }>()
    const p = await this.dbGetProfile(userId)
    return { free: w?.free ?? 0, paid: w?.paid ?? 0, level: p.level }
  }

  private async dbGetProfile(userId: string): Promise<{ membership: Membership; level: number; currentXp: number }> {
    const p = await this.env.DOM_DB.prepare('SELECT membership, level, current_xp FROM profiles WHERE user_id = ?').bind(userId).first<{ membership: Membership; level: number; current_xp: number }>()
    return { membership: (p?.membership ?? 'NONE') as Membership, level: p?.level ?? 1, currentXp: p?.current_xp ?? 0 }
  }

  private async tryInsertIdem(key: string): Promise<boolean> {
    try {
      await this.env.DOM_DB.prepare('INSERT INTO idempotency_keys (key, created_at) VALUES (?,?)').bind(key, Date.now()).run()
      return true
    } catch (e) {
      return false
    }
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request, this.env)
  }
}
