/**
 * The refusal of a catalog the snapshot port cannot represent (curated plan U5): the DAO refuses a stored shape
 * rather than dropping it, and names every issue it found.
 *
 * @module
 */

/** Every stored shape the port cannot hold. */
export type CatalogSnapshotRule =
    | 'rootWithoutName'
    | 'ownerItemUnkeyed'
    | 'variantWithoutRoot'
    | 'variantWithoutNutrition'
    | 'citationCount'
    | 'citationShape'
    | 'valueNotPer100g'
    | 'portionWithoutProvenance'
    | 'portionSourceUnknown'
    | 'portionCitationUnknown'
    | 'categorySourceUnknown'
    | 'sourceLineageShape'
    | 'forwardWithoutTarget';

/** One stored shape the port cannot hold, and where. */
export interface CatalogSnapshotIssue {
    /** The row's id or natural key. */
    readonly where: string;
    readonly rule: CatalogSnapshotRule;
}

/** Thrown when the catalog holds a shape the port cannot represent. It carries every issue found. */
export class CatalogSnapshotUnreadableError extends Error {
    public readonly issues: readonly CatalogSnapshotIssue[];

    /**
     * @param issues - Every issue found; at least one.
     */
    public constructor(issues: readonly CatalogSnapshotIssue[]) {
        const shown = issues.slice(0, 20).map((issue) => `  ${issue.where} [${issue.rule}]`);

        super([`The catalog cannot be read as a snapshot (${String(issues.length)} issue(s)):`, ...shown].join('\n'));
        this.name = 'CatalogSnapshotUnreadableError';
        this.issues = issues;
        Object.setPrototypeOf(this, CatalogSnapshotUnreadableError.prototype);
    }
}

/**
 * Whether a value is a {@link CatalogSnapshotUnreadableError}. Pure.
 *
 * @param error - Any thrown value.
 * @returns Whether it is one.
 */
export function isCatalogSnapshotUnreadableError(error: unknown): error is CatalogSnapshotUnreadableError {
    return error instanceof CatalogSnapshotUnreadableError;
}
