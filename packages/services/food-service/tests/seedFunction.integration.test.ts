/**
 * The seed function end to end with only the database mocked (curated catalog plan U3, KTD-4, KTD-5, KTD-18; the
 * 2026-09-20 ruling: integration mocks the database).
 *
 * The real handler, the real event parser, the real RDS IAM connection config, the real bundle digest and the real
 * ledger read run here; `pg.Client` is a recording fake. So these cases prove what the unit suites cannot see across
 * their seams: the connection the handler builds is the seeder's, from the stage's environment, with the core's
 * timeout added; `describe` sends exactly its four statements in order, the read inside a READ ONLY transaction; and an
 * `apply` that names another bundle is refused before any client exists. The real server is
 * `tests/e2e/seedFunction.e2e.test.ts`.
 *
 * ⚠️ From source, the handler's bundle root is `src/` (two directories above `src/lambdas/seed/`), so `assetSha` here
 * is the digest of the source tree. Only the deployed asset makes it the seed's digest; these cases compare it with
 * `readSeedManifest` of the same root, which is all they need.
 */
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATABASE_ROLES, isSeedManifestMismatchError, readSeedManifest } from '@kitchensink/db-schema-guard';

import { handler } from '../src/lambdas/seed/handler.js';

/** The fake's record, shared with its hoisted factory. */
const fake = vi.hoisted(() => ({
    clients: [] as { config: Record<string, unknown>; statements: string[]; ended: boolean }[],
    ledger: [] as { seed_sha: string }[],
}));

vi.mock('pg', async (importOriginal) => {
    const actual = await importOriginal<{ default: object }>();

    class Client {
        private readonly record: (typeof fake.clients)[number];

        public constructor(config: Record<string, unknown>) {
            this.record = { config, statements: [], ended: false };
            fake.clients.push(this.record);
        }

        public async connect(): Promise<void> {}

        public async query(sql: string): Promise<{ rows: readonly object[]; rowCount: number }> {
            this.record.statements.push(sql);

            const rows = sql.includes('catalog_seed_ledger') ? fake.ledger : [];

            return { rows, rowCount: rows.length };
        }

        public async end(): Promise<void> {
            this.record.ended = true;
        }
    }

    return { default: { ...actual.default, Client } };
});

const SOURCE_ROOT = resolve(import.meta.dirname, '..', 'src');
const ENV = {
    STAGE: 'pr-7',
    FOOD_DB_ENDPOINT: 'db.example.internal',
    FOOD_DB_PORT: '5432',
    FOOD_DB_NAME: 'kitchensink_food_pr_7',
} as const;

beforeEach(() => {
    fake.clients.length = 0;
    fake.ledger = [];

    for (const [name, value] of Object.entries(ENV)) {
        vi.stubEnv(name, value);
    }
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('the seed function, its database mocked', () => {
    it('describes as the seeder over RDS IAM: four statements, the read inside a READ ONLY transaction', async () => {
        fake.ledger = [{ seed_sha: 'b'.repeat(64) }];

        const description = await handler({ action: 'describe' });

        expect(description).toStrictEqual({
            action: 'describe',
            assetSha: readSeedManifest(SOURCE_ROOT).sha,
            ledgerSha: 'b'.repeat(64),
        });
        expect(fake.clients).toHaveLength(1);

        const [client] = fake.clients;

        expect(client?.config).toMatchObject({
            host: ENV.FOOD_DB_ENDPOINT,
            port: 5432,
            database: ENV.FOOD_DB_NAME,
            user: DATABASE_ROLES.food.seeder,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 5_000,
        });
        expect(typeof client?.config['password']).toBe('function');
        expect(client?.statements).toStrictEqual([
            'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
            'SET LOCAL statement_timeout = 5000',
            expect.stringContaining('SELECT seed_sha FROM public.catalog_seed_ledger ORDER BY id DESC LIMIT 1'),
            'COMMIT',
        ]);
        expect(client?.ended).toBe(true);
    });

    it('describes a database never seeded with a null ledger digest', async () => {
        expect(await handler({ action: 'describe' })).toMatchObject({ action: 'describe', ledgerSha: null });
    });

    it('⛔ refuses an apply for a bundle it does not hold, before any client exists', async () => {
        const outcome = await handler({ action: 'apply', expectSeedSha: 'f'.repeat(64) }).then(
            () => undefined,
            (error: unknown) => error,
        );

        expect(isSeedManifestMismatchError(outcome)).toBe(true);
        expect(fake.clients).toStrictEqual([]);
    });
});
