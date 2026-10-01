/**
 * `applyRoleModel` and `assertRoleModel` with food's seeder (curated catalog plan U18, ADR-0039 §§5–8).
 *
 * ⛔ The load-bearing rule: `rds_iam` is granted only after a re-read shows the master cannot reach ANY role about to
 * receive it, because `rds_iam` reached through any chain forces IAM auth on the master and locks out every password
 * client. The cases below take the roles from the GRANT SQL itself, so a check list that drifts from the grant list
 * fails here rather than in production.
 *
 * The catalog is a scripted fake: membership rows and `pg_roles` rows are fixed per case, and every statement is
 * recorded. The real server is `packages/infra/global/tests/e2e/seederBootstrap.e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES, RDS_MASTER_USERNAME, databaseRoleNames } from '../roles/databaseRoles.js';
import {
    RDS_IAM,
    RoleModelPostconditionError,
    applyRoleModel,
    assertRoleModel,
    isRoleModelPostconditionError,
} from '../roles/applyRoleModel.js';
import type { CatalogReader, MembershipEdge } from '../roles/roleGraph.js';
import { iamLoginStatements } from '../roles/roleStatements.js';

const roles = DATABASE_ROLES.food;
const master = RDS_MASTER_USERNAME;
const context = { master, isProd: false } as const;

interface RoleRow {
    readonly rolname: string;
    readonly rolcanlogin: boolean;
    readonly rolcreatedb: boolean;
}

const edge = (member: string, role: string, inherit = true, set = true): MembershipEdge => ({
    member,
    role,
    admin: false,
    inherit,
    set,
});

/** A healthy non-prod food catalog: every role, and exactly the memberships the model grants. */
function healthy(): { roles: RoleRow[]; edges: MembershipEdge[] } {
    return {
        roles: [
            { rolname: roles.owner, rolcanlogin: false, rolcreatedb: false },
            { rolname: roles.migrator, rolcanlogin: true, rolcreatedb: true },
            { rolname: roles.app, rolcanlogin: true, rolcreatedb: false },
            { rolname: 'food_seeder', rolcanlogin: true, rolcreatedb: false },
        ],
        edges: [
            edge(roles.migrator, roles.owner),
            edge(master, roles.owner),
            edge(roles.migrator, RDS_IAM),
            edge(roles.app, RDS_IAM),
            edge('food_seeder', RDS_IAM),
        ],
    };
}

/** A reader over a fixed catalog that records every statement. */
function readerOver(state: { roles: RoleRow[]; edges: MembershipEdge[] }): CatalogReader & { sql: string[] } {
    const sql: string[] = [];

    return {
        sql,
        query: async <Row>(text: string, values?: unknown[]) => {
            sql.push(text);

            if (text.includes('FROM pg_auth_members')) {
                return { rows: [...state.edges] as unknown as Row[] };
            }

            if (text.includes('FROM pg_roles WHERE rolname = ANY')) {
                const asked = (values?.[0] ?? []) as string[];

                return { rows: state.roles.filter((row) => asked.includes(row.rolname)) as unknown as Row[] };
            }

            return { rows: [] };
        },
    };
}

/** The roles `iamLoginStatements` grants `rds_iam` to, read from its SQL. */
const iamGrantees = iamLoginStatements(roles).map((sql) => /^GRANT rds_iam TO "(\w+)"$/u.exec(sql)?.[1] ?? '');

describe('applyRoleModel — rds_iam only after the master is proven unable to reach a grantee', () => {
    it('reads the grantees from the SQL, and there are three', () => {
        expect(iamGrantees).toStrictEqual(['food_migrator', 'food_app', 'food_seeder']);
    });

    it.each(iamGrantees)(
        '⛔ refuses, granting no rds_iam at all, when the master is a member of %s',
        async (grantee) => {
            const state = healthy();
            const reader = readerOver({ ...state, edges: [...state.edges, edge(master, grantee)] });
            let caught: unknown;

            try {
                await applyRoleModel(reader, { roles, context });
            } catch (error) {
                caught = error;
            }

            expect(isRoleModelPostconditionError(caught)).toBe(true);
            expect(reader.sql.filter((sql) => sql.startsWith('GRANT rds_iam'))).toStrictEqual([]);
        },
    );

    it('on a clean graph, grants all three only after the membership re-read', async () => {
        const reader = readerOver(healthy());

        await applyRoleModel(reader, { roles, context });

        const reread = reader.sql.findIndex((sql) => sql.includes('FROM pg_auth_members'));
        const grants = reader.sql.flatMap((sql, index) => (sql.startsWith('GRANT rds_iam') ? [index] : []));

        expect(grants).toHaveLength(3);
        expect(grants.every((index) => index > reread)).toBe(true);
        expect(reread).toBeGreaterThan(reader.sql.findIndex((sql) => sql.includes('CREATE ROLE "food_seeder"')));
    });
});

