/**
 * The refusal the catalog verifier raises (curated catalog plan U6, KTD-3).
 */

/** One fact the verifier could not prove. */
export interface VerificationFailure {
    /** The catalog table the fact is about, or the committed input the verifier could not read the expected state from. */
    readonly table: string;
    /** What does not hold, in words. */
    readonly fact: string;
    /** How many rows break it. */
    readonly rows: number;
    /** A few of those rows, as the check rendered them, for the deploy log. */
    readonly sample: readonly string[];
}

/** Where a failure was found: deriving the expected catalog from the committed bytes, or comparing the catalog. */
export type VerificationStage = 'prepare' | 'verify';

/**
 * The message a refusal carries: where it was found, then every failing fact with its row count and sample. Pure.
 *
 * @param stage - Where the failures were found.
 * @param failures - Every failing fact.
 * @returns The message.
 */
function describeFailures(stage: VerificationStage, failures: readonly VerificationFailure[]): string {
    const heading =
        stage === 'prepare'
            ? 'The committed seed does not yield an expected catalog'
            : 'The catalog does not equal the committed seed';
    const facts = failures.map((failure) => {
        const sample = failure.sample.length === 0 ? '' : `, e.g. ${failure.sample.join(' | ')}`;

        return `${failure.table}: ${failure.fact} (${String(failure.rows)} rows${sample})`;
    });

    return `${heading}: ${facts.join('; ')}`;
}

/**
 * Thrown when the catalog does not equal the committed seed, or the committed seed does not yield an expected catalog.
 * It names every failing table and fact, never only the first, so one deploy log shows the whole difference.
 */
export class CatalogVerificationError extends Error {
    /**
     * @param stage - Where the failures were found.
     * @param failures - Every failing fact; at least one.
     */
    public constructor(
        public readonly stage: VerificationStage,
        public readonly failures: readonly VerificationFailure[],
    ) {
        super(describeFailures(stage, failures));
        this.name = 'CatalogVerificationError';
        Object.setPrototypeOf(this, CatalogVerificationError.prototype);
    }
}

/**
 * Type guard for {@link CatalogVerificationError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a verification refusal.
 */
export function isCatalogVerificationError(error: unknown): error is CatalogVerificationError {
    return error instanceof CatalogVerificationError;
}
