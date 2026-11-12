/**
 * Who bound a line (`bound_by`) and which imported line it came from (`import_line_id`), through the real save paths of
 * `RecipesService` over a fake DAL (ADR-0072 §5), written before the wiring.
 *
 * What each case is there to catch:
 *
 *  - **A title-only PATCH keeps the origin** — both shipped editors send EVERY ingredient on EVERY save, so a service that
 *    forgot the stored origin would reset all of them to `cook` on the first edit. The case includes a line kept AS WRITTEN,
 *    which has no food to carry by: it must keep its link (and stay NULL), not become `cook` (a kept-as-written line still
 *    has a `food_lookup_id`, an unresolved one, so a rule fed raw lookup ids would call it a food).
 *  - **A food change makes the line `cook`** and clears the link; the amount alone does not.
 *  - **The save path's directives** (`cook` for a rebind, `set` for the import's own save) are an INTERNAL channel: they
 *    arrive as arguments to `update`/`create`, never through the request body.
 *  - **A create stamps `cook` on a food the caller chose**, and the import states its origins exactly and its own provenance,
 *    without the curator grant that `POST /recipes` demands (ADR-0023's exception for this route only).
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RecipeErrorCode, RecipeSourceType, RecipeVisibility } from '@kitchensink/recipe-core';

import { makeIngredientLineRow, makeRecipeRow, makeRecipeStepRow } from '../../__fixtures__/index.js';
import type { Principal } from '../../auth/principal.js';
import {
    fakeFoodLookupsDal,
    makeRootArm,
    makeUnresolvedArm,
} from '../../ingredients/__fixtures__/foodLookups.fixture.js';
import type { RecipeAggregate } from '../dal/recipes.dal.js';
import { fakeRecipesDal, FAKE_TX } from '../__fixtures__/recipesDal.fixture.js';
import { makeRecipesService } from '../__fixtures__/recipesService.fixture.js';
import type { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import { resolveStatementProvenance } from '../domain/provenancePolicy.js';
import { isRecipeDomainError } from '../recipe.error.js';

const OWNER = '01JBINDINGORIGIN00000OWNER';
const PRINCIPAL: Principal = {
    userId: OWNER,
    sub: 'user_clerk',
    scopes: [],
    permissions: [],
    roles: [],
    principalKind: 'real',
    containment: 'enforce',
};

const FLOUR = makeRootArm({ lookupId: '00000000-0000-4000-8000-0000000000a1', foodId: 'food-flour' });
const BUTTER = makeRootArm({ lookupId: '00000000-0000-4000-8000-0000000000a2', foodId: 'food-butter' });
const WRITTEN = makeUnresolvedArm({
    lookupId: '00000000-0000-4000-8000-0000000000a3',
    failure: { name: 'Grandma’s spice mix' },
});
const LOOKUPS = fakeFoodLookupsDal(FLOUR, BUTTER, WRITTEN);

const LINK_FLOUR = '00000000-0000-4000-8000-0000000000e1';
const LINK_WRITTEN = '00000000-0000-4000-8000-0000000000e2';

/** A stored draft with a flour line the import auto-bound and a spice mix it kept as written. */
function importedDraft(): RecipeAggregate {
    const recipe = makeRecipeRow({ id: 'r-1', ownerId: OWNER, currentVersion: 1, status: 'draft' });

    return {
        recipe,
        steps: [makeRecipeStepRow({ recipeId: recipe.id })],
        ingredients: [
            makeIngredientLineRow({
                id: 'line-0',
                recipeId: 'r-1',
                foodLookupId: FLOUR.lookupId,
                sortOrder: 0,
                boundBy: 'autoBest',
                importLineId: LINK_FLOUR,
            }),
            makeIngredientLineRow({
                id: 'line-1',
                recipeId: 'r-1',
                foodLookupId: WRITTEN.lookupId,
                sortOrder: 1,
                boundBy: null,
                importLineId: LINK_WRITTEN,
            }),
        ],
    };
}

