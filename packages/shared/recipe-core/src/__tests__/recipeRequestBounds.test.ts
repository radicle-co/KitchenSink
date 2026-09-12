/**
 * THE RECIPE REQUEST BOUNDS — the bound-by-bound proof, at the bounds' own home.
 *
 * OWNER RULING: the recipe request bounds live in `recipe-core`, so BOTH apps and the service inherit one
 * number rather than each restating it. This suite is that authority's own test, and it is written to the
 * mutation lens: every bound is asserted as an ACCEPT at the boundary AND a REJECT one step past it, so
 * deleting a `.max()`, widening a constant, or dropping a `.min(1)` reds a case here. An accept-only test
 * would pass against a schema with no bounds at all.
 *
 * ── WHAT IS AND IS NOT DERIVED ──
 *
 * The two STORAGE ceilings ({@link INT4_CEILING}, {@link NUMERIC_8_2_CEILING}) are asserted here as plain
 * numbers. They are NOT derived from a drizzle column and must never be: `recipe-core` is a zod-only leaf
 * that both apps bundle, and letting a storage type reach it is the coupling §15.2 removed. The equality
 * against the real columns is asserted, separately and mechanically, by each service's own
 * `storageCapacity.test.ts` — which READS both models and compares them.
 *
 * The character limits have NO storage floor to derive from at all: every text column behind them is
 * unbounded `text`, so each is purely a PRODUCT decision. That is recorded where a reader would otherwise
 * go looking for a column to blame.
 */
import { describe, expect, it } from 'vitest';

import {
    INT4_CEILING,
    MAX_RECIPE_CUISINE_LENGTH,
    MAX_RECIPE_DESCRIPTION_LENGTH,
    MAX_RECIPE_INGREDIENTS,
    MAX_RECIPE_INGREDIENT_NAME_LENGTH,
    MAX_RECIPE_INGREDIENT_QUANTITY,
    MAX_RECIPE_LIST_PAGE_SIZE,
    MAX_RECIPE_TAGS,
    MAX_RECIPE_TITLE_LENGTH,
    MIN_RECIPE_INGREDIENT_QUANTITY,
    NUMERIC_8_2_CEILING,
    recipeCuisineSchema,
    recipeDescriptionSchema,
    recipeExpectedVersionSchema,
    recipeIngredientGroupLabelSchema,
    recipeIngredientIdSchema,
    recipeIngredientNameSchema,
    recipeIngredientNotesSchema,
    recipeIngredientPreparationSchema,
    recipeIngredientQuantitySchema,
    recipeIngredientUnitSchema,
    MAX_RECIPE_INGREDIENT_GROUP_LABEL_LENGTH,
    MAX_RECIPE_INGREDIENT_PREPARATION_LENGTH,
    recipeLineNutritionSchema,
    recipeListMemberSchema,
    recipeMinutesSchema,
    recipeServingsSchema,
    recipeStepInstructionSchema,
    recipeTimerSecondsSchema,
    recipeTitleSchema,
} from '../recipeRequestBounds.js';
import { recipeIngredientViewSchema, recipeSchema, recipeStepViewSchema } from '../recipe.types.js';

/**
 * Whether a schema accepts a value.
 *
 * @param schema - The schema under test.
 * @param value - The candidate value.
 * @returns True when the value parses. Pure.
 */
function accepts(schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown): boolean {
    return schema.safeParse(value).success;
}

// ── The two storage ceilings ──────────────────────────────────────────────────────────────────────

describe('the storage ceilings are the physical limits, spelled once', () => {
    it('INT4_CEILING is the int4 maximum', () => {
        expect(INT4_CEILING).toBe(2_147_483_647);
    });

    it('NUMERIC_8_2_CEILING is one representable step below 10^6, not 10^6', () => {
        // Postgres ROUNDS to the declared scale BEFORE range-checking, so `numeric(8,2)` rejects `999999.996`
        // (it rounds to `1000000.00`) while accepting `999999.99`. Verified against a live PostgreSQL 16.
        expect(NUMERIC_8_2_CEILING).toBe(999_999.99);
    });
});

// ── Character limits: PRODUCT decisions, no storage floor ─────────────────────────────────────────

