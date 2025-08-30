export type Membership = 'ACTIVE' | 'NONE'

export interface User {
  id: string
  email: string
}

export interface Profile {
  userId: string
  membership: Membership
  level: number
  currentXp: number
}

export interface Wallet {
  userId: string
  free: number
  paid: number
}

export type LedgerKind = 'grant' | 'buy' | 'spend' | 'adjust'
export type MpKind = 'free' | 'paid'

export interface LedgerEntry {
  id: string
  userId: string
  kind: LedgerKind
  mpKind: MpKind | null
  amount: number // +/-
  balanceAfter: number
  refType?: string
  refId?: string
  meta?: Record<string, unknown>
  ts: number
}

export interface Env {
  LEDGER_DO: DurableObjectNamespace
  DOM_DB: D1Database
  R2_ASSETS: R2Bucket
  MP_GRANT_MONTHLY: string
  ETHER_GRANT: string
  ETHER_PRICE_CENTS: string
  LEVEL_CAP: string
  JWT_TTL_MIN: string
  STRIPE_PRICE_ETHER?: string
  STRIPE_PRICE_SUB?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_MP_WEBHOOK_SECRET?: string
  STRIPE_SUBSCRIPTION_WEBHOOK_SECRET?: string
  PUBLIC_BASE_URL?: string
  ADMIN_SECRET?: string
  MAIL_FROM?: string
  MAIL_FROM_NAME?: string
  APP_SSO_PRIVATE_KEY_PEM?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_REGION?: string
  R2_BUCKET?: string
  MAGIC_LINK_TTL_MIN?: string
  MAGIC_LINK_RATE_LIMIT_PER_HOUR?: string
  DISPOSABLE_DOMAINS?: string
  DOWNLOAD_TOKEN_TTL_SEC?: string
  R2_PRESIGN_TTL_SEC?: string
  // STRIPE_WEBHOOK_SECRET?: string
  // R2?: R2Bucket
}
