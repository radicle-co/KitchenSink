/**
 * @module db-bootstrap/bootstrapPass — one database's role-split bootstrap, run as the RDS master on `postgres`.
 *
 * The order is the safety property (`docs/plans/2026-09-11-database-role-split.md`, "Bootstrap pass"):
 *
 * 1. **Census** — logged, before anything changes, so a failed deploy's logs say what the catalog looked like.
 * 2. **Converge** — take the master out of the login roles (an interrupted recreate can leave it in the app role),
 *    proven by a re-read.
 * 3. **Role model** — `applyRoleModel`, which grants `rds_iam` only after re-reading that the master cannot reach it.
 * 4. **Disposition** — read the database's owner from `pg_database`; measure emptiness only while the master owns it;
 *    `decideDisposition` answers create / ready / adopt / recreate / refuse. A refusal throws here, before any
 *    destructive statement.
 * 5. **Act** — create owned by the owner; adopt; or the one-shot legacy recreate followed by create.
 * 6. **Role model again** — re-grants `rds_iam` to the app role the recreate took it from.
 * 7. **Database ACL** — as the owner (`SET ROLE`), from the maintenance database: PUBLIC closed, CONNECT for the
 *    migrator and the service role. Database-level only — schema grants are the migrator's, inside the database.
 * 8. **Postconditions** — the owner, not draining, PUBLIC without CONNECT, the two logins with it; all read from
 *    `postgres`, never by connecting in (prod's master cannot).
 * 9. **Master login probe** — a FRESH password login while this session is still held. If it fails, this session
 *    takes back what the pass granted the master, probes again, and fails the deploy either way.
 *
 * DESIGN PATTERN: Template Method over injected ports (`session`, `connectAsMaster`, `log`) — the step order is fixed
 * here; the Policy module (`disposition.ts`) makes every decision; the steps are thin appliers.
 */
import {
    applyRoleModel,
    databaseAclStatements,
    ROLE_CATALOG_LOCK_KEY,
    ROLE_CATALOG_LOCK_TIMEOUT_MS,
    readRoleCensus,
    type CatalogReader,
    type DatabaseRoles,
    type DatabaseService,
    type LockOutEdges,
} from '@kitchensink/db-schema-guard';

import { measureEmptiness } from './adoptEmpty.js';
import { decideDisposition, type DatabaseDisposition, type DatabaseRow } from './disposition.js';
import { BootstrapRefusedError } from './bootstrapRefusedError.js';
import { MasterLoginProbeError } from './masterLoginProbeError.js';
import { MasterUnreachableError, isCredentialRefusal } from './masterUnreachableError.js';
import { recreateLegacyDatabase, type RecreateReport } from './legacyRecreate.js';
import { releaseMasterFrom, revokeMembership } from './masterMembership.js';
import { reportPerPrDatabases } from './perPrInventory.js';

export { BootstrapRefusedError, isBootstrapRefusedError } from './bootstrapRefusedError.js';
export { MasterLoginProbeError, isMasterLoginProbeError } from './masterLoginProbeError.js';
export { MasterUnreachableError, isMasterUnreachableError } from './masterUnreachableError.js';

/** A connection the pass opens and closes itself. */
export interface MasterConnection extends CatalogReader {
    end(): Promise<void>;
}

/** What the pass talks to. */
export interface BootstrapPorts {
    /** The held master session, on the maintenance database. */
    readonly session: CatalogReader;
    /** Open a FRESH master connection to `database` — the login probe, and the emptiness check. */
    readonly connectAsMaster: (database: string) => Promise<MasterConnection>;
    /** One structured log line. */
    readonly log: (entry: Record<string, unknown>) => void;
}

