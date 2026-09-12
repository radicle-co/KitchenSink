/**
 * Applies the committed catalog seed atomically and proves the result before recording it (curated catalog plan U6,
 * KTD-1, KTD-2, KTD-4; R32, R33, R36, R37, R40).
 *
 * @pattern Transaction Script — one procedure owns the lock, the transactions and the ledger; the planner decides what
 *   changes, the Unit of Work writes it, and the verifier, a parameter, proves it
 * @pattern Port — {@link CatalogSeedVerifier} is the consumer-owned contract the independent verifier implements
 *
 * The order is KTD-2's:
 *
 * 1. Take the seed's SESSION advisory lock, bounded, before any transaction begins. A lock taken inside one would come
 *    too late: the second of two concurrent applies would plan against rows the first had not committed.
 * 2. Let the verifier prepare, outside any transaction: it creates temp tables, which a READ ONLY transaction refuses.
 * 3. In REPEATABLE READ, READ ONLY: read the ledger's newest digest. When it is this seed's, read the snapshot and plan;
 *    when the plan is empty, run the verifier and stop. Nothing is written and nothing is recorded (R36, AE5).
 * 4. Otherwise, in READ COMMITTED: read the snapshot again, plan, write, verify, insert the ledger row LAST, commit. A
 *    current ledger over rows that differ is drift, and is repaired the same way; a new digest whose plan is empty (a
 *    change to the seeder alone) still verifies before it is recorded (R40).
 *
 * Readers see the previous seed until the commit, and any throw rolls everything back (R32, R37). Every transaction
 * sets its own statement, lock and idle timeouts and a search path that puts `pg_temp` last, all with `SET LOCAL` so
 * none outlives it.
 *
 * ⛔ The Lambda handler is U3's, not this module's: {@link runCatalogSeed} is a library call on a connection the caller
 * opened for this invocation alone (KTD-2) and closes after it.
 */
import { performance } from 'node:perf_hooks';

import type pg from 'pg';

import { ADVISORY_LOCK_CLASSES, isManifestSha, withSessionAdvisoryLock } from '@kitchensink/db-schema-guard';

import { buildCatalogPlan, isEmptyPlan, type CatalogPlan } from './catalogPlanBuilder.js';
import { applyCatalogPlan, type CatalogApplyCounts } from './catalogPlanApplier.js';
import { CatalogSnapshotDao } from './catalogSnapshot.dao.js';
import type { CatalogContent, CatalogSnapshot, CatalogSnapshotSource } from './catalogSnapshot.js';
import { pgSeedSession, type CatalogSeedSession } from './catalogSeedSession.js';
import type { CatalogChanges } from './curatedSeedFormat.js';
import { composeSeedImage } from './seedImage.js';
import { projectSeed } from './seedProjection.js';
import { loadSeedSources } from './seedSources.js';

/**
 * How long an apply waits for another apply's lock. Under the seed function's 900 s (KTD-1), with room for this apply's
 * own work after the wait; the same bound `applyMigrations` gives its migration lock.
 */
export const SEED_LOCK_WAIT_MS = 240_000;

/**
 * How long one statement may run. The largest is the `INSERT … SELECT` of every nutrition value of the committed seed;
 * the WHOLE write of that seed into an empty database took about 10 s locally (2026-10-01). The bound stops a runaway
 * statement well inside the function's 900 s.
 */
export const SEED_STATEMENT_TIMEOUT_MS = 300_000;

/** How long a statement waits for a row lock a live write holds (a cook's add-by-name, say) before the apply fails. */
export const SEED_LOCK_TIMEOUT_MS = 30_000;

/**
 * How long the transaction may sit idle between statements. The longest gaps are this process's own work inside the
 * transaction: assembling the snapshot it read, planning and resolving the rows. Over the committed seed, reading a full
 * catalog back and planning against it took about 1.5 s locally (2026-10-01). The bound ends a transaction whose
 * process has stalled, without cutting off that work on a slower host.
 */
export const SEED_IDLE_IN_TRANSACTION_TIMEOUT_MS = 120_000;

/** The statements every seed transaction opens with, after its BEGIN. */
const TRANSACTION_SETTINGS = [
    `SET LOCAL statement_timeout = ${String(SEED_STATEMENT_TIMEOUT_MS)}`,
    `SET LOCAL lock_timeout = ${String(SEED_LOCK_TIMEOUT_MS)}`,
    `SET LOCAL idle_in_transaction_session_timeout = ${String(SEED_IDLE_IN_TRANSACTION_TIMEOUT_MS)}`,
    // `pg_temp` LAST, so an unqualified name (the snapshot DAO's are) can never resolve to a temp table the verifier
    // created in this session; 0018's functions pin the same path for the same reason.
    'SET LOCAL search_path = pg_catalog, public, pg_temp',
] as const;

