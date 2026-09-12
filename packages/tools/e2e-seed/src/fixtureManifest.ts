/**
 * THE SEEDED WORLD FOR ONE DEPLOYED RUN — derived from the run key, created through the product's own APIs.
 *
 * ## Why this is not `recipe-service`'s `seed.ts`
 *
 * `seed.ts` is a SCHEMA-level fixture and says so: it is "the ONE authoritative definition of the seeded
 * world" *for `tests/globalSetup.ts` and the recipe-service's own specs*. It writes rows an HTTP caller
 * cannot produce — two owners, fixed UUIDs, an ingredient line with `unit: ''` ("the one shape the wire
 * INPUT schema would reject, so seeding it keeps the read path honest"), and a hand-maintained
 * `ingredient_names_text` mirroring a trigger's input. It also cannot be imported: `recipe-service` declares
 * no `exports`, deliberately, so nothing outside it may reach in.
 *
 * This module is a DIFFERENT thing with the same shape: the world a deployed run creates for itself, over
 * HTTP, as identities it owns and deletes. Its reason to change is what the Maestro flows assert and what
 * the API permits — not the recipe database's schema.
 *
 * ⚠️ The two agree TODAY on every scalar the flows read, because the flows were written against `seed.ts`
 * and cite it by name (`serving-scale.yaml` asserts 2 servings and 10/10/20 minutes "per
 * packages/services/recipe-service/src/database/seed.ts"). That agreement is ASSERTED, by
 * `packages/infra/global/__tests__/maestroFixtureWorld.test.ts`, rather than left to memory — so changing
 * the asparagus's servings in either place is a red test naming the other, and a deliberate divergence is a
 * decision someone records instead of a surprise a flow discovers.
 *
 * ## The two things the API changes about the world
 *
 * ⛔ `unit` is OMITTED where `seed.ts` writes `''`. The read projection turns an empty unit back into an
 * absent one, so the rendered detail is identical — but the write schema rejects the empty string, which is
 * exactly the asymmetry `seed.ts` exists to exercise from the other side.
 *
 * ⛔ Pan-Seared Duck is NOT reproduced. It is seeded to the PRO owner and no flow references it — grepped
 * across the whole `.maestro` corpus, zero hits — so creating it would be a fixture nothing reads.
 */
import { auxiliaryFixtureEmail, signInFixtureEmail } from '@kitchensink/e2e-fixtures';

/**
 * The fixture password. Shared across identities and platforms deliberately: it is not a secret (these
 * accounts exist only on a development Clerk instance, verify with the fixed dev code, and own nothing),
 * and the flows type it literally.
 */
export const FIXTURE_PASSWORD = 'Commise-e2e-Test-9j2xQ!';

/**
 * The ingredient every run creates and NO seeded recipe uses.
 *
 * `recipes/search-navigation.yaml` filters discovery by this name and asserts the feed collapses to "No
 * matching recipes". `seed.ts` records the same invariant about its own pinned trio — "attaching any of the
 * three to a seed recipe turns that flow red" — and it is the one piece of knowledge genuinely shared
 * between the two worlds, so it is stated here ONCE and threaded to the flow rather than restated in YAML.
 */
export const UNATTACHED_PROBE_INGREDIENT = 'Flour';

/** Which identity owns a seeded recipe. */
export type FixtureOwner = 'signer' | 'coAuthor';

/** One ingredient line. `unit` absent is the unitless line ("1 lemon", "8 lamb chops"). */
export interface FixtureIngredientLine {
    readonly name: string;
    readonly quantity: number;
    readonly unit?: string | undefined;
}

/** One step. `timerSeconds` absent is a step with no timer. */
export interface FixtureStep {
    readonly instruction: string;
    readonly timerSeconds?: number | undefined;
}

/** A recipe in the seeded world, before its title is scoped to a run. */
export interface FixtureRecipeDefinition {
    readonly key: FixtureRecipeKey;
    readonly owner: FixtureOwner;
    readonly baseTitle: string;
    readonly description: string;
    readonly visibility: 'public' | 'private';
    readonly servings: number;
    readonly prepTimeMinutes: number;
    readonly cookTimeMinutes: number;
    readonly totalTimeMinutes: number;
    readonly ingredients: readonly FixtureIngredientLine[];
    readonly steps: readonly FixtureStep[];
}

/** The recipes a run seeds, keyed the way the flows refer to them. */
export type FixtureRecipeKey = 'lamb' | 'asparagus' | 'salad' | 'risotto';

/**
 * The world, before run-scoping.
 *
 * ⚠️ OWNERSHIP IS LOAD-BEARING, not an arbitrary split. `risotto` belongs to the co-author because
 * `discover-clone` clones it and then asserts the owner-only "Edit recipe" appears on the COPY, and
 * `rating`'s docblock says it uses a recipe the signer does not own "so the own-recipe gate, Sc8, is NOT
 * engaged". No amount of seeding under one identity produces "a recipe you do not own". The other three are
 * the signer's, which is what makes `search-navigation`'s "3 recipes" true.
 */
