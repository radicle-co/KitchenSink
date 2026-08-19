import { defineConfig } from 'vitest/config';

/**
 * Integration tier: drives the REAL `POST /api/v1/recipes` and the REAL ingredient-resolution endpoints
 * of a booted recipe service (which itself calls a booted food service).
 *
 * It is its own tier because it is the only one that can prove the thing the importer exists to prove —
 * that a recipe parsed out of 1900s prose is ACCEPTED by the shipped contract and that its ingredient
 * names go through the product's own catalog lookup. A mocked test would assert the importer's beliefs
 * about the API rather than the API.
 *
 * Skipped (not failed) when `COOKBOOK_IMPORT_RECIPE_URL` is unset, mirroring how the recipe service's own
 * DB-backed tiers guard on `DATABASE_URL`.
 */
export default defineConfig({
    test: {
        include: ['tests/**/*.integration.test.ts'],
        fileParallelism: false,
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
});
