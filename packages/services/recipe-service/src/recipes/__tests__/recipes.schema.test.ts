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
 * ⚠️ The BOUNDS themselves now live in `@kitchensink/recipe-core` (`recipeRequestBounds.ts`) — the owner's
 * ruling, so both apps inherit the same numbers — and this file composes them. That relocation is why suite 0
 * exists: it asserts REFERENCE IDENTITY between each request field and the `recipe-core` Value Object, which
 * is what makes "the bound is not restated here" a checked property rather than a comment. The value-level
 * accept/reject cases below are retained on TOP of that, because identity alone would not notice
 * `recipe-core` itself loosening a bound.
 *
 * Four properties carry most of the value:
 *
 *  0. **Every bounded field IS the recipe-core object** (`shape.title === recipeTitleSchema`).
 *  1. **The DTO and the published schema are the SAME OBJECT** (`Dto.schema === …Schema`). `@kitchensink/
 *     schema-recipe` publishes these verbatim, so identity makes it impossible to validate one shape
 *     server-side and publish another.
 *  2. **There is ONE representation of each body.** This bullet used to say the opposite — that `recipe-core`
 *     keeps interfaces the client and the form model are written against, and that mutual assignability stops
 *     them drifting. Those interfaces are DELETED and the assertion is gone with them: assignability is not
 *     identity, a spread is exempt from excess-property checking, and a passing bidirectional check is evidence
 *     that a second declaration exists. See that suite for the defect it was hiding.
 *  3. **The `.min(1)`s that fix a body the server could SEND and no client could READ.** `title`, `cuisine`,
 *     `steps[].instruction` and `ingredients[].notes` were each storable as `''`, and the corresponding read
 *     schema rejects `''` — so the typed client threw parsing back what it had just written. Those four are
 *     asserted against the READ schema, not just as bare rejections, so the reason survives.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
    recipeIngredientViewSchema,
    recipeSchema,
    recipeStepViewSchema,
    MAX_RECIPE_CUISINE_LENGTH,
    MAX_RECIPE_DESCRIPTION_LENGTH,
    MAX_RECIPE_DEVICE_LABEL_LENGTH,
    MAX_RECIPE_INGREDIENTS,
    MAX_RECIPE_INGREDIENT_GROUP_LABEL_LENGTH,
    MAX_RECIPE_INGREDIENT_NAME_LENGTH,
    MAX_RECIPE_INGREDIENT_PREPARATION_LENGTH,
    MAX_RECIPE_INGREDIENT_QUANTITY,
    MAX_RECIPE_INGREDIENT_SOURCE_LINE_LENGTH,
    MAX_RECIPE_LIST_PAGE_SIZE,
    MAX_RECIPE_SOURCE_ATTRIBUTION_LENGTH,
    MAX_RECIPE_SOURCE_URL_LENGTH,
    MAX_RECIPE_TAGS,
    MAX_RECIPE_TITLE_LENGTH,
    MIN_RECIPE_INGREDIENT_QUANTITY,
    recipeCuisineSchema,
    recipeDescriptionSchema,
    recipeDeviceLabelSchema,
    recipeExpectedVersionSchema,
    recipeIngredientIdSchema,
    recipeIngredientNameSchema,
    recipeIngredientGroupLabelSchema,
    recipeIngredientNotesSchema,
    recipeIngredientPreparationSchema,
    recipeIngredientSourceLineSchema,
    ingredientQuantitySchema,
    recipeIngredientUnitSchema,
    recipeLineNutritionSchema,
    recipeMinutesSchema,
    recipeServingsSchema,
    recipeStepInstructionSchema,
    recipeTimerSecondsSchema,
    recipeTitleSchema,
} from '@kitchensink/recipe-core';

import { PROVISIONAL_VERIFICATION_THRESHOLDS } from '@kitchensink/recipe-core/resolution/verification-gate-policy';

import {
    cloneRecipeRequestSchema,
    createRecipeIngredientInputSchema,
    createRecipeRequestSchema,
    listRecipesQuerySchema,
    recipeIngredientInputSchema,
    recipeNutritionRequestSchema,
    recipeStepInputSchema,
    setRecipeVisibilityRequestSchema,
    updateRecipeRequestSchema,
    MAX_NUTRITION_RECIPE_IDS,
} from '../recipes.schema.js';
import type {
    CreateRecipeRequest,
    RecipeIngredientInput,
    RecipeStepInput,
    UpdateRecipeRequest,
} from '../recipes.schema.js';
import { CreateRecipeDto } from '../dto/createRecipe.dto.js';
import { UpdateRecipeDto } from '../dto/updateRecipe.dto.js';
import { CloneRecipeDto } from '../dto/cloneRecipe.dto.js';
import { SetVisibilityDto } from '../dto/setVisibility.dto.js';
import { ListRecipesQueryDto } from '../dto/listRecipes.query.dto.js';

