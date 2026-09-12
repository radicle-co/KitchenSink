/**
 * The seed function's core: one bundle, one connection, and the seeder meeting the verifier (curated catalog plan U3,
 * KTD-2, KTD-4, KTD-5).
 *
 * `pg` is replaced by a recording client, and the seed and the verifier by recording doubles, so these cases prove the
 * ORDER and the WIRING: the bundle is digested before any connection is opened, the one client always ends, the seeder
 * reads the bundle's own `data/` and the verifier its own `verify/sql/`, and `describe` reads the ledger inside a READ
 * ONLY transaction bounded by a statement timeout. The real driver is `tests/e2e/seedFunction.e2e.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSeedBundleRefusedError, isSeedManifestMismatchError, readSeedManifest } from '@kitchensink/db-schema-guard';

import type { CatalogSeedResult } from '../../../foods/seed/catalog/catalogSeedTransaction.js';
import { applySeedBundle, describeSeedBundle } from '../seedBundle.js';

/** What the doubles record, shared with the hoisted module factories. */
const state = vi.hoisted(() => ({
    clients: [] as { config: unknown; events: string[] }[],
    /** Rows a statement containing the key answers with. */
    answers: new Map<string, readonly Record<string, unknown>[]>(),
    /** A statement containing this text fails. */
    failOn: { text: undefined as string | undefined },
    seedCalls: [] as unknown[],
    verifierOptions: [] as unknown[],
    seedOutcome: { reject: undefined as Error | undefined },
}));

vi.mock('pg', () => {
    class Client {
        private readonly record: (typeof state.clients)[number];

        public constructor(config: unknown) {
            this.record = { config, events: [] };
            state.clients.push(this.record);
        }

        public async connect(): Promise<void> {
            this.record.events.push('connect');
        }

        public async query(sql: string): Promise<{ rows: readonly Record<string, unknown>[]; rowCount: number }> {
            this.record.events.push(sql);

            if (state.failOn.text !== undefined && sql.includes(state.failOn.text)) {
                throw new Error(`refused: ${sql}`);
            }

            const rows = [...state.answers.entries()].find(([marker]) => sql.includes(marker))?.[1] ?? [];

            return { rows, rowCount: rows.length };
        }

        public async end(): Promise<void> {
            this.record.events.push('end');
        }
    }

    return { default: { Client } };
});

vi.mock('../../../foods/seed/catalog/catalogSeedTransaction.js', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    runCatalogSeed: async (options: { client: { query(sql: string): Promise<unknown> } }) => {
        state.seedCalls.push(options);
        await options.client.query('/* the seed */');

        if (state.seedOutcome.reject !== undefined) {
            throw state.seedOutcome.reject;
        }

        return SEED_RESULT;
    },
}));

vi.mock('../../../foods/seed/verify/catalogVerifier.js', () => ({
    createCatalogVerifier: (options: unknown) => {
        state.verifierOptions.push(options);

        return { marker: 'the verifier', options };
    },
}));

const SEED_RESULT = vi.hoisted((): CatalogSeedResult => ({
    outcome: 'applied',
    seedSha: 'c'.repeat(64),
    changes: 3,
    counts: {},
    timings: {
        loadMs: 1,
        lockWaitMs: 0,
        planMs: 2,
        writeMs: 3,
        verifyMs: 4,
        transactionMs: 9,
        totalMs: 10,
    },
}));

const CONNECTION = { host: 'db.internal', port: 5432, database: 'kitchensink_food_pr_7', user: 'food_seeder' };
const LEDGER_HEAD = 'seed_sha FROM public.catalog_seed_ledger';

const scratch = mkdtempSync(join(tmpdir(), 'seedBundle-'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

/** A bundle directory shaped like the seed asset. */
function bundle(): string {
    const root = mkdtempSync(join(scratch, 'bundle-'));

    for (const [path, body] of [
        ['package.json', '{"type":"module"}\n'],
        ['lambdas/seed/handler.js', 'export const handler = () => 1;\n'],
        ['data/curatedCatalog.jsonl', '{"key":"apple"}\n'],
        ['verify/sql/checkRoots.sql', 'SELECT 1;\n'],
    ] as const) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), body);
    }

    return root;
}

const log = vi.fn();

