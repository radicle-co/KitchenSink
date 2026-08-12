/**
 * THE RECIPES VERTICAL'S AUTHORED CONTRACT (§15.2) — the bound-by-bound proof that nothing was lost.
 *
 * The migration this suite guards replaced `class-validator` DTOs with `nestjs-zod` adapters over
 * `recipes.schema.ts`. The dangerous failure mode was NOT "the new schema is wrong" — it was "the new schema
 * is LOOSER and nothing notices", because the published contract was already generated from `recipe-core`'s
 * request zod, which had no `title` maximum, no `ingredientId` UUID check, no quantity bounds, no array caps
 * and no upper bound on any int4-backed number. So every bound that existed before is asserted here as a
 * REJECTION, one field at a time, and the suite is written to fail if any of them is dropped.
 *
 * Three properties carry most of the value:
 *
 *  1. **The DTO and the published schema are the SAME OBJECT** (`Dto.schema === …Schema`). `@kitchensink/
 *     schema-recipe` publishes these verbatim, so identity makes it impossible to validate one shape
 *     server-side and publish another.
 *  2. **`z.infer` of each request schema is mutually assignable with the `recipe-core` domain input type.**
 *     `recipe-core` keeps the interfaces the typed client and the editor's form model are written against;
 *     this is what stops the schema and those interfaces drifting now that the zod lives here.
 *  3. **The `.min(1)`s that fix a body the server could SEND and no client could READ.** `title`, `cuisine`,
 *     `steps[].instruction` and `ingredients[].notes` were each storable as `''`, and the corresponding read
 *     schema rejects `''` — so the typed client threw parsing back what it had just written. Those four are
 *     asserted against the READ schema, not just as bare rejections, so the reason survives.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
    MAX_RECIPE_DEVICE_LABEL_LENGTH,
    recipeIngredientViewSchema,
    recipeSchema,
    recipeStepViewSchema,
} from '@kitchensink/recipe-core';
import type { CreateRecipeInput, CreateRecipeIngredientInput, CreateRecipeStepInput } from '@kitchensink/recipe-core';

import {
    cloneRecipeRequestSchema,
    createRecipeRequestSchema,
    listRecipesQuerySchema,
    recipeIngredientInputSchema,
    recipeStepInputSchema,
    setRecipeVisibilityRequestSchema,
    updateRecipeRequestSchema,
    MAX_RECIPE_CUISINE_LENGTH,
    MAX_RECIPE_DESCRIPTION_LENGTH,
    MAX_RECIPE_INGREDIENTS,
    MAX_RECIPE_INGREDIENT_NAME_LENGTH,
    MAX_RECIPE_INGREDIENT_QUANTITY,
    MAX_RECIPE_LIST_PAGE_SIZE,
    MAX_RECIPE_TAGS,
    MAX_RECIPE_TITLE_LENGTH,
    MIN_RECIPE_INGREDIENT_QUANTITY,
} from '../recipes.schema.js';
import type { CreateRecipeRequest, RecipeIngredientInput, RecipeStepInput } from '../recipes.schema.js';
import { CreateRecipeDto } from '../dto/create-recipe.dto.js';
import { UpdateRecipeDto } from '../dto/update-recipe.dto.js';
import { CloneRecipeDto } from '../dto/clone-recipe.dto.js';
import { SetVisibilityDto } from '../dto/set-visibility.dto.js';
import { ListRecipesQueryDto } from '../dto/list-recipes.query.dto.js';

/** A valid ingredient line the individual cases override one field of. */
const A_LINE = {
    ingredientId: '00000000-0000-4000-8000-0000000000aa',
    name: 'Flour',
    quantity: 1,
} as const;

/** A minimal-but-valid create body; `over` layers the field under test on top. */
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: 'Herb Risotto',
        servings: 4,
        prepTimeMinutes: 10,
        cookTimeMinutes: 25,
        totalTimeMinutes: 35,
        ingredients: [A_LINE],
        steps: [{ instruction: 'Toast the rice.' }],
        ...over,
    };
}

