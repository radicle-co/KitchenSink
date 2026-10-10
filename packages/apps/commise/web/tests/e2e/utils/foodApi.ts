import type { Page } from '@playwright/test';
import type {
    AuthoredFoodSearchResultView,
    CatalogSearchResultView,
    FoodResponse,
} from '@kitchensink/food-service-client';
import {
    PROGRESSIVE_SEARCH_CONTENT_TYPE,
    adoptRemoteFoodRequestSchema,
    createAuthoredFoodRequestSchema,
    progressiveSearchFrameSchema,
    type DataSourceView,
    type ProgressiveSearchFrame,
} from '@kitchensink/schema-food';

import { E2E_CATALOG_FOOD, E2E_SALT_FOOD } from './recipeApi';

/**
 * A double for the food service as the editor's ingredient search reads it from the browser (ADR-0055 point 9): the
 * progressive search, `GET /api/v1/foods/search/progressive`, streamed as NDJSON frames (the database frame, one frame
 * per wired source, then `complete`); the remote pick, `POST /api/v1/foods/remote/adopt` (point 10); the source
 * register the list names a source from, `GET /api/v1/foods/sources`; and the create of the cook's own food,
 * `POST /api/v1/foods/authored` (S5.5). Register it AFTER `mockRecipeApi`, whose catch-all route for every `/api/v1/`
 * path would otherwise answer food's paths too: Playwright asks the newest route first.
 *
 * By default the catalog answers the two foods the recipe double admits (`E2E_SALT_FOOD`, `E2E_CATALOG_FOOD`), whatever
 * the text, the cook has no foods of their own, and no source is wired. A spec that needs another answer passes one; a
 * spec that needs a refusal registers its own route after this one.
 *
 * ⚠️ A route answers with the whole body at once, so the frames arrive together here. How the list fills in as each one
 * arrives is the component and integration tiers' (`foodSuggestions.model.test.ts`, `progressiveSearch.integration`).
 *
 * The cook's own foods live in an {@link OwnFoodLedger}, because two doubles read them: this one searches and creates
 * them, and the recipe double's `by-food` admits them, as the real recipe service reads a food from food. A spec that
 * puts one on a line passes the SAME ledger to both (`mockRecipeApi`'s `ownFoods`).
 */

/** The cook's own foods, as food holds them. A create adds to it. */
export interface OwnFoodLedger {
    readonly foods: AuthoredFoodSearchResultView[];
}

/**
 * A ledger holding `seed`.
 *
 * @param seed - The foods the cook already has.
 * @returns The ledger. Pure.
 */
export const ownFoodLedger = (seed: readonly AuthoredFoodSearchResultView[] = []): OwnFoodLedger => ({
    foods: [...seed],
});

/**
 * A remote food as the double holds it: what food streams for it, and the catalog root its adopt answers. Give it a
 * root the recipe double admits through `by-food` (`E2E_CATALOG_FOOD`, say), so the pick can land on a line.
 */
export interface RemoteFoodDouble {
    readonly name: string;
    readonly reference: string;
    readonly rootId: string;
}

/** One source's answer to a text, as its frame says it. */
export type SourceAnswerDouble =
    | { readonly source: string; readonly outcome: 'answered'; readonly foods: readonly RemoteFoodDouble[] }
    | { readonly source: string; readonly outcome: 'busy' | 'limited'; readonly retryAfterSeconds: number }
    | { readonly source: string; readonly outcome: 'unavailable' };

/** One request the page sent food's search or its remote pick. */
export type RecordedFoodSearch =
    { readonly route: 'progressive'; readonly query: string } | { readonly route: 'adopt'; readonly reference: string };

/** What the double answers. */
export interface MockFoodApiOptions {
    /** The catalog's results for a text. */
    readonly catalog?: (query: string) => readonly CatalogSearchResultView[];
    /**
     * The cook's own foods: a search answers those whose name contains the text, ignoring case, and a create adds one,
     * or answers food's duplicate for a name the cook already has.
     */
    readonly authored?: OwnFoodLedger;
    /** The database groups food could not search: each reads `unavailable` in the database frame. */
    readonly unavailable?: readonly ('authored' | 'catalog')[];
    /**
     * Each wired source's answer for a text, in the order the frames arrive. None by default. An adopt answers the root
     * of a food some source served, and food's `409 REMOTE_FOOD_GONE` for any other reference.
     */
    readonly sources?: (query: string) => readonly SourceAnswerDouble[];
    /** The source register the list names a source from. USDA alone by default. */
    readonly register?: readonly DataSourceView[];
}

/** USDA as the register names it: the list says "From USDA" from its short name. */
export const USDA_SOURCE: DataSourceView = {
    id: 'usda',
    shortName: 'USDA',
    name: 'USDA FoodData Central',
    publisher: 'U.S. Department of Agriculture',
    edition: 'SR Legacy 2018-04',
    licenceName: 'CC0 1.0 Universal',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.',
    attributionLanguage: 'en',
    homepage: 'https://fdc.nal.usda.gov/',
    converted: false,
};

/**
 * A source's frame for its answer: what food streams, never the root an adopt answers.
 *
 * @param answer - The source's answer.
 * @returns The frame. Pure.
 */
