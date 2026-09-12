/**
 * Repo-wide guard: what a local run must do about the FOOD CATALOG, decided before anything is downloaded.
 *
 * ⛔ WHY THIS EXISTS. `local:up` applies migrations and stops — it never seeds. So a fresh sandbox has an
 * empty food catalog by construction, and NOTHING said so. The cost of that silence, measured:
 *
 *   - 348 recipes imported, 1,832 ingredient lines submitted.
 *   - `catalog_suggestion 0.0%`, lines carrying a real `food_id`: 0.
 *   - The import reported SUCCESS, because the recipe service degrades to
 *     `catalogAvailability: 'unavailable'` rather than failing a write.
 *
 * An empty catalog is indistinguishable, from every downstream signal, from a catalog that simply has no
 * match. The point of this module is that the difference is stated up front.
 *
 * ⚠️ The seeded data is DURABLE — `local:down` omits `-v`, so the postgres volume and the ~7,793 seeded
 * foods survive a restart. Seeding is a once-per-volume operation, not a per-run one, and the planner says
 * so rather than re-seeding blindly.
 *
 * ⛔ The DOWNLOAD stays a separate, explicit step. `food-service/src/foods/seed/README.md` makes fetching an
 * operator concern deliberately, "so a re-run never re-downloads hundreds of MB, and so the importer is
 * trivially testable and offline-safe". This planner may report that a fetch is NEEDED; it never smuggles
 * one into `local:up`.
 */
import { describe, expect, it } from 'vitest';

import { planFoodSeed } from '../foodSeedPlan.js';

describe('planFoodSeed', () => {
    it('reports a seeded catalog as up to date, and does not propose re-seeding', () => {
        expect(planFoodSeed({ foodRows: 7793, datasetPresent: true })).toStrictEqual({
            kind: 'up-to-date',
            foodRows: 7793,
        });
    });

    it('is up to date even when the dataset directory is gone — the DATA is what matters', () => {
        // ⚠️ The CSVs are an input to a one-time load, not a runtime dependency. A machine that seeded and
        // then deleted the download is correctly configured.
        expect(planFoodSeed({ foodRows: 7793, datasetPresent: false })).toStrictEqual({
            kind: 'up-to-date',
            foodRows: 7793,
        });
    });

    it('proposes seeding when the catalog is empty and the dataset is already downloaded', () => {
        expect(planFoodSeed({ foodRows: 0, datasetPresent: true })).toStrictEqual({ kind: 'seed' });
    });

    it('proposes a FETCH when the catalog is empty and nothing has been downloaded', () => {
        expect(planFoodSeed({ foodRows: 0, datasetPresent: false })).toStrictEqual({ kind: 'fetch-then-seed' });
    });

    /**
     * ⛔ A PARTIAL catalog is not "seeded". The bulk seeder is resumable and idempotent by design — an
     * unchanged food is skipped without a write — so the safe answer to "some rows, fewer than expected" is
     * to run it again, not to assume the last run finished. A run killed part-way through is exactly the
     * case that would otherwise leave a catalog that looks populated and silently is not.
     */
    it('treats a partially loaded catalog as needing another pass', () => {
        expect(planFoodSeed({ foodRows: 400, datasetPresent: true })).toStrictEqual({ kind: 'seed' });
    });

    it('treats a catalog at the expected size as complete', () => {
        expect(planFoodSeed({ foodRows: 7793, datasetPresent: true }).kind).toBe('up-to-date');
    });

    it('treats a catalog LARGER than expected as complete — another dataset may have been added', () => {
        // Foundation and the full FDC download both add foods on top of SR Legacy. More than expected is
        // never a reason to re-run.
        expect(planFoodSeed({ foodRows: 12000, datasetPresent: true }).kind).toBe('up-to-date');
    });

    it('never proposes a fetch when the dataset is present, whatever the row count', () => {
        for (const foodRows of [0, 1, 400, 7792]) {
            expect(planFoodSeed({ foodRows, datasetPresent: true }).kind).toBe('seed');
        }
    });
});