/** One database's bootstrap. */
export interface BootstrapPassInput {
    readonly service: DatabaseService;
    readonly roles: DatabaseRoles;
    readonly database: string;
    readonly master: string;
    readonly isProd: boolean;
    /** Whether the one-shot legacy recreate is armed for this stage (`legacyRecreateArmed`). */
    readonly armed: boolean;
    /**
     * Which `pg_auth_members` rows count as membership for every lock-out question. Production never sets it, so it
     * is `every-row`; only a vanilla-PostgreSQL stand-in master passes `inherit-or-set` (see `edgeConfersMembership`).
     */
    readonly lockOutEdges?: LockOutEdges;
}

/** What the pass did. */
export interface BootstrapPassReport {
    readonly service: DatabaseService;
    readonly database: string;
    readonly disposition: DatabaseDisposition['kind'];
    readonly recreate?: RecreateReport;
}

/** Bases that have per-PR children (ADR-0006), whose census rides along. */
const HAS_PER_PR_CHILDREN: ReadonlySet<DatabaseService> = new Set(['food', 'recipe']);

const quote = (identifier: string): string => `"${identifier}"`;

/** The database's catalog row, or `undefined`. */
async function readDatabaseRow(session: CatalogReader, database: string): Promise<DatabaseRow | undefined> {
    const [row] = (
        await session.query<{ owner: string; datconnlimit: number }>(
            'SELECT pg_get_userbyid(datdba) AS owner, datconnlimit FROM pg_database WHERE datname = $1',
            [database],
        )
    ).rows;

    return row === undefined ? undefined : { owner: row.owner, draining: row.datconnlimit === -2 };
}

/** Whether the master-owned `database` holds nothing; measured by connecting in, while that is still possible. */
async function isEmpty(ports: BootstrapPorts, database: string): Promise<boolean> {
    const connection = await ports.connectAsMaster(database);

    try {
        const emptiness = await measureEmptiness(connection);

        ports.log({ message: 'master-owned database emptiness', database, ...emptiness });

        return emptiness.empty;
    } finally {
        await connection.end();
    }
}

/** Issue the database ACL as the owner, from the maintenance database. */
async function applyDatabaseAcl(session: CatalogReader, input: BootstrapPassInput): Promise<void> {
    await session.query(`SET ROLE ${quote(input.roles.owner)}`);

    try {
        for (const sql of databaseAclStatements(input.roles, input.database)) {
            await session.query(sql);
        }
    } finally {
        await session.query('RESET ROLE');
    }
}

/** The database-level postconditions, read from `pg_database` / the ACL functions — never by connecting in. */
async function assertDatabasePostconditions(session: CatalogReader, input: BootstrapPassInput): Promise<void> {
    const { roles, database } = input;
    const [row] = (
        await session.query<{
            owner: string;
            datconnlimit: number;
            public_connect: boolean;
            migrator: boolean;
            app: boolean;
            migrator_ddl: boolean;
            app_ddl: boolean;
        }>(
            `SELECT pg_get_userbyid(datdba) AS owner, datconnlimit,
                    has_database_privilege('public', datname, 'CONNECT') AS public_connect,
                    has_database_privilege($2, datname, 'CONNECT') AS migrator,
                    has_database_privilege($3, datname, 'CONNECT') AS app,
                    -- EXPLICIT grants, read from the ACL itself: has_database_privilege would also count the rights
                    -- the migrator INHERITS from the owner, which it is meant to have.
                    EXISTS (SELECT 1 FROM aclexplode(datacl) a
                             WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $2)
                               AND a.privilege_type IN ('CREATE', 'TEMPORARY')) AS migrator_ddl,
                    EXISTS (SELECT 1 FROM aclexplode(datacl) a
                             WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = $3)
                               AND a.privilege_type IN ('CREATE', 'TEMPORARY'))
                        OR has_database_privilege($3, datname, 'CREATE')
                        OR has_database_privilege($3, datname, 'TEMPORARY') AS app_ddl
               FROM pg_database WHERE datname = $1`,
            [database, roles.migrator, roles.app],
        )
    ).rows;

    const unmet = [
        row === undefined && `${database} does not exist`,
        row !== undefined && row.owner !== roles.owner && `${database} is owned by ${row.owner}, not ${roles.owner}`,
        row?.datconnlimit === -2 && `${database} is mid-DROP`,
        row?.public_connect === true && `PUBLIC can still CONNECT to ${database}`,
        row?.migrator === false && `${roles.migrator} cannot CONNECT to ${database}`,
        row?.app === false && `${roles.app} cannot CONNECT to ${database}`,
        row?.migrator_ddl === true && `${roles.migrator} holds an explicit CREATE or TEMPORARY grant on ${database}`,
        row?.app_ddl === true && `${roles.app} holds CREATE or TEMPORARY on ${database}`,
    ].filter((item): item is string => typeof item === 'string');

    if (unmet.length > 0) {
        throw new BootstrapRefusedError(`postconditions not met: ${unmet.join('; ')}`);
    }
}