const flourLine = { ingredientId: FLOUR.lookupId, quantity: { kind: 'exact', value: 2 }, unit: 'cup' } as const;
const writtenLine = { ingredientId: WRITTEN.lookupId, quantity: { kind: 'absent' } } as const;

function setup() {
    const stored = importedDraft();
    const dal = fakeRecipesDal({
        findById: vi.fn().mockResolvedValue(stored),
        update: vi.fn().mockResolvedValue({ ...stored, recipe: { ...stored.recipe, currentVersion: 2 } }),
        create: vi.fn().mockResolvedValue(stored),
    });
    const service = makeRecipesService({ dal, lookups: LOOKUPS });

    return { dal, service };
}

/** The lines the DAL was asked to persist on the last update, as `[boundBy, importLineId]` pairs. */
function persistedOrigins(dal: ReturnType<typeof setup>['dal']): unknown {
    const call = vi.mocked(dal.update).mock.calls.at(-1);
    const lines = (call?.[1] as { ingredients?: readonly { boundBy?: unknown; importLineId?: unknown }[] } | undefined)
        ?.ingredients;

    return lines?.map((line) => [line.boundBy, line.importLineId]);
}

describe('RecipesService.update — the stored origin follows the line', () => {
    it('⛔ a title-only PATCH that resends every line keeps both the bound origin and the as-written link', async () => {
        const { dal, service } = setup();

        await service.update(
            PRINCIPAL,
            'r-1',
            { expectedVersion: 1, title: 'A new title', ingredients: [flourLine, writtenLine] },
            undefined,
        );

        expect(persistedOrigins(dal)).toStrictEqual([
            ['autoBest', LINK_FLOUR],
            [null, LINK_WRITTEN],
        ]);
    });

    it('editing the AMOUNT of a bound line keeps its origin (identity is the food alone)', async () => {
        const { dal, service } = setup();

        await service.update(
            PRINCIPAL,
            'r-1',
            {
                expectedVersion: 1,
                ingredients: [{ ...flourLine, quantity: { kind: 'exact', value: 3 } }, writtenLine],
            },
            undefined,
        );

        expect(persistedOrigins(dal)).toStrictEqual([
            ['autoBest', LINK_FLOUR],
            [null, LINK_WRITTEN],
        ]);
    });

    it('⛔ a different food on the line makes it `cook` and clears the import link', async () => {
        const { dal, service } = setup();

        await service.update(
            PRINCIPAL,
            'r-1',
            { expectedVersion: 1, ingredients: [{ ...flourLine, ingredientId: BUTTER.lookupId }, writtenLine] },
            undefined,
        );

        expect(persistedOrigins(dal)).toStrictEqual([
            ['cook', null],
            [null, LINK_WRITTEN],
        ]);
    });

    it('turning an as-written line into a food is the cook’s decision: `cook`, and the link is gone', async () => {
        const { dal, service } = setup();

        await service.update(
            PRINCIPAL,
            'r-1',
            { expectedVersion: 1, ingredients: [flourLine, { ...writtenLine, ingredientId: BUTTER.lookupId }] },
            undefined,
        );

        expect(persistedOrigins(dal)).toStrictEqual([
            ['autoBest', LINK_FLOUR],
            ['cook', null],
        ]);
    });

    it('a PATCH with no ingredients touches no line at all', async () => {
        const { dal, service } = setup();

        await service.update(PRINCIPAL, 'r-1', { expectedVersion: 1, title: 'Only the title' }, undefined);

        const patch: object | undefined = vi.mocked(dal.update).mock.calls.at(-1)?.[1];

        expect(patch).not.toHaveProperty('ingredients');
    });

    it('⛔ the `cook` directive confirms a line even on the SAME food (the rebind’s own channel)', async () => {
        const { dal, service } = setup();

        await service.update(
            PRINCIPAL,
            'r-1',
            { expectedVersion: 1, ingredients: [flourLine, writtenLine] },
            undefined,
            { lineOrigins: new Map([[0, { kind: 'cook' }]]) },
        );

        expect(persistedOrigins(dal)).toStrictEqual([
            ['cook', LINK_FLOUR],
            [null, LINK_WRITTEN],
        ]);
    });

    it('the `cook` directive on a changed food keeps the link the rebind passes on purpose', async () => {
        const { dal, service } = setup();

        await service.update(
            PRINCIPAL,
            'r-1',
            { expectedVersion: 1, ingredients: [{ ...flourLine, ingredientId: BUTTER.lookupId }, writtenLine] },
            undefined,
            { lineOrigins: new Map([[0, { kind: 'cook', importLineId: LINK_FLOUR }]]) },
        );

        expect(persistedOrigins(dal)).toStrictEqual([
            ['cook', LINK_FLOUR],
            [null, LINK_WRITTEN],
        ]);
    });
});

