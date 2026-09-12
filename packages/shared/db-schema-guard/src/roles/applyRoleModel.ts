/**
 * Apply a database's role model and verify it: the thin, impure half of `roleStatements.ts`.
 *
 * ⛔ THE ORDER IS THE SAFETY PROPERTY. Roles and memberships first; then the catalog is RE-READ and `rds_iam` is
 * granted to the login roles only if the master has no membership path into either; then it is re-read again and
 * the master must not reach `rds_iam` at all. A master that reaches `rds_iam` through any chain is forced onto IAM
 * auth and locked out (AWS), together with every in-VPC tool that could undo it.
 *
 * DESIGN PATTERN: Design-by-contract postconditions — {@link assertRoleModel} reads the catalog and lists every
 * unmet condition, so a deploy that leaves the model wrong fails loudly instead of running on it.
 */
import {
    lockOutPredicate,
    pathsToRole,
    readMembershipEdges,
    type CatalogReader,
    type MembershipEdge,
} from './roleGraph.js';
import { iamLoginStatements, roleModelStatements, type RoleModelContext } from './roleStatements.js';
import type { DatabaseRoles } from './databaseRoles.js';

/** The RDS-managed role whose membership switches a login to IAM-token authentication. */
export const RDS_IAM = 'rds_iam';

/** The role model's postconditions did not hold. */
export class RoleModelPostconditionError extends Error {
    /** Every unmet condition, one sentence each. */
    public readonly violations: readonly string[];

    public constructor(violations: readonly string[]) {
        super(`The database role model does not hold:\n  - ${violations.join('\n  - ')}`);
        this.name = 'RoleModelPostconditionError';
        this.violations = violations;
        Object.setPrototypeOf(this, RoleModelPostconditionError.prototype);
    }
}

/**
 * Type guard for {@link RoleModelPostconditionError}.
 *
 * @param error - Anything thrown.
 * @returns Whether it is the role-model postcondition error.
 */
export function isRoleModelPostconditionError(error: unknown): error is RoleModelPostconditionError {
    return error instanceof RoleModelPostconditionError;
}

/** What {@link applyRoleModel} and {@link assertRoleModel} need to know. */
export interface RoleModelInput {
    readonly roles: DatabaseRoles;
    readonly context: RoleModelContext;
}

/** Render a path for a message: `a → b → rds_iam`. */
const render = (paths: readonly (readonly string[])[]): string => paths.map((path) => path.join(' → ')).join('; ');

/**
 * Create the roles, wire their memberships, then — only if the master cannot reach them — grant `rds_iam` to the
 * two login roles, and finally prove the whole model.
 *
 * @param reader - A connection to the maintenance database, as the RDS master.
 * @param input - The database's roles and the stage context.
 * @throws {RoleModelPostconditionError} when the master has a path into a login role (nothing is granted), or
 *   when any postcondition fails afterwards.
 * @sideEffect Creates/alters roles and grants memberships.
 */
export async function applyRoleModel(reader: CatalogReader, input: RoleModelInput): Promise<void> {
    for (const sql of roleModelStatements(input.roles, input.context)) {
        await reader.query(sql);
    }

    const edges = await readMembershipEdges(reader);
    const counts = lockOutPredicate(input.context.lockOutEdges ?? 'every-row');
    const intoLogins = [input.roles.migrator, input.roles.app].flatMap((role) =>
        pathsToRole(edges, input.context.master, role, counts),
    );

    if (intoLogins.length > 0) {
        throw new RoleModelPostconditionError([
            `the master ${input.context.master} is a member of a login role (${render(intoLogins)}), so granting ` +
                `${RDS_IAM} to it would force IAM auth on the master — refusing to grant ${RDS_IAM}`,
        ]);
    }

    for (const sql of iamLoginStatements(input.roles)) {
        await reader.query(sql);
    }

    await assertRoleModel(reader, input);
}

/** One role's attributes, as the postconditions read them. */
interface RoleRow {
    readonly rolname: string;
    readonly rolcanlogin: boolean;
    readonly rolcreatedb: boolean;
}

/**
 * The membership of `member` in `role`, merged across every grant, or `undefined` when there is none.
 *
 * ⚠️ MERGED, not the first row: PostgreSQL 16+ keeps one `pg_auth_members` row PER GRANTOR, and a role the master
 * creates arrives with an automatic ADMIN-only row beside the grant this module issues. An option held by any grant
 * is held (PostgreSQL's own rule), so the options are OR-ed; taking the first row would read the ADMIN-only one and
 * report a membership the catalog in fact grants.
 */