/** Whether the create schema accepts a body with the given override. */
function createAccepts(over: Record<string, unknown>): boolean {
    return createRecipeRequestSchema.safeParse(body(over)).success;
}

/** Whether the create schema accepts a single ingredient line with the given override. */
function lineAccepts(over: Record<string, unknown>): boolean {
    return recipeIngredientInputSchema.safeParse({ ...A_LINE, ...over }).success;
}

// ── 1. The DTOs ARE the published schemas ─────────────────────────────────────────────────────────

describe('the DTOs are the published schemas, so one cannot be validated and the other published', () => {
    it.each([
        ['CreateRecipeDto', CreateRecipeDto, createRecipeRequestSchema],
        ['UpdateRecipeDto', UpdateRecipeDto, updateRecipeRequestSchema],
        ['CloneRecipeDto', CloneRecipeDto, cloneRecipeRequestSchema],
        ['SetVisibilityDto', SetVisibilityDto, setRecipeVisibilityRequestSchema],
        ['ListRecipesQueryDto', ListRecipesQueryDto, listRecipesQuerySchema],
    ])('%s.schema IS the authored schema object', (_name, dto, schema) => {
        expect((dto as unknown as { schema: unknown }).schema).toBe(schema);
    });
});

// ── 2. The wire schema and the domain input type cannot drift ──────────────────────────────────────

describe('the inferred wire types stay assignable to the recipe-core domain inputs', () => {
    it('CreateRecipeRequest and CreateRecipeInput are mutually assignable', () => {
        expectTypeOf<CreateRecipeRequest>().toExtend<CreateRecipeInput>();
        expectTypeOf<CreateRecipeInput>().toExtend<CreateRecipeRequest>();
    });

    it('the nested line and step types are mutually assignable with their domain inputs', () => {
        expectTypeOf<RecipeIngredientInput>().toExtend<CreateRecipeIngredientInput>();
        expectTypeOf<CreateRecipeIngredientInput>().toExtend<RecipeIngredientInput>();
        expectTypeOf<RecipeStepInput>().toExtend<CreateRecipeStepInput>();
        expectTypeOf<CreateRecipeStepInput>().toExtend<RecipeStepInput>();
    });

    it('`deviceLabel` is part of BOTH, which it was not before (the document forbade it)', () => {
        expectTypeOf<CreateRecipeInput>().toHaveProperty('deviceLabel');
        expectTypeOf<CreateRecipeRequest>().toHaveProperty('deviceLabel');
    });
});

// ── 3. Every bound that existed before still rejects ───────────────────────────────────────────────

describe('title — max 200 carried forward, plus the min(1) that fixes an unreadable response', () => {
    it('the cap is 200, exactly what the class-validator DTO enforced', () => {
        expect(MAX_RECIPE_TITLE_LENGTH).toBe(200);
    });

    it('accepts a title at 200 and REJECTS 201 — the published contract used to say there was no maximum', () => {
        expect(createAccepts({ title: 'a'.repeat(200) })).toBe(true);
        expect(createAccepts({ title: 'a'.repeat(201) })).toBe(false);
    });

    it('REJECTS a 50 000-character title, the body a naive swap to recipe-core`s zod would have accepted', () => {
        expect(createAccepts({ title: 'a'.repeat(50_000) })).toBe(false);
    });

    it('rejects `""`, because recipeSchema.title is min(1) and would reject it on the way back out', () => {
        expect(createAccepts({ title: '' })).toBe(false);
        expect(recipeSchema.shape.title.safeParse('').success).toBe(false);
    });

    it('is REQUIRED', () => {
        expect(createRecipeRequestSchema.safeParse({ ...body(), title: undefined }).success).toBe(false);
    });
});