const CREATE_DTO: CreateRecipeDto = {
    title: 'Pancakes',
    cuisine: 'American',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    status: 'draft',
    ingredients: [flourLine, writtenLine],
    steps: [{ instruction: 'Mix' }],
};

function persistedOnCreate(dal: ReturnType<typeof setup>['dal']): {
    readonly lines: readonly (readonly [unknown, unknown])[];
    readonly row: Record<string, unknown>;
} {
    const row = vi.mocked(dal.create).mock.calls.at(-1)?.[0] as unknown as Record<string, unknown> & {
        ingredients: readonly { boundBy?: unknown; importLineId?: unknown }[];
    };

    return { lines: row.ingredients.map((line) => [line.boundBy, line.importLineId] as const), row };
}

describe('RecipesService.create — an ordinary create stamps the cook’s own choice', () => {
    it('a food the caller chose is `cook`; a line kept as written has no origin', async () => {
        const { dal, service } = setup();

        await service.create(PRINCIPAL, CREATE_DTO, undefined);

        expect(persistedOnCreate(dal).lines).toStrictEqual([
            ['cook', null],
            [null, null],
        ]);
    });

    it('⛔ still refuses `imported_public` without the curator grant (the import exception is not on this route)', async () => {
        const { dal, service } = setup();
        const error = await service
            .create(
                PRINCIPAL,
                {
                    ...CREATE_DTO,
                    source: {
                        sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                        sourceUrl: 'https://example.com/r',
                        sourceAttribution: 'Example',
                    },
                },
                undefined,
            )
            .catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getResponse()).toMatchObject({ code: 'FORBIDDEN' });
        expect(dal.create).not.toHaveBeenCalled();
    });
});

