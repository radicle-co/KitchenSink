/**
 * The PostgreSQL role-membership graph, read once and walked purely.
 *
 * ⛔ WHY THIS EXISTS: the RDS master login (`identity_app`) authenticates by PASSWORD, and AWS documents that
 * granting `rds_iam` to a user — "including the RDS master user", and through NESTED membership too — makes IAM
 * authentication take precedence. A master that reaches `rds_iam` through ANY chain of memberships is locked out,
 * and so is every in-VPC tool that could undo it, because they all connect as the master. So "is there a path
 * from the master to `rds_iam`?" must be answered from the real catalog, over every edge, recursively — and must
 * always be "no". See `docs/plans/2026-09-11-database-role-split.md`.
 *
 * DESIGN PATTERN: a pure graph walk over a value read in one query — the reader is the only impure part, so the
 * walk is tested against deliberately violating graphs without a database.
 */

/** One `pg_auth_members` row: `member` belongs to `role`, with the three PostgreSQL 16+ grant options. */
export interface MembershipEdge {
    readonly member: string;
    readonly role: string;
    /** `WITH ADMIN` — may grant the role onward. Confers no privileges by itself. */
    readonly admin: boolean;
    /** `WITH INHERIT` — the member holds the role's privileges without `SET ROLE`. */
    readonly inherit: boolean;
    /** `WITH SET` — the member may `SET ROLE` to the role. */
    readonly set: boolean;
}

/**
 * Whether an edge carries INHERIT or SET — the RELAXED reading of membership, which ignores an ADMIN-only row.
 *
 * ⚠️ Not the default for lock-out questions. PostgreSQL 16+ records an automatic ADMIN-only row from a CREATEROLE
 * user to every role it creates, and its own `is_member_of_role` (ROLERECURSE_MEMBERS) counts such a row — so
 * whether RDS's `rds_iam` precedence check does is unknown. Step 0 found the RDS master holds NO ADMIN-only row at
 * all (its ADMIN on the app roles is implicit, through `rds_superuser`), which is why it could not be measured. Use
 * this only where the caller KNOWS its ADMIN-only rows are ones RDS would hold implicitly — the vanilla-PostgreSQL
 * stand-in master of the integration tiers.
 *
 * @param edge - One membership edge.
 * @returns `true` when the edge carries INHERIT or SET. Pure.
 */
export function edgeConfersMembership(edge: MembershipEdge): boolean {
    return edge.inherit || edge.set;
}

/**
 * Every `pg_auth_members` row is a membership — the CONSERVATIVE reading, and the default. A lock-out of the
 * password-authenticated master is not recoverable from inside the VPC, while a refusal is only an outage, so an
 * unmeasured rule is read the way that fails safe.
 *
 * @param _edge - One membership edge; every one counts.
 * @returns Always `true`. Pure.
 */
export function everyMembershipRow(_edge: MembershipEdge): boolean {
    return true;
}

/** Which rows count as membership when asking whether a role reaches `rds_iam`. */
export type LockOutEdges = 'every-row' | 'inherit-or-set';

/**
 * The edge predicate for a lock-out reading.
 *
 * @param semantics - `every-row` (production) or `inherit-or-set` (a vanilla-PostgreSQL stand-in only).
 * @returns The predicate. Pure.
 */
export function lockOutPredicate(semantics: LockOutEdges): (edge: MembershipEdge) => boolean {
    return semantics === 'every-row' ? everyMembershipRow : edgeConfersMembership;
}

/**
 * Every simple path from `from` to `to` over the edges `counts` admits.
 *
 * @param edges - The whole membership graph.
 * @param from - The starting role (e.g. the master).
 * @param to - The role to reach (e.g. `rds_iam`).
 * @param counts - Which edges are memberships; defaults to EVERY row (see {@link everyMembershipRow}).
 * @returns Each path as the role names along it, `from` first and `to` last; empty when unreachable. A role is
 *   never reported as a path to itself. Pure; terminates on cycles.
 */
export function pathsToRole(
    edges: readonly MembershipEdge[],
    from: string,
    to: string,
    counts: (edge: MembershipEdge) => boolean = everyMembershipRow,
): readonly (readonly string[])[] {
    const outgoing = new Map<string, string[]>();

    for (const edge of edges) {
        if (counts(edge)) {
            outgoing.set(edge.member, [...(outgoing.get(edge.member) ?? []), edge.role]);
        }
    }

    const found: string[][] = [];

    const walk = (current: string, path: readonly string[]): void => {
        for (const next of outgoing.get(current) ?? []) {
            if (path.includes(next)) {
                continue;
            }

            if (next === to) {
                found.push([...path, next]);
            } else {
                walk(next, [...path, next]);
            }
        }
    };

    walk(from, [from]);

    return found;
}

/** Anything that can run one catalog query — a `pg.Pool`, a checked-out client, or a test double. */
export interface CatalogReader {
    query<Row>(sql: string, values?: unknown[]): Promise<{ readonly rows: Row[] }>;
}

/**
 * Read the whole membership graph in one query.
 *
 * Joined by OID and returned by NAME, so a role that does not exist (e.g. `rds_iam` on a non-RDS PostgreSQL)
 * simply has no edges rather than raising the way a `'rds_iam'::regrole` cast would.
 *
 * @param reader - A connection to any database on the instance (roles are cluster-wide).
 * @returns Every edge, sorted by member then role.
 * @sideEffect Reads `pg_auth_members` and `pg_roles`.
 */
export async function readMembershipEdges(reader: CatalogReader): Promise<readonly MembershipEdge[]> {
    const result = await reader.query<MembershipEdge>(
        `SELECT m.rolname AS member, r.rolname AS role,
                am.admin_option AS admin, am.inherit_option AS inherit, am.set_option AS set
           FROM pg_auth_members am
           JOIN pg_roles r ON r.oid = am.roleid
           JOIN pg_roles m ON m.oid = am.member
          ORDER BY m.rolname, r.rolname`,
    );

    return result.rows;
}