/** A connected client, never a pool: the snapshot DAO's type, and the one the verifier receives. */
export type SeedClient = pg.Client | pg.PoolClient;

/**
 * The independent verifier (KTD-3), as this transaction calls it. Another module implements it, and it may import
 * nothing from the seeder.
 *
 * - `prepare` runs once per apply, under the seed lock and OUTSIDE any transaction, with the session's own settings: it
 *   creates its temp tables and COPYs the committed bytes into them. A READ ONLY transaction refuses `CREATE`.
 * - `check` runs at most once per apply, inside the apply's transaction, after the writes and before the ledger row,
 *   with `search_path = pg_catalog, public, pg_temp`: it names its own temp tables `pg_temp.<name>`. It creates nothing,
 *   may write only to its own temp tables, and THROWS on any difference, which rolls the apply back. In the read-only
 *   path it runs with nothing written, and the same rule holds.
 */
export interface CatalogSeedVerifier {
    /**
     * Load what the check reads.
     *
     * @param client - The apply's connection, outside any transaction.
     * @sideEffect Creates temp tables and writes to them.
     */
    prepare(client: SeedClient): Promise<void>;
    /**
     * Prove the catalog equals the committed seed.
     *
     * @param client - The apply's connection, inside its transaction.
     * @throws Any error, naming what differs.
     * @sideEffect Reads the catalog; may write its own temp tables.
     */
    check(client: SeedClient): Promise<void>;
}

/** The verifier bound to the apply's connection. */
export interface BoundCatalogSeedVerifier {
    /** @sideEffect See {@link CatalogSeedVerifier.prepare}. */
    prepare(): Promise<void>;
    /** @sideEffect See {@link CatalogSeedVerifier.check}. */
    check(): Promise<void>;
}

/** Where the apply's one summary line goes. The U3 handler adapts it to the service's logger. */
export type CatalogSeedLog = (message: string, attributes: Readonly<Record<string, unknown>>) => void;

/** How long each part of an apply took, in milliseconds. KTD-1 picks the seed's shape from `transactionMs`. */
export interface CatalogSeedTimings {
    /** Reading, checking and composing the committed files (the facade's; 0 when the caller passed the target). */
    readonly loadMs: number;
    readonly lockWaitMs: number;
    /** Reading the snapshot and planning, in the transaction that wrote. */
    readonly planMs: number;
    readonly writeMs: number;
    readonly verifyMs: number;
    /** From the first transaction's BEGIN to the last one's COMMIT. */
    readonly transactionMs: number;
    readonly totalMs: number;
}

/** What one apply did. */
export interface CatalogSeedResult {
    /** `unchanged` when the ledger held this digest and nothing differed (R36). */
    readonly outcome: 'applied' | 'unchanged';
    readonly seedSha: string;
    /** How many changes the plan named, for the log; the diff renders them (U5). */
    readonly changes: number;
    readonly counts: CatalogApplyCounts;
    readonly timings: CatalogSeedTimings;
}

/** Everything one apply needs, with the target already composed and every collaborator bound to one connection. */
export interface ApplyCatalogSeedOptions {
    readonly session: CatalogSeedSession;
    /** Reads the catalog on `session`'s connection, inside the transaction this module opens. */
    readonly snapshot: CatalogSnapshotSource;
    readonly verify: BoundCatalogSeedVerifier;
    /** The committed seed's content (U5's projection). */
    readonly target: CatalogContent;
    readonly changes: CatalogChanges;
    /** The digest the ledger records once the verifier passes (KTD-4): 64 lowercase hex digits. */
    readonly seedSha: string;
    readonly log: CatalogSeedLog;
    /** The one source of new ids; `newFoodId` unless a test names its ids. */
    readonly mintId?: () => string;
    /** The time the caller spent composing `target`, logged with the rest. */
    readonly loadMs?: number;
}

/** Everything the deployed seed passes. */
export interface RunCatalogSeedOptions {
    /** A connection opened for this invocation alone, outside any transaction. Never a pool. */
    readonly client: SeedClient;
    /** The committed seed's data directory (`FS/src/foods/seed/data/`, copied into the seed asset). */
    readonly dataDir: string;
    readonly seedSha: string;
    readonly verify: CatalogSeedVerifier;
    readonly log: CatalogSeedLog;
}

/** One transaction's mode. */
type TransactionMode = 'readOnly' | 'readWrite';