describe('RecipesService.create — the import’s own save', () => {
    // REWRITTEN for ADR-0089: the provenance is what the ONE statement reader resolves (`resolveStatementProvenance`), so a
    // web statement carries the kind `public_web`. It used to be a hand-built `imported_public` with no kind, which reads as
    // the curator's public-domain text and was saved PUBLIC here: exactly the hazard the kind closes.
    const WEB_PROVENANCE = resolveStatementProvenance({ kind: 'public_web', citation: 'https://example.com/r' });
    const BOOK_PROVENANCE = resolveStatementProvenance({ kind: 'book', citation: 'The Joy of Cooking, p. 12' });

    if (WEB_PROVENANCE === undefined || BOOK_PROVENANCE === undefined) {
        throw new Error('test setup: the statements must resolve');
    }

    const imported = {
        provenance: WEB_PROVENANCE,
        lineOrigins: [
            { kind: 'set', boundBy: 'exact', importLineId: LINK_FLOUR },
            { kind: 'set', boundBy: null, importLineId: LINK_WRITTEN },
        ],
    } as const;

    it('⛔ stores the provenance the STATEMENT set, without the curator grant, and states each line’s origin exactly', async () => {
        const { dal, service } = setup();

        // PRIVATE: a web copy is private only (ADR-0089), so the item's public request is refused (next case).
        await service.create(PRINCIPAL, { ...CREATE_DTO, visibility: RecipeVisibility.PRIVATE }, undefined, imported);

        const { lines, row } = persistedOnCreate(dal);

        expect(row).toMatchObject({
            sourceType: 'imported_public',
            sourceKind: 'public_web',
            sourceUrl: 'https://example.com/r',
            sourceAttribution: 'example.com',
            status: 'draft',
        });
        expect(lines).toStrictEqual([
            ['exact', LINK_FLOUR],
            [null, LINK_WRITTEN],
        ]);
    });

    it('⛔ refuses origins that do not line up one-to-one with the lines: a short list would silently mark the rest `cook`', async () => {
        const { dal, service } = setup();

        await expect(
            service.create(PRINCIPAL, { ...CREATE_DTO, visibility: RecipeVisibility.PRIVATE }, undefined, {
                provenance: imported.provenance,
                lineOrigins: [imported.lineOrigins[0]],
            }),
        ).rejects.toThrow(/lineOrigins/u);
        expect(dal.create).not.toHaveBeenCalled();
    });

    it('judges visibility against the provenance the statement set: a book recipe can never be public', async () => {
        const { dal, service } = setup();
        const error = await service
            .create(PRINCIPAL, { ...CREATE_DTO, visibility: RecipeVisibility.PUBLIC }, undefined, {
                ...imported,
                provenance: BOOK_PROVENANCE,
            })
            .catch((thrown: unknown) => thrown);

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(dal.create).not.toHaveBeenCalled();
    });

    it('judges a WEB statement the same way: a public save is refused, because the web copy is private only (ADR-0089)', async () => {
        const { dal, service } = setup();
        const error = await service
            .create(PRINCIPAL, { ...CREATE_DTO, visibility: RecipeVisibility.PUBLIC }, undefined, imported)
            .catch((thrown: unknown) => thrown);

        expect(isRecipeDomainError(error) && error.code).toBe(RecipeErrorCode.INVALID_VISIBILITY);
        expect(dal.create).not.toHaveBeenCalled();
    });

    it('runs `afterWrite` INSIDE the recipe’s transaction, after the recipe row and before the version snapshot', async () => {
        const order: string[] = [];
        const stored = importedDraft();
        const dal = fakeRecipesDal({
            create: vi.fn(async () => {
                order.push('create');

                return stored;
            }),
        });
        const service = makeRecipesService({ dal, lookups: LOOKUPS });
        const afterWrite = vi.fn(async (tx: unknown, saved: { recipeId: string; ingredients: readonly unknown[] }) => {
            order.push('afterWrite');
            expect(tx).toBe(FAKE_TX);
            // What was PERSISTED, so the import can key each saved line's verdict from the rows (not from the request).
            expect(saved.recipeId).toBe(stored.recipe.id);
            expect(saved.ingredients).toBe(stored.ingredients);
        });

        await service.create(PRINCIPAL, { ...CREATE_DTO, visibility: RecipeVisibility.PRIVATE }, undefined, {
            ...imported,
            afterWrite,
        });

        expect(order).toStrictEqual(['create', 'afterWrite']);
        expect(afterWrite).toHaveBeenCalledOnce();
    });

    it('⛔ an `afterWrite` that throws fails the create, so the claim and the recipe commit or vanish together', async () => {
        const { service } = setup();
        const boom = new Error('claim lost');
        const error = await service
            .create(PRINCIPAL, { ...CREATE_DTO, visibility: RecipeVisibility.PRIVATE }, undefined, {
                ...imported,
                afterWrite: () => Promise.reject(boom),
            })
            .catch((thrown: unknown) => thrown);

        expect(error).toBe(boom);
    });
});
