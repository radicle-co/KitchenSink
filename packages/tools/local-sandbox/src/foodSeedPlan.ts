/**
 * @module foodSeedPlan — what a local run must do about the food catalog.
 *
 * ⛔ `local:up` applies migrations and stops; it never seeds. A fresh sandbox therefore has an EMPTY food
 * catalog by construction, and nothing said so. Measured cost of that silence: 348 recipes imported, 1,832
 * ingredient lines submitted, `catalog_suggestion 0.0%`, zero lines carrying a real `food_id` — and the
 * import reported SUCCESS throughout, because the recipe service degrades to
 * `catalogAvailability: 'unavailable'` rather than failing a write. An empty catalog is indistinguishable,
 * from every downstream signal, from a catalog that simply has no match.
 *
 * ⚠️ Seeding is once per VOLUME, not once per run. `local:down` omits `-v`, so the postgres volume and the
 * seeded foods survive a restart; re-seeding on every `local:up` would be minutes of work to reach a state
 * that was already true.
 *
 * ⛔ The DOWNLOAD is never smuggled in here. `food-service/src/foods/seed/README.md` makes fetching an
 * operator step deliberately — "so a re-run never re-downloads hundreds of MB, and so the importer is
 * trivially testable and offline-safe". This planner may report that a fetch is needed; running one is the
 * operator's call, through `local:seed-food`.
 */

/** The USDA SR Legacy dataset's food count — the frozen 2018-04 release, never re-issued. */
export const SR_LEGACY_FOOD_COUNT = 7793;

/** What a local run should do about the catalog. */
export type FoodSeedPlan =
    | { readonly kind: 'up-to-date'; readonly foodRows: number }
    | { readonly kind: 'seed' }
    | { readonly kind: 'fetch-then-seed' };

/** What the planner needs to know, gathered by the caller. */
export interface FoodSeedFacts {
    /** Rows in the food catalog's `food` table. */
    readonly foodRows: number;
    /** Whether an extracted dataset directory is already on disk. */
    readonly datasetPresent: boolean;
}

/**
 * Decide what the catalog needs.
 *
 * ⚠️ A PARTIAL catalog is not "seeded". The bulk seeder is resumable and idempotent — an unchanged food is
 * skipped without a write — so the safe answer to "fewer rows than expected" is to run it again rather than
 * to assume the last run finished. A run killed part-way is exactly the case that would otherwise leave a
 * catalog looking populated and silently incomplete.
 *
 * ⚠️ MORE rows than expected is complete, not suspicious: Foundation and the full FDC download both add
 * foods on top of SR Legacy.
 *
 * @param facts - The row count and whether a dataset is downloaded.
 * @returns The plan. Pure.
 */
export function planFoodSeed(facts: FoodSeedFacts): FoodSeedPlan {
    if (facts.foodRows >= SR_LEGACY_FOOD_COUNT) {
        return { kind: 'up-to-date', foodRows: facts.foodRows };
    }

    if (facts.datasetPresent) {
        return { kind: 'seed' };
    }

    return { kind: 'fetch-then-seed' };
}