/**
 * How many EXTRA master-login probes a failure earns before the rollback is believed, and how long to wait
 * between them. Small on both counts: a deploy is blocked while this runs, and the case being ruled out is a
 * momentary transport failure rather than a sustained outage.
 */
const PROBE_RETRIES = 2;
const PROBE_RETRY_DELAY_MS = 250;

/** A fresh master login; the failure message, or `undefined` on success. Never throws. */
async function probeMasterLogin(ports: BootstrapPorts): Promise<ProbeFailure | undefined> {
    try {
        const connection = await ports.connectAsMaster('postgres');

        try {
            await connection.query('SELECT 1');
        } finally {
            await connection.end();
        }

        return undefined;
    } catch (error) {
        // ⛔ THE CODE IS CARRIED, not just the message. Deciding whether to revoke `rds_iam` from live roles
        // on a localised, version-dependent message string is how a network fault becomes an outage; `pg`
        // sets `code` on every server error and Node sets it on every connection failure.
        const code =
            typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined;

        return { message: error instanceof Error ? error.message : String(error), code };
    }
}

/** What a failed master-login probe reported — its text, and the SQLSTATE or errno that classifies it. */
interface ProbeFailure {
    readonly message: string;
    readonly code: string | undefined;
}

/**
 * Probe a fresh master login; on failure, take away everything that could carry the master to `rds_iam` and fail.
 *
 * The rollback revokes `rds_iam` from the two LOGIN roles — which cuts EVERY path from the master to `rds_iam` that
 * this model could have created, whatever kind of row carried it, and needs only ADMIN on `rds_iam` — and then takes
 * the master out of the owner and login roles. It runs on the session this pass already holds, which stays
 * authenticated whatever the precedence rule now says about a NEW login.
 *
 * @throws {MasterLoginProbeError} when the probe fails, after the rollback and a second probe.
 * @sideEffect Opens a fresh connection; on failure, revokes memberships.
 */
