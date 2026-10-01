/**
 * The admission ceiling (ADR-0053 §2). Every caller, in either lane, stops at 90% of a source's declared limit: the
 * owner's 2026-09-15 ruling for USDA ("Up to 900"), applied to every source. The top tenth of a window is headroom
 * that is never spent, because spending to a publisher's limit is how a 429 is earned.
 *
 * @pattern Specification — one pure rule, read by admission, by the register's own check and by the quota block rule
 * @module
 */

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
