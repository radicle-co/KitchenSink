/**
 * Unit tests for the editor's display caps vs the wire's bounds (`form/limits.ts`).
 *
 * ⚠️ These 2 describe blocks came from `model.test.ts`, which covered all of `form/model.ts`
 * before it was split into one module per concern. No assertion was changed, added or dropped in the
 * move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';
import {
    MAX_RECIPE_DESCRIPTION_LENGTH,
    MAX_RECIPE_TITLE_LENGTH,
    recipeDescriptionSchema,
    recipeTitleSchema,
} from '@kitchensink/recipe-core';
import { createRecipeRequestSchema } from '@kitchensink/schema-recipe';
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from '../limits.js';

describe('the editor INHERITS the wire bound rather than restating it (owner ruling)', () => {
    // The bounds live in `@kitchensink/recipe-core`, and `recipe-service`'s `recipes.schema.ts` composes the
    // very same objects into the published request body. These assertions close the loop from THIS side: the
    // number the editor measures itself against is the number the server enforces, so the pair below cannot
    // drift the way an independently-authored client-side limit would.

    it('the wire`s title field IS the recipe-core Value Object the form validates with', () => {
        expect(createRecipeRequestSchema.shape.title).toBe(recipeTitleSchema);
    });

    it('the wire`s description field wraps the recipe-core Value Object', () => {
        expect(createRecipeRequestSchema.shape.description.unwrap()).toBe(recipeDescriptionSchema);
    });

    it('the exported constants are the ones behind those schemas', () => {
        // Mutation-relevant: were `MAX_RECIPE_TITLE_LENGTH` to drift from `recipeTitleSchema`'s actual cap, the
        // "stricter, never looser" comparison below would be measuring against a number nothing enforces.
        expect(recipeTitleSchema.safeParse('a'.repeat(MAX_RECIPE_TITLE_LENGTH)).success).toBe(true);
        expect(recipeTitleSchema.safeParse('a'.repeat(MAX_RECIPE_TITLE_LENGTH + 1)).success).toBe(false);
        expect(recipeDescriptionSchema.safeParse('a'.repeat(MAX_RECIPE_DESCRIPTION_LENGTH)).success).toBe(true);
        expect(recipeDescriptionSchema.safeParse('a'.repeat(MAX_RECIPE_DESCRIPTION_LENGTH + 1)).success).toBe(false);
    });
});

describe('the editor may be STRICTER than the wire, never LOOSER (§15.2)', () => {
    // The editor caps `title` at 64 and `description` at 256 (w3/e6) with a hard `maxLength` on the input and
    // a live "N/64" counter, while the SERVER accepts 200 and 5000. A tighter editor is a legitimate product
    // choice — a title has to fit a card. A LOOSER one is a bug: the user types something the input accepts
    // and the API then rejects on submit, which is the failure mode centralizing the zod exists to end.
    //
    // ⚠️ The 3× / 20× gap between the two numbers is real and was NOT set deliberately — the pair were
    // authored independently. Which number is right for the product is an open question; this test only fixes
    // the DIRECTION, so the question can be answered later without a regression in the meantime.

    it('the title display cap does not exceed the wire cap', () => {
        expect(TITLE_MAX_LENGTH).toBeLessThanOrEqual(MAX_RECIPE_TITLE_LENGTH);
    });

    it('the description display cap does not exceed the wire cap', () => {
        expect(DESCRIPTION_MAX_LENGTH).toBeLessThanOrEqual(MAX_RECIPE_DESCRIPTION_LENGTH);
    });

    it('a title the editor allows is one the wire accepts', () => {
        const atCap = 'a'.repeat(TITLE_MAX_LENGTH);

        expect(createRecipeRequestSchema.shape.title.safeParse(atCap).success).toBe(true);
    });

    it('a description the editor allows is one the wire accepts', () => {
        const atCap = 'a'.repeat(DESCRIPTION_MAX_LENGTH);

        expect(createRecipeRequestSchema.shape.description.safeParse(atCap).success).toBe(true);
    });
});
