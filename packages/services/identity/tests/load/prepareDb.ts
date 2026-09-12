/**
 * Standalone DB preparation for the identity k6 load suite (used by the CI load job and local runs).
 *
 * Mirrors `packages/services/recipe-service/tests/load/prepare-db.mjs`: applies the ordered
 * `src/database/migrations/*.sql` files against `DATABASE_URL`, then seeds the fixtures the k6 scenarios
 * require. Idempotent — it drops and recreates the `public` schema first, because the migration SQL is
 * not idempotent (bare `CREATE TABLE`), exactly as the integration suites do. (Migration 0005 creates the
 * `citext` extension, so no separate extension step is needed.)
 *
 * TypeScript rather than `.mjs` so the fixture shapes it shares with `prepareClerkTokens.ts` are
 * type-checked; run it under `tsx` (`npm run test:load:db`).
 *
 * Three seed sets, each load-bearing:
 *
 *  1. **Warm principals** (`IDENTITY_WARM_POOL_SIZE`, default 50) — user + account + profile, so
 *     `sessionHotPath.load.js` measures the STEADY-STATE authenticated read. Without them the ramp-up
 *     would pay first-sight `provisionCompleteUser` writes and the p95 would describe provisioning, not
 *     the hot path. Must be `>= IDENTITY_LOAD_PEAK_VUS` — the scripts rotate warm principals by scenario
 *     iteration, so distinctness of CONCURRENT iterations holds only while the pool exceeds the peak VU
 *     count. Asserted below rather than left to silently wrap two writers onto one profile row.
 *  2. **The admin principal** — same three rows; its token carries `public_metadata.scopes:
 *     ['admin:users']`. Seeded rather than provisioned on first use so the admin scenario's first
 *     iteration is not an outlier write.
 *  3. **Bulk filler users** (`IDENTITY_BULK_USERS`, default 20000) — `users` rows only. The admin list
 *     filters with `ilike '%needle%'`, which a btree on `users.email`/`users.name` CANNOT serve, so the
 *     planner sequentially scans. That scan's cost is proportional to this population; seeding a
 *     realistic forward-looking volume is what makes `adminUserSearch.load.js` able to FAIL.
 *
 * Usage (from packages/services/identity):
 *   DATABASE_URL=postgres://... npm run test:load:db
 *   IDENTITY_BULK_USERS=200000 DATABASE_URL=postgres://... npm run test:load:db
 *
 * @sideEffect DROPS the `public` schema of `DATABASE_URL` and rewrites it. NEVER point this at a database
 *            you care about — it is destructive by design (a load DB is disposable).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import {
    ADMIN_SCOPE,
    BULK_EMAIL_PREFIX,
    BULK_INDEX_PAD,
    BULK_NAME_PREFIX,
    BULK_SUB_PREFIX,
    BULK_ULID_PREFIX,
    POOL_EMAIL_DOMAIN,
    POOL_NAME_NEEDLE,
    adminIdentity,
    bulkIdentity,
    warmIdentity,
    type SeededIdentity,
} from './poolIdentities.js';

const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
    console.error('prepare-db: DATABASE_URL is required.');
    process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations');

const WARM_POOL_SIZE = Math.max(1, Number(process.env['IDENTITY_WARM_POOL_SIZE'] ?? 50));
const BULK_USERS = Math.max(0, Number(process.env['IDENTITY_BULK_USERS'] ?? 20_000));
// Only read to VALIDATE the warm pool covers the peak; the load shape itself is k6's concern.
const PEAK_VUS = Math.max(1, Number(process.env['IDENTITY_LOAD_PEAK_VUS'] ?? 50));

if (WARM_POOL_SIZE < PEAK_VUS) {
    // Fail LOUD rather than let the rotation wrap: two concurrent iterations sharing a warm user would
    // both PATCH one profile row, and `patchUserMe`'s non-transactional read-after-write then returns the
    // OTHER writer's value — a check failure that looks like a service bug and is not one.
    console.error(
        `prepare-db: IDENTITY_WARM_POOL_SIZE (${WARM_POOL_SIZE}) must be >= IDENTITY_LOAD_PEAK_VUS ` +
            `(${PEAK_VUS}) — the scripts rotate warm principals by scenario iteration.`,
    );
    process.exit(1);
}

/**
 * Require an ALREADY-MINTED token pool whose warm size matches what we are about to seed.
 *
 * Two silent-failure paths close here, and both would have made a WRONG run look green:
 *
 *  1. **Pool/DB size mismatch.** If the pool holds more warm tokens than this step seeds rows for, the
 *     surplus tokens carry `sub`s the database has never seen — so the "warm" hot-path scenario would
 *     read-through-PROVISION them, answer `200`, satisfy every check, and report first-sight write
 *     latency as the steady-state read. Nothing downstream can detect that, so it is detected here.
 *  2. **A missing pool.** `clerk-tokens.json` is gitignored credential material, so CI cannot assume it
 *     exists — it must mint it. Refusing to prepare a database for a pool that is not there makes the
 *     omission a hard failure at the earliest possible point, instead of a k6 `open()` error later or,
 *     worse, a run against a stale pool.
 */
