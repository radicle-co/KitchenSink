/**
 * @module The session interruption ledger (plan 0011 KTD4, FR-036): which interruptions the cook has already seen in
 * this app process, so the store-review ask never lands on top of another one. S5 owns `timerAlertPermission`, 010
 * owns `paywall` and `offer`, 014 owns `pushPermission`, and S12 owns `storeReview`. An owner calls `markShown` when
 * its sheet or request resolves, and reads `anyShown` before it asks. A cold start resets it.
 *
 * @pattern Registry — a module-level set, one per app process.
 */

/** The interruptions the ledger tracks, each named by the feature that owns it. */
export const INTERRUPTION_KINDS = [
    'paywall',
    'offer',
    'pushPermission',
    'timerAlertPermission',
    'storeReview',
] as const;

export type InterruptionKind = (typeof INTERRUPTION_KINDS)[number];

const shown = new Set<InterruptionKind>();

/**
 * Records that an interruption was shown in this app process.
 *
 * @param kind - The interruption that was shown.
 * @sideEffect Writes the process-wide ledger.
 */
export function markShown(kind: InterruptionKind): void {
    shown.add(kind);
}

/**
 * Tells whether any interruption was shown in this app process.
 *
 * @returns True when any interruption was shown in this app process.
 */
export function anyShown(): boolean {
    return shown.size > 0;
}