async function probeOrRollBack(ports: BootstrapPorts, input: BootstrapPassInput, step: string): Promise<void> {
    let failure = await probeMasterLogin(ports);

    // ⛔ ASK AGAIN BEFORE CONCLUDING A LOCK-OUT. The rollback below revokes `rds_iam` from `<svc>_migrator`
    // and `<svc>_app` — LIVE roles that every running service authenticates with — so reading a dropped
    // packet, a restarting proxy or a moment at the connection limit as a lock-out manufactures an outage
    // across the whole instance, in response to the thing least likely to mean what it looked like. Measured:
    // a single injected `ECONNREFUSED` produced a full revoke and then reported `recoveredAfterRollback:
    // true` — the master had been fine all along, and the net "recovered" only from the damage it did.
    //
    // A lock-out is PERSISTENT (AWS has switched the master to IAM auth; every subsequent password login is
    // refused), so re-probing separates the two without weakening the guarantee: a real one still fails every
    // attempt and still rolls back. The retries cost nothing on the happy path — this runs only after a
    // failure — and the delay is short because a deploy is waiting on it.
    //
    for (let attempt = 0; failure !== undefined && attempt < PROBE_RETRIES; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_DELAY_MS));

        failure = await probeMasterLogin(ports);
    }

    if (failure === undefined) {
        return;
    }

    // ⛔ ONLY A CREDENTIAL REFUSAL IS A LOCK-OUT. A sustained outage used to end in the rollback too, which
    // revokes `rds_iam` from `<svc>_migrator` and `<svc>_app` — live roles every running service
    // authenticates with — and so manufactured an instance-wide outage out of a network fault. The two are
    // now separated by SQLSTATE: `28P01`/`28000` mean the server refused THESE CREDENTIALS, which is what
    // AWS produces once the master has been switched to IAM auth; anything else, including an unrecognised
    // code, is not evidence of a lock-out.
    //
    // ⚠️ Erring toward NOT revoking is the deliberate direction. A missed lock-out leaves the instance in
    // the state it was already in and surfaces here as a stated failure a human handles; a wrongly
    // diagnosed one takes every service off IAM auth. Only one of those is an incident.
    const { session, log } = ports;
    const { roles, master } = input;

    if (!isCredentialRefusal(failure.code)) {
        log({
            event: 'master-login-probe-unreachable',
            step,
            code: failure.code ?? null,
            failure: failure.message,
            rolledBack: false,
        });

        throw new MasterUnreachableError(failure.message, failure.code);
    }

    for (const login of [roles.migrator, roles.app]) {
        const refusals = await revokeMembership(session, 'rds_iam', login).catch((error: unknown) => [String(error)]);

        if (refusals.length > 0) {
            log({ message: 'rollback could not revoke rds_iam', login, refusals });
        }
    }

    await releaseMasterFrom(session, master, [roles.owner, roles.migrator, roles.app], input.lockOutEdges).catch(
        (error: unknown) => log({ message: 'rollback could not release the master', error: String(error) }),
    );

    // ⛔ SAY WHAT THIS COST. Taking the master out of `<svc>_owner` is the right move here — it is one of the
    // edges that could carry the master to `rds_iam` — but it is ALSO the exact membership per-PR reclamation
    // runs on: the reaper can drop a per-PR database only because the master INHERITs each owner outside prod
    // (`dropDatabaseAuthority`). So from this moment until the next SUCCESSFUL DataStack deploy re-grants it,
    // the reaper silently reclaims nothing and every abandoned preview keeps billing.
    //
    // ⚠️ The rollback is NOT the thing to change — its premise is that the catalog read missed an edge, so it
    // deliberately removes more than it can prove is needed. What was wrong was that the consequence appeared
    // nowhere: this path's own error is about a failed master LOGIN, so nothing in it mentions reclamation,
    // and a cost leak nobody is told about is the same failure ADR-0005 records for a tag sweep that matches
    // nothing and reports success.
    log({
        message:
            'per-PR database reclamation is DISABLED until the next successful DataStack deploy: the rollback ' +
            'released the master from the owner role the reaper inherits to drop per-PR databases',
        database: input.database,
        service: input.service,
        ownerRole: roles.owner,
    });

    throw new MasterLoginProbeError(`${step}: ${failure}`, (await probeMasterLogin(ports)) === undefined);
}

/**
 * Run one database's bootstrap, holding {@link ROLE_CATALOG_LOCK_KEY} for its whole length.
 *
 * @param ports - The held master session, a factory for fresh master connections, and a logger.
 * @param input - The database, its roles, the stage kind, and whether the recreate is armed.
 * @returns What the pass did.
 * @throws {BootstrapRefusedError} when the database or catalog is in a state it will not change.
 * @throws {MasterLoginProbeError} when a fresh master login fails after a step that grants memberships.
 * @sideEffect Creates/alters roles and memberships; creates, re-owns or (armed) drops databases.
 */
