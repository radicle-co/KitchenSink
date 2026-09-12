/**
 * The planner's one refusal (curated catalog plan U5): every reason a seed cannot be planned against a snapshot,
 * collected and reported together.
 *
 * `CatalogPlanRule` is a closed union with one member per refusal, so a test asserts the NAMED cause.
 */

/** Every rule a plan can break, one member per refusal. */
export type CatalogPlanRule =
    // A root or variant the seed retires is the target of a forward, which would then resolve to a retired row (KTD-8).
    | 'forwardStranded'
    // The seed gives an item a source row that a live, non-seed item already holds (Q1, open for the owner).
    | 'liveSourceHeld'
    // A variant the seed retires belongs to a root the plan deletes; a retired variant must keep its root.
    | 'retiredVariantLosesRoot';

/** One broken rule, and where. */
export interface CatalogPlanIssue {
    /** The natural key the issue is about. */
    readonly where: string;
    readonly rule: CatalogPlanRule;
    /** A sentence for the person fixing it. */
    readonly detail: string;
}

/** Thrown when a seed cannot be planned against a snapshot. It carries every issue found, not the first. */
export class CatalogPlanRefusedError extends Error {
    /** Every issue, in natural-key order. */
    public readonly issues: readonly CatalogPlanIssue[];

    /**
     * @param issues - Every issue found; at least one.
     */
    public constructor(issues: readonly CatalogPlanIssue[]) {
        const shown = issues.slice(0, 20).map((issue) => `  ${issue.where} [${issue.rule}] ${issue.detail}`);
        const more = issues.length > shown.length ? [`  … and ${String(issues.length - shown.length)} more`] : [];

        super([`The catalog plan is refused (${String(issues.length)} issue(s)):`, ...shown, ...more].join('\n'));
        this.name = 'CatalogPlanRefusedError';
        this.issues = issues;
        Object.setPrototypeOf(this, CatalogPlanRefusedError.prototype);
    }
}

/**
 * Type guard for {@link CatalogPlanRefusedError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a plan refusal.
 */
export function isCatalogPlanRefusedError(error: unknown): error is CatalogPlanRefusedError {
    return error instanceof CatalogPlanRefusedError;
}