const edgeOf = (edges: readonly MembershipEdge[], member: string, role: string): MembershipEdge | undefined => {
    const grants = edges.filter((edge) => edge.member === member && edge.role === role);

    return grants.length === 0
        ? undefined
        : {
              member,
              role,
              admin: grants.some((edge) => edge.admin),
              inherit: grants.some((edge) => edge.inherit),
              set: grants.some((edge) => edge.set),
          };
};

/**
 * Read the catalog and throw if any role-model postcondition fails.
 *
 * @param reader - A connection to any database on the instance.
 * @param input - The database's roles and the stage context.
 * @throws {RoleModelPostconditionError} listing every unmet condition.
 * @sideEffect Reads `pg_roles` and `pg_auth_members`.
 */
export async function assertRoleModel(reader: CatalogReader, input: RoleModelInput): Promise<void> {
    const { roles, context } = input;
    const edges = await readMembershipEdges(reader);
    const counts = lockOutPredicate(context.lockOutEdges ?? 'every-row');
    const rows = (
        await reader.query<RoleRow>(
            'SELECT rolname, rolcanlogin, rolcreatedb FROM pg_roles WHERE rolname = ANY($1::text[])',
            [[roles.owner, roles.migrator, roles.app]],
        )
    ).rows;
    const attributes = new Map(rows.map((row) => [row.rolname, row]));
    const violations: string[] = [];

    const expect = (condition: boolean, message: string): void => {
        if (!condition) {
            violations.push(message);
        }
    };

    const owner = attributes.get(roles.owner);
    const migrator = attributes.get(roles.migrator);
    const app = attributes.get(roles.app);

    expect(owner !== undefined, `the owner role ${roles.owner} does not exist`);
    expect(migrator !== undefined, `the migrator role ${roles.migrator} does not exist`);
    expect(app !== undefined, `the service role ${roles.app} does not exist`);

    expect(owner?.rolcanlogin === false, `the owner ${roles.owner} can LOG IN — it must be NOLOGIN`);
    expect(owner?.rolcreatedb === false, `the owner ${roles.owner} has CREATEDB`);
    expect(
        pathsToRole(edges, roles.owner, RDS_IAM, counts).length === 0,
        `the owner ${roles.owner} reaches ${RDS_IAM} (${render(pathsToRole(edges, roles.owner, RDS_IAM, counts))}) — the master joins it`,
    );

    const migratorToOwner = edgeOf(edges, roles.migrator, roles.owner);

    expect(migrator?.rolcanlogin === true, `the migrator ${roles.migrator} cannot log in`);
    expect(
        migratorToOwner?.inherit === true && migratorToOwner.set,
        `the migrator ${roles.migrator} does not hold INHERIT and SET on the owner ${roles.owner}`,
    );
    expect(edgeOf(edges, roles.migrator, RDS_IAM) !== undefined, `the migrator ${roles.migrator} is not in ${RDS_IAM}`);
    expect(
        migrator?.rolcreatedb === !context.isProd,
        `the migrator ${roles.migrator} has CREATEDB=${String(migrator?.rolcreatedb)}, expected ${String(!context.isProd)}`,
    );

    expect(app?.rolcanlogin === true, `the service role ${roles.app} cannot log in`);
    expect(app?.rolcreatedb === false, `the service role ${roles.app} has CREATEDB`);
    expect(edgeOf(edges, roles.app, RDS_IAM) !== undefined, `the service role ${roles.app} is not in ${RDS_IAM}`);

    for (const target of [roles.owner, roles.migrator]) {
        expect(
            pathsToRole(edges, roles.app, target, counts).length === 0,
            `the service role ${roles.app} is a member of ${target} — it must hold data privileges only`,
        );
    }

    const masterToOwner = edgeOf(edges, context.master, roles.owner);

    expect(masterToOwner?.set === true, `the master ${context.master} cannot SET ROLE to the owner ${roles.owner}`);
    expect(
        masterToOwner?.inherit === !context.isProd,
        `the master ${context.master} has INHERIT=${String(masterToOwner?.inherit)} on the owner, expected ${String(!context.isProd)}`,
    );

    const masterToIam = pathsToRole(edges, context.master, RDS_IAM, counts);

    expect(
        masterToIam.length === 0,
        `⛔ the master ${context.master} reaches ${RDS_IAM} (${render(masterToIam)}) — it will be forced onto IAM auth`,
    );

    if (violations.length > 0) {
        throw new RoleModelPostconditionError(violations);
    }
}