describe('title — max 200, and a min(1) that fixes a response no client could read', () => {
    it('the cap is 200', () => {
        expect(MAX_RECIPE_TITLE_LENGTH).toBe(200);
    });

    it('accepts 200 characters and REJECTS 201', () => {
        expect(accepts(recipeTitleSchema, 'a'.repeat(200))).toBe(true);
        expect(accepts(recipeTitleSchema, 'a'.repeat(201))).toBe(false);
    });

    it('REJECTS a 50 000-character title — the body an unbounded title schema would accept', () => {
        expect(accepts(recipeTitleSchema, 'a'.repeat(50_000))).toBe(false);
    });

    it('rejects `""`, because the READ schema rejects it too', () => {
        // `recipeSchema.title` is `min(1)`, and every recipe-returning client method parses its response with
        // it — so a server that accepted `''` would store a title it could then send in a body no client
        // could read. This pairing is the reason, so it is asserted rather than described.
        expect(accepts(recipeTitleSchema, '')).toBe(false);
        expect(accepts(recipeSchema.shape.title, '')).toBe(false);
    });
});

describe('description — max 5000, and `""` DELIBERATELY accepted', () => {
    it('the cap is 5000', () => {
        expect(MAX_RECIPE_DESCRIPTION_LENGTH).toBe(5000);
    });

    it('accepts 5000 characters and rejects 5001', () => {
        expect(accepts(recipeDescriptionSchema, 'a'.repeat(5000))).toBe(true);
        expect(accepts(recipeDescriptionSchema, 'a'.repeat(5001))).toBe(false);
    });

    it('ACCEPTS `""` — the one min(1) not adopted, and both halves of the reason hold', () => {
        // (a) `''` is a legal value of the READ schema (`z.string().default('')`), so unlike title/cuisine
        // there is no body-the-client-cannot-read to fix; and (b) `''` is the ONLY way a caller can CLEAR a
        // previously-set description, since an omitted field means "leave unchanged".
        expect(accepts(recipeDescriptionSchema, '')).toBe(true);
        expect(accepts(recipeSchema.shape.description, '')).toBe(true);
    });
});

describe('cuisine — max 100, min(1) adopted', () => {
    it('the cap is 100', () => {
        expect(MAX_RECIPE_CUISINE_LENGTH).toBe(100);
    });

    it('accepts 100 characters and rejects 101', () => {
        expect(accepts(recipeCuisineSchema, 'a'.repeat(100))).toBe(true);
        expect(accepts(recipeCuisineSchema, 'a'.repeat(101))).toBe(false);
    });

    it('rejects `""`, which the read schema also rejects', () => {
        expect(accepts(recipeCuisineSchema, '')).toBe(false);
        expect(accepts(recipeSchema.shape.cuisine, '')).toBe(false);
    });
});

describe('ingredient line strings', () => {
    it('name is capped at 120 and rejects `""`', () => {
        expect(MAX_RECIPE_INGREDIENT_NAME_LENGTH).toBe(120);
        expect(accepts(recipeIngredientNameSchema, 'a'.repeat(120))).toBe(true);
        expect(accepts(recipeIngredientNameSchema, 'a'.repeat(121))).toBe(false);
        expect(accepts(recipeIngredientNameSchema, '')).toBe(false);
    });

    it('unit rejects `""` so "unitless" has ONE representation — omitting the key', () => {
        expect(accepts(recipeIngredientUnitSchema, 'g')).toBe(true);
        expect(accepts(recipeIngredientUnitSchema, '')).toBe(false);
    });

    it('notes rejects `""`, which the read schema rejects too', () => {
        expect(accepts(recipeIngredientNotesSchema, 'finely chopped')).toBe(true);
        expect(accepts(recipeIngredientNotesSchema, '')).toBe(false);
        expect(accepts(recipeIngredientViewSchema.shape.notes, '')).toBe(false);
    });
});

describe('step instruction — min(1) adopted, and NO maximum, deliberately', () => {
    it('rejects `""`, which the read schema rejects on the way back out', () => {
        expect(accepts(recipeStepInstructionSchema, '')).toBe(false);
        expect(accepts(recipeStepViewSchema.shape.instruction, '')).toBe(false);
    });

    it('accepts a very long instruction — no cap has ever existed and inventing one would break live data', () => {
        // The column is unbounded `text`. A maximum here is a PRODUCT decision, flagged rather than guessed
        // at: any number chosen now would start rejecting steps that work today.
        expect(accepts(recipeStepInstructionSchema, 'a'.repeat(50_000))).toBe(true);
    });
});

