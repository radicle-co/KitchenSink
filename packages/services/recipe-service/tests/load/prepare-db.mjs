/**
 * Standalone DB preparation for the k6 load suite (used by the CI `load-test` job and local validation).
 *
 * Applies the ordered `src/database/migrations/*.sql` files against `DATABASE_URL` and seeds the baseline
 * catalog ingredients the load payloads reference (must match `tests/globalSetup.ts` SEED_INGREDIENTS
 * and `tests/load/lib/common.js` SEED_INGREDIENT_*). Since T043b, recipe create validates each line's
 * `ingredientId` against the catalog, so these rows MUST exist or every create 400s and trips the k6
 * failure-rate threshold. Idempotent: drops/recreates `public`, re-applies migrations, upserts seeds.
 *
 * Usage: `DATABASE_URL=postgres://... node tests/load/prepare-db.mjs`
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
    console.error('prepare-db: DATABASE_URL is required.');
    process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations');

/** The baseline catalog ingredients the load payloads attach by id. */
const SEED_INGREDIENTS = [
    { id: '00000000-0000-4000-8000-0000000000aa', name: 'Flour' },
    { id: '00000000-0000-4000-8000-0000000000bb', name: 'Sugar' },
    { id: '00000000-0000-4000-8000-0000000000cc', name: 'Butter' },
];

const pool = new pg.Pool({ connectionString: DATABASE_URL });

try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');

    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }

    for (const ingredient of SEED_INGREDIENTS) {
        await pool.query(
            `INSERT INTO ingredients (id, name, is_user_entered, search_vector)
             VALUES ($1, $2, true, to_tsvector('english', $2))
             ON CONFLICT (id) DO NOTHING`,
            [ingredient.id, ingredient.name],
        );
    }

    console.log(`prepare-db: applied ${files.length} migrations + ${SEED_INGREDIENTS.length} seed ingredients.`);
} finally {
    await pool.end();
}
