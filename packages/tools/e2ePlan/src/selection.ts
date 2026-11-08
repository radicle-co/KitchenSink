/** What a plan decides for one tier (the Playwright specs, or the Maestro flows). */
export interface Pick {
    readonly id: string;
    /** Why it runs, in the words of the changes that selected it. */
    readonly because: string;
}

export type TierSelection =
    /** Run the whole tier. A reason per change that cannot be narrowed. */
    | { readonly kind: 'all'; readonly reasons: readonly string[] }
    /** Run these. Zero picks means none. */
    | { readonly kind: 'some'; readonly picks: readonly Pick[] };

export interface Plan {
    readonly web: TierSelection;
    readonly mobile: TierSelection;
    /** Things the caller should see: a selector that failed and fell back to the full suite, for one. */
    readonly warnings: readonly string[];
}

/**
 * The plan that runs everything.
 *
 * @param reason - Why.
 * @param warnings - Anything the caller should see with it.
 * @returns A plan with both tiers whole.
 */
export function fullPlan(reason: string, warnings: readonly string[] = []): Plan {
    return { web: { kind: 'all', reasons: [reason] }, mobile: { kind: 'all', reasons: [reason] }, warnings };
}