describe('tags and dietary flags — non-empty members', () => {
    it('rejects an empty member', () => {
        expect(accepts(recipeListMemberSchema, 'vegan')).toBe(true);
        expect(accepts(recipeListMemberSchema, '')).toBe(false);
    });

    it('the array caps are 100 ingredients and 50 tags', () => {
        expect(MAX_RECIPE_INGREDIENTS).toBe(100);
        expect(MAX_RECIPE_TAGS).toBe(50);
    });
});

// ── Numbers: the int4-backed fields that were a 500 and are now a 400 ─────────────────────────────

describe('servings — positive, whole, and bounded by the int4 column it writes', () => {
    it('accepts 1 and the int4 ceiling', () => {
        expect(accepts(recipeServingsSchema, 1)).toBe(true);
        expect(accepts(recipeServingsSchema, INT4_CEILING)).toBe(true);
    });

    it('REJECTS one past the int4 ceiling — this exact value was a measured 500', () => {
        // `POST /api/v1/recipes` with `servings: 9999999999` passed validation and died at the INSERT with
        // `22003 value "9999999999" is out of range for type integer`, which the exception filter collapsed
        // to a 500. It is a 400.
        expect(accepts(recipeServingsSchema, INT4_CEILING + 1)).toBe(false);
        expect(accepts(recipeServingsSchema, 9_999_999_999)).toBe(false);
        expect(accepts(recipeServingsSchema, 1e300)).toBe(false);
    });

    it('rejects 0, a negative, and a fraction', () => {
        expect(accepts(recipeServingsSchema, 0)).toBe(false);
        expect(accepts(recipeServingsSchema, -1)).toBe(false);
        expect(accepts(recipeServingsSchema, 2.5)).toBe(false);
    });
});

describe('minutes (prep/cook/total) — non-negative, whole, int4-bounded', () => {
    it('accepts 0 and the int4 ceiling', () => {
        // 0 is legal here and NOT for servings: a no-cook recipe has 0 cook minutes.
        expect(accepts(recipeMinutesSchema, 0)).toBe(true);
        expect(accepts(recipeMinutesSchema, INT4_CEILING)).toBe(true);
    });

    it('REJECTS one past the int4 ceiling — each of the three was a measured 500', () => {
        expect(accepts(recipeMinutesSchema, INT4_CEILING + 1)).toBe(false);
        expect(accepts(recipeMinutesSchema, 9_999_999_999)).toBe(false);
    });

    it('rejects a negative and a fraction', () => {
        expect(accepts(recipeMinutesSchema, -1)).toBe(false);
        expect(accepts(recipeMinutesSchema, 10.5)).toBe(false);
    });
});

describe('timerSeconds — STRICTLY positive, int4-bounded', () => {
    it('accepts 1 and the int4 ceiling', () => {
        expect(accepts(recipeTimerSecondsSchema, 1)).toBe(true);
        expect(accepts(recipeTimerSecondsSchema, INT4_CEILING)).toBe(true);
    });

    it('REJECTS one past the int4 ceiling — the fifth measured 500', () => {
        expect(accepts(recipeTimerSecondsSchema, INT4_CEILING + 1)).toBe(false);
    });

    it('REJECTS 0, because the column CHECK is `timer_seconds > 0` — "no timer" is an omitted key', () => {
        // A literal `0` reached the INSERT and violated the check. This is a 500 → 400 fix, not tidiness.
        expect(accepts(recipeTimerSecondsSchema, 0)).toBe(false);
    });
});

describe('expectedVersion — positive, int4-bounded because it reaches a WHERE clause', () => {
    it('accepts 1 and the int4 ceiling, rejects one past it', () => {
        expect(accepts(recipeExpectedVersionSchema, 1)).toBe(true);
        expect(accepts(recipeExpectedVersionSchema, INT4_CEILING)).toBe(true);
        // `WHERE current_version = $1` with an out-of-range parameter fails with the same `22003` an INSERT
        // would — a 500 for what is plainly a bad request.
        expect(accepts(recipeExpectedVersionSchema, INT4_CEILING + 1)).toBe(false);
    });

    it('rejects 0 and a negative — no row ever carries them', () => {
        expect(accepts(recipeExpectedVersionSchema, 0)).toBe(false);
        expect(accepts(recipeExpectedVersionSchema, -1)).toBe(false);
    });
});