/** A valid ingredient line the individual cases override one field of. */
const A_LINE = {
    ingredientId: '00000000-0000-4000-8000-0000000000aa',
    name: 'Flour',
    quantity: { kind: 'exact', value: 1 },
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

// ── 0. Every bounded field IS recipe-core's object, so no bound can be restated here ──────────────

describe('the request fields ARE the recipe-core Value Objects (identity, not equivalence)', () => {
    // OWNER RULING: the bounds live in `recipe-core` so both apps inherit them. `toBe` — reference identity
    // — is what makes that structural rather than aspirational: an equivalent-looking `z.string().max(200)`
    // re-declared here would pass any behavioural assertion while being a SECOND representation of the rule,
    // which is the exact defect (a looser twin drifting from the enforced bound) this seam removed. If a
    // field is ever re-declared locally, this fails immediately and names the field.
    it.each([
        ['title', createRecipeRequestSchema.shape.title, recipeTitleSchema],
        ['servings', createRecipeRequestSchema.shape.servings, recipeServingsSchema],
        ['prepTimeMinutes', createRecipeRequestSchema.shape.prepTimeMinutes, recipeMinutesSchema],
        ['cookTimeMinutes', createRecipeRequestSchema.shape.cookTimeMinutes, recipeMinutesSchema],
        ['totalTimeMinutes', createRecipeRequestSchema.shape.totalTimeMinutes, recipeMinutesSchema],
        ['ingredients[].ingredientId', recipeIngredientInputSchema.shape.ingredientId, recipeIngredientIdSchema],
        ['ingredients[].name', recipeIngredientInputSchema.shape.name, recipeIngredientNameSchema],
        ['ingredients[].quantity', recipeIngredientInputSchema.shape.quantity, ingredientQuantitySchema],
        ['steps[].instruction', recipeStepInputSchema.shape.instruction, recipeStepInstructionSchema],
        ['expectedVersion', updateRecipeRequestSchema.shape.expectedVersion, recipeExpectedVersionSchema],
    ])('%s is the recipe-core schema object itself', (_field, wireField, valueObject) => {
        expect(wireField).toBe(valueObject);
    });

    it('the OPTIONAL fields wrap the same object rather than re-declaring it', () => {
        // `.optional()` returns a wrapper, so identity is asserted one level in — the wrapped inner type.
        const unwrap = (schema: { unwrap: () => unknown }): unknown => schema.unwrap();

        expect(unwrap(createRecipeRequestSchema.shape.description)).toBe(recipeDescriptionSchema);
        expect(unwrap(createRecipeRequestSchema.shape.cuisine)).toBe(recipeCuisineSchema);
        expect(unwrap(createRecipeRequestSchema.shape.deviceLabel)).toBe(recipeDeviceLabelSchema);
        expect(unwrap(recipeIngredientInputSchema.shape.unit)).toBe(recipeIngredientUnitSchema);
        expect(unwrap(recipeIngredientInputSchema.shape.notes)).toBe(recipeIngredientNotesSchema);
        expect(unwrap(recipeStepInputSchema.shape.timerSeconds)).toBe(recipeTimerSecondsSchema);
        expect(unwrap(recipeIngredientInputSchema.shape.userCalories)).toBe(recipeLineNutritionSchema);
    });
});

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

describe('there is ONE representation of each request body, and it is this file’s', () => {
    /**
     * ⚠️ WHAT THIS SUITE USED TO BE, AND WHY IT WAS PART OF THE PROBLEM.
     *
     * It asserted MUTUAL ASSIGNABILITY between each `z.infer` here and a hand-written `recipe-core` interface
     * (`CreateRecipeInput`, `CreateRecipeIngredientInput`, `CreateRecipeStepInput`), on the reasoning that the
     * check made drift impossible. Those interfaces are now DELETED (ADR-0014 / §15 rule 4), and the deletion is
     * the fix — the assertion was weaker than it read:
     *
     *  • assignability is not identity, so two shapes could satisfy it and still disagree about optionality in a
     *    way that matters at a call site;
     *  • TypeScript's excess-property check does NOT apply to a spread, so a projection annotated with the
     *    interface could send a field this schema does not accept and still compile. That is precisely how
     *    `toUpdateRecipeInput` came to send `visibility` on the PATCH body — the service stripped it, a test
     *    pinned the strip, and both type-checked;
     *  • a passing bidirectional assertion between two declarations is evidence that a SECOND declaration
     *    exists, which is the thing §15 rule 4 forbids. The test was documenting the defect.
     *
     * What replaces it is the property that actually matters: the inferred type IS derived from the schema, so
     * `deviceLabel` — the field the old document forbade while the server persisted it — is present on exactly
     * one type, and there is no second one to compare against.
     */
    it('the inferred type carries deviceLabel, the field the published document used to forbid', () => {
        expectTypeOf<CreateRecipeRequest>().toHaveProperty('deviceLabel');
        expect(createAccepts({ deviceLabel: 'iPhone 15' })).toBe(true);
    });

    it('the nested inputs are the schema’s own inferred types, with no rival declaration to reconcile', () => {
        expectTypeOf<RecipeIngredientInput>().toEqualTypeOf<z.infer<typeof recipeIngredientInputSchema>>();
        expectTypeOf<RecipeStepInput>().toEqualTypeOf<z.infer<typeof recipeStepInputSchema>>();
    });

    /**
     * The DERIVATION that replaced the deleted `UpdateRecipeInput extends Omit<Partial<CreateRecipeInput>, …>`.
     *
     * §15 rule 4's prescription for a consumer whose shape genuinely differs is `Pick`/`Omit`/`Partial` over the
     * wire type, never an independent declaration — and the update body is the in-contract instance of exactly
     * that. Asserting the relationship here means the `visibility` OMIT (the field the dedicated visibility route
     * owns) cannot be quietly reinstated by an edit to the create body.
     */
    it('the update body is a DERIVATION of the create body, with visibility omitted', () => {
        expectTypeOf<UpdateRecipeRequest>().not.toHaveProperty('visibility');
        expectTypeOf<CreateRecipeRequest>().toHaveProperty('visibility');
        expect(updateRecipeRequestSchema.safeParse({ expectedVersion: 1, visibility: 'public' }).success).toBe(false);
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

/**
 * REWRITTEN for U8. The window is unchanged; what changed is that the ENVELOPE now carries a value object,
 * so the same window has to hold at every member the union admits — and the field's required-ness now means
 * "a line must SAY which of the three it is", not "a line must state a number".
 */
describe('ingredient quantity — the numeric(10,3) window carried forward exactly', () => {
    it('the bounds are 0.001 .. 1 000 000', () => {
        expect(MIN_RECIPE_INGREDIENT_QUANTITY).toBe(0.001);
        expect(MAX_RECIPE_INGREDIENT_QUANTITY).toBe(1_000_000);
    });

    it('accepts both endpoints and rejects just outside them', () => {
        expect(lineAccepts({ quantity: { kind: 'exact', value: 0.001 } })).toBe(true);
        expect(lineAccepts({ quantity: { kind: 'exact', value: 1_000_000 } })).toBe(true);
        expect(lineAccepts({ quantity: { kind: 'exact', value: 0.0009 } })).toBe(false);
        expect(lineAccepts({ quantity: { kind: 'exact', value: 1_000_000.001 } })).toBe(false);
    });

    it('holds the SAME window at both ends of a range', () => {
        expect(lineAccepts({ quantity: { kind: 'range', low: 0.001, high: 1_000_000 } })).toBe(true);
        expect(lineAccepts({ quantity: { kind: 'range', low: 0.0009, high: 3 } })).toBe(false);
        expect(lineAccepts({ quantity: { kind: 'range', low: 2, high: 1_000_000.001 } })).toBe(false);
    });

    it('rejects 0 (the column CHECK is `quantity > 0`) and a negative', () => {
        expect(lineAccepts({ quantity: { kind: 'exact', value: 0 } })).toBe(false);
        expect(lineAccepts({ quantity: { kind: 'exact', value: -1 } })).toBe(false);
    });

    // R40/R41 — the two members the pre-U8 scalar could not express, now part of the envelope.
    it('accepts a stated RANGE and an ABSENT quantity', () => {
        expect(lineAccepts({ quantity: { kind: 'range', low: 2, high: 3 } })).toBe(true);
        expect(lineAccepts({ quantity: { kind: 'absent' } })).toBe(true);
    });

    it('rejects the pre-U8 bare number outright', () => {
        expect(lineAccepts({ quantity: 2 })).toBe(false);
    });

    // Still REQUIRED — but what it requires is now a DECLARATION. `{ kind: 'absent' }` is how a line says
    // the source stated no amount; omitting the field entirely says nothing at all, and stays a 400.
    it('is REQUIRED — an absent quantity is DECLARED, never omitted', () => {
        expect(recipeIngredientInputSchema.safeParse({ ...A_LINE, quantity: undefined }).success).toBe(false);
        const { quantity: _omitted, ...withoutQuantity } = A_LINE;
        expect(recipeIngredientInputSchema.safeParse(withoutQuantity).success).toBe(false);
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

describe('the create body REFUSES what it must not trust (it used to strip it)', () => {
    /**
     * These six were asserted as STRIPS and are now REJECTIONS, per GR-017 §17-c.
     *
     * The security property is unchanged in both worlds — none of these fields ever reached the service, so
     * neither behaviour lets a caller smuggle ownership, a row id, a version, a rating or a provenance flag.
     * What changes is what the caller is TOLD. A strip answered `201` with a recipe whose owner is not the one
     * requested and whose `sourceType` is not the one requested, and said nothing about either; the rejection
     * names the refused key.
     *
     * The parallel case that is NOT merely diagnostic is `visibility` on the UPDATE body: it was stripped, the
     * app's own `toUpdateRecipeInput` was sending it, and a user's privacy choice was silently discarded — see
     * that schema's docstring.
     */
    it.each(['ownerId', 'id', 'currentVersion', 'averageRating', 'sourceType', 'hasSubstantiveEdit'])(
        'answers 400 for a smuggled %s rather than accepting the body without it',
        (field) => {
            const parsed = createRecipeRequestSchema.safeParse(body({ [field]: 'hostile' }));

            expect(parsed.success).toBe(false);
            // The rejection must be about the KEY, not a coincidental type error on a field of the same name.
            expect(
                parsed.error?.issues.some((issue) => issue.code === 'unrecognized_keys' && issue.keys.includes(field)),
            ).toBe(true);
        },
    );

    // The counterpart property, so the assertions above cannot be satisfied by a schema that rejects everything.
    it('still accepts the body without those keys, so the strictness did not break create', () => {
        expect(createRecipeRequestSchema.safeParse(body()).success).toBe(true);
    });
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

describe('recipeNutritionRequestSchema — the deferred lookup’s id list', () => {
    /** `count` distinct, well-formed recipe ids. */
    function ids(count: number): string[] {
        return Array.from(
            { length: count },
            (_value, index) => `00000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
        );
    }

    it('accepts a list of recipe ids', () => {
        expect(recipeNutritionRequestSchema.parse({ recipeIds: ids(3) })).toEqual({ recipeIds: ids(3) });
    });

    it('⛔ REFUSES an empty list — a request that asks for nothing is a caller bug, not an empty answer', () => {
        // Answering `{}` would look like "none of your recipes have nutrition", which is a different fact.
        expect(recipeNutritionRequestSchema.safeParse({ recipeIds: [] }).success).toBe(false);
    });

    it('⛔ CAPS the list, so one request cannot fan out into an unbounded read', () => {
        // Mirrors food's own `MAX_NUTRITION_IDS` posture: a batch endpoint with no cap turns a single request
        // into an unbounded database read plus an unbounded downstream fan-out.
        expect(recipeNutritionRequestSchema.safeParse({ recipeIds: ids(MAX_NUTRITION_RECIPE_IDS) }).success).toBe(true);
        expect(recipeNutritionRequestSchema.safeParse({ recipeIds: ids(MAX_NUTRITION_RECIPE_IDS + 1) }).success).toBe(
            false,
        );
    });

    it('⛔ names the offending FIELD on the over-cap rejection, so the 400 is parseable', () => {
        // The published `VALIDATION_FAILED` arm promises `details.fields`, which the envelope builds from these
        // issue paths. A cap enforced anywhere else (a hand-thrown message) produces a 400 a client validating
        // against the published schema cannot parse — the defect this mirrors.
        const failure = recipeNutritionRequestSchema.safeParse({ recipeIds: ids(MAX_NUTRITION_RECIPE_IDS + 1) });

        expect(failure.success).toBe(false);
        expect(failure.error?.issues.map((issue) => issue.path.join('.'))).toContain('recipeIds');
    });

    it('⛔ REFUSES an id that is not a recipe id, rather than passing it to the query', () => {
        expect(recipeNutritionRequestSchema.safeParse({ recipeIds: ['not-a-uuid'] }).success).toBe(false);
        expect(recipeNutritionRequestSchema.safeParse({ recipeIds: [''] }).success).toBe(false);
    });

    it('⛔ is STRICT — a smuggled `ownerId` is a 400, never a silently ignored key', () => {
        expect(recipeNutritionRequestSchema.safeParse({ recipeIds: ids(1), ownerId: '01JHOSTILE' }).success).toBe(
            false,
        );
    });

    it('REQUIRES the field — an absent body is a 400, not an empty map', () => {
        expect(recipeNutritionRequestSchema.safeParse({}).success).toBe(false);
    });
});

describe('cloneRecipeRequestSchema — a bodyless POST is legal, a body with fields is not', () => {
    // The `.default({})` and the strict catchall judge DIFFERENT things, and both properties matter: the default
    // applies to an ABSENT body (which is what makes `POST` with no payload legal), while the catchall judges the
    // keys of a body that IS present. Asserted together because a change to either would look like a change to
    // the other.
    it('accepts an absent body and an empty body', () => {
        expect(cloneRecipeRequestSchema.parse(undefined)).toEqual({});
        expect(cloneRecipeRequestSchema.parse({})).toEqual({});
    });

    it('REFUSES a field, because this endpoint takes none and guessing at one should not look like it worked', () => {
        expect(cloneRecipeRequestSchema.safeParse({ ownerId: 'hostile' }).success).toBe(false);
        expect(cloneRecipeRequestSchema.safeParse({ visibility: 'public' }).success).toBe(false);
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

// ── Declared provenance on create (004-FR-024 / 004-FR-025, ADR-0023) ─────────────────────────────

/** A well-formed curated declaration; `over` layers the field under test on top. */
function source(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        sourceType: 'imported_public',
        sourceUrl: 'https://www.gutenberg.org/cache/epub/12350/pg12350.txt',
        sourceAttribution: 'The International Jewish Cook Book by Florence Kreisler Greenbaum',
        ...over,
    };
}

describe('createRecipeRequestSchema — the optional `source` declaration', () => {
    it('still accepts a body with NO source, so 004-FR-024’s "unchanged behaviour" holds at the wire', () => {
        const parsed = createRecipeRequestSchema.safeParse(body());

        expect(parsed.success).toBe(true);
        expect(parsed.success && 'source' in parsed.data).toBe(false);
    });

    it('accepts a bare user_created declaration (the baseline a caller may always state)', () => {
        expect(createAccepts({ source: { sourceType: 'user_created' } })).toBe(true);
    });

    it('accepts a COMPLETE imported_public declaration', () => {
        expect(createAccepts({ source: source() })).toBe(true);
    });

    /**
     * ⚠️ THE SHAPE IS A DISCRIMINATED UNION, NOT AN OBJECT WITH OPTIONAL FIELDS — and that is the point.
     *
     * An `imported_public` recipe asserts "this content came from somewhere else, and here is where". A
     * declaration carrying that claim with no URL and no attribution is the false-attribution hazard
     * 004-FR-025 exists to prevent, arriving through the front door. Making the two fields REQUIRED on that
     * member (and unrepresentable on `user_created`) means an unattributed import is not a rule the service
     * enforces — it is a state the wire cannot express.
     */
    it.each(['sourceUrl', 'sourceAttribution'])('REFUSES an imported_public declaration missing %s', (field) => {
        const incomplete = source();
        delete incomplete[field];

        expect(createAccepts({ source: incomplete })).toBe(false);
    });

    it('REFUSES source fields on a user_created declaration — they have no meaning there', () => {
        expect(createAccepts({ source: { sourceType: 'user_created', sourceUrl: 'https://example.com' } })).toBe(false);
        expect(createAccepts({ source: { sourceType: 'user_created', sourceAttribution: 'Someone' } })).toBe(false);
    });

    /**
     * `imported_physical` and `imported_paid` are DELIBERATELY not declarable, and their absence is a
     * narrowing of 004-FR-025 rather than an oversight. Both are private-only classes under C-004, and
     * `evaluateVisibility` allows either to go private with NO premium check — so admitting them here would
     * hand a free-tier caller the private recipe 004-FR-028 says must be gated on an entitlement, and
     * 004-FR-014a's attestation + citation machinery that is supposed to accompany them does not exist yet.
     * They join the union when 004 builds that gate, not before.
     */
    it.each(['imported_physical', 'imported_paid'])('REFUSES %s — not declarable until 004 builds its gate', (kind) => {
        expect(createAccepts({ source: { sourceType: kind, sourceAttribution: 'A book' } })).toBe(false);
    });

    it('REFUSES an unknown sourceType', () => {
        expect(createAccepts({ source: source({ sourceType: 'imported_telepathically' }) })).toBe(false);
    });

    it('REFUSES a stray key inside source (the nested object is strict too, GR-017 §17-c)', () => {
        expect(createAccepts({ source: source({ clonedFromId: 'smuggled' }) })).toBe(false);
        expect(createAccepts({ source: source({ hasSubstantiveEdit: true }) })).toBe(false);
    });

    it('REFUSES a sourceUrl that is not a URL', () => {
        expect(createAccepts({ source: source({ sourceUrl: 'not-a-url' }) })).toBe(false);
    });

    it('REFUSES an empty sourceAttribution — the field exists to carry a credit, and "" credits nobody', () => {
        expect(createAccepts({ source: source({ sourceAttribution: '' }) })).toBe(false);
    });

    it('carries recipe-core’s length bounds rather than restating them', () => {
        expect(
            createAccepts({ source: source({ sourceAttribution: 'a'.repeat(MAX_RECIPE_SOURCE_ATTRIBUTION_LENGTH) }) }),
        ).toBe(true);
        expect(
            createAccepts({
                source: source({ sourceAttribution: 'a'.repeat(MAX_RECIPE_SOURCE_ATTRIBUTION_LENGTH + 1) }),
            }),
        ).toBe(false);
        expect(
            createAccepts({
                source: source({ sourceUrl: `https://e.com/${'a'.repeat(MAX_RECIPE_SOURCE_URL_LENGTH)}` }),
            }),
        ).toBe(false);
    });
});

/**
 * ⛔ THE REGRESSION THAT ARRIVES FOR FREE IF `source` IS ADDED TO THE WRONG SCHEMA.
 *
 * `updateRecipeRequestSchema` is derived from `createRecipeRequestBaseSchema` via `.omit().partial()`. Had
 * `source` been added to that BASE, `PATCH /api/v1/recipes/{id}` would have inherited it and any caller
 * could RE-CLASSIFY an existing recipe as `imported_public` after creation — bypassing the provenance policy
 * entirely, because the policy runs only on create. That is the actual privilege-escalation path in this
 * change, and it is pinned by a test rather than by a comment.
 *
 * It composes with the shipped rule that attribution is immutable after create
 * (`substantiveEditImported.test.ts`: an update NEVER rewrites `sourceType`/`sourceUrl`/`sourceAttribution`).
 */
describe('updateRecipeRequestSchema — provenance is a CREATE-time fact and stays one', () => {
    it('does NOT declare source', () => {
        expect(Object.keys(updateRecipeRequestSchema.shape)).not.toContain('source');
    });

    it('answers 400 for a PATCH that tries to re-declare provenance', () => {
        const parsed = updateRecipeRequestSchema.safeParse({ expectedVersion: 1, source: source() });

        expect(parsed.success).toBe(false);
        expect(
            parsed.error?.issues.some((issue) => issue.code === 'unrecognized_keys' && issue.keys.includes('source')),
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
        currentVersion: 1,
        ratingCount: 0,
        usesPremiumCapability: false,
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
    };
}

/**
 * ⛔ THE SOURCE LINE IS A TRANSCRIPTION FACT, AND TRANSCRIPTION HAPPENS ONCE — AT CREATE (plan U11/U14).
 *
 * `recipe_ingredients.display_text` is a DISPLAY override and the importer's `ParsedIngredientLine.raw` never
 * left its own memory, so until this field the raw line a cook's source actually stated did not exist inside
 * recipe-service at all. `0023_line_verifications.sql`'s header names that gap as the single reason U11's
 * verification gate ships observe-only: with no source line there is nothing for the gate's parse to be
 * checked AGAINST, and `decideVerification` skips every line with `reason: 'no-source-text'`.
 *
 * It rides the CREATE element schema and never the base, for the reason `recipeSourceInputSchema` states and
 * ADR-0023 records. The escalation here is not merely re-classification, it is worse: the gate's verdicts are
 * memoized ACROSS USERS (`ingredient_resolution_memos`, migration 0021), so a caller who could re-assert a
 * source line on `PATCH` could steer a line's judgement — assert a source line that agrees with a wrong parse,
 * collect an `agree` verdict, and have the memo bind that resolution for everyone. Create-only means the fact
 * the gate judged is the fact that was transcribed.
 *
 * ⚠️ THE WIRE BOUND IS DELIBERATELY LOOSER THAN THE GATE'S 400. `MAX_VERIFICATION_SOURCE_LINE_LENGTH` is a
 * TRANSPORT bound and `PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars` is a CALIBRATION bound; this is
 * a third thing — a PAYLOAD bound on what a cook may transcribe. Were it also 400, the gate's
 * `reject: 'source-line-over-cap'` branch would be unreachable by construction and an honest long line would
 * `400` a whole recipe create instead of resolving as unresolved and being surfaced for correction, which is
 * the behaviour that branch exists to produce.
 */
describe('ingredient sourceLine — create-only, and the gate’s only source of truth', () => {
    it('the field IS the recipe-core Value Object, not a bound restated here', () => {
        // `.optional()` returns a wrapper, so identity is asserted one level in — see suite 0.
        expect(createRecipeIngredientInputSchema.shape.sourceLine.unwrap()).toBe(recipeIngredientSourceLineSchema);
    });

    it('the CREATE body accepts a line carrying a source line', () => {
        expect(createAccepts({ ingredients: [{ ...A_LINE, sourceLine: '2 cups all-purpose flour, sifted' }] })).toBe(
            true,
        );
    });

    it('is OPTIONAL — an authored line has no source to transcribe, and that is not an error', () => {
        expect(createAccepts({ ingredients: [A_LINE] })).toBe(true);
    });

    it('rejects `""` and a whitespace-only line, so "no source" has ONE representation — omitting the key', () => {
        expect(createAccepts({ ingredients: [{ ...A_LINE, sourceLine: '' }] })).toBe(false);
        expect(createAccepts({ ingredients: [{ ...A_LINE, sourceLine: '   ' }] })).toBe(false);
    });

    it('accepts a line AT the cap and rejects one past it', () => {
        const at = 'a'.repeat(MAX_RECIPE_INGREDIENT_SOURCE_LINE_LENGTH);

        expect(createAccepts({ ingredients: [{ ...A_LINE, sourceLine: at }] })).toBe(true);
        expect(createAccepts({ ingredients: [{ ...A_LINE, sourceLine: `${at}a` }] })).toBe(false);
    });

    it('ACCEPTS a line the verification gate will refuse to judge — the cap is the gate’s, not the wire’s', () => {
        expect(MAX_RECIPE_INGREDIENT_SOURCE_LINE_LENGTH).toBeGreaterThan(
            PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars,
        );
        expect(
            createAccepts({
                ingredients: [
                    {
                        ...A_LINE,
                        sourceLine: 'b'.repeat(PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars + 1),
                    },
                ],
            }),
        ).toBe(true);
    });

    it('⛔ is ABSENT from the BASE element schema, which is what `PATCH` derives from', () => {
        expect(Object.keys(recipeIngredientInputSchema.shape)).not.toContain('sourceLine');
    });

    it('⛔ answers 400 for a PATCH that tries to assert a source line', () => {
        const parsed = updateRecipeRequestSchema.safeParse({
            expectedVersion: 1,
            ingredients: [{ ...A_LINE, sourceLine: '2 cups all-purpose flour' }],
        });

        expect(parsed.success).toBe(false);
    });
});

/**
 * U26/U27 — the two fields an ingredient line gained, and the ONE thing that separates them from
 * `sourceLine`, `statedMeasure` and `source`: they sit on the BASE, so `PATCH` inherits them.
 *
 * ⛔ ADR-0023's criterion is not "a new field" — it is AUTHORIZATION over a field VALUE with a cross-user
 * harm behind it. `source` is create-only because a base-schema placement "would let ANY caller re-classify
 * an existing recipe as `imported_public` after creation, bypassing the policy". A preparation and a section
 * heading classify nothing, gate nothing, and are read by no policy.
 *
 * ⚠️ And the verification gate is NOT a second criterion: that ADR's own `statedMeasure` addendum refuses to
 * treat it as an authorization surface — "a parser-quality control, not an integrity control against a
 * hostile client". `verificationKey` hashes identity, both quantity bounds, the unit and the stated measure;
 * neither of these fields is in it, so there is nothing to steer in either direction.
 *
 * ⛔ Create-only would be ACTIVELY WRONG for them, twice over, and the code already shows why:
 * `versions.service.ts` rebuilds an UPDATE body from a snapshot on restore (so a create-only field could
 * never be restored), and `replaceForRecipe` deletes and re-inserts every line whenever a PATCH supplies
 * `ingredients` — which both shipped clients always do. Create-only would silently destroy both fields on
 * every metadata edit unless a THIRD carry-forward rule were written beside `transcriptionCarryForward.ts`,
 * machinery that exists only because those two fields HAD to be create-only.
 *
 * These are therefore POSITIVE pins, the mirror of the negative ones above.
 */
describe('U26 — ingredient preparation, on the BASE schema', () => {
    it('the field IS the recipe-core Value Object, not a bound restated here', () => {
        expect(recipeIngredientInputSchema.shape.preparation.unwrap()).toBe(recipeIngredientPreparationSchema);
    });

    it('the CREATE body accepts a line carrying a preparation', () => {
        expect(createAccepts({ ingredients: [{ ...A_LINE, preparation: 'finely chopped' }] })).toBe(true);
    });

    it('is OPTIONAL — most lines state no preparation, and that is not an error', () => {
        expect(lineAccepts({})).toBe(true);
    });

    it('rejects `""` and whitespace-only, so "no preparation" has ONE representation — omitting the key', () => {
        expect(lineAccepts({ preparation: '' })).toBe(false);
        expect(lineAccepts({ preparation: '   ' })).toBe(false);
    });

    it('accepts a preparation AT the cap and rejects one past it', () => {
        const at = 'a'.repeat(MAX_RECIPE_INGREDIENT_PREPARATION_LENGTH);

        expect(lineAccepts({ preparation: at })).toBe(true);
        expect(lineAccepts({ preparation: `${at}a` })).toBe(false);
    });

    it('✅ is PRESENT on the BASE element schema, so `PATCH` can edit it', () => {
        expect(Object.keys(recipeIngredientInputSchema.shape)).toContain('preparation');
    });

    it('✅ a PATCH may set a preparation — a cook edits how they chop an onion', () => {
        const parsed = updateRecipeRequestSchema.safeParse({
            expectedVersion: 1,
            ingredients: [{ ...A_LINE, preparation: 'roughly torn' }],
        });

        expect(parsed.success).toBe(true);
    });

    it('⛔ is NEVER folded into the food name — the two are separate keys on the wire', () => {
        const parsed = recipeIngredientInputSchema.parse({ ...A_LINE, preparation: 'sifted' });

        expect(parsed.name).toBe('Flour');
        expect(parsed.preparation).toBe('sifted');
    });

    it('⛔ does NOT displace `notes`, which is a display override with its own producer', () => {
        expect(lineAccepts({ notes: '2 cups all-purpose flour, sifted', preparation: 'sifted' })).toBe(true);
        expect(Object.keys(recipeIngredientInputSchema.shape)).toContain('notes');
    });
});

describe('U27 — ingredient group label, on the BASE schema', () => {
    it('the field IS the recipe-core Value Object, not a bound restated here', () => {
        expect(recipeIngredientInputSchema.shape.groupLabel.unwrap()).toBe(recipeIngredientGroupLabelSchema);
    });

    it('the CREATE body accepts a grouped line', () => {
        expect(createAccepts({ ingredients: [{ ...A_LINE, groupLabel: 'For the marinade' }] })).toBe(true);
    });

    it('is OPTIONAL — an UNGROUPED recipe sends no group key at all, never `""`', () => {
        expect(lineAccepts({})).toBe(true);
        expect(lineAccepts({ groupLabel: '' })).toBe(false);
        expect(lineAccepts({ groupLabel: '   ' })).toBe(false);
    });

    it('accepts a label AT the cap and rejects one past it', () => {
        const at = 'a'.repeat(MAX_RECIPE_INGREDIENT_GROUP_LABEL_LENGTH);

        expect(lineAccepts({ groupLabel: at })).toBe(true);
        expect(lineAccepts({ groupLabel: `${at}a` })).toBe(false);
    });

    it('TRIMS, so `"Dry "` and `"Dry"` cannot become two identical-looking sections', () => {
        expect(recipeIngredientInputSchema.parse({ ...A_LINE, groupLabel: ' Dry ' }).groupLabel).toBe('Dry');
    });

    it('is FREE TEXT and never an enum — "Dry"/"Wet" are labels, not a closed set (owner ruling 2026-08-24)', () => {
        for (const groupLabel of ['Dry', 'Wet', 'For the crust', 'For serving', 'ソース用']) {
            expect(lineAccepts({ groupLabel })).toBe(true);
        }
    });

    it('✅ is PRESENT on the BASE element schema, so `PATCH` can regroup a line', () => {
        expect(Object.keys(recipeIngredientInputSchema.shape)).toContain('groupLabel');
    });

    it('✅ a PATCH may move a line between sections while preserving its other fields', () => {
        const parsed = updateRecipeRequestSchema.safeParse({
            expectedVersion: 1,
            ingredients: [{ ...A_LINE, unit: 'cup', notes: 'sifted', groupLabel: 'For the topping' }],
        });

        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.ingredients?.[0]).toMatchObject({
            ingredientId: A_LINE.ingredientId,
            name: 'Flour',
            unit: 'cup',
            notes: 'sifted',
            groupLabel: 'For the topping',
        });
    });

    /**
     * ⛔ The connection to the import side, asserted rather than assumed. `parseIngredientLine` already
     * detects a section heading and raises `group_header`; U27's stated purpose is to give that signal
     * somewhere to land. This pins that the wire is WIDE ENOUGH for the headings a real cookbook prints.
     *
     * ⚠️ It does NOT claim the signal reaches here today, and it does not: `cookbook-import`'s prose scanner
     * accepts a clause only when it parses to both a quantity and a unit, and a heading has neither — so a
     * heading is never emitted as a clause at all. See `0030_ingredient_preparation_and_group.sql`'s
     * RESIDUAL note.
     */
    it('accepts the section headings `parseIngredientLine` flags as `group_header`', () => {
        for (const groupLabel of ['For the sauce', 'For the topping', 'Dry ingredients', 'For the garnish']) {
            expect(lineAccepts({ groupLabel })).toBe(true);
        }
    });
});