/**
 * Milliseconds since a mark, rounded. Impure: reads the clock.
 *
 * @param since - A `performance.now()` mark.
 * @returns The elapsed whole milliseconds.
 */
function elapsedMs(since: number): number {
    return Math.round(performance.now() - since);
}

/**
 * Run `work` in one transaction with the seed's settings: COMMIT when it settles, ROLLBACK and rethrow when it throws.
 *
 * A COMMIT that the deferred triggers refuse rejects, and PostgreSQL has already rolled the transaction back. A ROLLBACK
 * that fails is swallowed: it fails only on a connection already lost, and the failure that caused it is the one
 * reported.
 *
 * @param session - The connection.
 * @param mode - REPEATABLE READ, READ ONLY; or READ COMMITTED.
 * @param work - The statements.
 * @param settings - The `SET LOCAL` statements run first; the seed's own by default.
 * @returns What `work` returned.
 * @sideEffect Executes BEGIN, the settings, `work` and COMMIT or ROLLBACK.
 */
async function inTransaction<T>(
    session: CatalogSeedSession,
    mode: TransactionMode,
    work: () => Promise<T>,
    settings: readonly string[] = TRANSACTION_SETTINGS,
): Promise<T> {
    await session.query(
        mode === 'readOnly'
            ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
            : 'BEGIN ISOLATION LEVEL READ COMMITTED',
    );

    try {
        for (const statement of settings) {
            await session.query(statement);
        }

        const result = await work();

        await session.query('COMMIT');

        return result;
    } catch (error) {
        await session.query('ROLLBACK').catch(() => undefined);

        throw error;
    }
}

/**
 * Run `work` in a REPEATABLE READ, READ ONLY transaction whose statements time out after `statementTimeoutMs`: any
 * write inside it fails with SQLSTATE 25006. The seed function's `describe` reads the ledger this way, so it can never
 * write and never wait long.
 *
 * @param session - The connection, outside any transaction.
 * @param statementTimeoutMs - The bound on each statement.
 * @param work - The reads.
 * @returns What `work` returned, after COMMIT.
 * @sideEffect Executes BEGIN, the setting, `work`, and COMMIT or ROLLBACK.
 */
export async function inReadOnlySnapshot<T>(
    session: CatalogSeedSession,
    statementTimeoutMs: number,
    work: () => Promise<T>,
): Promise<T> {
    return inTransaction(session, 'readOnly', work, [`SET LOCAL statement_timeout = ${String(statementTimeoutMs)}`]);
}

/**
 * The digest of the newest ledger row. The seed function's `describe` reads it too (`lambdas/seed/seedBundle.ts`), so
 * "the newest row" has one definition.
 *
 * @param session - The connection, inside a transaction.
 * @returns The digest, or `null` for an empty ledger.
 * @throws {Error} when the stored digest is not text, which the ledger's own CHECK rules out.
 * @sideEffect Reads `catalog_seed_ledger`.
 */
export async function ledgerHead(session: CatalogSeedSession): Promise<string | null> {
    const { rows } = await session.query(
        '/* catalogSeed:ledgerHead */ SELECT seed_sha FROM public.catalog_seed_ledger ORDER BY id DESC LIMIT 1',
    );
    const head = rows[0]?.['seed_sha'];

    if (head === undefined) {
        return null;
    }

    if (typeof head !== 'string') {
        throw new Error(`catalog_seed_ledger.seed_sha is not text: ${JSON.stringify(head)}`);
    }

    return head;
}

/**
 * Refuse a digest the ledger's CHECK would refuse, before any work.
 *
 * @param seedSha - The digest.
 * @throws {RangeError} when it is not 64 lowercase hex digits.
 */
function assertSeedSha(seedSha: string): void {
    if (!isManifestSha(seedSha)) {
        throw new RangeError(`the seed digest must be 64 lowercase hex digits, not ${JSON.stringify(seedSha)}`);
    }
}

/**
 * Plan against a snapshot read now, on the session's transaction.
 *
 * @param options - The apply's options.
 * @returns The snapshot and the plan.
 * @throws {CatalogSnapshotUnreadableError} when the catalog holds a shape the port cannot represent.
 * @throws {CatalogPlanRefusedError} when the seed cannot be planned against it.
 * @sideEffect Reads the catalog.
 */
async function planNow(
    options: ApplyCatalogSeedOptions,
): Promise<{ readonly snapshot: CatalogSnapshot; readonly plan: CatalogPlan }> {
    const snapshot = await options.snapshot.read();

    return { snapshot, plan: buildCatalogPlan(options.target, snapshot, options.changes) };
}

