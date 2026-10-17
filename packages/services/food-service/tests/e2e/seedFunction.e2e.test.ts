/**
 * LOCAL e2e: the seed function's core, loaded from the BUILT asset, against a real PostgreSQL as the seeder (curated
 * catalog plan U3, KTD-1, KTD-2, KTD-4, KTD-5, KTD-18).
 *
 * The asset is built exactly as the pipeline builds it (`seedAssetBuild.mjs`) and its `lambdas/seed/handler.js` is
 * imported, so the bundle that ships is the code under test: its inlined `pg`, its copy of the committed data and its
 * copy of the verifier SQL. What these cases prove that no mock can:
 *
 * - a database never seeded describes with no ledger digest;
 * - the real committed seed applies through the asset as `food_seeder`, verifies, and records the asset's own digest,
 *   after which `describe` reads the two digests equal (the deploy gate's "current");
 * - an apply naming a bundle the function does not hold writes nothing;
 * - `describe`'s transaction refuses a write with SQLSTATE 25006, and a server that never answers fails it inside its
 *   connect timeout, so the deploy gate never waits long on a stopped database.
 *
 * The apply's timings are printed: KTD-1 picks the seed's shape from `transactionMs`, and this is the local signal.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readSeedManifest, type SeedDescription } from '@kitchensink/db-schema-guard';

import { pgSeedSession } from '../../src/foods/seed/catalog/catalogSeedSession.js';
import { inReadOnlySnapshot, type CatalogSeedResult } from '../../src/foods/seed/catalog/catalogSeedTransaction.js';
import type { ApplySeedBundleOptions, SeedBundleTarget } from '../../src/lambdas/seed/seedBundle.js';
import { foodDb } from '../support/roleDb.js';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..', '..');

/** The seed function's bundle, as `local:up` and this suite load it. */
interface SeedBundleModule {
    applySeedBundle(options: ApplySeedBundleOptions): Promise<CatalogSeedResult>;
    describeSeedBundle(target: SeedBundleTarget): Promise<SeedDescription>;
}

/**
 * Whether a loaded module is the seed bundle.
 *
 * @param value - The module namespace.
 * @returns `true` when it exports both calls.
 */
function isSeedBundleModule(value: unknown): value is SeedBundleModule {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const exports = value as Readonly<Record<string, unknown>>;

    return typeof exports['applySeedBundle'] === 'function' && typeof exports['describeSeedBundle'] === 'function';
}

/** Generous: the real seed's apply took about 10 s of writes plus the verifier locally (2026-10-01). */
const APPLY_TIMEOUT_MS = 600_000;