describe('description — max 5000 carried forward, and `""` DELIBERATELY still accepted', () => {
    it('the cap is 5000', () => {
        expect(MAX_RECIPE_DESCRIPTION_LENGTH).toBe(5000);
    });

    it('accepts 5000 characters and rejects 5001', () => {
        expect(createAccepts({ description: 'a'.repeat(5000) })).toBe(true);
        expect(createAccepts({ description: 'a'.repeat(5001) })).toBe(false);
    });

    it('ACCEPTS `""` — the one min(1) NOT adopted, and the reason is a readable round trip', () => {
        // Unlike title/cuisine/instruction/notes, `''` is a legal value of the READ schema
        // (`recipeSchema.description` is `z.string().default('')`), so there is no body-the-client-cannot-read
        // to fix here. And `''` is the only way any caller can CLEAR a previously-set description, since an
        // omitted field means "leave unchanged" — rejecting it would make a set description unclearable.
        expect(createAccepts({ description: '' })).toBe(true);
        expect(recipeSchema.shape.description.safeParse('').success).toBe(true);
    });

    it('the RESPONSE contract still OMITS description rather than emitting `""` for an unset one', () => {
        // `recipeSchema.description` has a `''` DEFAULT, which is a consumer-side normalization of an absent
        // key — not the server starting to emit `''`. A body with no `description` still parses.
        expect(recipeSchema.parse(makeRecipeResponse()).description).toBe('');
    });
});

describe('cuisine — max 100 carried forward, min(1) adopted', () => {
    it('the cap is 100', () => {
        expect(MAX_RECIPE_CUISINE_LENGTH).toBe(100);
    });

    it('accepts 100 characters and rejects 101', () => {
        expect(createAccepts({ cuisine: 'a'.repeat(100) })).toBe(true);
        expect(createAccepts({ cuisine: 'a'.repeat(101) })).toBe(false);
    });

    it('rejects `""`, which the read schema also rejects — the server used to store and echo it', () => {
        expect(createAccepts({ cuisine: '' })).toBe(false);
        expect(recipeSchema.shape.cuisine.safeParse('').success).toBe(false);
    });
});

describe('ingredientId — a real UUID, not "any non-empty string"', () => {
    it('accepts a UUID', () => {
        expect(lineAccepts({})).toBe(true);
    });

    it('REJECTS a non-UUID id — recipe-core`s idSchema is `string().min(1)` and would have widened this', () => {
        expect(lineAccepts({ ingredientId: 'not-a-uuid' })).toBe(false);
        expect(lineAccepts({ ingredientId: 'ing-1' })).toBe(false);
        expect(lineAccepts({ ingredientId: '' })).toBe(false);
    });
});

describe('ingredient line strings — the name cap and the min(1)s', () => {
    it('name is capped at 120', () => {
        expect(MAX_RECIPE_INGREDIENT_NAME_LENGTH).toBe(120);
        expect(lineAccepts({ name: 'a'.repeat(120) })).toBe(true);
        expect(lineAccepts({ name: 'a'.repeat(121) })).toBe(false);
    });

    it('name rejects `""`', () => {
        expect(lineAccepts({ name: '' })).toBe(false);
    });

    it('unit rejects `""` so "unitless" has ONE representation — omitting the key', () => {
        expect(lineAccepts({ unit: 'g' })).toBe(true);
        expect(lineAccepts({ unit: '' })).toBe(false);
        expect(lineAccepts({})).toBe(true);
    });

    it('notes rejects `""`, which the read schema rejects too — the server used to store and echo it', () => {
        expect(lineAccepts({ notes: 'finely chopped' })).toBe(true);
        expect(lineAccepts({ notes: '' })).toBe(false);
        expect(recipeIngredientViewSchema.shape.notes.safeParse('').success).toBe(false);
    });
});

