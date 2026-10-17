/**
 * Standalone DB preparation for the k6 load suite (used by the CI `load-test` job and local validation).
 *
 * Applies the ordered `src/database/migrations/*.sql` files against `DATABASE_URL`. It seeds no ingredients: the
 * write scenarios resolve theirs through the API in `setup()` (`lib/common.js` `resolveSeedIngredients`), so they
 * behave the same on a local database and a deployed stage. Idempotent: drops/recreates `public` and re-applies
 * migrations.
 *
 * Usage: `DATABASE_URL=postgres://... node tests/load/prepareDb.mjs`
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

const pool = new pg.Pool({ connectionString: DATABASE_URL });

try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');

    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }

    console.log(`prepare-db: applied ${files.length} migrations.`);
} finally {
    await pool.end();
}