describe('per-line nutrition overrides — bounded by their numeric(8,2) column', () => {
    it('accepts 0 and the exact ceiling', () => {
        expect(accepts(recipeLineNutritionSchema, 0)).toBe(true);
        expect(accepts(recipeLineNutritionSchema, NUMERIC_8_2_CEILING)).toBe(true);
    });

    it('REJECTS just past the ceiling, including the value Postgres ROUNDS into overflow', () => {
        expect(accepts(recipeLineNutritionSchema, 1_000_000)).toBe(false);
        // `999999.996` rounds to `1000000.00` at scale 2 and overflows, so the bound must exclude it.
        expect(accepts(recipeLineNutritionSchema, 999_999.996)).toBe(false);
    });

    it('rejects a negative — no macro is negative', () => {
        expect(accepts(recipeLineNutritionSchema, -1)).toBe(false);
    });
});

describe('ingredient quantity — the numeric(10,3) window', () => {
    it('the bounds are 0.001 .. 1 000 000', () => {
        expect(MIN_RECIPE_INGREDIENT_QUANTITY).toBe(0.001);
        expect(MAX_RECIPE_INGREDIENT_QUANTITY).toBe(1_000_000);
    });

    it('accepts both endpoints and rejects just outside them', () => {
        expect(accepts(recipeIngredientQuantitySchema, 0.001)).toBe(true);
        expect(accepts(recipeIngredientQuantitySchema, 1_000_000)).toBe(true);
        // Below the column's scale, `0.0009` rounds to `0.000` and then violates `CHECK (quantity > 0)` —
        // an uncaught 500 that aborted the whole recipe transaction.
        expect(accepts(recipeIngredientQuantitySchema, 0.0009)).toBe(false);
        expect(accepts(recipeIngredientQuantitySchema, 1_000_000.001)).toBe(false);
    });

    it('rejects 0 and a negative', () => {
        expect(accepts(recipeIngredientQuantitySchema, 0)).toBe(false);
        expect(accepts(recipeIngredientQuantitySchema, -1)).toBe(false);
    });
});

describe('ingredientId — a real UUID, not "any non-empty string"', () => {
    it('accepts a UUID', () => {
        expect(accepts(recipeIngredientIdSchema, '00000000-0000-4000-8000-0000000000aa')).toBe(true);
    });

    it('REJECTS a non-UUID — composing recipe-core`s idSchema here would have widened this field', () => {
        // `idSchema` is `z.string().min(1)` (it must also describe app-user ULIDs), so composing it would
        // QUIETLY widen this from "a UUID" to "any non-empty string".
        expect(accepts(recipeIngredientIdSchema, 'not-a-uuid')).toBe(false);
        expect(accepts(recipeIngredientIdSchema, 'ing-1')).toBe(false);
        expect(accepts(recipeIngredientIdSchema, '')).toBe(false);
    });
});

describe('the list page size cap', () => {
    it('is 100', () => {
        expect(MAX_RECIPE_LIST_PAGE_SIZE).toBe(100);
    });
});

/**
 * U26/U27 — the two fields an ingredient line gained, and the shape of "absent" for each.
 *
 * ⛔ Both TRIM before they bound, following `recipeIngredientSourceLineSchema`'s idiom rather than the
 * bare `.min(1)` that `notes` and `unit` use. Whitespace-only is a SECOND SPELLING of absent, and for a
 * group label it is worse than redundant: `"Dry "` and `"Dry"` would render as two sections wearing the
 * same visible heading, with no way for a reader to tell them apart or a cook to merge them.
 */