describe('ingredient quantity — the numeric(10,3) window carried forward exactly', () => {
    it('the bounds are 0.001 .. 1 000 000', () => {
        expect(MIN_RECIPE_INGREDIENT_QUANTITY).toBe(0.001);
        expect(MAX_RECIPE_INGREDIENT_QUANTITY).toBe(1_000_000);
    });

    it('accepts both endpoints and rejects just outside them', () => {
        expect(lineAccepts({ quantity: 0.001 })).toBe(true);
        expect(lineAccepts({ quantity: 1_000_000 })).toBe(true);
        expect(lineAccepts({ quantity: 0.0009 })).toBe(false);
        expect(lineAccepts({ quantity: 1_000_000.001 })).toBe(false);
    });

    it('rejects 0 (the column CHECK is `quantity > 0`) and a negative', () => {
        expect(lineAccepts({ quantity: 0 })).toBe(false);
        expect(lineAccepts({ quantity: -1 })).toBe(false);
    });

    it('is REQUIRED', () => {
        expect(recipeIngredientInputSchema.safeParse({ ...A_LINE, quantity: undefined }).success).toBe(false);
    });
});

describe('step instruction — min(1) adopted, and NO maximum, deliberately', () => {
    it('rejects `""`, which recipeStepViewSchema.instruction rejects on the way back out', () => {
        expect(recipeStepInputSchema.safeParse({ instruction: '' }).success).toBe(false);
        expect(recipeStepViewSchema.shape.instruction.safeParse('').success).toBe(false);
    });

    it('accepts a very long instruction — no cap has ever existed and inventing one would break live data', () => {
        // The column is unbounded `text`. Adding a maximum here is a PRODUCT decision, flagged rather than
        // guessed at: any number chosen now would start rejecting steps that work today.
        expect(recipeStepInputSchema.safeParse({ instruction: 'a'.repeat(50_000) }).success).toBe(true);
    });
});

describe('array caps carried forward', () => {
    it('ingredients is 1..100 and tags is 0..50', () => {
        expect(MAX_RECIPE_INGREDIENTS).toBe(100);
        expect(MAX_RECIPE_TAGS).toBe(50);
    });

    it('rejects an empty ingredients array and an empty steps array', () => {
        expect(createAccepts({ ingredients: [] })).toBe(false);
        expect(createAccepts({ steps: [] })).toBe(false);
    });
});

describe('enums carried forward', () => {
    it.each(['visibility', 'status'])('%s rejects a value outside its enum', (field) => {
        expect(createAccepts({ [field]: 'nonsense' })).toBe(false);
    });

    it('visibility accepts public and private', () => {
        expect(createAccepts({ visibility: 'public' })).toBe(true);
        expect(createAccepts({ visibility: 'private' })).toBe(true);
    });

    it('status accepts draft and published', () => {
        expect(createAccepts({ status: 'draft' })).toBe(true);
        expect(createAccepts({ status: 'published' })).toBe(true);
    });
});

describe('the create body strips what it must not trust', () => {
    it.each(['ownerId', 'id', 'currentVersion', 'averageRating', 'sourceType', 'hasSubstantiveEdit'])(
        'drops a smuggled %s',
        (field) => {
            expect(createRecipeRequestSchema.parse(body({ [field]: 'hostile' }))).not.toHaveProperty(field);
        },
    );
});

// ── The remaining request shapes ───────────────────────────────────────────────────────────────────

describe('setRecipeVisibilityRequestSchema — newly published', () => {
    it('accepts the two literals and nothing else', () => {
        expect(setRecipeVisibilityRequestSchema.parse({ visibility: 'public' })).toEqual({ visibility: 'public' });
        expect(setRecipeVisibilityRequestSchema.parse({ visibility: 'private' })).toEqual({ visibility: 'private' });
        expect(setRecipeVisibilityRequestSchema.safeParse({ visibility: 'unlisted' }).success).toBe(false);
    });

    it('REQUIRES the field — an empty body is a 400, not a silent no-op', () => {
        expect(setRecipeVisibilityRequestSchema.safeParse({}).success).toBe(false);
    });
});

