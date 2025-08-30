import { walletCap } from './math'

export type MpKind = 'free' | 'paid'

export interface Wallet {
  free: number
  paid: number
  level: number
}

export function totalMP(w: Wallet): number {
  return w.free + w.paid
}

// Consume MP in user-favorable order: free -> paid
export function spend(w: Wallet, amount: number): { wallet: Wallet; spentFree: number; spentPaid: number } {
  if (amount <= 0) return { wallet: { ...w }, spentFree: 0, spentPaid: 0 }
  let remaining = amount
  const spentFree = Math.min(w.free, remaining)
  remaining -= spentFree
  const spentPaid = Math.min(w.paid, remaining)
  remaining -= spentPaid
  if (remaining > 0) throw new Error('INSUFFICIENT_MP')
  return {
    wallet: { ...w, free: w.free - spentFree, paid: w.paid - spentPaid },
    spentFree,
    spentPaid,
  }
}

export function canInject(w: Wallet, inject: number): boolean {
  return totalMP(w) + inject <= walletCap(w.level)
}

export function grant(w: Wallet, kind: MpKind, amount: number): Wallet {
  if (amount <= 0) return w
  if (!canInject(w, amount)) throw new Error('CAP_EXCEEDED')
  if (kind === 'free') return { ...w, free: w.free + amount }
  return { ...w, paid: w.paid + amount }
}

// Dry-run helper for top-up suggestion
export function suggestEtherCount(required: number, bal: number): { need: number; k: number } {
  const need = Math.max(required - bal, 0)
  const k = Math.ceil(need / 333)
  return { need, k }
}