describe('U26 — ingredient preparation', () => {
    it('is capped at 120 and rejects `""`', () => {
        expect(MAX_RECIPE_INGREDIENT_PREPARATION_LENGTH).toBe(120);
        expect(accepts(recipeIngredientPreparationSchema, 'finely chopped')).toBe(true);
        expect(accepts(recipeIngredientPreparationSchema, 'a'.repeat(120))).toBe(true);
        expect(accepts(recipeIngredientPreparationSchema, 'a'.repeat(121))).toBe(false);
        expect(accepts(recipeIngredientPreparationSchema, '')).toBe(false);
    });

    it('REFUSES a whitespace-only preparation rather than storing one', () => {
        expect(accepts(recipeIngredientPreparationSchema, '   ')).toBe(false);
        expect(accepts(recipeIngredientPreparationSchema, '\t\n')).toBe(false);
    });

    it('trims, so the stored value is the phrase and not the typing around it', () => {
        expect(recipeIngredientPreparationSchema.parse('  finely chopped  ')).toBe('finely chopped');
    });

    it('bounds AFTER trimming — 120 characters of content plus spaces is still 120 characters', () => {
        expect(accepts(recipeIngredientPreparationSchema, `  ${'a'.repeat(120)}  `)).toBe(true);
    });

    it('the READ schema accepts what the request schema produces, and still rejects `""`', () => {
        expect(accepts(recipeIngredientViewSchema.shape.preparation, 'finely chopped')).toBe(true);
        expect(accepts(recipeIngredientViewSchema.shape.preparation, '')).toBe(false);
        // ⚠️ NO maximum on the read side, deliberately — the `recipeIngredientNotesSchema` precedent: a response
        // has to be able to carry a value persisted before the bound existed.
        expect(accepts(recipeIngredientViewSchema.shape.preparation, 'a'.repeat(500))).toBe(true);
    });
});

describe('U27 — ingredient group label', () => {
    it('is capped at 60 and rejects `""`', () => {
        expect(MAX_RECIPE_INGREDIENT_GROUP_LABEL_LENGTH).toBe(60);
        expect(accepts(recipeIngredientGroupLabelSchema, 'For the marinade')).toBe(true);
        expect(accepts(recipeIngredientGroupLabelSchema, 'a'.repeat(60))).toBe(true);
        expect(accepts(recipeIngredientGroupLabelSchema, 'a'.repeat(61))).toBe(false);
        expect(accepts(recipeIngredientGroupLabelSchema, '')).toBe(false);
    });

    it('REFUSES a whitespace-only label — a section with an invisible heading is not a section', () => {
        expect(accepts(recipeIngredientGroupLabelSchema, '   ')).toBe(false);
    });

    it('TRIMS, so `"Dry "` and `"Dry"` are the same section rather than two identical-looking ones', () => {
        expect(recipeIngredientGroupLabelSchema.parse(' Dry ')).toBe('Dry');
        expect(recipeIngredientGroupLabelSchema.parse('Dry')).toBe(recipeIngredientGroupLabelSchema.parse(' Dry '));
    });

    it('is FREE TEXT and never an enum — "Dry" and "Wet" are two labels among many (owner ruling 2026-08-24)', () => {
        for (const label of ['Dry', 'Wet', 'For the crust', 'Für den Teig', 'ソース用']) {
            expect(accepts(recipeIngredientGroupLabelSchema, label)).toBe(true);
        }
    });

    /**
     * ⛔ The connection to the import side, asserted rather than assumed. `parseIngredientLine` already
     * detects a section heading and raises `group_header`; U27's whole purpose is to give that signal
     * somewhere to land. This pins that the label schema is WIDE ENOUGH for the headings that parser flags —
     * if a future bound narrowed below what a real cookbook prints, this reds.
     */
    it('accepts the section headings a real cookbook prints', () => {
        for (const heading of ['For the sauce', 'For the topping', 'Dry ingredients', 'For the garnish']) {
            expect(accepts(recipeIngredientGroupLabelSchema, heading)).toBe(true);
        }
    });

    it('the READ schema accepts what the request schema produces, and still rejects `""`', () => {
        expect(accepts(recipeIngredientViewSchema.shape.groupLabel, 'For the marinade')).toBe(true);
        expect(accepts(recipeIngredientViewSchema.shape.groupLabel, '')).toBe(false);
        expect(accepts(recipeIngredientViewSchema.shape.groupLabel, 'a'.repeat(500))).toBe(true);
    });
});
