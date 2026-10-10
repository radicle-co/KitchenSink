/**
 * The admission ceilings (ADR-0053 §2). Every caller stops at 90% of a source's declared limit: the owner's 2026-09-15
 * ruling for USDA ("Up to 900"), applied to every source. The top tenth of a window is headroom that is never spent,
 * because spending to a publisher's limit is how a 429 is earned.
 *
 * The worker's own calls stop earlier, at its share of that ceiling (owner, 2026-10-02), so a cook's search or pick
 * always finds the rest of the window. Every lane's calls are counted together against the ceiling, and the
 * worker's own calls against its share (`SourceCallLogDao.admit`); `RollingWindowLimiter` gives each lane its own.
 *
 * @pattern Specification — pure rules, read by admission, by the register's own check and by the quota block rule
 * @module
 */

/**
 * The share of a window's ceiling the background worker's own calls may spend: two thirds, owner's rulings
 * 2026-10-02. Adds are never refused (spec 003 FR-043b), so without it one account's batch add could have the worker
 * spend the whole window and leave every cook's search and pick busy. A cook's calls are not counted toward it, so busy
 * cooks pause bulk work only once the whole window is spent. Whole numbers, so the rule never depends on binary
 * rounding.
 */
export const WORKER_WINDOW_SHARE = { numerator: 2, denominator: 3 } as const;

/**
 * The most calls a window may hold before admission refuses: ⌊0.9 × requests⌋. Integer arithmetic, so the rule never
 * depends on how 0.9 rounds in binary. Pure.
 *
 * @param requests - The declared limit's request count for one window.
 * @returns The ceiling.
 */
export function sourceCeiling(requests: number): number {
    return Math.floor((requests * 9) / 10);
}

/**
 * The most of its own calls a window may hold before the worker's admission refuses: {@link WORKER_WINDOW_SHARE} of
 * the ceiling, rounded down so the worker never spends past its share. Pure.
 *
 * @param ceiling - The source's admission ceiling ({@link sourceCeiling}).
 * @returns The worker's ceiling.
 */
export function workerCeiling(ceiling: number): number {
    return Math.floor((ceiling * WORKER_WINDOW_SHARE.numerator) / WORKER_WINDOW_SHARE.denominator);
}