describe('assertRoleModel — the seeder’s postconditions', () => {
    it('passes a healthy catalog', async () => {
        await expect(assertRoleModel(readerOver(healthy()), { roles, context })).resolves.toBeUndefined();
    });

    const broken: readonly (readonly [string, (state: ReturnType<typeof healthy>) => void, RegExp])[] = [
        [
            'the seeder missing',
            (state) => {
                state.roles = state.roles.filter((row) => row.rolname !== 'food_seeder');
            },
            /seeder role food_seeder does not exist/u,
        ],
        [
            'a seeder that cannot log in',
            (state) => {
                state.roles = state.roles.map((row) =>
                    row.rolname === 'food_seeder' ? { ...row, rolcanlogin: false } : row,
                );
            },
            /seeder food_seeder cannot log in/u,
        ],
        [
            'a seeder with CREATEDB',
            (state) => {
                state.roles = state.roles.map((row) =>
                    row.rolname === 'food_seeder' ? { ...row, rolcreatedb: true } : row,
                );
            },
            /seeder food_seeder has CREATEDB/u,
        ],
        [
            'a seeder outside rds_iam',
            (state) => {
                state.edges = state.edges.filter((e) => !(e.member === 'food_seeder' && e.role === RDS_IAM));
            },
            /seeder food_seeder is not in rds_iam/u,
        ],
    ];

    it.each(broken)('⛔ reports %s', async (_case, breakIt, message) => {
        const state = healthy();

        breakIt(state);

        const outcome = await assertRoleModel(readerOver(state), { roles, context }).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isRoleModelPostconditionError(outcome)).toBe(true);
        expect((outcome as RoleModelPostconditionError).violations.join('\n')).toMatch(message);
    });

    // ⛔ Every pair, both ways, read from the registry and not typed out, plus roles OUTSIDE it: another database's
    // service role, and a predefined role that would give the seeder writes on `schema_migrations`. A check that
    // walks a list of the registry's roles passes the last three rows.
    const others = [...databaseRoleNames(roles).filter((role) => role !== 'food_seeder'), master, 'recipe_app'];
    const isolation: readonly (readonly [string, MembershipEdge, RegExp])[] = [
        ...others.map(
            (role) =>
                [
                    `the seeder a member of ${role}`,
                    edge('food_seeder', role),
                    new RegExp(`the seeder food_seeder is a member of ${role} `, 'u'),
                ] as const,
        ),
        [
            'the seeder a member of pg_write_all_data',
            edge('food_seeder', 'pg_write_all_data'),
            /the seeder food_seeder is a member of pg_write_all_data /u,
        ],
        ...others.map(
            (role) =>
                [
                    `${role} a member of the seeder`,
                    edge(role, 'food_seeder'),
                    new RegExp(`${role} is a member of the seeder food_seeder `, 'u'),
                ] as const,
        ),
    ];

    it.each(isolation)('⛔ reports %s', async (_case, extra, message) => {
        const state = healthy();
        const outcome = await assertRoleModel(readerOver({ ...state, edges: [...state.edges, extra] }), {
            roles,
            context,
        }).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isRoleModelPostconditionError(outcome)).toBe(true);
        expect((outcome as RoleModelPostconditionError).violations.join('\n')).toMatch(message);
    });

    it('asks nothing of a seeder where the database has none', async () => {
        const identity = DATABASE_ROLES.identity;
        const state = {
            roles: [
                { rolname: identity.owner, rolcanlogin: false, rolcreatedb: false },
                { rolname: identity.migrator, rolcanlogin: true, rolcreatedb: true },
                { rolname: identity.app, rolcanlogin: true, rolcreatedb: false },
            ],
            edges: [
                edge(identity.migrator, identity.owner),
                edge(master, identity.owner),
                edge(identity.migrator, RDS_IAM),
                edge(identity.app, RDS_IAM),
            ],
        };

        await expect(assertRoleModel(readerOver(state), { roles: identity, context })).resolves.toBeUndefined();
    });
});
