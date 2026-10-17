/**
 * The refusals of a table policy that does not fit (curated catalog plan U4a): a table in two sets, or a policy and a
 * database's roles that disagree about the seeder.
 *
 * @module
 */
import type { DatabaseRoles } from './databaseRoles.js';

/** A table named by more than one set, with the sets that name it. */
export interface TablePolicyOverlap {
    readonly table: string;
    /** The sets, in `TABLE_POLICY_SETS` order; `migrationLedger` when it is the runner's own ledger. */
    readonly sets: readonly string[];
}

/** A table is in more than one set, or a set names the migration ledger. */
export class TablePolicyOverlapError extends Error {
    /** Every table named more than once. */
    public readonly overlaps: readonly TablePolicyOverlap[];

    public constructor(overlaps: readonly TablePolicyOverlap[]) {
        super(
            'the table policy names a table in more than one set: ' +
                overlaps.map((overlap) => `${overlap.table} (${overlap.sets.join(', ')})`).join('; ') +
                '. Each table has one set, and the migration ledger belongs to the runner.',
        );
        this.name = 'TablePolicyOverlapError';
        this.overlaps = overlaps.map((overlap) => ({ table: overlap.table, sets: [...overlap.sets] }));
        Object.setPrototypeOf(this, TablePolicyOverlapError.prototype);
    }
}

/**
 * Type guard for {@link TablePolicyOverlapError}.
 *
 * @param value - The candidate.
 * @returns `true` when `value` is an overlapping policy.
 */
export function isTablePolicyOverlapError(value: unknown): value is TablePolicyOverlapError {
    return value instanceof TablePolicyOverlapError;
}

/** Why a policy does not fit a database's roles. */
export type TablePolicySeederMismatch = 'seederWithoutPolicy' | 'policyWithoutSeeder';

/** A database with a seeder was given no policy, or a database without one was given tables to grant it. */
export class TablePolicySeederMismatchError extends Error {
    /** Which way the policy and the roles disagree. */
    public readonly reason: TablePolicySeederMismatch;
    /** The database's owner role, which names the database. */
    public readonly owner: string;

    public constructor(reason: TablePolicySeederMismatch, roles: DatabaseRoles) {
        super(
            reason === 'seederWithoutPolicy'
                ? `the database owned by ${roles.owner} has a seeder (${roles.seeder ?? ''}) but was given NO_TABLE_POLICY: ` +
                      'the seeder would hold no table right. Pass the database’s table registry.'
                : `the database owned by ${roles.owner} has no seeder, but its table policy names tables: every set ` +
                      'grants the seeder something. Pass NO_TABLE_POLICY.',
        );
        this.name = 'TablePolicySeederMismatchError';
        this.reason = reason;
        this.owner = roles.owner;
        Object.setPrototypeOf(this, TablePolicySeederMismatchError.prototype);
    }
}

/**
 * Type guard for {@link TablePolicySeederMismatchError}.
 *
 * @param value - The candidate.
 * @returns `true` when `value` is a policy that does not fit its roles.
 */
export function isTablePolicySeederMismatchError(value: unknown): value is TablePolicySeederMismatchError {
    return value instanceof TablePolicySeederMismatchError;
}