export const SEED_WORLD: readonly FixtureRecipeDefinition[] = [
    {
        key: 'lamb',
        owner: 'signer',
        baseTitle: 'Mediterranean Grilled Lamb',
        description: 'Herb-marinated grilled lamb.',
        visibility: 'private',
        servings: 4,
        prepTimeMinutes: 15,
        cookTimeMinutes: 30,
        totalTimeMinutes: 45,
        ingredients: [
            { name: 'Lamb loin chops', quantity: 8, unit: undefined },
            { name: 'Olive oil', quantity: 3, unit: 'tbsp' },
            { name: 'Garlic', quantity: 3, unit: 'clove' },
            { name: 'Fresh oregano', quantity: 2, unit: 'tbsp' },
            { name: 'Lemon', quantity: 1, unit: undefined },
        ],
        steps: [
            {
                instruction:
                    'Whisk the olive oil, crushed garlic, chopped oregano and the juice of the lemon into a marinade.',
                timerSeconds: undefined,
            },
            {
                instruction: 'Coat the chops in the marinade and leave them to stand at room temperature.',
                timerSeconds: 1800,
            },
            {
                instruction:
                    'Grill the chops over high heat, turning once, until charred outside and pink at the bone.',
                timerSeconds: 480,
            },
            { instruction: 'Rest the chops loosely covered before serving.', timerSeconds: 300 },
        ],
    },
    {
        key: 'asparagus',
        owner: 'signer',
        baseTitle: 'Asparagus with Green Sauce',
        description: 'Blanched asparagus, herb sauce.',
        visibility: 'private',
        servings: 2,
        prepTimeMinutes: 10,
        cookTimeMinutes: 10,
        totalTimeMinutes: 20,
        ingredients: [
            { name: 'Asparagus', quantity: 500, unit: 'g' },
            { name: 'Flat-leaf parsley', quantity: 30, unit: 'g' },
            { name: 'Capers', quantity: 1, unit: 'tbsp' },
            { name: 'Olive oil', quantity: 4, unit: 'tbsp' },
            { name: 'Lemon', quantity: 1, unit: undefined },
        ],
        steps: [
            { instruction: 'Snap the woody ends off the asparagus spears and discard them.', timerSeconds: undefined },
            {
                instruction: 'Blanch the spears in salted boiling water, then drop them straight into iced water.',
                timerSeconds: 180,
            },
            {
                instruction: 'Blend the parsley, capers, olive oil and lemon juice into a loose green sauce.',
                timerSeconds: undefined,
            },
            { instruction: 'Drain the spears well and spoon the green sauce over them.', timerSeconds: undefined },
        ],
    },
    {
        key: 'salad',
        owner: 'signer',
        baseTitle: 'Gourmet Garden Salad',
        description: 'Seasonal greens, vinaigrette.',
        visibility: 'public',
        servings: 2,
        prepTimeMinutes: 15,
        cookTimeMinutes: 0,
        totalTimeMinutes: 15,
        ingredients: [
            { name: 'Mixed salad greens', quantity: 150, unit: 'g' },
            { name: 'Cucumber', quantity: 1, unit: undefined },
            { name: 'Red wine vinegar', quantity: 1, unit: 'tbsp' },
            { name: 'Olive oil', quantity: 3, unit: 'tbsp' },
            { name: 'Sea salt', quantity: 1, unit: 'tsp' },
        ],
        steps: [
            {
                instruction: 'Wash and dry the salad greens, then tear them into a wide serving bowl.',
                timerSeconds: undefined,
            },
            {
                instruction: 'Shave the cucumber into ribbons and scatter them over the greens.',
                timerSeconds: undefined,
            },
            {
                instruction:
                    'Whisk the olive oil, red wine vinegar and sea salt into a vinaigrette and dress the salad just before serving.',
                timerSeconds: undefined,
            },
        ],
    },
    {
        key: 'risotto',
        owner: 'coAuthor',
        baseTitle: 'Herb Risotto',
        description: 'Creamy risotto with fresh herbs.',
        visibility: 'public',
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 25,
        totalTimeMinutes: 35,
        ingredients: [
            { name: 'Arborio rice', quantity: 320, unit: 'g' },
            { name: 'Vegetable stock', quantity: 1.2, unit: 'l' },
            { name: 'Parmesan cheese', quantity: 60, unit: 'g' },
            { name: 'Fresh chives', quantity: 2, unit: 'tbsp' },
            { name: 'Olive oil', quantity: 2, unit: 'tbsp' },
        ],
        steps: [
            {
                instruction: 'Bring the vegetable stock to a bare simmer and keep it beside the pan.',
                timerSeconds: undefined,
            },
            {
                instruction: 'Toast the arborio rice in the olive oil until the grains turn translucent at the edges.',
                timerSeconds: 120,
            },
            {
                instruction: 'Add the stock a ladle at a time, stirring, until the rice is creamy and just al dente.',
                timerSeconds: 1080,
            },
            {
                instruction:
                    'Beat in the parmesan and chives off the heat, then let the risotto settle before serving.',
                timerSeconds: 120,
            },
        ],
    },
];

