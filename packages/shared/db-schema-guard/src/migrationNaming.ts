/**
 * The migration FILENAME contract: `NNNN_snake_case.sql`, one file per number.
 *
 * The runner orders by filename and keys its ledger by filename, so two files sharing a number both apply, in an
 * order set by whatever follows the number — an accident the manifest digest happily certifies. Gaps are allowed
 * (a number can be burned by a rebase; the tree holds several), so only duplicates and malformed names are refused.
 *
 * DESIGN PATTERN: Specification — a pure verdict over a list of filenames, shared by the runner (refuses at apply
 * time) and by the repo-wide tree guard (refuses at CI time), so there is one authority for the rule.
 */
import { MigrationNamingError } from './errors.js';

/** `NNNN_snake_case.sql`: four digits, then lower-case words joined by single underscores. */
const MIGRATION_NAME = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/u;

/** One way a migrations directory breaks the naming contract. */
export type MigrationNamingProblem =
    | { readonly kind: 'malformedName'; readonly file: string }
    | { readonly kind: 'duplicateNumber'; readonly number: string; readonly files: readonly string[] };

/**
 * Every naming-contract violation among the given `.sql` filenames.
 *
 * @param files - Bare `.sql` filenames of one directory, in any order.
 * @returns Malformed names (sorted), then one entry per number claimed twice (sorted). Pure.
 */
export function migrationNamingProblems(files: readonly string[]): readonly MigrationNamingProblem[] {
    const sorted = [...files].sort();
    const malformed = sorted.filter((file) => !MIGRATION_NAME.test(file));
    const byNumber = new Map<string, string[]>();

    for (const file of sorted) {
        const number = /^(\d+)/u.exec(file)?.[1];

        if (number !== undefined) {
            byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
        }
    }

    return [
        ...malformed.map((file): MigrationNamingProblem => ({ kind: 'malformedName', file })),
        ...[...byNumber]
            .filter(([, claimants]) => claimants.length > 1)
            .map(([number, claimants]): MigrationNamingProblem => ({
                kind: 'duplicateNumber',
                number,
                files: claimants,
            })),
    ];
}

/**
 * Refuse a migrations directory whose `.sql` names break the contract.
 *
 * @param directory - The directory, used only to make the failure readable.
 * @param files - Its `.sql` filenames.
 * @throws {MigrationNamingError} when any name is malformed or any number is claimed twice.
 */
export function assertMigrationNaming(directory: string, files: readonly string[]): void {
    const problems = migrationNamingProblems(files);

    if (problems.length > 0) {
        throw new MigrationNamingError(directory, problems);
    }
}