export async function runBootstrapPass(ports: BootstrapPorts, input: BootstrapPassInput): Promise<BootstrapPassReport> {
    // ⛔ BOUNDED. `pg_advisory_lock` waits forever by default, and this lock is held for a whole pass — so a
    // run killed mid-flight leaves its backend holding it until TCP keepalive notices, and the next deploy
    // and the reaper both queue behind it with nothing to read, at a moment when the service role may have no
    // `rds_iam` and the master may still be joined to it. `ROLE_CATALOG_LOCK_TIMEOUT_MS` sits under this
    // Lambda's own 600s timeout on purpose, so contention ends as a STATED failure inside the function's
    // budget rather than as an unexplained timeout. `applyMigrations` bounds its lock the same way.
    //
    // ⚠️ RESET afterwards: `lock_timeout` is a SESSION setting and this session is the caller's, reused
    // across every database in the pass, so leaving it set would silently shorten later statements' waits.
    await ports.session.query(`SET lock_timeout = ${ROLE_CATALOG_LOCK_TIMEOUT_MS}`);

    try {
        await ports.session.query('SELECT pg_advisory_lock($1)', [ROLE_CATALOG_LOCK_KEY]);
    } finally {
        await ports.session.query('RESET lock_timeout').catch(() => undefined);
    }

    try {
        return await runLockedPass(ports, input);
    } finally {
        await ports.session.query('SELECT pg_advisory_unlock($1)', [ROLE_CATALOG_LOCK_KEY]).catch(() => undefined);
    }
}

/** The pass itself, under the lock. */
async function runLockedPass(ports: BootstrapPorts, input: BootstrapPassInput): Promise<BootstrapPassReport> {
    const { session, log } = ports;
    const { roles, database, master } = input;
    const lockOutEdges = input.lockOutEdges ?? 'every-row';
    const context = { master, isProd: input.isProd, lockOutEdges };

    log({
        message: 'role census before the bootstrap',
        service: input.service,
        lockOutEdges,
        census: await readRoleCensus(session, { adminProbe: [roles.owner, roles.migrator, roles.app, 'rds_iam'] }),
    });

    if (HAS_PER_PR_CHILDREN.has(input.service)) {
        await reportPerPrDatabases(session, database);
    }

    const released = await releaseMasterFrom(session, master, [roles.migrator, roles.app], lockOutEdges);

    if (released.length > 0) {
        log({ message: 'converged: took the master back out of login roles', released });
    }

    await applyRoleModel(session, { roles, context });
    // ⛔ BEFORE anything destructive: if the role model just put the master on a path to rds_iam that the catalog
    // reading missed, the deploy fails here, with every database intact.
    await probeOrRollBack(ports, input, 'after the role model');

    const row = await readDatabaseRow(session, database);
    const empty =
        row !== undefined && row.owner === master && !row.draining ? await isEmpty(ports, database) : undefined;
    const disposition = decideDisposition({ ...input, row, empty });

    log({ message: 'database disposition', service: input.service, database, armed: input.armed, disposition });

    let recreate: RecreateReport | undefined;

    switch (disposition.kind) {
        case 'refuse':
            throw new BootstrapRefusedError(disposition.reason);
        case 'ready':
            break;
        case 'adopt':
            await session.query(`ALTER DATABASE ${quote(database)} OWNER TO ${quote(roles.owner)}`);
            break;
        case 'recreate':
            recreate = await recreateLegacyDatabase(session, {
                ...input,
                lockOutEdges,
                legacyOwner: disposition.legacyOwner,
            });
            log({ message: 'legacy recreate', ...recreate });
            await session.query(`CREATE DATABASE ${quote(database)} OWNER ${quote(roles.owner)}`);
            break;
        case 'create':
            await session.query(`CREATE DATABASE ${quote(database)} OWNER ${quote(roles.owner)}`);
            break;

        default: {
            const exhaustive: never = disposition;

            throw new Error(`unhandled disposition ${JSON.stringify(exhaustive)}`);
        }
    }

    await applyRoleModel(session, { roles, context });
    await probeOrRollBack(ports, input, 'after re-granting the login roles');
    await applyDatabaseAcl(session, input);
    await assertDatabasePostconditions(session, input);

    return recreate === undefined
        ? { service: input.service, database, disposition: disposition.kind }
        : { service: input.service, database, disposition: disposition.kind, recreate };
}
