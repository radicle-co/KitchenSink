/**
 * A database's table policy: which of its tables the seeder writes and the service role may only partly write
 * (curated catalog plan KTD-13, KTD-14, KTD-18, U4).
 *
 * The service names its own tables and this package decides what each role may do with a table of each set, so the
 * package never names a service's table. Three sets, disjoint:
 *
 * - **catalog** — the seeded tables (KTD-12's trigger guards them). DML for the seeder and the service role.
 * - **serviceReadOnly** — the seed ledger. SELECT and INSERT for the seeder, SELECT only for the service role.
 * - **dictionaries** — the shared dictionaries (`nutrient`, `food_category`). SELECT and INSERT for both.
 *
 * Every other table keeps the service role's default DML and gives the seeder nothing.
 *
 * @pattern Parameter Object — the service's table sets, passed in so this package stays ignorant of them
 * @pattern Null Object — {@link NO_TABLE_POLICY}, the policy of a database with no seeder
 */
import { MIGRATION_LEDGER_TABLE, type DatabaseRoles } from './databaseRoles.js';
import { TablePolicyOverlapError, TablePolicySeederMismatchError } from './tablePolicy.errors.js';

/** The sets a policy partitions its tables into, in the order statements and audits visit them. */
export const TABLE_POLICY_SETS = ['catalog', 'serviceReadOnly', 'dictionaries'] as const;

/** One of {@link TABLE_POLICY_SETS}. */
export type TablePolicySet = (typeof TABLE_POLICY_SETS)[number];

/** A database's table-name sets. */
export type TablePolicy = { readonly [Key in TablePolicySet]: ReadonlySet<string> };

/** A table right a policy grants. */
export type TablePrivilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

/** The rights the service role holds on every table no policy restricts (ADR-0039 §3). */
export const SERVICE_ROLE_TABLE_RIGHTS: readonly TablePrivilege[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

/** What the service role and the seeder may do with a table of each set. The one authority statements and audits read. */
export const TABLE_POLICY_RIGHTS: {
    readonly [Key in TablePolicySet]: {
        readonly app: readonly TablePrivilege[];
        readonly seeder: readonly TablePrivilege[];
    };
} = {
    catalog: { app: SERVICE_ROLE_TABLE_RIGHTS, seeder: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
    serviceReadOnly: { app: ['SELECT'], seeder: ['SELECT', 'INSERT'] },
    dictionaries: { app: ['SELECT', 'INSERT'], seeder: ['SELECT', 'INSERT'] },
};

/**
 * The policy of a database with no seeder: it names no table. Compared by identity, so a seeded database cannot be
 * handed it by mistake ({@link assertTablePolicyFits}).
 */
export const NO_TABLE_POLICY: TablePolicy = Object.freeze({
    catalog: new Set<string>(),
    serviceReadOnly: new Set<string>(),
    dictionaries: new Set<string>(),
});

/** One table a policy names, with its set. */
export interface PolicyTable {
    readonly table: string;
    readonly set: TablePolicySet;
}

/**
 * Every table a policy names, set by set in {@link TABLE_POLICY_SETS} order and by name within a set, so the
 * statements built from it come out in one order every run. Pure.
 *
 * @param policy - The policy.
 * @returns One entry per table.
 */
export function policyTables(policy: TablePolicy): readonly PolicyTable[] {
    return TABLE_POLICY_SETS.flatMap((set) => [...policy[set]].sort().map((table) => ({ table, set })));
}

/**
 * Refuse a policy that does not fit the database's roles. Pure, so the runner checks it before it connects.
 *
 * - The sets are disjoint, and none names the migration ledger: the seeder would gain INSERT on it.
 * - A database with a seeder is given a policy other than {@link NO_TABLE_POLICY}. Its sets may still be empty, as
 *   food's are until the catalog tables exist (U4a).
 * - A database with no seeder is given a policy that names no table, since every set grants the seeder something.
 *
 * @param roles - The database's roles.
 * @param policy - Its policy.
 * @throws {TablePolicyOverlapError} when a table is named twice or the ledger is named at all.
 * @throws {TablePolicySeederMismatchError} when the policy and the seeder disagree.
 */
export function assertTablePolicyFits(roles: DatabaseRoles, policy: TablePolicy): void {
    const setsByTable = new Map<string, string[]>();

    for (const { table, set } of policyTables(policy)) {
        setsByTable.set(table, [...(setsByTable.get(table) ?? []), set]);
    }

    const ledgerSets = setsByTable.get(MIGRATION_LEDGER_TABLE);

    if (ledgerSets !== undefined) {
        ledgerSets.push('migrationLedger');
    }

    const overlaps = [...setsByTable].filter(([, sets]) => sets.length > 1).map(([table, sets]) => ({ table, sets }));

    if (overlaps.length > 0) {
        throw new TablePolicyOverlapError(overlaps);
    }

    if (roles.seeder !== undefined && policy === NO_TABLE_POLICY) {
        throw new TablePolicySeederMismatchError('seederWithoutPolicy', roles);
    }

    if (roles.seeder === undefined && setsByTable.size > 0) {
        throw new TablePolicySeederMismatchError('policyWithoutSeeder', roles);
    }
}
