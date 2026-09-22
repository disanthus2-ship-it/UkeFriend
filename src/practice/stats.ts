import type { Attempt } from './session';

export interface ChordStat {
  readonly chordId: string;
  readonly attempts: number;
  readonly hits: number;
  readonly bestTotalMs: number | null;
  readonly bestSettleMs: number | null;
  /** Most recent totals, newest last, capped at RECENT_LIMIT. */
  readonly recentTotalsMs: readonly number[];
}

export const RECENT_LIMIT = 10;
const STORAGE_KEY = 'ukefriend.stats.v1';

export function emptyStat(chordId: string): ChordStat {
  return {
    chordId,
    attempts: 0,
    hits: 0,
    bestTotalMs: null,
    bestSettleMs: null,
    recentTotalsMs: [],
  };
}

/** Mean of the recent totals, or null when the chord has never been hit. */
export function averageTotalMs(stat: ChordStat): number | null {
  if (stat.recentTotalsMs.length === 0) return null;
  return stat.recentTotalsMs.reduce((s, x) => s + x, 0) / stat.recentTotalsMs.length;
}

export function accuracy(stat: ChordStat): number | null {
  if (stat.attempts === 0) return null;
  return stat.hits / stat.attempts;
}

export function applyAttempt(stat: ChordStat, attempt: Attempt): ChordStat {
  // Skips are not failures — the player chose to move on, and counting them
  // against accuracy would punish browsing the library.
  if (attempt.outcome === 'skipped') return stat;

  const hit = attempt.outcome === 'hit';
  const total = attempt.latency?.totalMs ?? null;
  const settle = attempt.latency?.settleMs ?? null;

  const recent = total === null ? stat.recentTotalsMs : [...stat.recentTotalsMs, total];

  return {
    chordId: stat.chordId,
    attempts: stat.attempts + 1,
    hits: stat.hits + (hit ? 1 : 0),
    bestTotalMs:
      total === null ? stat.bestTotalMs : Math.min(stat.bestTotalMs ?? Infinity, total),
    bestSettleMs:
      settle === null ? stat.bestSettleMs : Math.min(stat.bestSettleMs ?? Infinity, settle),
    recentTotalsMs: recent.slice(-RECENT_LIMIT),
  };
}

export type StatsMap = Record<string, ChordStat>;

export function recordAttempt(stats: StatsMap, attempt: Attempt): StatsMap {
  if (!attempt.chordId) return stats;
  const existing = stats[attempt.chordId] ?? emptyStat(attempt.chordId);
  return { ...stats, [attempt.chordId]: applyAttempt(existing, attempt) };
}

/**
 * Read persisted stats.
 *
 * localStorage throws in a private window and can be disabled entirely, and
 * stored data can be from an older version of the app, so every failure mode
 * degrades to "no history" rather than breaking the page.
 */
export function loadStats(storage: Storage | undefined = safeStorage()): StatsMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const out: StatsMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<ChordStat>;
      if (typeof v?.attempts !== 'number') continue;
      out[id] = {
        chordId: id,
        attempts: v.attempts,
        hits: typeof v.hits === 'number' ? v.hits : 0,
        bestTotalMs: typeof v.bestTotalMs === 'number' ? v.bestTotalMs : null,
        bestSettleMs: typeof v.bestSettleMs === 'number' ? v.bestSettleMs : null,
        recentTotalsMs: Array.isArray(v.recentTotalsMs)
          ? v.recentTotalsMs.filter((n): n is number => typeof n === 'number').slice(-RECENT_LIMIT)
          : [],
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveStats(stats: StatsMap, storage: Storage | undefined = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Quota exceeded or storage disabled. Practice still works; history does not persist.
  }
}

export function clearStats(storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
