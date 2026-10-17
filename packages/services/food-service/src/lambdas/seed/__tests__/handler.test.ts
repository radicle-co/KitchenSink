/**
 * The seed function's Lambda adapter (curated catalog plan U3, KTD-4, KTD-5, KTD-18).
 *
 * The core is replaced by a recording double, so these cases prove only the adapter's own decisions: the event is
 * parsed before anything else is read, the connection is the SEEDER's over RDS IAM, the bundle is the function's own
 * task root (two directories above the handler), and each action reaches its own core with nothing it does not need.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATABASE_ROLES, isMalformedSeedEventError } from '@kitchensink/db-schema-guard';

import { handler } from '../handler.js';

const calls = vi.hoisted(() => ({ apply: [] as unknown[], describe: [] as unknown[] }));

vi.mock('../seedBundle.js', () => ({
    applySeedBundle: async (options: unknown) => {
        calls.apply.push(options);

        return { outcome: 'applied' };
    },
    describeSeedBundle: async (options: unknown) => {
        calls.describe.push(options);

        return { action: 'describe', assetSha: 'a'.repeat(64), ledgerSha: null };
    },
}));

const HANDLER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'f'.repeat(64);
const ENV = {
    STAGE: 'pr-7',
    FOOD_DB_ENDPOINT: 'db.example.internal',
    FOOD_DB_PORT: '5432',
    FOOD_DB_NAME: 'kitchensink_food_pr_7',
} as const;

/** The connection every action is handed: the seeder, over RDS IAM, to the stage's database. */
const SEEDER_CONNECTION = {
    host: ENV.FOOD_DB_ENDPOINT,
    port: 5432,
    database: ENV.FOOD_DB_NAME,
    user: DATABASE_ROLES.food.seeder,
    ssl: { rejectUnauthorized: false },
    password: expect.any(Function),
};

beforeEach(() => {
    calls.apply.length = 0;
    calls.describe.length = 0;

    for (const [name, value] of Object.entries(ENV)) {
        vi.stubEnv(name, value);
    }
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('the seed handler', () => {
    it('applies with the pipeline’s digest, as the seeder, over its own task root', async () => {
        expect(await handler({ action: 'apply', expectSeedSha: SHA })).toStrictEqual({ outcome: 'applied' });
        expect(calls.apply).toStrictEqual([
            {
                connection: SEEDER_CONNECTION,
                bundleDir: resolve(HANDLER_DIR, '..', '..'),
                expectSeedSha: SHA,
                log: expect.any(Function),
            },
        ]);
        expect(calls.describe).toStrictEqual([]);
    });

    it('describes with nothing but the connection and the bundle', async () => {
        expect(await handler({ action: 'describe' })).toStrictEqual({
            action: 'describe',
            assetSha: 'a'.repeat(64),
            ledgerSha: null,
        });
        expect(calls.describe).toStrictEqual([
            { connection: SEEDER_CONNECTION, bundleDir: resolve(HANDLER_DIR, '..', '..') },
        ]);
        expect(calls.apply).toStrictEqual([]);
    });

    it.each<[string, unknown]>([
        ['an apply with no digest', { action: 'apply' }],
        ['an action it does not know', { action: 'drop' }],
        ['a migrate event', { expectManifestSha: SHA }],
        ['nothing at all', undefined],
    ])('⛔ refuses %s before reading its environment', async (_case, event) => {
        vi.stubEnv('FOOD_DB_ENDPOINT', '');

        const outcome = await handler(event).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isMalformedSeedEventError(outcome)).toBe(true);
        expect([...calls.apply, ...calls.describe]).toStrictEqual([]);
    });

    it('⛔ refuses to run with no database endpoint, naming the variable', async () => {
        vi.stubEnv('FOOD_DB_ENDPOINT', '');

        await expect(handler({ action: 'describe' })).rejects.toThrow('FOOD_DB_ENDPOINT');
        expect(calls.describe).toStrictEqual([]);
    });

    it('logs the seed’s summary as one JSON line on stdout, for the drained log group', async () => {
        const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

        try {
            await handler({ action: 'apply', expectSeedSha: SHA });

            const { log } = calls.apply[0] as { log: (message: string, attributes: object) => void };

            log('catalog seed applied', { outcome: 'applied', transactionMs: 12 });

            expect(write).toHaveBeenCalledTimes(1);
            expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toStrictEqual({
                level: 'info',
                message: 'catalog seed applied',
                outcome: 'applied',
                transactionMs: 12,
            });
            expect(String(write.mock.calls[0]?.[0]).endsWith('\n')).toBe(true);
        } finally {
            write.mockRestore();
        }
    });
});
