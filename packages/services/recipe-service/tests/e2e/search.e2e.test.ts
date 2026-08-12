/**
 * W8-a.1 / W8-a.3 / W8-a.9 — e2e proof of the search read surface through the fully ASSEMBLED recipe app
 * (`GET /api/v1/search/recipes`) against the real Postgres harness. Pins the client-visible HTTP contract for
 * the three shipped search changes at the DB level, where the unit tests can only assert SQL shape:
 *
 *   - **Draft exclusion (W8-a.3, security):** a `visibility=public, status=draft` recipe owned by someone
 *     else is ABSENT from a viewer's results and from the facet sample — the leak the status predicate closes.
 *   - **Facet dimensions (W8-a.9):** the response carries `cuisine` counts and mutually-exclusive
 *     `totalTime` buckets over the (draft-excluded) match sample.
 *   - **Sorts (W8-a.9) + calories (W8-a.1):** `sortBy=quickest` orders by ascending total time, and each
 *     hit's `recipe.leadCaloriesPerServing` is surfaced from the denormalized column.
 *
 * The booted app authenticates as VIEWER (dev bypass). Recipes are seeded via a direct pg pool (so drafts
 * and other owners' rows exist), each carrying a unique FTS token so `query=` scopes the sample to this
 * spec's rows. Skips when no test database is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { ApiErrorBody } from '@kitchensink/schema-recipe';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const VIEWER = '01JSEARCHE2E000VIEWER0000A';
const OTHER_OWNER = '01JSEARCHE2E0000OWNER0000B';
/** A token present in every seeded title but (deliberately) in no other recipe, so `query=` scopes to us. */
const TOKEN = 'zzsearchfixture';
/** A separate token for the REQ-030f cook-time rows, isolated from the `TOKEN` total-count assertions. */
const COOK_TOKEN = 'zzcooktimefixture';

interface SeededRecipe {
    readonly ownerId: string;
    readonly status: 'draft' | 'published';
    readonly cuisine: string;
    readonly totalTime: number;
    readonly calories: number | null;
    readonly title: string;
}

interface CookTimeSeededRecipe {
    readonly title: string;
    readonly cookTime: number;
}

interface SearchHit {
    recipe: { id: string; title: string; leadCaloriesPerServing?: number };
}

interface FacetBucket {
    value: string;
    count: number;
}

interface SearchBody {
    results: SearchHit[];
    facets: { cuisine: FacetBucket[]; totalTime: FacetBucket[] };
    total: number;
}

