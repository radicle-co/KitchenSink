/**
 * The catalog seed function: a pipeline-only Lambda in `FoodSchemaStack`, invoked by `runSeed.sh` after the migrate
 * step and before anything that reads the catalog deploys (curated catalog plan U3, ADR-0051).
 *
 * @pattern Adapter — the Lambda event and environment onto the core in `seedBundle.ts`, as the seeder over RDS IAM
 * @pattern Visitor — an exhaustive `switch` over the parsed `SeedEvent` union
 *
 * Two actions, parsed strictly before anything else is read:
 *
 * - `apply` with the digest the pipeline computed: the core refuses a bundle that is not the one built, then seeds and
 *   verifies in one transaction, and returns what it did with its timings.
 * - `describe`: the asset's digest and the ledger's newest, for the deploy gate (KTD-5).
 *
 * It connects as `food_seeder` (KTD-18), never the migrator or the service role; the function's role holds
 * `rds-db:connect` for that login alone. The bundle is the function's own task root: this module is bundled to
 * `lambdas/seed/handler.js`, two directories below it (`seedAssetBuild.mjs`).
 *
 * ⚠️ It also exports the core, because `local:up` loads THIS bundle from the synthesized asset and drives
 * {@link applySeedBundle} over a password connection: local-sandbox can import neither food's source nor `pg`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATABASE_ROLES, parseSeedEvent, type SeedDescription } from '@kitchensink/db-schema-guard';
import { rdsPoolConfig } from '@kitchensink/rds-iam-auth';

import type { CatalogSeedResult } from '../../foods/seed/catalog/catalogSeedTransaction.js';
import { readFoodDbTarget } from '../foodDbTarget.js';
import { applySeedBundle, describeSeedBundle } from './seedBundle.js';

export { applySeedBundle, describeSeedBundle } from './seedBundle.js';
export type { ApplySeedBundleOptions, SeedBundleTarget } from './seedBundle.js';

/**
 * The asset root, resolved from this module's own location.
 *
 * @returns The directory two above `lambdas/seed/`.
 */
function bundleRoot(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * Write one log line as JSON on stdout, which the drained log group forwards (ADR-0042).
 *
 * @param message - The line.
 * @param attributes - Its fields.
 * @sideEffect Writes to stdout.
 */
function logLine(message: string, attributes: Readonly<Record<string, unknown>>): void {
    process.stdout.write(`${JSON.stringify({ level: 'info', message, ...attributes })}\n`);
}

/**
 * Lambda entrypoint.
 *
 * @param event - `{ action: 'apply', expectSeedSha }` or `{ action: 'describe' }`, and nothing else.
 * @returns The apply's result, or the description.
 * @throws {MalformedSeedEventError} for any other event, before the environment is read.
 * @throws {Error} for a missing or malformed environment variable.
 * @throws Whatever the core throws.
 * @sideEffect Reads the environment and the bundle; connects to PostgreSQL as the seeder.
 */
export const handler = async (event: unknown): Promise<CatalogSeedResult | SeedDescription> => {
    const parsed = parseSeedEvent(event);
    const { host, port, database } = readFoodDbTarget(process.env);
    const connection = rdsPoolConfig({ host, port, database, username: DATABASE_ROLES.food.seeder });
    const bundleDir = bundleRoot();

    switch (parsed.action) {
        case 'apply':
            return applySeedBundle({ connection, bundleDir, expectSeedSha: parsed.expectSeedSha, log: logLine });
        case 'describe':
            return describeSeedBundle({ connection, bundleDir });
    }
};
