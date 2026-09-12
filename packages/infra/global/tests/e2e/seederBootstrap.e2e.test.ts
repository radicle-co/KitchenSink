// @vitest-environment node
/**
 * LOCAL e2e: the role-split bootstrap pass with a SEEDER role, run by a NOSUPERUSER stand-in for the RDS master
 * against a real PostgreSQL (curated catalog plan U18, ADR-0039).
 *
 * Food's seeder is a third LOGIN role. Every list the pass iterates must reach it: the converge that takes the master
 * out of login roles, the `rds_iam` grant and its master-reach check, the probe rollback, and the database ACL and
 * its postconditions. A list typed out as `[migrator, app]` would leave the seeder as a login role the master can
 * reach, which on RDS forces IAM auth on the master and locks out every password client.
 *
 * The stand-in master and its limits are `tests/dbBootstrap.integration.test.ts`'s: a password stands in for an IAM
 * token, so the lock-out is asserted STRUCTURALLY, as the master's membership paths. The superuser
 * (`DATABASE_ADMIN_URL`) only builds fixtures and reads results. Names are prefixed `kss_` so this suite never
 * collides with that one or with the service harnesses on the same server.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    applyMigrations,
    edgeConfersMembership,
    isRoleModelAbsentError,
    readMigrationManifest,
    type CatalogReader,
    type DatabaseRoles,
    type MembershipEdge,
} from '@kitchensink/db-schema-guard';
import { provisionStandInMaster } from '@kitchensink/service-test-harness';

import {
    isBootstrapRefusedError,
    isMasterLoginProbeError,
    runBootstrapPass,
    type BootstrapPassInput,
    type BootstrapPorts,
} from '../../src/db-bootstrap/bootstrapPass.js';
import { isMasterMembershipError } from '../../src/db-bootstrap/masterMembership.js';
import { catalogProbes } from '../common/catalogProbes.js';
import { throwawayServerUrl } from '../common/throwawayServer.js';

const ADMIN_URL = process.env['DATABASE_ADMIN_URL'];
/** The throwaway server — loopback only; a refused URL fails the run here (see `throwawayServer.ts`). */
const SERVER_URL = throwawayServerUrl(ADMIN_URL);
const MASTER = 'kss_master';
const PASSWORD = 'kss-pw';

const SEEDED = {
    owner: 'kss_food_owner',
    migrator: 'kss_food_migrator',
    app: 'kss_food_app',
    seeder: 'kss_food_seeder',
} as const satisfies DatabaseRoles;
const INDIRECT = {
    owner: 'kss_ind_owner',
    migrator: 'kss_ind_migrator',
    app: 'kss_ind_app',
    seeder: 'kss_ind_seeder',
} as const satisfies DatabaseRoles;
const ABSENT = {
    owner: 'kss_abs_owner',
    migrator: 'kss_abs_migrator',
    app: 'kss_abs_app',
    seeder: 'kss_abs_seeder',
} as const satisfies DatabaseRoles;
const VIA = 'kss_via';

const DATABASES = ['kss_food', 'kss_ind', 'kss_abs'] as const;
const ROLES = [...Object.values(SEEDED), ...Object.values(INDIRECT), ...Object.values(ABSENT), VIA];

/** A connection string for `role` on `database`, on the `DATABASE_ADMIN_URL` server. */
function urlFor(role: string, database: string): string {
    const url = new URL(SERVER_URL ?? 'postgres://localhost/postgres');

    url.username = role;
    url.password = PASSWORD;
    url.pathname = `/${database}`;

    return url.toString();
}

/** Open a connection as the stand-in master. */
async function connectAsMaster(database: string): Promise<pg.Client> {
    const client = new pg.Client({ connectionString: urlFor(MASTER, database) });

    await client.connect();

    return client;
}

/** A session that forwards every statement except those `rewrite` changes; `null` swallows the statement. */
function rewritingSession(session: CatalogReader, rewrite: (sql: string) => string | null): CatalogReader {
    return {
        query: async <Row>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }> => {
            const statement = rewrite(sql);

            if (statement === null) {
                return { rows: [] };
            }

            return { rows: (await session.query(statement, values)).rows as Row[] };
        },
    };
}

