/**
 * e2e proof of the WRITE → PUBLIC-READ round trip: a recipe created through `POST /api/v1/recipes` by one
 * user is discoverable by ANOTHER user through `GET /api/v1/search/recipes`.
 *
 * **Why this file exists.** Both halves were already covered, and the JOINT was not.
 * `__tests__/integration/recipes/crud.integration.test.ts` proves create → the OWNER's own library list;
 * `search.e2e.test.ts` and `__tests__/integration/search/search.integration.test.ts` prove the search read —
 * but both seed their corpus with raw `INSERT` SQL, which hands the read path a row the WRITE path never
 * produced. Any divergence between what create persists and what search selects on therefore ships green:
 * the create path is the only thing that populates `ingredient_names_text` (`buildIngredientNamesText`, from
 * the RESOLVED catalog names — never the client's DTO `name`), the `search_vector` trigger is the only thing
 * that weights it, and a raw INSERT that sets the column itself proves neither.
 *
 * So this suite writes ONLY through the API and reads ONLY through the API, and it reads as a DIFFERENT
 * principal — because "my own recipe is in my own results" is satisfied by the owner branch of the visibility
 * predicate and would pass even if `public` discovery were broken outright. The seeker owns nothing here.
 *
 * The scoping is asserted as a PAIR, since either half alone is satisfied by more than one bug: public +
 * published is FOUND by the seeker, and public + `draft` is ABSENT from the seeker while still PRESENT in its
 * author's own results (W8-a.3) — the second half is what distinguishes "correctly scoped away" from "the
 * create path indexed nothing at all". The ingredient the recipes are created with is a freshly created
 * FREEFORM catalog row carrying a token unique to this file, so the "found by ingredient name" assertion
 * cannot be satisfied by the shared seed catalog or by another spec's rows.
 *
 * ⚠️ A `private` recipe is deliberately NOT part of this round trip, and the reason is itself a finding worth
 * recording: C-004 forbids a FREE-tier caller from creating a `user_created` recipe as private at all (the
 * dev-bypass Principal carries no `premium` permission, so `POST` answers `400 INVALID_VISIBILITY` — proven by
 * `__tests__/integration/recipes/cloneVisibility.integration.test.ts`). Every private recipe in this service's
 * test corpus therefore exists ONLY because a fixture wrote one straight into Postgres, past the policy the
 * API enforces — the same write-path/read-path divergence this file exists to close, in a shape no
 * API-only spec can reach. Private-visibility SCOPING stays covered by the raw-seeded search suites.
 *
 * The app is booted as AUTHOR; the seeker's reads run under {@link asPrincipal}. Skips without a database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { asPrincipal, bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const AUTHOR = '01JDISCE2E00000AUTHOR0000A';
/** A second user who owns NOTHING — so every hit they get is a PUBLIC-discovery hit, never an owner hit. */
const SEEKER = '01JDISCE2E00000SEEKER0000B';

/** FTS tokens unique to this file, so `query=` can never be satisfied by the seed or by a sibling spec. */
const PUBLIC_TOKEN = 'zzdiscoverpublicfixture';
const DRAFT_TOKEN = 'zzdiscoverdraftfixture';
/** The freeform ingredient's name — indexed at weight C via `ingredient_names_text`, by the CREATE path. */
const INGREDIENT_TOKEN = 'zzdiscoveringredientfixture';

interface RecipeBody {
    id: string;
    ownerId: string;
    title: string;
    visibility: string;
    status: string;
}

interface IngredientBody {
    id: string;
    name: string;
}

interface SearchBody {
    results: { recipe: { id: string; title: string } }[];
    total: number;
}

