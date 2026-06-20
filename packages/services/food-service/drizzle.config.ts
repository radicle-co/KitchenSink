import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration for the `kitchensink_food` logical database (feature 003).
 *
 * `generate` emits SQL migrations from `src/db/schema` into `src/db/migrations`; they are applied
 * against `kitchensink_food` on the shared `kitchensink-data-{stage}` instance by the migration
 * runner. `DATABASE_URL` is only consulted for push/introspect flows, not for `generate`.
 */
export default defineConfig({
    dialect: 'postgresql',
    // Point at the table-definition module directly. The barrel (`index.ts`) re-exports with the
    // project-standard `.js` extension, which drizzle-kit's CJS schema loader cannot resolve; the
    // definitions all live in this single file, so targeting it avoids that resolution mismatch.
    schema: './src/db/schema/usda.ts',
    out: './src/db/migrations',
    dbCredentials: {
        url: process.env['DATABASE_URL'] ?? 'postgresql://food_app:postgres@localhost:5432/kitchensink_food',
    },
});
