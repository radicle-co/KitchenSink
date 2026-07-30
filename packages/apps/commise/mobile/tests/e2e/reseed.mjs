/**
 * Reset the recipe DB to the clean seed state BETWEEN Maestro flows, so each flow gets the fixture it was
 * designed against (the 5 seed recipes + 1 collection) rather than the accumulated, mutated state of the
 * flows before it (create/clone/delete are not all hermetic, which pollutes later flows like
 * search-navigation and pushes seed recipes below the fold). TRUNCATE the recipe data — the `ingredients`
 * catalog (from prepare-db, needed by the create typeahead) is preserved — then re-run the idempotent seed.
 *
 * The recipe service keeps running: TRUNCATE holds only a brief lock and does not drop the schema, so its
 * connection pool survives. Usage: `DATABASE_URL=… node packages/apps/commise/mobile/tests/e2e/reseed.mjs`
 *
 * `RESEED_MODE=empty` truncates and STOPS — no re-seed — leaving a genuinely empty library. That is the
 * first-run state (`recipes/empty-library.yaml`), which is unreachable any other way: the seeded fixture is
 * exactly what hid a permanent-loading-skeleton defect on the screen a brand-new account opens on. Anything
 * other than `empty` (including unset) is the default seeded reset every other flow depends on.
 */
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
    console.error('reseed: DATABASE_URL is required.');
    process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
// `recipes` + `collections` cascade to their children (ingredients/steps/photos/collection links, versions,
// ratings, pending archives). `ingredients` (the catalog) is intentionally NOT truncated.
await client.query(
    'TRUNCATE recipes, collections, recipe_ratings, recipe_versions, recipe_version_pending_archives, account_erasure_jobs RESTART IDENTITY CASCADE',
);
await client.end();

if (process.env['RESEED_MODE'] === 'empty') {
    console.log('reseed: recipe DB truncated and left EMPTY (RESEED_MODE=empty).');
    process.exit(0);
}

// Re-run the seed via tsx directly (the `npm run seed` workspace script adds turbo overhead that is far
// too slow for a per-flow loop; the seed script is a standalone pg inserter).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
execSync('npx tsx packages/services/recipe-service/src/database/seed.ts', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
});
console.log('reseed: recipe DB reset to the clean seed state.');
