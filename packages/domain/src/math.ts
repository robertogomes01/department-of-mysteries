export type Membership = 'ACTIVE' | 'NONE'

// ROUND_HALF_UP helper for non-negative inputs
export function roundHalfUp(x: number): number {
  // For non-negative values, Math.floor(x + 0.5) achieves round half up
  return Math.floor(x + 0.5)
}

// Required XP to go from L -> L+1
export function reqXP(L: number): number {
  // Integer, unbiased from float issues: round_half_up((9L^2 + 9L + 3)/10)
  return roundHalfUp((9 * L * L + 9 * L + 3) / 10)
}

export function walletCap(level: number): number {
  return level * 1000
}

export function xpFromArticle(spentMP: number): number {
  return spentMP
}

export function xpFromMarket(spentMP: number): number {
  // floor((3*mp + 1)/2) enforces round half up for .5 cases using integers
  return Math.floor((3 * spentMP + 1) / 2)
}

export interface LevelState {
  level: number // 1..100
  currentXp: number // 0..reqXP(level)-1
}

export interface LevelResult extends LevelState { added: number }

export function awardXp(state: LevelState, baseXp: number): LevelResult {
  const LEVEL_MAX = 100
  let { level: L, currentXp: xp } = state
  if (L >= LEVEL_MAX) return { level: LEVEL_MAX, currentXp: 0, added: 0 }
  let added = baseXp
  xp += baseXp
  while (L < LEVEL_MAX && xp >= reqXP(L)) {
    xp -= reqXP(L)
    L++
  }
  if (L >= LEVEL_MAX) {
    L = LEVEL_MAX
    xp = 0
  }
  return { level: L, currentXp: xp, added }
}