/**
 * The env contract between this package, `run-maestro-flows.sh` and the flow YAML — ONE registry, so the
 * producer and the consumers cannot drift.
 *
 * `packages/infra/global/__tests__/maestroFixtureVariables.test.ts` asserts SET EQUALITY in both
 * directions: every `${E2E_…}` a flow interpolates is a key here, and every key here is referenced by at
 * least one flow. A variable nothing reads is a fixture nothing needs; a variable nothing supplies renders
 * as the literal text `${E2E_RECIPE_LAMB}` on screen and fails a flow for a reason that reads like an app
 * defect.
 */
export const FIXTURE_ENV_KEYS = {
    signInEmail: 'E2E_SIGNIN_EMAIL',
    signInPassword: 'E2E_SIGNIN_PASSWORD',
    erasureEmail: 'E2E_ERASURE_EMAIL',
    probeIngredient: 'E2E_PROBE_INGREDIENT',
    lamb: 'E2E_RECIPE_LAMB',
    asparagus: 'E2E_RECIPE_ASPARAGUS',
    salad: 'E2E_RECIPE_SALAD',
    risotto: 'E2E_RECIPE_RISOTTO',
} as const;

/** A key of {@link FIXTURE_ENV_KEYS}. */
export type FixtureEnvKey = (typeof FIXTURE_ENV_KEYS)[keyof typeof FIXTURE_ENV_KEYS];

/** A recipe with its run-scoped title resolved. */
export interface FixtureRecipe extends FixtureRecipeDefinition {
    /** `<baseTitle> <runKey>` — unique to this run, so no anchored selector can match another run's row. */
    readonly title: string;
}

/** Everything one run's world is. Frozen: a manifest a caller can edit is a manifest that drifts. */
export interface FixtureManifest {
    readonly runKey: string;
    readonly signInEmail: string;
    readonly coAuthorEmail: string;
    readonly erasureEmail: string;
    readonly password: string;
    readonly probeIngredient: string;
    readonly recipes: readonly FixtureRecipe[];
}

/**
 * The run-scoped title of a seeded recipe.
 *
 * ⚠️ The run key goes at the END, not the front. Every flow that matches a title unanchored does so as a
 * SUBSTRING, and several scroll to a row by its leading words — a prefix would break every one of them,
 * while a suffix leaves the base title matchable and still makes the full string unique to this run. Pure.
 */
export function runScopedTitle(baseTitle: string, runKey: string): string {
    return `${baseTitle} ${runKey}`;
}

/**
 * Derive this run's world. Pure and deterministic: the same run key produces a byte-identical manifest in
 * `provision`, in each of the ~35 `reset` processes, and in `teardown`, which is what lets three separate
 * commands agree on what the world should be without passing it between them.
 */
export function deriveFixtureManifest(runKey: string): FixtureManifest {
    return Object.freeze({
        runKey,
        signInEmail: signInFixtureEmail(runKey),
        coAuthorEmail: auxiliaryFixtureEmail(runKey, 'author'),
        erasureEmail: auxiliaryFixtureEmail(runKey, 'erasure'),
        password: FIXTURE_PASSWORD,
        probeIngredient: UNATTACHED_PROBE_INGREDIENT,
        recipes: Object.freeze(
            SEED_WORLD.map((definition) =>
                Object.freeze({ ...definition, title: runScopedTitle(definition.baseTitle, runKey) }),
            ),
        ),
    });
}

/**
 * The manifest as `KEY=VALUE` lines — the same stdout contract `provisionSignInFixture` established, reused
 * rather than replaced by a JSON one, so a shell reads it with `IFS='=' read` and nothing parses prose.
 *
 * Pure, and the ONLY place a manifest becomes environment: a second formatter would be a second answer to
 * "what does the flow see".
 */
export function manifestToEnvLines(manifest: FixtureManifest): readonly string[] {
    const byKey = new Map(manifest.recipes.map((recipe) => [recipe.key, recipe.title]));

    return [
        `${FIXTURE_ENV_KEYS.signInEmail}=${manifest.signInEmail}`,
        `${FIXTURE_ENV_KEYS.signInPassword}=${manifest.password}`,
        `${FIXTURE_ENV_KEYS.erasureEmail}=${manifest.erasureEmail}`,
        `${FIXTURE_ENV_KEYS.probeIngredient}=${manifest.probeIngredient}`,
        `${FIXTURE_ENV_KEYS.lamb}=${byKey.get('lamb') ?? ''}`,
        `${FIXTURE_ENV_KEYS.asparagus}=${byKey.get('asparagus') ?? ''}`,
        `${FIXTURE_ENV_KEYS.salad}=${byKey.get('salad') ?? ''}`,
        `${FIXTURE_ENV_KEYS.risotto}=${byKey.get('risotto') ?? ''}`,
    ];
}
