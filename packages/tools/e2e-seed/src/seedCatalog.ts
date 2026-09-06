/**
 * SEED CATALOG — fill this stage's food catalog by asking the food service to sync a list of names.
 *
 * A `pr-{N}` preview gets its own fresh logical database (ADR-0006) and nothing seeds the food half, so
 * every catalog read answers empty on a live, healthy stage. This closes that through the product's own
 * door: `POST /api/v1/foods/batch`, which any authenticated caller may use and whose worker fetches from
 * USDA exactly as it would for a real user.
 *
 * Idempotent by construction — the endpoint dedups on the normalized name, so a re-run of the same names
 * against a filled catalog is a batch of inline `RESOLVED` hits and no waiting at all.
 *
 * Usage: `e2e-seed seed-catalog`, with `E2E_SEED_FOOD_URL` naming the stage's food origin.
 *
 * @sideEffect Signs in to Clerk, enqueues USDA fetches, and polls until they settle.
 */
import { establishSession, remintFromSession, resolveRunKey } from '@kitchensink/e2e-fixtures';
import { FoodServiceClient } from '@kitchensink/food-service-client';

import { readSeedEnvironment } from './env.js';
import { CATALOG_SEED_NAMES, findCatalogShortfalls, seedFoodCatalog, type CatalogItem } from './foodCatalog.js';
import { deriveFixtureManifest } from './fixtureManifest.js';
import { memoizingTokenSource } from './tokenSource.js';

const env = readSeedEnvironment(process.env);
const foodOrigin = (process.env['E2E_SEED_FOOD_URL'] ?? '').replace(/\/+$/, '');

if (foodOrigin === '') {
    throw new Error('e2e-seed seed-catalog: E2E_SEED_FOOD_URL is required and has no default');
}

/**
 * Who fills the catalog.
 *
 * The catalog is stage-wide and CALLER-INVARIANT — `GET /api/v1/foods/nutrition?ids=` deliberately excludes
 * per-author rows — so any authenticated identity may fill it and no attribution is implied. `E2E_SEED_
 * CATALOG_EMAIL` lets the caller name one anyway, so a suite that already holds an identity fills the
 * catalog AS that identity rather than standing up a second account on a shared Clerk instance. Absent, it
 * falls back to this run's own signer.
 */
const email = process.env['E2E_SEED_CATALOG_EMAIL']?.trim() || deriveFixtureManifest(resolveRunKey()).signInEmail;

const session = await establishSession({
    email,
    publishableKey: env.clerkPublishableKey,
    origin: env.webOrigin,
});

const client = new FoodServiceClient({
    baseUrl: foodOrigin,
    token: memoizingTokenSource(session, { remint: remintFromSession }),
});

const outcome = await seedFoodCatalog(CATALOG_SEED_NAMES, {
    batch: async (names) => (await client.batch(names)).items as readonly CatalogItem[],
    status: async (id) => (await client.getStatus(id)) as CatalogItem,
    now: Date.now,
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.error(message),
});

// ⚠️ REPORTED, ALWAYS — including on the happy path. A name USDA cannot disambiguate is a fact worth
// seeing in the log rather than a silent absence: it is how `egg` was found to come back `UNRESOLVED`,
// and it is the first thing to read if the postcondition below ever starts failing.
for (const entry of outcome.rejected) {
    console.error(`e2e-seed seed-catalog: "${entry.name}" settled as ${entry.status} — not searchable`);
}

const shortfalls = findCatalogShortfalls(outcome);

if (shortfalls.length > 0) {
    // ⛔ The postcondition, not the source's answers. A suite run against a catalog that quietly came up
    // short fails about search relevance instead of about the one fact that explains it.
    for (const shortfall of shortfalls) {
        console.error(`::error::e2e-seed seed-catalog: ${shortfall}`);
    }

    process.exit(1);
}

console.error(
    `e2e-seed seed-catalog: ${outcome.resolved.length} foods RESOLVED in ${foodOrigin}'s catalog ` +
        `(${outcome.rejected.length} not searchable).`,
);
