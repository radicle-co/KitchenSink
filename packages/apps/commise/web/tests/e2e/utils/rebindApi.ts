import type { Page, Route } from '@playwright/test';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import { rebindIngredientLineRequestSchema, type RebindIngredientLineRequest } from '@kitchensink/schema-recipe';

import { versionConflictBody } from './recipeApi';

/**
 * A double for the rebind command (`POST /api/v1/recipes/{id}/ingredients/{position}/rebind`, plan 002 U5), layered
 * over `mockRecipeApi`'s store: registered after it, so it answers this one route and every other request reaches the
 * recipe double.
 *
 * It answers as the service does where a spec can observe it:
 * - the body is parsed by the service's own strict schema, so a body the editor could not have sent fails loudly;
 * - a stale `expectedVersion` gets the enriched 409 the service sends (`versionConflictBody`), so the editor shows its
 *   conflict view;
 * - a rebind to the binding the line already holds writes nothing and answers the version sent (ADR-0045);
 * - otherwise the line at the stored position is rebound with a new binding id, the version goes up by one, and the
 *   whole detail is answered.
 */

/** What the double knows about the foods a spec rebinds to. */
export interface RebindCatalog {
    /** The name the service derives for a `catalogFood` target, by food id. A food not listed is refused. */
    readonly foodNames?: Readonly<Record<string, string>>;
    /** A variant's parts, by variant id. */
    readonly variantParts?: Readonly<Record<string, readonly { readonly attribute: string; readonly text: string }[]>>;
    /**
     * A variant's root, by variant id, for a pick that also changes the line's food (Change food to a search result that
     * names a variant). A `catalogVariant` target with no root listed keeps the line's root and name, as the details
     * dialog's picks do.
     */
    readonly variantRoots?: Readonly<Record<string, { readonly foodId: string; readonly name: string }>>;
}

/** One command the page sent. */
export interface RecordedRebind {
    readonly path: string;
    readonly body: RebindIngredientLineRequest;
}

type StoredLine = RecipeDetail['ingredients'][number];

/** The line a target rebinds to, or `undefined` when the double does not know the target. Pure. */
function reboundLine(line: StoredLine, target: RebindIngredientLineRequest['target'], catalog: RebindCatalog) {
    // A rebind binds a food: whatever the line was (declared, unmatched), it is now a resolved, food-backed line.
    const { variant: _previous, unresolvedReason: _reason, ...kept } = line;
    const rootLine = { ...kept, isUserEntered: false, resolutionStatus: 'RESOLVED' as const };

    switch (target.kind) {
        case 'catalogVariant': {
            const parts = catalog.variantParts?.[target.foodVariantId];
            const root = catalog.variantRoots?.[target.foodVariantId];

            return parts === undefined
                ? undefined
                : { ...rootLine, ...root, variant: { id: target.foodVariantId, parts: [...parts] } };
        }

        case 'catalogFood': {
            const name = catalog.foodNames?.[target.foodId];

            return name === undefined ? undefined : { ...rootLine, foodId: target.foodId, name };
        }

        case 'name':
            // Not modelled: a spec that sends one should fail, not pass on an invented answer.
            return undefined;
    }
}

/**
 * Install the rebind double.
 *
 * @param page - The Playwright page.
 * @param store - The store `mockRecipeApi` returned; the double reads and writes it.
 * @param catalog - The foods and variants the double can rebind to.
 * @returns The commands the page sent, in order (filled as they arrive).
 * @sideEffect Registers a `page.route` handler that mutates `store`.
 */
export async function mockRebind(
    page: Page,
    store: Map<string, RecipeDetail>,
    catalog: RebindCatalog,
): Promise<readonly RecordedRebind[]> {
    const sent: RecordedRebind[] = [];
    let nextBinding = 1;

    await page.route('**/api/v1/recipes/*/ingredients/*/rebind', async (intercepted: Route) => {
        const path = new URL(intercepted.request().url()).pathname;
        const [, id = '', position = ''] = /\/recipes\/([^/]+)\/ingredients\/(\d+)\/rebind$/.exec(path) ?? [];
        const body = rebindIngredientLineRequestSchema.parse(intercepted.request().postDataJSON());
        const recipe = store.get(id);
        const index = Number(position);
        const line = recipe?.ingredients[index];

        sent.push({ path, body });

        if (recipe === undefined || line === undefined) {
            await intercepted.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: 'no such line' } });

            return;
        }

        if (body.expectedVersion !== recipe.currentVersion) {
            await intercepted.fulfill({ status: 409, json: versionConflictBody(recipe, body.expectedVersion) });

            return;
        }

        const rebound = reboundLine(line, body.target, catalog);

        if (rebound === undefined) {
            await intercepted.fulfill({
                status: 400,
                json: { code: 'UNKNOWN_INGREDIENT', message: 'the double does not know this target' },
            });

            return;
        }

        // ADR-0045: a rebind to the binding the line already holds writes nothing and answers the version sent.
        const unchanged =
            body.target.kind === 'catalogVariant'
                ? line.variant?.id === body.target.foodVariantId
                : body.target.kind === 'catalogFood' &&
                  line.foodId === body.target.foodId &&
                  line.variant === undefined;

        if (unchanged) {
            await intercepted.fulfill({ json: recipe });

            return;
        }

        const next: RecipeDetail = {
            ...recipe,
            currentVersion: recipe.currentVersion + 1,
            ingredients: recipe.ingredients.map((each, at) =>
                at === index
                    ? { ...rebound, ingredientId: `88888888-8888-4888-8888-${String(nextBinding++).padStart(12, '0')}` }
                    : each,
            ),
        };

        store.set(id, next);
        await intercepted.fulfill({ json: next });
    });

    return sent;
}