describe.skipIf(!hasDatabaseUrl)('search read surface (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: VIEWER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

        const rows: SeededRecipe[] = [
            {
                ownerId: OTHER_OWNER,
                status: 'published',
                cuisine: 'italian',
                totalTime: 20,
                calories: 300,
                title: `${TOKEN} quick italian`,
            },
            {
                ownerId: OTHER_OWNER,
                status: 'published',
                cuisine: 'thai',
                totalTime: 75,
                calories: null,
                title: `${TOKEN} slow thai`,
            },
            // A PUBLIC DRAFT owned by someone else — must never surface to the viewer (W8-a.3).
            {
                ownerId: OTHER_OWNER,
                status: 'draft',
                cuisine: 'italian',
                totalTime: 10,
                calories: 999,
                title: `${TOKEN} secret draft`,
            },
        ];

        for (const r of rows) {
            await pool.query(
                `INSERT INTO recipes
                   (owner_id, title, visibility, status, cuisine, servings,
                    prep_time_minutes, cook_time_minutes, total_time_minutes, lead_calories_per_serving)
                 VALUES ($1, $2, 'public', $3, $4, 2, 5, 10, $5, $6)`,
                [r.ownerId, r.title, r.status, r.cuisine, r.totalTime, r.calories],
            );
        }

        // REQ-030f — two published public rows with distinct cook times, isolated by COOK_TOKEN.
        const cookRows: CookTimeSeededRecipe[] = [
            { title: `${COOK_TOKEN} quick sear`, cookTime: 30 },
            { title: `${COOK_TOKEN} slow braise`, cookTime: 60 },
        ];

        for (const r of cookRows) {
            await pool.query(
                `INSERT INTO recipes
                   (owner_id, title, visibility, status, cuisine, servings,
                    prep_time_minutes, cook_time_minutes, total_time_minutes)
                 VALUES ($1, $2, 'public', 'published', 'italian', 2, 5, $3, $3)`,
                [OTHER_OWNER, r.title, r.cookTime],
            );
        }
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[OTHER_OWNER, VIEWER]]);
        await pool.end();
        await booted?.close();
    });

    async function search(params: Record<string, string>): Promise<SearchBody> {
        const qs = new URLSearchParams({ query: TOKEN, ...params }).toString();
        const res = await fetch(`${booted.baseUrl}/api/v1/search/recipes?${qs}`);
        expect(res.status).toBe(200);
        return (await res.json()) as SearchBody;
    }

    /** The raw response for an arbitrary query string — used by the rejection cases, which are not `200`. */
    async function rawSearch(qs: string): Promise<{ status: number; body: ApiErrorBody }> {
        const res = await fetch(`${booted.baseUrl}/api/v1/search/recipes?${qs}`);

        return { status: res.status, body: (await res.json()) as ApiErrorBody };
    }

    /**
     * The rendered `details.fields` of an error body, ASSERTED present rather than assumed.
     *
     * Reading `body.details?.['fields']` and casting would throw a `TypeError` out of the assertion when the
     * envelope carries no `details` — a crash instead of a failure, which hides WHICH property was missing. The
     * published contract promises `details.fields` for `VALIDATION_FAILED`, so its absence is exactly what these
     * cases must report clearly.
     */
    function fieldsOf(body: ApiErrorBody): readonly string[] {
        const fields = body.details?.['fields'];

        expect(Array.isArray(fields), `expected details.fields on ${JSON.stringify(body)}`).toBe(true);

        return fields as readonly string[];
    }

    it("excludes another owner's public DRAFT from results and total (W8-a.3 leak closed)", async () => {
        const body = await search({});

        expect(body.total).toBe(2); // the two published rows only — the draft is invisible
        const titles = body.results.map((h) => h.recipe.title);
        expect(titles).not.toContain(`${TOKEN} secret draft`);
    });

    it('surfaces cuisine + total-time facets over the draft-excluded sample (W8-a.9)', async () => {
        const body = await search({});

        // italian would be 2 if the draft leaked; it is 1 because the draft is excluded from the sample.
        expect(body.facets.cuisine).toContainEqual({ value: 'italian', count: 1 });
        expect(body.facets.cuisine).toContainEqual({ value: 'thai', count: 1 });
        // total_time buckets: 20 → '16-30', 75 → '61+' (the draft's 10 → '0-15' must be absent).
        expect(body.facets.totalTime).toContainEqual({ value: '16-30', count: 1 });
        expect(body.facets.totalTime).toContainEqual({ value: '61+', count: 1 });
        expect(body.facets.totalTime.find((b) => b.value === '0-15')).toBeUndefined();
    });

    it('orders by ascending total time for sortBy=quickest and surfaces denormalized calories (W8-a.9/.1)', async () => {
        const body = await search({ sortBy: 'quickest' });

        expect(body.results.map((h) => h.recipe.title)).toEqual([`${TOKEN} quick italian`, `${TOKEN} slow thai`]);
        // The 20-min italian carries its denormalized headline calories; the thai row seeded NULL → omitted.
        expect(body.results[0]!.recipe.leadCaloriesPerServing).toBe(300);
        expect(body.results[1]!.recipe.leadCaloriesPerServing).toBeUndefined();
    });

    it('filters by maxCookTime (REQ-030f): a 60-min cook time is excluded at max=30, a 30-min one is included', async () => {
        const bounded = await search({ query: COOK_TOKEN, maxCookTime: '30' });

        expect(bounded.total).toBe(1);
        const boundedTitles = bounded.results.map((h) => h.recipe.title);
        expect(boundedTitles).toContain(`${COOK_TOKEN} quick sear`);
        expect(boundedTitles).not.toContain(`${COOK_TOKEN} slow braise`);

        // Raising the bound to exactly the slow row's cook time includes both (inclusive upper bound).
        const wide = await search({ query: COOK_TOKEN, maxCookTime: '60' });
        expect(wide.total).toBe(2);
    });

    /*
     * ── THE REJECTION PATH, WHICH THIS SUITE DID NOT ASSERT AT ALL ──
     *
     * Every case above is a `200`, so the route's `400` was untested end-to-end — and it was WRONG. Until the
     * query contract was authored as zod, this was the last `class-validator` route in `packages/services/**`:
     * `class-validator` reports its constraints on `message[]`, not on the `errors` key `ApiExceptionFilter` maps
     * to `VALIDATION_FAILED`, so the rejection fell through to `codeForStatus(400)` and published `BAD_REQUEST` —
     * a code deliberately ABSENT from `recipeErrorCodeSchema`, which the typed client's union therefore rejects,
     * degrading it to status-mapping. Meanwhile the published document promised `VALIDATION_FAILED` with
     * `details.fields`. One endpoint of forty-one answered in a different dialect, and nothing could see it.
     *
     * These cases assert the CODE and the FIELD NAME through the assembled app, which is the only tier where the
     * pipe, the filter and the published contract all participate.
     */
    it('rejects an out-of-range page size as VALIDATION_FAILED, naming the field', async () => {
        const { status, body } = await rawSearch('pageSize=999');

        expect(status).toBe(400);
        expect(body.code).toBe('VALIDATION_FAILED');
        expect(fieldsOf(body).join(' ')).toContain('pageSize');
    });

    it('rejects a non-integer time filter as VALIDATION_FAILED rather than truncating it', async () => {
        const { status, body } = await rawSearch('maxCookTime=12.5');

        expect(status).toBe(400);
        expect(body.code).toBe('VALIDATION_FAILED');
        expect(fieldsOf(body).join(' ')).toContain('maxCookTime');
    });

    // The int4 case: a filter WRITES nothing, but it becomes `WHERE <int4 column> <= $1`, and an out-of-range
    // parameter fails that comparison with Postgres `22003` — which the filter collapses to a generic 500. So the
    // boundary must reject it, and this asserts it is a 400 against the REAL database rather than a mock.
    it('rejects a filter no int4 column can hold as a 400, not a 500 from Postgres', async () => {
        const { status, body } = await rawSearch('maxTotalTime=2147483648');

        expect(status).toBe(400);
        expect(body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an unknown sort key instead of silently falling back to relevance', async () => {
        const { status, body } = await rawSearch('sortBy=cheapest');

        expect(status).toBe(400);
        expect(body.code).toBe('VALIDATION_FAILED');
    });

    /*
     * The forward-compatibility exemption, proven end-to-end: an unrecognized query parameter must NOT fail the
     * search. GR-017 §17-c's `strictObject` default is deliberately waived for read queries, and the concrete
     * case is a pasted tracking tag — which must not stop a caller listing recipes.
     */
    it('ignores an unrecognized query parameter rather than rejecting the search', async () => {
        const body = await search({ utm_source: 'newsletter' });

        expect(body.total).toBeGreaterThan(0);
    });

    /*
     * `?maxPrepTime=` — what a UI serializes for a cleared numeric input. Under the previous DTO this coerced to
     * `Number('') === 0` and passed `@Min(0)`, so the request silently meant "at most zero minutes" and returned
     * NOTHING: a wrong answer, served as a 200, from a parameter the caller believed they had left blank.
     */
    it('treats a blank filter as absent, not as zero, so a cleared input does not empty the results', async () => {
        const blank = await search({ maxPrepTime: '' });

        expect(blank.total).toBe(2);
    });
});