describe.skipIf(!hasDatabaseUrl)('create → public discovery (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;
    let ingredientId: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: AUTHOR });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

        // A freeform catalog ingredient created through the API — the id the recipe lines below reference.
        const created = await fetch(`${booted.baseUrl}/api/v1/ingredients`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: INGREDIENT_TOKEN }),
        });
        expect(created.status).toBe(201);
        ingredientId = ((await created.json()) as IngredientBody).id;
    });

    afterAll(async () => {
        await pool.query('DELETE FROM recipes WHERE owner_id = ANY($1)', [[AUTHOR, SEEKER]]);
        await pool.query('DELETE FROM ingredients WHERE name = $1', [INGREDIENT_TOKEN]);
        await pool.end();
        await booted?.close();
    });

    /** Create a recipe THROUGH THE API as AUTHOR and return the created body. */
    async function createRecipe(title: string, visibility: 'public' | 'private', status: 'draft' | 'published') {
        const res = await fetch(`${booted.baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                title,
                description: 'Created through the API by the discovery round-trip spec.',
                visibility,
                status,
                servings: 2,
                prepTimeMinutes: 5,
                cookTimeMinutes: 10,
                totalTimeMinutes: 15,
                ingredients: [
                    { ingredientId, name: INGREDIENT_TOKEN, quantity: { kind: 'exact', value: 1 }, unit: 'cup' },
                ],
                steps: [{ instruction: 'Cook it.' }],
            }),
        });
        expect(res.status).toBe(201);

        return (await res.json()) as RecipeBody;
    }

    /** Search as `userId` — a full-text query, one page. */
    async function searchAs(userId: string, query: string): Promise<SearchBody> {
        return asPrincipal(userId, async () => {
            const res = await fetch(
                `${booted.baseUrl}/api/v1/search/recipes?query=${encodeURIComponent(query)}&pageSize=50`,
            );
            expect(res.status).toBe(200);

            return (await res.json()) as SearchBody;
        });
    }

    it('a PUBLIC recipe created through the API is discoverable by ANOTHER user in the public search', async () => {
        const created = await createRecipe(`${PUBLIC_TOKEN} skillet supper`, 'public', 'published');
        expect(created.ownerId).toBe(AUTHOR);
        expect(created.visibility).toBe('public');
        expect(created.status).toBe('published');

        const found = await searchAs(SEEKER, PUBLIC_TOKEN);

        expect(found.total).toBe(1);
        expect(found.results.map((hit) => hit.recipe.id)).toEqual([created.id]);
        // The projection carries the WRITTEN title through to the read model, not a placeholder.
        expect(found.results[0]?.recipe.title).toBe(`${PUBLIC_TOKEN} skillet supper`);
    });

    it('the created recipe is findable by its INGREDIENT name — the denormalized column only the write path fills', async () => {
        // `ingredient_names_text` is written by `RecipesService.create` from the RESOLVED catalog name and
        // indexed at weight C by the `search_vector` trigger. A corpus seeded with raw INSERTs sets that
        // column by hand, so it can never prove the create path fills it. This can.
        const found = await searchAs(SEEKER, INGREDIENT_TOKEN);

        expect(found.results.map((hit) => hit.recipe.title)).toContain(`${PUBLIC_TOKEN} skillet supper`);
    });

    it('the visibility SCOPING is real, not a no-op: a PUBLIC DRAFT created through the API is ABSENT from another user’s search, and PRESENT in its author’s (W8-a.3)', async () => {
        const created = await createRecipe(`${DRAFT_TOKEN} unfinished supper`, 'public', 'draft');
        expect(created.status).toBe('draft');

        const seeker = await searchAs(SEEKER, DRAFT_TOKEN);
        expect(seeker.total).toBe(0);
        expect(seeker.results).toEqual([]);

        // The negative above is only meaningful if the row is genuinely INDEXED and merely scoped away —
        // otherwise a create that indexed nothing at all would satisfy it just as well. The author's own
        // search is what separates those two, and it is why this pair is asserted together.
        const author = await searchAs(AUTHOR, DRAFT_TOKEN);
        expect(author.results.map((hit) => hit.recipe.id)).toEqual([created.id]);
    });
});