describe('the seed function against a real database (LOCAL e2e)', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'seedFunction-'));
    const asset = join(scratch, 'distSeed');
    let bundle: SeedBundleModule;
    let connection: pg.ClientConfig;

    /** The newest ledger digest, read by the owner rather than through the code under test. */
    async function ledger(): Promise<readonly string[]> {
        return foodDb().asOwner(async (client) => {
            const rows = await client.query<{ seed_sha: string }>(
                'SELECT seed_sha FROM catalog_seed_ledger ORDER BY id',
            );

            return rows.rows.map((row) => row.seed_sha);
        });
    }

    beforeAll(async () => {
        const build = spawnSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                'const { buildSeedAsset } = await import(process.argv[1]); await buildSeedAsset({ packageRoot: process.argv[2], outdir: process.argv[3] });',
                pathToFileURL(join(PACKAGE_ROOT, 'seedAssetBuild.mjs')).href,
                PACKAGE_ROOT,
                asset,
            ],
            { encoding: 'utf8' },
        );

        expect(build.status, build.stderr).toBe(0);

        const loaded: unknown = await import(pathToFileURL(join(asset, 'lambdas', 'seed', 'handler.js')).href);

        if (!isSeedBundleModule(loaded)) {
            throw new TypeError('the built seed handler does not export applySeedBundle and describeSeedBundle');
        }

        bundle = loaded;
        connection = { connectionString: foodDb().seederUrl };
        await foodDb().truncate();
    }, 120_000);

    afterAll(async () => {
        // The tier's database is shared by the next suite: leave it as the others do, empty.
        await foodDb().truncate();
        rmSync(scratch, { recursive: true, force: true });
    });

    it('describes a database never seeded: the asset’s own digest, and no ledger digest', async () => {
        expect(await bundle.describeSeedBundle({ connection, bundleDir: asset })).toStrictEqual({
            action: 'describe',
            assetSha: readSeedManifest(asset).sha,
            ledgerSha: null,
        });
    });

    it('⛔ refuses an apply for a bundle it does not hold, and writes nothing', async () => {
        const outcome = await bundle
            .applySeedBundle({ connection, bundleDir: asset, expectSeedSha: 'f'.repeat(64), log: () => undefined })
            .then(
                () => undefined,
                (error: unknown) => error,
            );

        // By name: the bundle carries its own copy of `@kitchensink/db-schema-guard`, so its error class is not this one.
        expect(outcome).toMatchObject({ name: 'SeedManifestMismatchError' });
        expect(await ledger()).toStrictEqual([]);
    });

    it(
        'applies the real committed seed through the asset as the seeder, then describes it current',
        async () => {
            const assetSha = readSeedManifest(asset).sha;
            const result = await bundle.applySeedBundle({
                connection,
                bundleDir: asset,
                expectSeedSha: assetSha,
                log: () => undefined,
            });

            // The local timing signal KTD-1 reads; the first preview deploy's is the deciding one.
            console.log(`seed apply through the built asset: ${JSON.stringify(result.timings)}`);

            expect(result.outcome).toBe('applied');
            expect(result.seedSha).toBe(assetSha);
            expect(await ledger()).toStrictEqual([assetSha]);
            expect(await bundle.describeSeedBundle({ connection, bundleDir: asset })).toStrictEqual({
                action: 'describe',
                assetSha,
                ledgerSha: assetSha,
            });

            const again = await bundle.applySeedBundle({
                connection,
                bundleDir: asset,
                expectSeedSha: assetSha,
                log: () => undefined,
            });

            console.log(`seed re-apply (nothing to write): ${JSON.stringify(again.timings)}`);

            expect(again.outcome).toBe('unchanged');
            expect(await ledger()).toStrictEqual([assetSha]);
        },
        APPLY_TIMEOUT_MS,
    );

    it('⛔ refuses a write inside describe’s transaction with SQLSTATE 25006', async () => {
        const client = new pg.Client(connection);

        await client.connect();

        try {
            const outcome = await inReadOnlySnapshot(pgSeedSession(client), 5_000, async () =>
                client.query('INSERT INTO catalog_seed_ledger (seed_sha) VALUES ($1)', ['e'.repeat(64)]),
            ).then(
                () => undefined,
                (error: unknown) => error,
            );

            expect(outcome).toMatchObject({ code: '25006' });
        } finally {
            await client.end();
        }

        expect(await ledger()).not.toContain('e'.repeat(64));
    });

    it('fails inside its connect timeout against a server that never answers', async () => {
        const silent: Server = createServer(() => undefined);

        await new Promise<void>((done) => silent.listen(0, '127.0.0.1', done));

        const address = silent.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        const started = Date.now();

        try {
            await expect(
                bundle.describeSeedBundle({
                    connection: { host: '127.0.0.1', port, user: 'food_seeder', database: 'food_e2e_test' },
                    bundleDir: asset,
                }),
            ).rejects.toThrow();

            const elapsed = Date.now() - started;

            // The describe step's connect timeout is 5 s and the apply step's is 10 s (`seedBundle.ts`). Any bound under
            // 10 s tells them apart; 9.5 s leaves room for a loaded machine, where 8 s was measured to overrun.
            expect(elapsed).toBeGreaterThanOrEqual(4_500);
            expect(elapsed).toBeLessThan(9_500);
        } finally {
            silent.close();
        }
    }, 20_000);
});