/** An edge rendered for comparison. */
const renderEdge = (edge: MembershipEdge): string =>
    `${edge.member}→${edge.role} admin=${String(edge.admin)} inherit=${String(edge.inherit)} set=${String(edge.set)}`;

describe.skipIf(!SERVER_URL)('the bootstrap pass with a seeder role, against real PostgreSQL', () => {
    const admin = new pg.Pool({ connectionString: SERVER_URL, max: 2 });
    const { edges, holdsIamRow, masterPathsTo, can, explicitGrants } = catalogProbes(admin, MASTER);
    let session: pg.Client;
    const logs: Record<string, unknown>[] = [];

    const ports = (overrides: Partial<BootstrapPorts> = {}): BootstrapPorts => ({
        session,
        connectAsMaster,
        log: (entry) => logs.push(entry),
        ...overrides,
    });

    /** A pass as the stand-in master; `inherit-or-set` is the stand-in's concession (see the integration suite). */
    const pass = (roles: DatabaseRoles, database: string): BootstrapPassInput => ({
        service: 'food',
        roles,
        database,
        master: MASTER,
        isProd: false,
        armed: false,
        lockOutEdges: 'inherit-or-set',
    });

    async function cleanUp(): Promise<void> {
        for (const database of DATABASES) {
            await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        }

        for (const role of [...ROLES, MASTER]) {
            await admin.query(`DROP ROLE IF EXISTS "${role}"`);
        }
    }

    beforeAll(async () => {
        await cleanUp();
        await provisionStandInMaster(admin, MASTER, PASSWORD);
        session = await connectAsMaster('postgres');
    });

    afterAll(async () => {
        await session?.end().catch(() => undefined);
        await cleanUp();
        await admin.end();
    });

    describe('a fresh food-shaped database', () => {
        const input = pass(SEEDED, 'kss_food');

        it('creates the seeder as a login with no CREATEDB, in rds_iam, with CONNECT and its own TEMPORARY only', async () => {
            const report = await runBootstrapPass(ports(), input);
            const role = await admin.query<{ rolcanlogin: boolean; rolcreatedb: boolean }>(
                'SELECT rolcanlogin, rolcreatedb FROM pg_roles WHERE rolname = $1',
                [SEEDED.seeder],
            );

            expect(report.disposition).toBe('create');
            expect(role.rows).toStrictEqual([{ rolcanlogin: true, rolcreatedb: false }]);
            expect(await holdsIamRow(SEEDED.seeder)).toBe(true);
            expect(await explicitGrants(SEEDED.seeder, 'kss_food')).toStrictEqual(['CONNECT', 'TEMPORARY']);
            expect(await can(SEEDED.seeder, 'CREATE', 'kss_food')).toBe(false);
            expect(await can('public', 'CONNECT', 'kss_food')).toBe(false);
            expect(await can('public', 'TEMPORARY', 'kss_food')).toBe(false);
        });

        it('gives the seeder no membership but rds_iam', async () => {
            const memberOf = (await edges()).filter((edge) => edge.member === SEEDED.seeder).map((edge) => edge.role);

            expect(memberOf).toStrictEqual(['rds_iam']);
        });

        it('leaves no role, the master included, a member of the seeder', async () => {
            // Every edge into the seeder, read the way the stand-in is run: the master's ADMIN-only row on a role it
            // created is vanilla PostgreSQL's record of an ADMIN that RDS holds without a row.
            const into = (await edges()).filter((edge) => edge.role === SEEDED.seeder && edgeConfersMembership(edge));

            expect(into).toStrictEqual([]);
            expect(await masterPathsTo('rds_iam')).toStrictEqual([]);
        });

        it('names the seeder in the census it logs before changing anything — absent (null) before the first pass', () => {
            const census = logs.find((entry) => entry['message'] === 'role census before the bootstrap')?.['census'];

            expect(census).toMatchObject({ adminOn: { [SEEDED.seeder]: null } });
        });

        it('is idempotent: a second pass finds it ready and changes no membership', async () => {
            const before = (await edges()).map(renderEdge).sort();
            const report = await runBootstrapPass(ports(), input);

            expect(report.disposition).toBe('ready');
            expect((await edges()).map(renderEdge).sort()).toStrictEqual(before);
        });

        it('RESETS the seeder’s database rights: a hand-granted CREATE goes, a revoked TEMPORARY comes back', async () => {
            await admin.query(`GRANT CREATE ON DATABASE kss_food TO ${SEEDED.seeder}`);
            await admin.query(`REVOKE TEMPORARY ON DATABASE kss_food FROM ${SEEDED.seeder}`);

            await runBootstrapPass(ports(), input);

            expect(await explicitGrants(SEEDED.seeder, 'kss_food')).toStrictEqual(['CONNECT', 'TEMPORARY']);
            expect(await can(SEEDED.seeder, 'CREATE', 'kss_food')).toBe(false);
        });

        it('⛔ refuses the deploy when the ACL step leaves the seeder without its TEMPORARY grant', async () => {
            const swallowTemporary = rewritingSession(session, (sql) => (/^GRANT TEMPORARY/u.test(sql) ? null : sql));

            try {
                const error = await runBootstrapPass(ports({ session: swallowTemporary }), input).catch(
                    (caught: unknown) => caught,
                );

                expect(isBootstrapRefusedError(error)).toBe(true);
                expect(String(error)).toContain('kss_food_seeder lacks its explicit TEMPORARY grant on kss_food');
            } finally {
                await runBootstrapPass(ports(), input);
            }
        });

        it('⛔ refuses the deploy when CREATE reaches the seeder', async () => {
            const addCreate = rewritingSession(session, (sql) =>
                sql.replace(/^GRANT TEMPORARY /u, 'GRANT TEMPORARY, CREATE '),
            );

            try {
                const error = await runBootstrapPass(ports({ session: addCreate }), input).catch(
                    (caught: unknown) => caught,
                );

                expect(isBootstrapRefusedError(error)).toBe(true);
                expect(String(error)).toContain('kss_food_seeder holds CREATE on kss_food');
            } finally {
                await runBootstrapPass(ports(), input);
            }
        });

        it('⛔ takes a master joined DIRECTLY to the seeder back out, before any rds_iam grant', async () => {
            // The shape an interrupted run leaves: the master in a login role that holds rds_iam — on RDS, the lock-out.
            await session.query(`GRANT ${SEEDED.seeder} TO ${MASTER} WITH INHERIT TRUE, SET TRUE`);
            expect((await masterPathsTo(SEEDED.seeder)).length).toBeGreaterThan(0);

            try {
                await runBootstrapPass(ports(), input);

                expect(await masterPathsTo(SEEDED.seeder)).toStrictEqual([]);
                expect(await masterPathsTo('rds_iam')).toStrictEqual([]);
                expect(logs.some((entry) => JSON.stringify(entry['released'] ?? []).includes(SEEDED.seeder))).toBe(
                    true,
                );
            } finally {
                await admin.query(`REVOKE ${SEEDED.seeder} FROM ${MASTER} GRANTED BY ${MASTER}`).catch(() => undefined);
            }
        });

        it('⛔ a failed master login rolls back rds_iam from EVERY login role, and the master from each', async () => {
            // The probe first joins the master to the seeder: the edge the catalog read "missed", which is the premise
            // of the rollback — it takes the master out of every role, not only the ones it can prove it joined.
            let joined = false;

            const refusedProbe: BootstrapPorts['connectAsMaster'] = async (database) => {
                if (database === 'postgres') {
                    // Once: the pass probes again after its rollback, and that probe must not undo the rollback.
                    if (!joined) {
                        joined = true;
                        await session.query(`GRANT ${SEEDED.seeder} TO ${MASTER} WITH INHERIT TRUE, SET TRUE`);
                    }

                    throw Object.assign(new Error('password authentication failed for user "kss_master" (injected)'), {
                        code: '28P01',
                    });
                }

                return connectAsMaster(database);
            };

            try {
                const error = await runBootstrapPass(ports({ connectAsMaster: refusedProbe }), input).catch(
                    (caught: unknown) => caught,
                );

                expect(isMasterLoginProbeError(error)).toBe(true);

                for (const login of [SEEDED.migrator, SEEDED.app, SEEDED.seeder]) {
                    expect(await holdsIamRow(login), `${login} still holds rds_iam`).toBe(false);
                }

                expect(await masterPathsTo(SEEDED.seeder)).toStrictEqual([]);
            } finally {
                await runBootstrapPass(ports(), input);
            }
        });
    });

    describe('a master that reaches the seeder INDIRECTLY', () => {
        beforeAll(async () => {
            await admin.query(`CREATE ROLE ${INDIRECT.seeder} LOGIN`);
            // RDS's implicit ADMIN on every role, without a membership: what lets the pass alter a role it did not create.
            await admin.query(`GRANT ${INDIRECT.seeder} TO ${MASTER} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
            await admin.query(`CREATE ROLE ${VIA} NOLOGIN`);
            await admin.query(`GRANT ${INDIRECT.seeder} TO ${VIA}`);
            await admin.query(`GRANT ${VIA} TO ${MASTER} WITH INHERIT TRUE, SET TRUE`);
        });

        afterAll(async () => {
            await admin.query(`REVOKE ${VIA} FROM ${MASTER}`).catch(() => undefined);
        });

        it('⛔ refuses before granting rds_iam to any login role, naming the path', async () => {
            const error = await runBootstrapPass(ports(), pass(INDIRECT, 'kss_ind')).catch((caught: unknown) => caught);

            // The converge refuses: it cannot take the master off a path it did not grant.
            expect(isMasterMembershipError(error)).toBe(true);
            expect(String(error)).toContain(VIA);

            for (const login of [INDIRECT.migrator, INDIRECT.app, INDIRECT.seeder]) {
                expect(await holdsIamRow(login), `${login} was granted rds_iam`).toBe(false);
            }
        });
    });

    describe('a migration run before the bootstrap created the seeder', () => {
        const migrations = mkdtempSync(join(tmpdir(), 'kssMigrations'));

        beforeAll(async () => {
            writeFileSync(join(migrations, '0001_marker.sql'), 'CREATE TABLE marker (id int);\n');
            // The bootstrap as it was before the seeder existed: the three original roles and the database.
            await runBootstrapPass(
                ports(),
                pass({ owner: ABSENT.owner, migrator: ABSENT.migrator, app: ABSENT.app }, 'kss_abs'),
            );
            await admin.query(`ALTER ROLE ${ABSENT.migrator} PASSWORD '${PASSWORD}'`);
        });

        afterAll(() => {
            rmSync(migrations, { recursive: true, force: true });
        });

        it('⛔ names the missing role, and neither takes the migration lock nor creates the ledger', async () => {
            const pool = new pg.Pool({ connectionString: urlFor(ABSENT.migrator, 'kss_abs'), max: 1 });

            try {
                const error = await applyMigrations({
                    pool,
                    migrationsDir: migrations,
                    label: 'kss',
                    expectedTables: ['marker'],
                    expectManifestSha: readMigrationManifest(migrations).sha,
                    database: 'kss_abs',
                    roles: ABSENT,
                    // A seeded database's own policy, naming no table: the refusal must come from the missing role.
                    tablePolicy: { catalog: new Set(), serviceReadOnly: new Set(), dictionaries: new Set() },
                }).catch((caught: unknown) => caught);

                expect(isRoleModelAbsentError(error)).toBe(true);
                expect(String(error)).toContain(ABSENT.seeder);

                // Read while the pool still holds its session: a lock taken and not released would still be here.
                const locks = await admin.query<{ held: number }>(
                    `SELECT count(*)::int AS held FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                      WHERE l.locktype = 'advisory' AND a.usename = $1`,
                    [ABSENT.migrator],
                );

                expect(locks.rows[0]?.held).toBe(0);
            } finally {
                await pool.end();
            }

            const inside = new pg.Client({ connectionString: SERVER_URL?.replace(/\/[^/]*$/u, '/kss_abs') });

            await inside.connect();

            try {
                const ledger = await inside.query(
                    "SELECT 1 FROM pg_class WHERE relname IN ('schema_migrations', 'marker')",
                );

                expect(ledger.rowCount).toBe(0);
            } finally {
                await inside.end();
            }
        });
    });
});
