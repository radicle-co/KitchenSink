/**
 * `applyCatalogSeed` (curated catalog plan U6, KTD-2, R32, R36, R40): the Transaction Script around one apply, over a
 * recording session, a stand-in snapshot and a stand-in verifier.
 *
 * Each case pins one promise of KTD-2: the session lock comes before any transaction; a current ledger with nothing to
 * write runs the verifier alone, read-only; anything else plans, writes, verifies and records the digest LAST in one
 * READ COMMITTED transaction; every transaction sets its three timeouts and its search path; and a failure anywhere
 * rolls back without the digest, releases the lock, and reports the failure itself rather than a cleanup's.
 */
import { ADVISORY_LOCK_CLASSES, isSessionLockTimeoutError } from '@kitchensink/db-schema-guard';
import { describe, expect, it } from 'vitest';

import {
    makeContent,
    makeContentRoot,
    makeContentVariant,
    makeSnapshot,
} from '../__fixtures__/catalogContent.fixtures.js';
import { makeCatalogChanges } from '../__fixtures__/curatedSeed.fixtures.js';
import { makeRecordingSeedSession, type RecordingSeedSession } from '../__fixtures__/recordingSeedSession.js';
import { EMPTY_SNAPSHOT, type CatalogSnapshot } from '../catalogSnapshot.js';
import {
    SEED_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    SEED_LOCK_TIMEOUT_MS,
    SEED_LOCK_WAIT_MS,
    SEED_STATEMENT_TIMEOUT_MS,
    applyCatalogSeed,
    type ApplyCatalogSeedOptions,
} from '../catalogSeedTransaction.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

const NO_CHANGES = makeCatalogChanges({ merges: [], aliases: [], exclusions: [], splits: [] });
const TARGET = makeContent([makeContentRoot()], [makeContentVariant()]);

/** The four statements every transaction opens with, after its BEGIN. */
const SETTINGS = [
    `SET LOCAL statement_timeout = ${String(SEED_STATEMENT_TIMEOUT_MS)}`,
    `SET LOCAL lock_timeout = ${String(SEED_LOCK_TIMEOUT_MS)}`,
    `SET LOCAL idle_in_transaction_session_timeout = ${String(SEED_IDLE_IN_TRANSACTION_TIMEOUT_MS)}`,
    'SET LOCAL search_path = pg_catalog, public, pg_temp',
];

const READ_ONLY = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';
const READ_WRITE = 'BEGIN ISOLATION LEVEL READ COMMITTED';
const LOCK = 'SELECT pg_advisory_lock($1, $2)';
const UNLOCK = 'SELECT pg_advisory_unlock($1, $2)';

/** What the stand-ins saw, by the statement count at the moment they ran. */
interface Seen {
    readonly prepared: number[];
    readonly checked: number[];
    readonly read: number[];
    readonly logged: { readonly message: string; readonly attributes: Readonly<Record<string, unknown>> }[];
}

/**
 * The options of one run over a recording session.
 *
 * @param session - The session.
 * @param overrides - What a case changes.
 * @returns The options and what the stand-ins see.
 */
function optionsFor(
    session: RecordingSeedSession,
    overrides: Partial<Omit<ApplyCatalogSeedOptions, 'snapshot'>> & {
        readonly held?: CatalogSnapshot;
        readonly checkFails?: unknown;
    } = {},
): { readonly options: ApplyCatalogSeedOptions; readonly seen: Seen } {
    const seen: Seen = { prepared: [], checked: [], read: [], logged: [] };
    const { held = EMPTY_SNAPSHOT, checkFails, ...rest } = overrides;
    let minted = 0;

    return {
        seen,
        options: {
            session,
            snapshot: {
                read: async () => {
                    seen.read.push(session.ran.length);

                    return held;
                },
            },
            verify: {
                prepare: async () => {
                    seen.prepared.push(session.ran.length);
                },
                check: async () => {
                    seen.checked.push(session.ran.length);

                    if (checkFails !== undefined) {
                        throw checkFails;
                    }
                },
            },
            target: TARGET,
            changes: NO_CHANGES,
            seedSha: SHA_B,
            log: (message, attributes) => {
                seen.logged.push({ message, attributes });
            },
            mintId: () => {
                minted += 1;

                return `new-${String(minted)}`;
            },
            ...rest,
        },
    };
}