/**
 * Apply a composed seed under the seed lock, per KTD-2, and log one summary line.
 *
 * @param options - The bound collaborators, the target and the digest.
 * @returns What the apply did, and how long each part took.
 * @throws {RangeError} when the digest is malformed, before the lock.
 * @throws {SessionLockTimeoutError} when another apply holds the lock past {@link SEED_LOCK_WAIT_MS}.
 * @throws {CatalogPlanRefusedError} when the seed cannot be planned against the catalog.
 * @throws {CatalogApplyError} when a statement wrote a different count than staged.
 * @throws Whatever the verifier or the database throws; the transaction is rolled back and no digest is recorded.
 * @sideEffect Takes and releases a session advisory lock; writes the catalog and the ledger in one transaction.
 */
export async function applyCatalogSeed(options: ApplyCatalogSeedOptions): Promise<CatalogSeedResult> {
    assertSeedSha(options.seedSha);

    const { session, seedSha, verify } = options;
    const started = performance.now();

    return withSessionAdvisoryLock(
        session,
        { classId: ADVISORY_LOCK_CLASSES.foodCatalogSeed, objectId: 0, waitTimeoutMs: SEED_LOCK_WAIT_MS },
        async () => {
            const lockWaitMs = elapsedMs(started);

            await verify.prepare();

            const transactions = performance.now();
            let planMs = 0;
            let writeMs = 0;
            let verifyMs = 0;
            const unchanged = await inTransaction(session, 'readOnly', async () => {
                if ((await ledgerHead(session)) !== seedSha) {
                    return false;
                }

                const planning = performance.now();
                const { plan } = await planNow(options);

                planMs = elapsedMs(planning);

                if (!isEmptyPlan(plan)) {
                    return false;
                }

                const verifying = performance.now();

                await verify.check();
                verifyMs = elapsedMs(verifying);

                return true;
            });
            let applied: { readonly plan: CatalogPlan; readonly counts: CatalogApplyCounts } | undefined;

            if (!unchanged) {
                applied = await inTransaction(session, 'readWrite', async () => {
                    const planning = performance.now();
                    const { snapshot, plan } = await planNow(options);

                    planMs = elapsedMs(planning);

                    const writing = performance.now();
                    const counts = await applyCatalogPlan(session, plan, snapshot.ids, options.mintId);

                    writeMs = elapsedMs(writing);

                    const verifying = performance.now();

                    await verify.check();
                    verifyMs = elapsedMs(verifying);
                    // LAST: the digest is recorded only once the verifier has passed (R40, KTD-4).
                    await session.query(
                        '/* catalogSeed:ledgerInsert */ INSERT INTO public.catalog_seed_ledger (seed_sha) VALUES ($1)',
                        [seedSha],
                    );

                    return { plan, counts };
                });
            }

            const result: CatalogSeedResult = {
                outcome: applied === undefined ? 'unchanged' : 'applied',
                seedSha,
                changes: applied?.plan.changes.length ?? 0,
                counts: applied?.counts ?? {},
                timings: {
                    loadMs: options.loadMs ?? 0,
                    lockWaitMs,
                    planMs,
                    writeMs,
                    verifyMs,
                    transactionMs: elapsedMs(transactions),
                    totalMs: (options.loadMs ?? 0) + elapsedMs(started),
                },
            };

            options.log(`catalog seed ${result.outcome}`, {
                outcome: result.outcome,
                seedSha,
                changes: result.changes,
                ...result.timings,
                rows: result.counts,
            });

            return result;
        },
    );
}

/**
 * Apply the committed catalog seed on one connection: load and compose the committed files, then {@link applyCatalogSeed}.
 *
 * @param options - The connection, the data directory, the digest, the verifier and the log.
 * @returns What the apply did.
 * @throws Whatever loading the committed files or {@link applyCatalogSeed} throws.
 * @sideEffect Reads the data directory; takes the seed lock; writes the catalog and the ledger on `client`.
 */
export async function runCatalogSeed(options: RunCatalogSeedOptions): Promise<CatalogSeedResult> {
    assertSeedSha(options.seedSha);

    const { client, verify } = options;
    const loading = performance.now();
    const inputs = await loadSeedSources(options.dataDir);
    const target = projectSeed(composeSeedImage(inputs)).content;

    return applyCatalogSeed({
        session: pgSeedSession(client),
        snapshot: new CatalogSnapshotDao(client),
        verify: { prepare: () => verify.prepare(client), check: () => verify.check(client) },
        target,
        changes: inputs.curated.changes,
        seedSha: options.seedSha,
        log: options.log,
        loadMs: elapsedMs(loading),
    });
}
