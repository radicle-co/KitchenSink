/**
 * The catalog seed function's core: apply or describe the seed one bundle holds, on one connection (curated catalog
 * plan U3, KTD-2, KTD-4, KTD-5).
 *
 * @pattern Facade — two calls over the bundle check, the connection, the seed transaction and the verifier
 * @pattern Composition Root — the only module where the seeder and the independent verifier meet (KTD-3)
 *
 * Two adapters drive it with a connection config: the Lambda handler (`handler.ts`, the seeder over RDS IAM) and
 * `local:up` (`packages/tools/local-sandbox`, a password connection to the local database, through the synthesized
 * asset's own bundle). So it knows nothing of Lambda, IAM, stages or the pipeline.
 *
 * - {@link applySeedBundle} digests the bundle BEFORE it connects and refuses one that is not the bundle the pipeline
 *   built: a function invoked before the deploy that ships it holds the previous release's seed, and must refuse rather
 *   than apply it and report success.
 * - {@link describeSeedBundle} answers the two digests the deploy gate compares, reading the ledger inside a READ ONLY
 *   transaction bounded by a statement timeout, so it can never write and never wait long.
 *
 * Each call opens its own client and always ends it (KTD-2: each invocation opens its own connection).
 */
import { join } from 'node:path';

import pg from 'pg';

import { assertSeedBundleMatches, readSeedManifest, type SeedDescription } from '@kitchensink/db-schema-guard';

import {
    inReadOnlySnapshot,
    ledgerHead,
    runCatalogSeed,
    type CatalogSeedLog,
    type CatalogSeedResult,
} from '../../foods/seed/catalog/catalogSeedTransaction.js';
import { pgSeedSession } from '../../foods/seed/catalog/catalogSeedSession.js';
import { createCatalogVerifier } from '../../foods/seed/verify/catalogVerifier.js';

/** How long an apply waits to connect. A database that does not answer in this long fails the deploy step. */
const APPLY_CONNECT_TIMEOUT_MS = 10_000;

/**
 * How long `describe` waits to connect. Short, because the deploy gate asks before the shared sandbox database is woken
 * (ADR-0028): a stopped database must read stale quickly, and stale deploys.
 */
const DESCRIBE_CONNECT_TIMEOUT_MS = 5_000;

/** How long `describe`'s one read may run. */
const DESCRIBE_STATEMENT_TIMEOUT_MS = 5_000;

/** Where a bundle and its database are. */
export interface SeedBundleTarget {
    /** How to connect: the caller's login and authentication. The core adds only a connect timeout. */
    readonly connection: pg.ClientConfig;
    /** The asset root: `package.json`, `lambdas/seed/handler.js`, `data/`, `verify/sql/`. */
    readonly bundleDir: string;
}

/** What {@link applySeedBundle} takes. */
export interface ApplySeedBundleOptions extends SeedBundleTarget {
    /** The digest the pipeline computed from the bundle it built (`runSeed.sh manifest`). */
    readonly expectSeedSha: string;
    /** Where the seed's one summary line goes. */
    readonly log: CatalogSeedLog;
}

/**
 * Open a client, run `work` on it, and end it whatever happens.
 *
 * An `end()` that fails is swallowed: it fails only on a connection already lost, and the failure `work` raised, if
 * any, is the one reported.
 *
 * @param config - The connection, with its timeout.
 * @param work - What to do on the connected client.
 * @returns What `work` returned.
 * @sideEffect Connects to PostgreSQL and disconnects.
 */
async function withClient<T>(config: pg.ClientConfig, work: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client(config);

    try {
        await client.connect();

        return await work(client);
    } finally {
        await client.end().catch(() => undefined);
    }
}

/**
 * Apply the seed a bundle holds, after proving it is the bundle the pipeline built.
 *
 * @param options - The connection, the bundle, the expected digest and the log.
 * @returns What the apply did, and how long each part took (KTD-1 reads `transactionMs`).
 * @throws {SeedBundleRefusedError | SeedManifestMismatchError} before any connection, for a bundle that is not the one
 *   the pipeline built.
 * @throws Whatever the seed or the verifier throws; the seed's transaction is rolled back and nothing is recorded.
 * @sideEffect Reads the bundle; connects; takes the seed lock; writes the catalog and the ledger.
 */
export async function applySeedBundle(options: ApplySeedBundleOptions): Promise<CatalogSeedResult> {
    const { bundleDir, expectSeedSha, log } = options;
    const manifest = assertSeedBundleMatches({ label: 'food catalog seed', bundleDir, expectSeedSha });
    const dataDir = join(bundleDir, 'data');
    const verify = createCatalogVerifier({ dataDir, sqlDir: join(bundleDir, 'verify', 'sql') });

    return withClient({ ...options.connection, connectionTimeoutMillis: APPLY_CONNECT_TIMEOUT_MS }, async (client) =>
        runCatalogSeed({ client, dataDir, seedSha: manifest.sha, verify, log }),
    );
}

/**
 * Answer the two digests the deploy gate compares: the asset's own, and the ledger's newest.
 *
 * @param target - The connection and the bundle.
 * @returns The description; `ledgerSha` is `null` for a database never seeded.
 * @throws {SeedBundleRefusedError} before any connection, for a bundle the manifest cannot name.
 * @throws Whatever connecting or reading throws, a connect timeout included; the gate reads any failure as stale.
 * @sideEffect Reads the bundle; connects; reads the ledger.
 */
export async function describeSeedBundle(target: SeedBundleTarget): Promise<SeedDescription> {
    const assetSha = readSeedManifest(target.bundleDir).sha;

    return withClient(
        { ...target.connection, connectionTimeoutMillis: DESCRIBE_CONNECT_TIMEOUT_MS },
        async (client) => {
            const session = pgSeedSession(client);
            const ledgerSha = await inReadOnlySnapshot(session, DESCRIBE_STATEMENT_TIMEOUT_MS, async () =>
                ledgerHead(session),
            );

            return { action: 'describe', assetSha, ledgerSha };
        },
    );
}