beforeEach(() => {
    state.clients.length = 0;
    state.seedCalls.length = 0;
    state.verifierOptions.length = 0;
    state.answers.clear();
    state.failOn.text = undefined;
    state.seedOutcome.reject = undefined;
    log.mockReset();
});

describe('applySeedBundle', () => {
    it('⛔ refuses a bundle that is not the one the pipeline built, without opening a connection', async () => {
        const outcome = await applySeedBundle({
            connection: CONNECTION,
            bundleDir: bundle(),
            expectSeedSha: 'a'.repeat(64),
            log,
        }).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isSeedManifestMismatchError(outcome)).toBe(true);
        expect(state.clients).toStrictEqual([]);
        expect(state.seedCalls).toStrictEqual([]);
    });

    it('runs the seed on one client, over the bundle’s own data and verifier SQL, and ends it', async () => {
        const root = bundle();
        const expectSeedSha = readSeedManifest(root).sha;

        const result = await applySeedBundle({ connection: CONNECTION, bundleDir: root, expectSeedSha, log });

        expect(result).toBe(SEED_RESULT);
        expect(state.clients).toHaveLength(1);
        expect(state.clients[0]?.config).toStrictEqual({ ...CONNECTION, connectionTimeoutMillis: 10_000 });
        expect(state.clients[0]?.events).toStrictEqual(['connect', '/* the seed */', 'end']);
        expect(state.verifierOptions).toStrictEqual([
            { dataDir: join(root, 'data'), sqlDir: join(root, 'verify/sql') },
        ]);
        expect(state.seedCalls).toStrictEqual([
            {
                client: expect.anything(),
                dataDir: join(root, 'data'),
                seedSha: expectSeedSha,
                verify: { marker: 'the verifier', options: state.verifierOptions[0] },
                log,
            },
        ]);
    });

    it('ends the client when the seed throws, and reports the seed’s own failure', async () => {
        const root = bundle();
        const failure = new Error('the verifier found a difference');

        state.seedOutcome.reject = failure;

        await expect(
            applySeedBundle({
                connection: CONNECTION,
                bundleDir: root,
                expectSeedSha: readSeedManifest(root).sha,
                log,
            }),
        ).rejects.toBe(failure);
        expect(state.clients[0]?.events.at(-1)).toBe('end');
    });
});

describe('describeSeedBundle', () => {
    it('reads the asset digest, then the ledger’s newest digest inside a READ ONLY transaction with a timeout', async () => {
        const root = bundle();

        state.answers.set(LEDGER_HEAD, [{ seed_sha: 'b'.repeat(64) }]);

        expect(await describeSeedBundle({ connection: CONNECTION, bundleDir: root })).toStrictEqual({
            action: 'describe',
            assetSha: readSeedManifest(root).sha,
            ledgerSha: 'b'.repeat(64),
        });
        expect(state.clients[0]?.config).toStrictEqual({ ...CONNECTION, connectionTimeoutMillis: 5_000 });

        const events = state.clients[0]?.events ?? [];

        expect(events[0]).toBe('connect');
        expect(events[1]).toMatch(/^BEGIN .*READ ONLY$/u);
        expect(events[2]).toBe('SET LOCAL statement_timeout = 5000');
        expect(events[3]).toContain(LEDGER_HEAD);
        expect(events.slice(4)).toStrictEqual(['COMMIT', 'end']);
    });

    it('answers a null ledger digest for a database never seeded', async () => {
        const root = bundle();

        expect(await describeSeedBundle({ connection: CONNECTION, bundleDir: root })).toStrictEqual({
            action: 'describe',
            assetSha: readSeedManifest(root).sha,
            ledgerSha: null,
        });
    });

    it('⛔ refuses a bundle it cannot name without opening a connection', async () => {
        const outcome = await describeSeedBundle({ connection: CONNECTION, bundleDir: join(scratch, 'absent') }).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isSeedBundleRefusedError(outcome)).toBe(true);
        expect(state.clients).toStrictEqual([]);
    });

    it('rolls back and ends the client when the ledger read fails', async () => {
        state.failOn.text = LEDGER_HEAD;

        await expect(describeSeedBundle({ connection: CONNECTION, bundleDir: bundle() })).rejects.toThrow(/refused/u);
        expect(state.clients[0]?.events.slice(-2)).toStrictEqual(['ROLLBACK', 'end']);
    });
});