/** The applied snapshot: the target already written, every id `id:<key>`. */
const APPLIED = makeSnapshot(TARGET);

describe('applyCatalogSeed — the ledger is current and nothing differs (R36, AE5)', () => {
    it('runs the verifier alone in a read-only transaction, writes nothing and records nothing', async () => {
        const session = makeRecordingSeedSession({ ledgerHead: SHA_B });
        const { options, seen } = optionsFor(session, { held: APPLIED });

        const result = await applyCatalogSeed(options);

        expect(result.outcome).toBe('unchanged');
        expect(session.steps).toEqual([
            `SET lock_timeout = ${String(SEED_LOCK_WAIT_MS)}`,
            LOCK,
            'RESET lock_timeout',
            READ_ONLY,
            ...SETTINGS,
            'ledgerHead',
            'COMMIT',
            UNLOCK,
        ]);
        expect(seen.checked).toEqual([session.steps.indexOf('COMMIT')]);
        expect(seen.prepared).toEqual([session.steps.indexOf(READ_ONLY)]);
    });

    it('takes the catalog seed’s registered lock class', async () => {
        const session = makeRecordingSeedSession({ ledgerHead: SHA_B });

        await applyCatalogSeed(optionsFor(session, { held: APPLIED }).options);

        expect(session.ran.find((statement) => statement.step === LOCK)?.values).toEqual([
            ADVISORY_LOCK_CLASSES.foodCatalogSeed,
            0,
        ]);
    });
});

