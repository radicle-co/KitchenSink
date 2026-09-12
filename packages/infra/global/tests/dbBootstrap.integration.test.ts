// @vitest-environment node
/**
 * Integration: the role-split bootstrap pass, run by a NOSUPERUSER stand-in for the RDS master against a REAL
 * PostgreSQL — including the one-shot legacy recreate and the ways it must refuse.
 *
 * ## The shape reproduced
 *
 * Step 0 measured the RDS master (`identity_app`): NOSUPERUSER, CREATEROLE, CREATEDB, `pg_signal_backend`, and
 * ADMIN — conferring nothing else — on `rds_iam` and on the legacy app roles, through `rds_superuser`. Here that is a
 * stand-in `rds_iam` role and a stand-in master holding ADMIN-only edges. A password stands in for an IAM token;
 * this server cannot enforce RDS's "rds_iam forces IAM auth" rule, so the lock-out is asserted STRUCTURALLY — the
 * master must never have a membership path to `rds_iam` — plus a fresh password login after every destructive step.
 *
 * The superuser (`DATABASE_URL`) only builds fixtures and reads results. Every statement under test runs as the
 * stand-in master, because a superuser can do anything and would prove nothing.
 *
 * Role and database names are prefixed `ksb_` so this suite never collides with the service harnesses that
 * provision the real `DATABASE_ROLES` names on the same server.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    ROLE_CATALOG_LOCK_KEY,
    edgeConfersMembership,
    isRoleModelPostconditionError,
    pathsToRole,
    readMembershipEdges,
    type CatalogReader,
} from '@kitchensink/db-schema-guard';

import { isMasterUnreachableError } from '../src/db-bootstrap/masterUnreachableError.js';
import {
    isBootstrapRefusedError,
    isMasterLoginProbeError,
    runBootstrapPass,
    type BootstrapPassInput,
    type BootstrapPorts,
} from '../src/db-bootstrap/bootstrapPass.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const MASTER = 'ksb_master';
const PASSWORD = 'ksb-pw';

const FRESH = { owner: 'ksb_fresh_owner', migrator: 'ksb_fresh_migrator', app: 'ksb_fresh_app' } as const;
const FOOD = { owner: 'ksb_food_owner', migrator: 'ksb_food_migrator', app: 'ksb_food_app' } as const;
const IDENTITY = { owner: 'ksb_id_owner', migrator: 'ksb_id_migrator', app: 'ksb_id_service' } as const;
const ADOPT = { owner: 'ksb_ad_owner', migrator: 'ksb_ad_migrator', app: 'ksb_ad_service' } as const;
const STRICT = { owner: 'ksb_strict_owner', migrator: 'ksb_strict_migrator', app: 'ksb_strict_app' } as const;
const IAM_VIA = 'ksb_iam_via';

const DATABASES = ['ksb_fresh', 'ksb_food', 'ksb_food_pr_7', 'ksb_identity', 'ksb_adopt', 'ksb_strict'] as const;
const ROLES = [
    ...Object.values(FRESH),
    ...Object.values(FOOD),
    ...Object.values(IDENTITY),
    ...Object.values(ADOPT),
    ...Object.values(STRICT),
];

/** A connection string for `role` on `database`, on the `DATABASE_URL` server. */
function urlFor(role: string, database: string): string {
    const url = new URL(DATABASE_URL ?? 'postgres://localhost/postgres');

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

/** Whether a FRESH password login as the master still succeeds — the lock-out would show here first. */
async function masterCanLogIn(database = 'postgres'): Promise<boolean> {
    try {
        const client = await connectAsMaster(database);

        await client.end();

        return true;
    } catch {
        return false;
    }
}

describe.skipIf(!DATABASE_URL)('the role-split bootstrap pass against real PostgreSQL', () => {
    const admin = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    let session: pg.Client;
    const logs: Record<string, unknown>[] = [];

    const ports = (overrides: Partial<BootstrapPorts> = {}): BootstrapPorts => ({
        session,
        connectAsMaster,
        log: (entry) => logs.push(entry),
        ...overrides,
    });

    /**
     * A pass as the stand-in master.
     *
     * ⚠️ `lockOutEdges: 'inherit-or-set'` is the stand-in's concession, and the ONE thing these tests do not run
     * the way production does. Vanilla PostgreSQL records a CREATEROLE user's ADMIN as a `pg_auth_members` row —
     * on every role it creates, and on `rds_iam` here — and the creator cannot revoke it (measured on PostgreSQL 18).
     * RDS confers that ADMIN implicitly through `rds_superuser` with no row at all (Step 0). The production reading
     * (`every-row`) would therefore refuse every pass here for rows RDS does not have; the conservative reading is
     * asserted on its own below, where it is the subject.
     */
    const pass = (input: Partial<BootstrapPassInput> & Pick<BootstrapPassInput, 'service' | 'roles' | 'database'>) =>
        ({
            master: MASTER,
            isProd: false,
            armed: false,
            lockOutEdges: 'inherit-or-set',
            ...input,
        }) as BootstrapPassInput;

    /** Whether `role` holds any `pg_auth_members` row into `rds_iam`, whatever its options. */
    async function holdsIamRow(role: string): Promise<boolean> {
        return (await edges()).some((edge) => edge.member === role && edge.role === 'rds_iam');
    }

    /** The owner and connection limit of `database`, or `undefined`. */
    async function databaseRow(database: string): Promise<{ owner: string; oid: number } | undefined> {
        const result = await admin.query<{ owner: string; oid: number }>(
            'SELECT pg_get_userbyid(datdba) AS owner, oid::int AS oid FROM pg_database WHERE datname = $1',
            [database],
        );

        return result.rows[0];
    }

    /** Whether `database` holds the fixture's marker table. */
    async function hasMarker(database: string): Promise<boolean> {
        const client = new pg.Client({ connectionString: DATABASE_URL?.replace(/\/[^/]*$/u, `/${database}`) });

        await client.connect();

        try {
            const result = await client.query("SELECT 1 FROM pg_class WHERE relname = 'marker'");

            return result.rowCount === 1;
        } finally {
            await client.end();
        }
    }

    async function edges(): Promise<ReturnType<typeof readMembershipEdges>> {
        return readMembershipEdges(admin as unknown as CatalogReader);
    }

    /**
     * The master's membership paths to `role`, read the way the stand-in is run (`inherit-or-set`): the stand-in's
     * ADMIN-only rows are vanilla PostgreSQL's record of an ADMIN that RDS holds without a row. The strict reading's
     * own subject is {@link holdsIamRow} and the every-row describe below.
     */
    async function masterPathsTo(role: string): Promise<readonly (readonly string[])[]> {
        return pathsToRole(await edges(), MASTER, role, edgeConfersMembership);
    }

    async function can(role: string, privilege: string, database: string): Promise<boolean> {
        const result = await admin.query<{ ok: boolean }>('SELECT has_database_privilege($1, $2, $3) AS ok', [
            role,
            database,
            privilege,
        ]);

        return result.rows[0]?.ok ?? false;
    }

    /** The privileges `role` holds on `database` through an EXPLICIT ACL entry, sorted. */
    async function explicitGrants(role: string, database: string): Promise<readonly string[]> {
        const result = await admin.query<{ privilege_type: string }>(
            `SELECT a.privilege_type FROM pg_database d, aclexplode(d.datacl) a
              WHERE d.datname = $1 AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2)
              ORDER BY 1`,
            [database, role],
        );

        return result.rows.map((row) => row.privilege_type);
    }

    async function cleanUp(): Promise<void> {
        for (const database of DATABASES) {
            await admin.query(`UPDATE pg_database SET datconnlimit = -1 WHERE datname = $1`, [database]);
            await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        }

        for (const role of [...ROLES, IAM_VIA, MASTER]) {
            await admin.query(`DROP ROLE IF EXISTS "${role}"`);
        }
    }

    beforeAll(async () => {
        await cleanUp();
        await admin.query(
            "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rds_iam') THEN CREATE ROLE rds_iam NOLOGIN; END IF; END $$",
        );
        await admin.query(`CREATE ROLE ${MASTER} LOGIN NOSUPERUSER CREATEROLE CREATEDB PASSWORD '${PASSWORD}'`);
        // RDS's master holds ADMIN on `rds_iam` through `rds_superuser` and nothing else; an ADMIN-only edge is the
        // same capability without a membership.
        await admin.query(`GRANT rds_iam TO ${MASTER} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
        await admin.query(`GRANT pg_signal_backend TO ${MASTER}`);
        session = await connectAsMaster('postgres');
    });

    afterAll(async () => {
        await session?.end().catch(() => undefined);
        await cleanUp();
        await admin.end();
    });

    describe('a fresh stage — no roles, no database', () => {
        const input = pass({ service: 'food', roles: FRESH, database: 'ksb_fresh' });

        it('creates the roles and the database owned by the owner role, closed to PUBLIC', async () => {
            const report = await runBootstrapPass(ports(), input);

            expect(report.disposition).toBe('create');
            expect((await databaseRow('ksb_fresh'))?.owner).toBe(FRESH.owner);
            expect(await can('public', 'CONNECT', 'ksb_fresh')).toBe(false);
            expect(await can(FRESH.migrator, 'CONNECT', 'ksb_fresh')).toBe(true);
            expect(await can(FRESH.app, 'CONNECT', 'ksb_fresh')).toBe(true);
        });

        it('leaves the master with no path to rds_iam, SET+INHERIT on the owner (non-prod), and a working login', async () => {
            const graph = await edges();
            const toOwner = graph.filter((edge) => edge.member === MASTER && edge.role === FRESH.owner);

            expect(pathsToRole(graph, MASTER, 'rds_iam', edgeConfersMembership)).toEqual([]);
            expect(toOwner.some((edge) => edge.set && edge.inherit)).toBe(true);
            expect(pathsToRole(graph, FRESH.app, 'rds_iam')).toEqual([[FRESH.app, 'rds_iam']]);
            expect(await masterCanLogIn()).toBe(true);
        });

        it('is idempotent — a second run finds it ready and changes nothing', async () => {
            const before = await databaseRow('ksb_fresh');
            const report = await runBootstrapPass(ports(), input);

            expect(report.disposition).toBe('ready');
            expect(await databaseRow('ksb_fresh')).toEqual(before);
        });

        it('RESETS the database ACL: a drifted CREATE/TEMP grant to a login role is taken back', async () => {
            // A superuser's grant is recorded as the owner's, which is exactly what the owner's REVOKE ALL removes.
            await admin.query(`GRANT CREATE, TEMPORARY ON DATABASE ksb_fresh TO ${FRESH.app}, ${FRESH.migrator}`);

            await runBootstrapPass(ports(), input);

            // The service role inherits nothing, so its EFFECTIVE privileges are the test; the migrator inherits the
            // owner's, which it is meant to, so for it the test is that no EXPLICIT grant is left in the ACL.
            expect(await can(FRESH.app, 'CREATE', 'ksb_fresh')).toBe(false);
            expect(await can(FRESH.app, 'TEMPORARY', 'ksb_fresh')).toBe(false);
            expect(await explicitGrants(FRESH.migrator, 'ksb_fresh')).toEqual(['CONNECT']);
            expect(await explicitGrants(FRESH.app, 'ksb_fresh')).toEqual(['CONNECT']);
        });

        it('⛔ SERIALIZES: a second pass waits on the advisory lock the first one holds', async () => {
            const holder = await connectAsMaster('postgres');

            await holder.query('SELECT pg_advisory_lock($1)', [ROLE_CATALOG_LOCK_KEY]);

            let finished = false;
            const blocked = runBootstrapPass(ports(), input).then(() => {
                finished = true;
            });

            await new Promise((resolve) => setTimeout(resolve, 750));
            expect(finished).toBe(false);

            await holder.query('SELECT pg_advisory_unlock($1)', [ROLE_CATALOG_LOCK_KEY]);
            await holder.end();
            await blocked;
            expect(finished).toBe(true);
        });

        it('⛔ BOUNDS the wait: lock_timeout is set before the acquire and reset after', async () => {
            // ⛔ `pg_advisory_lock` waits FOREVER by default. A pass killed mid-flight (this Lambda's timeout
            // is 600s) leaves its backend holding the role-catalog lock until TCP keepalive notices, and
            // every recovery door — the next deploy, the reaper — queues behind it with no diagnosis, while
            // the service role may have no `rds_iam` and the master may still be joined to it. A bounded
            // acquire converts that from an unexplained hang into a stated failure inside the Lambda's own
            // budget. Mirrors `applyMigrations`, which bounds the very same way and for the same reason.
            //
            // ⚠️ Asserted STRUCTURALLY, over the statements issued, rather than by elapsing the timeout: the
            // value has to exceed a legitimate wait (the SERIALIZES test above waits on a real holder), so a
            // behavioural test would have to sit out the whole timeout to prove anything.
            const issued: string[] = [];
            const recording = {
                query: (text: string, values?: unknown[]) => {
                    issued.push(text);

                    return session.query(text, values as never);
                },
            } as unknown as pg.Client;

            await runBootstrapPass(ports({ session: recording }), input);

            const setAt = issued.findIndex((text) => /SET lock_timeout/i.test(text));
            const acquiredAt = issued.findIndex((text) => text.includes('pg_advisory_lock'));

            expect(setAt).toBeGreaterThanOrEqual(0);
            expect(acquiredAt).toBeGreaterThan(setAt);
            // Reset afterwards: it is a session setting and this session outlives the pass, so leaving it in
            // place would silently shorten every later statement's lock wait.
            expect(issued.some((text) => /RESET lock_timeout/i.test(text))).toBe(true);
        });

        it('⛔ refuses, by name, a database an interrupted DROP left invalid (datconnlimit = -2)', async () => {
            await admin.query("UPDATE pg_database SET datconnlimit = -2 WHERE datname = 'ksb_fresh'");

            try {
                const error = await runBootstrapPass(ports(), input).catch((caught: unknown) => caught);

                expect(isBootstrapRefusedError(error)).toBe(true);
                expect(String(error)).toMatch(/ksb_fresh.*-2/su);
            } finally {
                await admin.query("UPDATE pg_database SET datconnlimit = -1 WHERE datname = 'ksb_fresh'");
            }
        });

        it('⛔ a TRANSIENT probe failure does not revoke anything — it re-probes and carries on', async () => {
            // ⛔ The rollback is the right answer to a LOCK-OUT and a catastrophe in response to a hiccup: it
            // revokes `rds_iam` from `<svc>_migrator` and `<svc>_app`, which are LIVE roles every running
            // service authenticates with. A dropped packet, a restarting proxy, or a moment at the
            // connection limit would therefore take every service on the instance off IAM auth — an outage
            // manufactured by the safety net, triggered by the thing least likely to mean what it looked
            // like. The probe is cheap and a lock-out is PERSISTENT, so asking twice separates them.
            let attempts = 0;

            const flakyProbe: BootstrapPorts['connectAsMaster'] = async (database) => {
                attempts += 1;

                if (database === 'postgres' && attempts === 1) {
                    throw Object.assign(new Error('connect ECONNREFUSED (injected)'), { code: 'ECONNREFUSED' });
                }

                return connectAsMaster(database);
            };

            await expect(runBootstrapPass(ports({ connectAsMaster: flakyProbe }), input)).resolves.toBeDefined();

            // The memberships the pass granted are INTACT: nothing was rolled back on a stumble.
            expect((await masterPathsTo(FRESH.owner)).length).toBeGreaterThan(0);
        });

        it('⛔ a SUSTAINED connectivity failure revokes NOTHING — it is not a lock-out', async () => {
            // ⛔ THE OUTAGE THIS PREVENTS. The rollback revokes `rds_iam` from `<svc>_migrator` and
            // `<svc>_app`, the roles every running service authenticates with. Reading "I cannot reach the
            // server" as "AWS has switched the master to IAM auth" therefore takes the whole instance off IAM
            // auth in response to a network fault. Re-probing already covered a STUMBLE; this covers the
            // server staying unreachable for every attempt, which used to end in the revoke.
            //
            // ⚠️ The asymmetry is deliberate and chosen on blast radius: a missed lock-out leaves the
            // instance as it already was and surfaces as a stated failure, while a wrongly-diagnosed one
            // manufactures an incident.
            const unreachable: BootstrapPorts['connectAsMaster'] = async (database) => {
                if (database === 'postgres') {
                    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1 (injected)'), {
                        code: 'ECONNREFUSED',
                    });
                }

                return connectAsMaster(database);
            };

            const error = await runBootstrapPass(ports({ connectAsMaster: unreachable }), input).catch(
                (caught: unknown) => caught,
            );

            expect(isMasterUnreachableError(error)).toBe(true);
            // ⛔ NOT the rollback error — that type's message asserts a rollback happened.
            expect(isMasterLoginProbeError(error)).toBe(false);
            // And the memberships the pass granted are INTACT.
            expect((await masterPathsTo(FRESH.owner)).length).toBeGreaterThan(0);
            expect(await masterCanLogIn()).toBe(true);
        });

        it('⛔ rolls back what it granted the master when a fresh master login fails, then throws', async () => {
            // ⚠️ CARRIES `28P01` as of 2026-09-12, which is what a real `pg` auth failure carries. The pass
            // now decides whether to roll back from the SQLSTATE rather than from the message, so a double
            // without one would exercise the UNREACHABLE path instead — and would no longer be testing what
            // this case is named for. The message is unchanged; only the realism of the double is.
            const failingProbe: BootstrapPorts['connectAsMaster'] = async (database) => {
                if (database === 'postgres') {
                    throw Object.assign(new Error('password authentication failed for user "ksb_master" (injected)'), {
                        code: '28P01',
                    });
                }

                return connectAsMaster(database);
            };

            const error = await runBootstrapPass(ports({ connectAsMaster: failingProbe }), input).catch(
                (caught: unknown) => caught,
            );

            expect(isMasterLoginProbeError(error)).toBe(true);
            expect(await masterPathsTo(FRESH.owner)).toEqual([]);

            // ⛔ AND IT SAYS SO. Releasing the master from `<svc>_owner` is what the rollback must do, but it
            // is also precisely what per-PR reclamation depends on: the reaper can drop a per-PR database
            // only because the master INHERITs each owner outside prod (`dropDatabaseAuthority`). So a
            // rollback leaves the reaper unable to reclaim anything until the next successful deploy —
            // silently, on a path whose own error is about something else entirely. A cost leak nobody is
            // told about is the failure mode ADR-0005 already records for a tag sweep that matches nothing.
            expect(
                logs.some(
                    (entry) => /reclamation/i.test(String(entry['message'])) && entry['database'] === 'ksb_fresh',
                ),
                `no log named the reclamation consequence; got ${JSON.stringify(logs)}`,
            ).toBe(true);

            // And the next ordinary run restores it.
            await runBootstrapPass(ports(), input);
            expect((await masterPathsTo(FRESH.owner)).length).toBeGreaterThan(0);
        });
    });

    describe('a legacy food database — owned by the old single role, which holds rds_iam', () => {
        const input = pass({ service: 'food', roles: FOOD, database: 'ksb_food' });

        beforeAll(async () => {
            await admin.query(`CREATE ROLE ${FOOD.app} LOGIN CREATEDB PASSWORD '${PASSWORD}'`);
            // RDS's implicit ADMIN on the legacy app role, without a membership.
            await admin.query(`GRANT ${FOOD.app} TO ${MASTER} WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
            // Granted BY THE SUPERUSER first — a grant the master did not make. The first armed test proves the
            // recreate refuses that state; the fixture is then moved to the shape RDS actually has.
            await admin.query(`GRANT rds_iam TO ${FOOD.app}`);

            for (const database of ['ksb_food', 'ksb_food_pr_7']) {
                await admin.query(`CREATE DATABASE ${database} OWNER ${FOOD.app}`);

                const legacy = new pg.Client({ connectionString: urlFor(FOOD.app, database) });

                await legacy.connect();
                await legacy.query('CREATE TABLE marker (id int)');
                await legacy.end();
            }
        });

        it('⛔ NOT armed → refuses, and drops nothing', async () => {
            const oid = (await databaseRow('ksb_food'))?.oid;
            const error = await runBootstrapPass(ports(), input).catch((caught: unknown) => caught);

            expect(isBootstrapRefusedError(error)).toBe(true);
            expect(String(error)).toMatch(/not armed/u);
            expect((await databaseRow('ksb_food'))?.oid).toBe(oid);
            expect(await hasMarker('ksb_food')).toBe(true);
        });

        it('⛔ an rds_iam grant the master cannot revoke (another grantor) → refuses BEFORE joining the master to it', async () => {
            const error = await runBootstrapPass(ports(), { ...input, armed: true }).catch((caught: unknown) => caught);

            expect(isBootstrapRefusedError(error)).toBe(true);
            expect(String(error)).toMatch(/grant of rds_iam to ksb_food_app by postgres/u);
            expect(await masterPathsTo(FOOD.app)).toEqual([]);
            expect(await masterPathsTo('rds_iam')).toEqual([]);
            expect(await hasMarker('ksb_food')).toBe(true);
            expect(await masterCanLogIn()).toBe(true);

            // Now the shape RDS has: the pre-split bootstrap granted rds_iam AS THE MASTER.
            await admin.query(`REVOKE rds_iam FROM ${FOOD.app} GRANTED BY postgres`);
            await session.query(`GRANT rds_iam TO ${FOOD.app}`);
        });

        it('⛔ NEGATIVE CONTROL: when the app role still reaches rds_iam another way, it refuses BEFORE joining the master to it', async () => {
            await admin.query(`CREATE ROLE ${IAM_VIA} NOLOGIN`);
            await admin.query(`GRANT rds_iam TO ${IAM_VIA}`);
            await admin.query(`GRANT ${IAM_VIA} TO ${FOOD.app}`);

            try {
                const error = await runBootstrapPass(ports(), { ...input, armed: true }).catch(
                    (caught: unknown) => caught,
                );

                expect(isBootstrapRefusedError(error)).toBe(true);
                expect(String(error)).toContain(IAM_VIA);
                expect(await masterPathsTo(FOOD.app)).toEqual([]);
                expect(await masterPathsTo('rds_iam')).toEqual([]);
                expect(await hasMarker('ksb_food')).toBe(true);
                expect(await masterCanLogIn()).toBe(true);
            } finally {
                await admin.query(`REVOKE ${IAM_VIA} FROM ${FOOD.app}`);
                await admin.query(`DROP ROLE ${IAM_VIA}`);
            }
        });

        it('⛔ a failure between joining the master to the app role and the DROP leaves the master able to log in', async () => {
            // The session, except that a DROP DATABASE throws — the moment after the master joined the app role.
            const failingDrop: CatalogReader = {
                query: async <Row>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }> => {
                    if (/^DROP DATABASE/u.test(sql)) {
                        throw new Error('injected: the DROP never ran');
                    }

                    const result = await session.query(sql, values);

                    return { rows: result.rows as Row[] };
                },
            };

            const error = await runBootstrapPass(ports({ session: failingDrop }), { ...input, armed: true }).catch(
                (caught: unknown) => caught,
            );

            expect(String(error)).toContain('injected');
            // The `finally` took the master back out of the app role…
            expect(await masterPathsTo(FOOD.app)).toEqual([]);
            expect(await masterPathsTo('rds_iam')).toEqual([]);
            expect(await masterCanLogIn()).toBe(true);
            // …and nothing was dropped.
            expect(await hasMarker('ksb_food')).toBe(true);
        });

        it('⛔ a failed master login right after the role model stops the pass BEFORE the drop, cutting rds_iam', async () => {
            // The probe that used to run only at the END of the pass now runs after each role-model step, so a
            // lock-out fails the deploy before anything is destroyed; and its rollback revokes rds_iam from the login
            // roles, which cuts EVERY path to it whatever kind of edge carried it.
            const failingProbe: BootstrapPorts['connectAsMaster'] = async (database) => {
                if (database === 'postgres') {
                    // ⚠️ `28P01`, as a real `pg` auth failure carries — the pass classifies by SQLSTATE
                    // now, so a code-less double would take the UNREACHABLE path and revoke nothing.
                    throw Object.assign(new Error('password authentication failed for user "ksb_master" (injected)'), {
                        code: '28P01',
                    });
                }

                return connectAsMaster(database);
            };

            const error = await runBootstrapPass(ports({ connectAsMaster: failingProbe }), {
                ...input,
                armed: true,
            }).catch((caught: unknown) => caught);

            expect(isMasterLoginProbeError(error)).toBe(true);
            expect(await hasMarker('ksb_food')).toBe(true);
            expect(await holdsIamRow(FOOD.app)).toBe(false);
            expect(await holdsIamRow(FOOD.migrator)).toBe(false);
            expect(await masterPathsTo('rds_iam')).toEqual([]);
        });

        it('ARMED → recreates the base database owned by the owner role, and re-owns the per-PR one for the reaper', async () => {
            const before = await databaseRow('ksb_food');
            const report = await runBootstrapPass(ports(), { ...input, armed: true });

            expect(report.disposition).toBe('recreate');
            expect(report.recreate?.reowned).toEqual(['ksb_food_pr_7']);

            const after = await databaseRow('ksb_food');

            expect(after?.owner).toBe(FOOD.owner);
            expect(after?.oid).not.toBe(before?.oid);
            expect(await hasMarker('ksb_food')).toBe(false);
            expect((await databaseRow('ksb_food_pr_7'))?.owner).toBe(FOOD.owner);
        });

        it('leaves the app role back in rds_iam, the master out of it, and the master able to log in', async () => {
            expect(pathsToRole(await edges(), FOOD.app, 'rds_iam')).toEqual([[FOOD.app, 'rds_iam']]);
            expect(await masterPathsTo(FOOD.app)).toEqual([]);
            expect(await masterPathsTo('rds_iam')).toEqual([]);
            expect(await masterCanLogIn()).toBe(true);
            expect(await can('public', 'CONNECT', 'ksb_food')).toBe(false);
        });

        it('a second ARMED run is a no-op — the recreate cannot repeat itself', async () => {
            const before = await databaseRow('ksb_food');
            const report = await runBootstrapPass(ports(), { ...input, armed: true });

            expect(report.disposition).toBe('ready');
            expect((await databaseRow('ksb_food'))?.oid).toBe(before?.oid);
        });
    });

    describe('a legacy identity database — master-owned, with data, on a PROD-shaped stage', () => {
        const input = pass({ service: 'identity', roles: IDENTITY, database: 'ksb_identity', isProd: true });

        beforeAll(async () => {
            await session.query('CREATE DATABASE ksb_identity');

            const owned = await connectAsMaster('ksb_identity');

            await owned.query('CREATE TABLE marker (id int)');
            await owned.end();
        });

        it('⛔ NOT armed → refuses', async () => {
            const error = await runBootstrapPass(ports(), input).catch((caught: unknown) => caught);

            expect(isBootstrapRefusedError(error)).toBe(true);
            expect(await hasMarker('ksb_identity')).toBe(true);
        });

        it('ARMED → drops and recreates it owned by the owner role', async () => {
            const report = await runBootstrapPass(ports(), { ...input, armed: true });

            expect(report.disposition).toBe('recreate');
            expect((await databaseRow('ksb_identity'))?.owner).toBe(IDENTITY.owner);
            expect(await hasMarker('ksb_identity')).toBe(false);
        });

        it('prod: the master may SET to the owner but does not INHERIT it — so it cannot even connect', async () => {
            const toOwner = (await edges()).filter((edge) => edge.member === MASTER && edge.role === IDENTITY.owner);

            expect(toOwner.some((edge) => edge.set)).toBe(true);
            expect(toOwner.some((edge) => edge.inherit)).toBe(false);
            expect(await masterCanLogIn('ksb_identity')).toBe(false);
            expect(await masterCanLogIn('postgres')).toBe(true);
        });

        it('prod: the migrator cannot create databases', async () => {
            const result = await admin.query<{ rolcreatedb: boolean }>(
                'SELECT rolcreatedb FROM pg_roles WHERE rolname = $1',
                [IDENTITY.migrator],
            );

            expect(result.rows[0]?.rolcreatedb).toBe(false);
        });
    });

    describe('⛔ the production lock-out reading (every-row), against vanilla PostgreSQL’s automatic ADMIN rows', () => {
        it('REFUSES before granting rds_iam when the master holds any row into a login role — an outage, not a lock-out', async () => {
            // Vanilla PostgreSQL gives the creator an ADMIN-only row on every role it creates. If RDS ever does the
            // same, this is what the deployed bootstrap sees — and it must stop before `rds_iam` reaches a role the
            // master is a member of in PostgreSQL's own sense.
            const error = await runBootstrapPass(ports(), {
                ...pass({ service: 'food', roles: STRICT, database: 'ksb_strict' }),
                lockOutEdges: 'every-row',
            }).catch((caught: unknown) => caught);

            expect(isRoleModelPostconditionError(error)).toBe(true);
            expect(String(error)).toMatch(/refusing to grant rds_iam/u);
            expect(await holdsIamRow(STRICT.migrator)).toBe(false);
            expect(await holdsIamRow(STRICT.app)).toBe(false);
            expect(await databaseRow('ksb_strict')).toBeUndefined();
            expect(await masterCanLogIn()).toBe(true);
        });
    });

    describe('an EMPTY master-owned database — what RDS creates for a new stage', () => {
        it('is ADOPTED even when armed: re-owned in place, never dropped', async () => {
            await session.query('CREATE DATABASE ksb_adopt');

            const before = await databaseRow('ksb_adopt');
            const report = await runBootstrapPass(ports(), {
                ...pass({ service: 'identity', roles: ADOPT, database: 'ksb_adopt' }),
                armed: true,
            });

            expect(report.disposition).toBe('adopt');
            expect(await databaseRow('ksb_adopt')).toEqual({ owner: ADOPT.owner, oid: before?.oid });
        });
    });
});
