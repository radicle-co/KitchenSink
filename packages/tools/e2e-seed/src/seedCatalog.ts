/**
 * SEED CATALOG — fill this stage's food catalog by asking the food service to sync a list of names.
 *
 * Every food deploy applies the curated catalog seed (ADR-0051), so a `pr-{N}` preview's catalog is not empty. This
 * makes sure the specific foods the cross-service linkage suite probes are present, through the product's own
 * door: `POST /api/v1/foods/batch`, which any authenticated caller may use. A name the catalog already holds, by its
 * normalized name, answers that entry and enqueues nothing (`FoodsService.batchAdd`); any other name is fetched from
 * USDA, as it would be for a real user.
 *
 * Idempotent by construction — the endpoint dedups on the normalized name, so a re-run of the same names
 * against a filled catalog is a batch of inline `RESOLVED` hits and no waiting at all.
 *
 * Usage: `e2e-seed seed-catalog`, with `E2E_SEED_FOOD_URL` naming the stage's food origin.
 *
 * @sideEffect Leases a pool slot and signs it in, enqueues USDA fetches, and polls until they settle.
 */
import { setTimeout as delay } from 'node:timers/promises';

import { clerkLeasePort, leaseSession } from '@kitchensink/e2e-fixtures/lease';
import { slotFor } from '@kitchensink/e2e-fixtures/testPool';

import { foodClientFor } from './client.js';
import { readFoodOrigin, readSeedEnvironment } from './env.js';
import {
    CATALOG_PROBE_QUERY,
    CATALOG_SEED_NAMES,
    findCatalogShortfalls,
    findProbeShortfall,
    seedFoodCatalog,
    type CatalogItem,
} from './foodCatalog.js';

const env = readSeedEnvironment(process.env);
const foodOrigin = readFoodOrigin(process.env);

/**
 * Who fills the catalog: the LINKAGE pool slot, which the cross-service suite leases in the same job.
 *
 * The catalog is stage-wide and CALLER-INVARIANT — `GET /api/v1/foods/nutrition?ids=` deliberately excludes
 * per-author rows — so any authenticated identity may fill it and no attribution is implied. It used to be an
 * address the caller named or this run's own run-minted signer; both are gone with the fixed pool (owner ruling
 * 2026-09-13), and a food a test imports is one the catalog may keep.
 */
const { handle: session } = await leaseSession({
    slot: slotFor('linkage', 'linkage'),
    publishableKey: env.clerkPublishableKey,
    origin: env.webOrigin,
    port: clerkLeasePort(env.clerkSecretKey),
});

const client = foodClientFor(foodOrigin, session);

const outcome = await seedFoodCatalog(CATALOG_SEED_NAMES, {
    batch: async (names) => (await client.batch(names)).items as readonly CatalogItem[],
    status: async (id) => (await client.getStatus(id)) as CatalogItem,
    now: Date.now,
    sleep: (ms) => delay(ms),
    log: (message) => console.error(message),
    // The disambiguation half. `UNRESOLVED` is the food service working as designed — USDA returned
    // several rows and it declines to guess — and on a live preview SEVEN of ten ordinary names came back
    // that way, `butter` among them. Walking the flow a user's client would walk is what makes the seed
    // produce a catalog rather than three rows.
    candidates: async (id) => (await client.getCandidates(id)).candidates,
    resolve: async (id, candidateId) => {
        await client.resolve(id, [candidateId]);
    },
});

// ⚠️ REPORTED, ALWAYS — including on the happy path. A name USDA cannot disambiguate is a fact worth
// seeing in the log rather than a silent absence: it is how `egg` was found to come back `UNRESOLVED`,
// and it is the first thing to read if the postcondition below ever starts failing.
for (const entry of outcome.rejected) {
    console.error(`e2e-seed seed-catalog: "${entry.name}" settled as ${entry.status} — not searchable`);
}

// ⛔ ASK THE SERVICE, do not infer. The two pure checks below reason about the names we asked for; this
// one issues the search the linkage suite itself issues, which is the only thing that can tell us whether
// food's `plainto_tsquery` AND-ing actually matches the rows USDA returned.
const probe = await client.search(CATALOG_PROBE_QUERY);
const shortfalls = [
    ...findCatalogShortfalls(outcome),
    ...findProbeShortfall(CATALOG_PROBE_QUERY, probe.results.length),
];

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
