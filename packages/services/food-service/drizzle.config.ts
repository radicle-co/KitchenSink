import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration for the `kitchensink_food` logical database (feature 003).
 *
 * The SOURCE OF TRUTH the migration runner applies is the hand-authored ordered SQL under
 * `src/db/migrations/` (repo convention — mirrors the identity service). drizzle-kit's journaled
 * `meta/` is intentionally NOT kept: this repo's in-VPC runner (FU-MIGRATE) reads ordered `.sql`,
 * not drizzle-kit's journal, and DDL drizzle-kit cannot express (the `CREATE EXTENSION pg_trgm` and
 * the composite same-food provenance FKs) lives in that SQL.
 *
 * `db:generate` is therefore only a HAND-AUTHORING AID: it emits the current schema's DDL into a
 * gitignored scratch dir (`.drizzle-scratch/`) so the engineer can diff it against the
 * hand-authored migration when the Drizzle schema under `src/db/schema/` changes, then fold any
 * delta in by hand. It must NOT write into `src/db/migrations/` (that would collide with the
 * ordered SQL). `DATABASE_URL` is only consulted for push/introspect flows, not for `generate`.
 */
export default defineConfig({
    dialect: 'postgresql',
    // Point at the table-definition modules directly (food.ts canonical core + enums, operational.ts
    // queue/limiter, foodCandidates.ts). The barrel (`index.ts`) re-exports with the project-standard
    // `.js` extension, which drizzle-kit's CJS schema loader cannot resolve, so the barrel itself is
    // NOT the target; listing the definition modules avoids that resolution mismatch and covers all
    // 13 tables + 5 enums.
    schema: ['./src/db/schema/food.ts', './src/db/schema/operational.ts', './src/db/schema/foodCandidates.ts'],
    out: './.drizzle-scratch',
    dbCredentials: {
        url: process.env['DATABASE_URL'] ?? 'postgresql://food_app:postgres@localhost:5432/kitchensink_food',
    },
});