describe('applyCatalogSeed — a seed to write', () => {
    it('plans, writes, verifies and records the digest last, in one READ COMMITTED transaction', async () => {
        const session = makeRecordingSeedSession({ ledgerHead: SHA_A });
        const { options, seen } = optionsFor(session);

        const result = await applyCatalogSeed(options);
        const steps = session.steps;
        const begin = steps.indexOf(READ_WRITE);
        const ledger = steps.indexOf('ledgerInsert');

        expect(result.outcome).toBe('applied');
        expect(steps.slice(begin, begin + 5)).toEqual([READ_WRITE, ...SETTINGS]);
        expect(steps.slice(ledger)).toEqual(['ledgerInsert', 'COMMIT', UNLOCK]);
        expect(steps.filter((step) => step === 'COMMIT')).toHaveLength(2);
        expect(steps.slice(begin + 5, ledger)).toContain('rootInsert');
        expect(seen.read).toEqual([begin + 5]);
        expect(seen.checked).toEqual([ledger]);
        expect(steps.lastIndexOf('partInsert')).toBeLessThan(ledger);
        expect(session.ran[ledger]?.values).toEqual([SHA_B]);
    });

    it('records a new digest whose plan is empty, after the verifier passes: a change to the seeder alone', async () => {
        const session = makeRecordingSeedSession({ ledgerHead: SHA_A });
        const { options, seen } = optionsFor(session, { held: APPLIED });

        const result = await applyCatalogSeed(options);

        expect(result.outcome).toBe('applied');
        expect(session.steps.slice(session.steps.indexOf(READ_WRITE))).toEqual([
            READ_WRITE,
            ...SETTINGS,
            'ledgerInsert',
            'COMMIT',
            UNLOCK,
        ]);
        expect(seen.checked).toEqual([session.steps.indexOf('ledgerInsert')]);
    });

    it('repairs drift: a current ledger over rows that differ still writes, verifies and records', async () => {
        const session = makeRecordingSeedSession({ ledgerHead: SHA_B });
        const { options } = optionsFor(session);

        const result = await applyCatalogSeed(options);

        expect(result.outcome).toBe('applied');
        expect(session.steps).toContain('rootInsert');
        expect(session.steps.indexOf('ledgerInsert')).toBeGreaterThan(session.steps.indexOf('rootInsert'));
    });

    it('logs one line with the outcome, the digest and the time each phase took', async () => {
        const session = makeRecordingSeedSession();
        const { options, seen } = optionsFor(session);

        await applyCatalogSeed(options);

        expect(seen.logged).toHaveLength(1);
        expect(seen.logged[0]?.attributes).toMatchObject({ outcome: 'applied', seedSha: SHA_B });

        for (const key of ['lockWaitMs', 'planMs', 'writeMs', 'verifyMs', 'transactionMs', 'totalMs']) {
            expect(seen.logged[0]?.attributes[key]).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('applyCatalogSeed — a failure', () => {
    it('rolls back without the digest when the verifier fails, releases the lock, and reports the verifier’s error', async () => {
        const session = makeRecordingSeedSession({ ledgerHead: SHA_A });
        const failure = new Error('expected_food differs from food');
        const { options } = optionsFor(session, { checkFails: failure });

        await expect(applyCatalogSeed(options)).rejects.toBe(failure);
        expect(session.steps).not.toContain('ledgerInsert');
        expect(session.steps.slice(-2)).toEqual(['ROLLBACK', UNLOCK]);
    });

    it('rejects when COMMIT is refused, where the deferred triggers run, and still releases the lock', async () => {
        const refused = new Error('a forward names deleted food x and nothing forwards it');
        const session = makeRecordingSeedSession({
            ledgerHead: SHA_A,
            failures: [
                { when: (statement) => statement.step === 'COMMIT' && statement.sql === 'COMMIT', error: refused },
            ],
        });
        const { options } = optionsFor(session);

        // The read-only transaction's COMMIT is the first to fail here, which is the same promise.
        await expect(applyCatalogSeed(options)).rejects.toBe(refused);
        expect(session.steps.at(-1)).toBe(UNLOCK);
    });

    it('never lets a failed ROLLBACK replace the failure that caused it', async () => {
        const failure = new Error('valueInsert touched 0 rows');
        const session = makeRecordingSeedSession({
            ledgerHead: SHA_A,
            failures: [
                { when: (statement) => statement.step === 'valueInsert', error: failure },
                { when: (statement) => statement.step === 'ROLLBACK', error: new Error('connection reset') },
            ],
        });

        await expect(applyCatalogSeed(optionsFor(session).options)).rejects.toBe(failure);
    });

    it('opens no transaction and prepares nothing when the lock is not granted in time', async () => {
        const session = makeRecordingSeedSession({
            failures: [
                {
                    when: (statement) => statement.step === LOCK,
                    error: Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
                },
            ],
        });
        const { options, seen } = optionsFor(session);

        await expect(applyCatalogSeed(options)).rejects.toSatisfy(isSessionLockTimeoutError);
        expect(session.steps.filter((step) => step.startsWith('BEGIN'))).toEqual([]);
        expect(seen.prepared).toEqual([]);
    });

    it('refuses a digest that is not 64 lowercase hex digits before it takes the lock', async () => {
        const session = makeRecordingSeedSession();

        await expect(applyCatalogSeed(optionsFor(session, { seedSha: 'ABC' }).options)).rejects.toThrow(RangeError);
        expect(session.ran).toEqual([]);
    });

    it('refuses a ledger head that is not text, rather than read it as a digest', async () => {
        const session = makeRecordingSeedSession({ ledgerHead: SHA_B });
        const { options } = optionsFor(session, {
            session: {
                query: async (sql, values) => {
                    const result = await session.query(sql, values);

                    return sql.includes('catalogSeed:ledgerHead') ? { rows: [{ seed_sha: 42 }], rowCount: 1 } : result;
                },
                copyFrom: (sql) => session.copyFrom(sql),
            },
        });

        await expect(applyCatalogSeed(options)).rejects.toThrow(/seed_sha/u);
    });
});