const tokensPath = join(dirname(fileURLToPath(import.meta.url)), 'clerk-tokens.json');

let warmTokenCount: number;

try {
    const pools = JSON.parse(readFileSync(tokensPath, 'utf-8')) as { warm?: unknown };
    warmTokenCount = Array.isArray(pools.warm) ? pools.warm.length : -1;
} catch {
    console.error(
        `prepare-db: no readable token pool at ${tokensPath}. Run \`npm run test:load:tokens\` FIRST ` +
            `(it is gitignored credential material, so it is never present from a checkout).`,
    );
    process.exit(1);
}

if (warmTokenCount !== WARM_POOL_SIZE) {
    console.error(
        `prepare-db: token pool has ${warmTokenCount} warm token(s) but this run seeds ${WARM_POOL_SIZE} ` +
            `warm principal(s). Re-mint with the SAME IDENTITY_WARM_POOL_SIZE ` +
            `(\`IDENTITY_WARM_POOL_SIZE=${WARM_POOL_SIZE} npm run test:load:tokens\`) — a surplus token ` +
            `names an unseeded sub, which the hot-path scenario would silently provision and report as a read.`,
    );
    process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL });

/** Insert one fully-provisioned principal (user + account + profile), idempotently. */
async function seedCompleteUser(identity: SeededIdentity): Promise<void> {
    await pool.query(
        `INSERT INTO users (id, identity_id, email, name, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (id) DO NOTHING`,
        [identity.userId, identity.sub, identity.email, identity.displayName],
    );
    await pool.query(
        `INSERT INTO accounts (user_id, subscription_tier)
         VALUES ($1, 'free')
         ON CONFLICT (user_id) DO NOTHING`,
        [identity.userId],
    );
    await pool.query(
        `INSERT INTO profiles (user_id, display_name)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [identity.userId, identity.displayName],
    );
}

try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');

    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }

    for (let index = 0; index < WARM_POOL_SIZE; index += 1) {
        await seedCompleteUser(warmIdentity(index));
    }

    await seedCompleteUser(adminIdentity());

    if (BULK_USERS > 0) {
        // Set-based: 20k round trips would dominate the prepare step's runtime, so the fragments exported
        // by poolIdentities.ts are composed in SQL rather than calling `bulkIdentity()` per row. Both
        // renderings read the SAME exported fragments, and the assertion below proves they agree instead
        // of trusting the concatenation by eye.
        await pool.query(
            `INSERT INTO users (id, identity_id, email, name, status)
             SELECT $3::text || lpad(i::text, $4::int, '0'),
                    $5::text || i,
                    $6::text || i || '@' || $2::text,
                    $7::text || i,
                    'active'
             FROM generate_series(0, $1::int - 1) AS s(i)
             ON CONFLICT (id) DO NOTHING`,
            [
                BULK_USERS,
                POOL_EMAIL_DOMAIN,
                BULK_ULID_PREFIX,
                BULK_INDEX_PAD,
                BULK_SUB_PREFIX,
                BULK_EMAIL_PREFIX,
                BULK_NAME_PREFIX,
            ],
        );

        // Fail LOUD if the SQL rendering ever stops matching the JS builder: a silent mismatch would make
        // the admin scenario filter for a needle no row contains, turning a table scan into a zero-row
        // probe and quietly reporting a green p95 for a query that never ran.
        const expected = bulkIdentity(0);
        const probe = await pool.query<{ identity_id: string; email: string; name: string }>(
            'SELECT identity_id, email, name FROM users WHERE id = $1',
            [expected.userId],
        );
        const actual = probe.rows[0];

        if (
            actual === undefined ||
            actual.identity_id !== expected.sub ||
            actual.email !== expected.email ||
            actual.name !== expected.displayName
        ) {
            throw new Error(
                `prepare-db: bulk seed shape does not match bulkIdentity(0) — expected ` +
                    `${JSON.stringify(expected)}, got ${JSON.stringify(actual ?? null)}`,
            );
        }

        // The planner's choice for the admin `ilike` predicate depends on table statistics, and a
        // freshly-bulk-loaded table has none — leaving the scenario measuring a plan the deployed service
        // would never choose. ANALYZE makes the measured plan the honest one.
        await pool.query('ANALYZE users');
    }

    const total = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM users');

    console.log(
        `prepare-db: applied ${files.length} migrations; seeded ${WARM_POOL_SIZE} warm + 1 admin ` +
            `(scope '${ADMIN_SCOPE}') + ${BULK_USERS} bulk users; users total = ${total.rows[0]?.total}; ` +
            `warm display-name prefix = '${POOL_NAME_NEEDLE}'.`,
    );
} finally {
    await pool.end();
}