describe('cloneRecipeRequestSchema — a bodyless POST is legal', () => {
    it('accepts an absent body, an empty body, and strips any field sent', () => {
        expect(cloneRecipeRequestSchema.parse(undefined)).toEqual({});
        expect(cloneRecipeRequestSchema.parse({})).toEqual({});
        expect(cloneRecipeRequestSchema.parse({ ownerId: 'hostile' })).toEqual({});
    });
});

describe('listRecipesQuerySchema — coerced, defaulted, bounded', () => {
    it('applies the defaults the class property initializers used to', () => {
        expect(listRecipesQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20, sortBy: 'updatedAt' });
    });

    it('coerces the string values a query bag actually carries', () => {
        expect(listRecipesQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
            page: 3,
            pageSize: 50,
            sortBy: 'updatedAt',
        });
    });

    it('rejects a fractional page size rather than truncating it', () => {
        expect(listRecipesQuerySchema.safeParse({ pageSize: '2.5' }).success).toBe(false);
    });

    it('enforces page >= 1 and pageSize 1..100', () => {
        expect(MAX_RECIPE_LIST_PAGE_SIZE).toBe(100);
        expect(listRecipesQuerySchema.safeParse({ page: 0 }).success).toBe(false);
        expect(listRecipesQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
        expect(listRecipesQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true);
        expect(listRecipesQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    });

    it.each(['updatedAt', 'createdAt', 'title'])('accepts sortBy=%s', (sortBy) => {
        expect(listRecipesQuerySchema.parse({ sortBy }).sortBy).toBe(sortBy);
    });

    it('rejects an unknown sortBy', () => {
        expect(listRecipesQuerySchema.safeParse({ sortBy: 'rating' }).success).toBe(false);
    });
});

describe('updateRecipeRequestSchema — a partial of create, minus visibility, plus expectedVersion', () => {
    it('accepts an expectedVersion-only body (nothing else is required)', () => {
        expect(updateRecipeRequestSchema.parse({ expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
    });

    it('carries every content bound over from create', () => {
        expect(updateRecipeRequestSchema.safeParse({ expectedVersion: 1, title: 'a'.repeat(201) }).success).toBe(false);
        expect(updateRecipeRequestSchema.safeParse({ expectedVersion: 1, cuisine: '' }).success).toBe(false);
        expect(updateRecipeRequestSchema.safeParse({ expectedVersion: 1, deviceLabel: 'a'.repeat(81) }).success).toBe(
            false,
        );
        expect(
            updateRecipeRequestSchema.safeParse({
                expectedVersion: 1,
                ingredients: [{ ...A_LINE, ingredientId: 'nope' }],
            }).success,
        ).toBe(false);
    });

    it('does NOT declare visibility — the service has always stripped it here', () => {
        expect(Object.keys(updateRecipeRequestSchema.shape)).not.toContain('visibility');
    });

    it('declares deviceLabel with the same length bound recipe-core publishes on the response', () => {
        expect(
            updateRecipeRequestSchema.safeParse({
                expectedVersion: 1,
                deviceLabel: 'a'.repeat(MAX_RECIPE_DEVICE_LABEL_LENGTH),
            }).success,
        ).toBe(true);
    });
});

/**
 * A `recipeSchema`-valid response body with NO `description` key, for the omit-vs-`''` assertion.
 *
 * @returns The body. Pure.
 */
function makeRecipeResponse(): Record<string, unknown> {
    return {
        id: 'rec-1',
        ownerId: '01JOWNER0000000000000000AA',
        title: 'Herb Risotto',
        prepTimeMinutes: 10,
        cookTimeMinutes: 25,
        totalTimeMinutes: 35,
        servings: 4,
        visibility: 'public',
        status: 'published',
        sourceType: 'user_created',
        hasSubstantiveEdit: false,
        dietaryFlags: [],
        tags: [],
        hasPartialNutrition: false,
        currentVersion: 1,
        ratingCount: 0,
        usesPremiumCapability: false,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
    };
}