const sourceFrameOf = (answer: SourceAnswerDouble): ProgressiveSearchFrame => {
    switch (answer.outcome) {
        case 'answered':
            return {
                type: 'source',
                source: answer.source,
                outcome: 'answered',
                items: answer.foods.map(({ name, reference }) => ({ name, reference })),
            };
        case 'busy':
        case 'limited':
            return {
                type: 'source',
                source: answer.source,
                outcome: answer.outcome,
                retryAfterSeconds: answer.retryAfterSeconds,
            };
        case 'unavailable':
            return { type: 'source', source: answer.source, outcome: 'unavailable' };

        default: {
            const unhandled: never = answer;

            return unhandled;
        }
    }
};

/**
 * An NDJSON body of `frames`, each parsed with food's own declaration first, so a frame food could never send fails the
 * spec here rather than being streamed.
 *
 * @param frames - The frames, in order.
 * @returns The body. Pure.
 */
const ndjsonOf = (frames: readonly ProgressiveSearchFrame[]): string =>
    frames.map((frame) => `${JSON.stringify(progressiveSearchFrameSchema.parse(frame))}\n`).join('');

/** The catalog's default answer: the foods the recipe double can admit. */
const DEFAULT_CATALOG = (): readonly CatalogSearchResultView[] => [
    { id: E2E_SALT_FOOD.foodId, name: E2E_SALT_FOOD.name, score: 0.95 },
    { id: E2E_CATALOG_FOOD.foodId, name: E2E_CATALOG_FOOD.name, score: 0.9 },
];

/** The per-author dedup key: a name compared trimmed and ignoring case. Pure. */
const dedupKeyOf = (name: string | null | undefined): string => (name ?? '').trim().toLowerCase();

/**
 * Food's `201` for a food the cook made: private, with no variants (an authored food never has any).
 *
 * @param id - The food's id.
 * @param name - Its name.
 * @returns The food. Pure.
 */
const authoredFoodResponse = (id: string, name: string): FoodResponse => ({
    id,
    name,
    description: null,
    kind: 'generic',
    status: 'RESOLVED',
    nutrients: [],
    portions: [],
    provenance: {},
    visibility: 'private',
    variants: [],
});

/**
 * Install the double.
 *
 * @param page - The Playwright page.
 * @param options - The answers.
 * @returns The searches and remote picks the page sent, in order (filled as they arrive).
 * @sideEffect Registers four `page.route` handlers.
 */
export async function mockFoodApi(
    page: Page,
    options: MockFoodApiOptions = {},
): Promise<readonly RecordedFoodSearch[]> {
    const sent: RecordedFoodSearch[] = [];
    const catalog = options.catalog ?? DEFAULT_CATALOG;
    const authored = options.authored ?? ownFoodLedger();
    const unavailable = new Set(options.unavailable ?? []);
    const sources = options.sources ?? (() => []);
    // The roots an adopt answers: every remote food a search has served so far, by its reference.
    const served = new Map<string, string>();
    let nextAuthoredId = 1;

    await page.route('**/api/v1/foods/search/progressive?**', async (intercepted) => {
        const query = new URL(intercepted.request().url()).searchParams.get('query') ?? '';
        const text = query.trim().toLowerCase();
        const answers = sources(query);

        sent.push({ route: 'progressive', query });
        answers.forEach((answer) => {
            if (answer.outcome === 'answered') {
                answer.foods.forEach((food) => served.set(food.reference, food.rootId));
            }
        });
        await intercepted.fulfill({
            status: 200,
            contentType: PROGRESSIVE_SEARCH_CONTENT_TYPE,
            body: ndjsonOf([
                {
                    type: 'database',
                    authored: unavailable.has('authored')
                        ? { outcome: 'unavailable' }
                        : {
                              outcome: 'answered',
                              results: authored.foods.filter((food) => (food.name ?? '').toLowerCase().includes(text)),
                          },
                    catalog: unavailable.has('catalog')
                        ? { outcome: 'unavailable' }
                        : { outcome: 'answered', results: [...catalog(query)] },
                },
                ...answers.map(sourceFrameOf),
                { type: 'complete' },
            ]),
        });
    });
    await page.route('**/api/v1/foods/remote/adopt', async (intercepted) => {
        // Parsed with food's own request declaration, as the create below is.
        const { reference } = adoptRemoteFoodRequestSchema.parse(intercepted.request().postDataJSON());
        const rootId = served.get(reference);

        sent.push({ route: 'adopt', reference });
        await (rootId === undefined
            ? intercepted.fulfill({
                  status: 409,
                  json: { code: 'REMOTE_FOOD_GONE', message: 'This remote food can no longer be picked' },
              })
            : intercepted.fulfill({ json: { id: rootId } }));
    });
    await page.route('**/api/v1/foods/sources', (intercepted) =>
        intercepted.fulfill({ json: { sources: options.register ?? [USDA_SOURCE] } }),
    );
    await page.route('**/api/v1/foods/authored', async (intercepted) => {
        if (intercepted.request().method() !== 'POST') {
            await intercepted.fallback();

            return;
        }

        // Parsed with food's own request declaration, so a body food would refuse fails the spec here rather than being
        // answered.
        const { name } = createAuthoredFoodRequestSchema.parse(intercepted.request().postDataJSON());
        const existing = authored.foods.find((food) => dedupKeyOf(food.name) === dedupKeyOf(name));

        if (existing !== undefined) {
            await intercepted.fulfill({
                status: 409,
                json: {
                    code: 'DUPLICATE_AUTHORED_NAME',
                    message: 'You already have a food with this name.',
                    details: { existingId: existing.id },
                },
            });

            return;
        }

        const id = `food_authored_${String(nextAuthoredId++)}`;

        authored.foods.push({ id, name, score: 1 });
        await intercepted.fulfill({ status: 201, json: authoredFoodResponse(id, name) });
    });

    return sent;
}
