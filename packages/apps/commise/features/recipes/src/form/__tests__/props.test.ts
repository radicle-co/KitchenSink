/**
 * Unit tests for the difficulty picker's pure helpers (FR-001b): {@link setDifficulty} (the single
 * set/clear transition both platform leaves share) and {@link difficultyOptions} (the ordered, localized
 * option set). Kept mutation-strong: clearing must REMOVE the key (so the update mapper can distinguish
 * "not stated" from a stated value), never store an explicit `undefined`.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import { classifyUnit, normalizeUnit, RECIPE_MEAL_TYPES, RecipeDifficulty } from '@kitchensink/recipe-core';

import { makeRecipeFormValues } from '../../__fixtures__/index.js';
import { recipeFormMessages, type RecipeFormMessages } from '../messages.js';
import type { RecipeFormIngredient, RecipeFormValues } from '../model.js';
import type { ResolvedRecipeFormIngredient } from '../props.js';
import {
    addChip,
    appendResolvedIngredient,
    difficultyOptions,
    ingredientSections,
    mealTypeOptions,
    parseQuantityBound,
    quantityInputValue,
    removeChipAt,
    setDifficulty,
    setIngredientQuantityHigh,
    setIngredientQuantityLow,
    setMealType,
    unitClassNote,
    unresolvedLineNote,
    updateIngredientAt,
} from '../props.js';

const messages: Pick<
    RecipeFormMessages,
    'difficultyEasy' | 'difficultyMedium' | 'difficultyHard' | 'difficultyNotStated'
> = {
    difficultyEasy: 'Easy',
    difficultyMedium: 'Medium',
    difficultyHard: 'Hard',
    difficultyNotStated: 'Not stated',
};

describe('setDifficulty', () => {
    it('states a difficulty when given a value', () => {
        const next = setDifficulty(makeRecipeFormValues(), RecipeDifficulty.HARD);

        expect(next.difficulty).toBe('hard');
    });

    it('overwrites a previously-stated difficulty', () => {
        const next = setDifficulty(
            makeRecipeFormValues({ difficulty: RecipeDifficulty.EASY }),
            RecipeDifficulty.MEDIUM,
        );

        expect(next.difficulty).toBe('medium');
    });

    it('REMOVES the difficulty key when cleared (not stored as undefined)', () => {
        // Mutation guard: an implementation that set `difficulty: undefined` would keep the key present, and
        // the update mapper (which branches on `values.difficulty === undefined`) would still clear correctly
        // — but `exactOptionalPropertyTypes` forbids it and the intent is a genuine absence. Pin the absence.
        const next = setDifficulty(makeRecipeFormValues({ difficulty: RecipeDifficulty.HARD }), undefined);

        expect(next.difficulty).toBeUndefined();
        expect('difficulty' in next).toBe(false);
    });

    it('does not mutate the input values', () => {
        const values = makeRecipeFormValues({ difficulty: RecipeDifficulty.HARD });

        setDifficulty(values, undefined);

        expect(values.difficulty).toBe('hard');
    });
});

describe('difficultyOptions', () => {
    it('lists Easy, Medium, Hard, then a not-stated (clear) option in order', () => {
        const options = difficultyOptions(messages as RecipeFormMessages);

        expect(options.map((option) => option.label)).toEqual(['Easy', 'Medium', 'Hard', 'Not stated']);
        expect(options.map((option) => option.value)).toEqual([
            RecipeDifficulty.EASY,
            RecipeDifficulty.MEDIUM,
            RecipeDifficulty.HARD,
            undefined,
        ]);
    });

    it('marks ONLY the last option as the clear option (no value)', () => {
        const options = difficultyOptions(messages as RecipeFormMessages);

        expect(options.filter((option) => option.value === undefined)).toHaveLength(1);
        expect(options[options.length - 1]?.value).toBeUndefined();
    });
});

describe('addChip (U6 tag/dietary chip control)', () => {
    it('appends a trimmed token to the list', () => {
        expect(addChip(['quick'], '  easy  ')).toEqual(['quick', 'easy']);
    });

    it('drops a blank / whitespace-only token (a copy, no add)', () => {
        expect(addChip(['quick'], '   ')).toEqual(['quick']);
        expect(addChip(['quick'], '')).toEqual(['quick']);
    });

    it('drops a case-insensitive duplicate rather than adding it', () => {
        expect(addChip(['Quick', 'dinner'], 'quick')).toEqual(['Quick', 'dinner']);
    });

    it('keeps a comma inside the token verbatim (never splits — it is not a separator)', () => {
        // Mutation guard: a comma-splitting implementation would yield two chips; the chip control treats the
        // whole entry as one token.
        expect(addChip([], 'salt, pepper')).toEqual(['salt, pepper']);
    });

    it('does not mutate the input list', () => {
        const list = ['quick'];
        addChip(list, 'easy');
        expect(list).toEqual(['quick']);
    });

    it('returns a NEW array even when nothing is added (so length comparison is safe, ref differs)', () => {
        const list = ['quick'];
        const result = addChip(list, 'quick');
        expect(result).not.toBe(list);
        expect(result).toEqual(['quick']);
    });
});

describe('removeChipAt (U6 tag/dietary chip control)', () => {
    it('removes the chip at the given index', () => {
        expect(removeChipAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
    });

    it('is a no-op copy for an out-of-range index', () => {
        expect(removeChipAt(['a', 'b'], 5)).toEqual(['a', 'b']);
    });

    it('does not mutate the input list', () => {
        const list = ['a', 'b'];
        removeChipAt(list, 0);
        expect(list).toEqual(['a', 'b']);
    });
});

describe('parseQuantityBound (U9 — a quantity field states an amount or states nothing)', () => {
    it('parses a stated amount', () => {
        expect(parseQuantityBound('2')).toBe(2);
    });

    it('parses a fractional amount', () => {
        expect(parseQuantityBound('0.5')).toBe(0.5);
    });

    it('reports a BLANK field as no bound at all — never as a zero (R40)', () => {
        // ⛔ The mutation this pins: `Number('')` is `0`, so the obvious `parseNumericInput` reuse turns an
        // emptied field into a stated amount of zero. `undefined` is what lets `absent` stay absent.
        expect(parseQuantityBound('')).toBeUndefined();
        expect(parseQuantityBound('   ')).toBeUndefined();
    });

    it('reports unparseable text as no bound', () => {
        expect(parseQuantityBound('abc')).toBeUndefined();
    });

    it('keeps a zero or a negative as the STATED number, so validation can refuse it', () => {
        // Not coerced to `undefined`: the user typed a number, and telling them it is not an amount is a
        // different message from silently deciding they stated nothing.
        expect(parseQuantityBound('0')).toBe(0);
        expect(parseQuantityBound('-1')).toBe(-1);
    });
});

describe('quantityInputValue (U9 — what a quantity field DISPLAYS)', () => {
    it('shows a stated amount', () => {
        expect(quantityInputValue(2)).toBe('2');
    });

    it('shows an absent bound as an EMPTY field, not a zero and not "NaN" (R40)', () => {
        expect(quantityInputValue(undefined)).toBe('');
        expect(quantityInputValue(Number.NaN)).toBe('');
    });

    it('shows a zero the user actually typed', () => {
        expect(quantityInputValue(0)).toBe('0');
    });
});

describe('setIngredientQuantityLow (U9)', () => {
    const values = makeRecipeFormValues();

    it('states the lower bound', () => {
        expect(setIngredientQuantityLow(values, 0, 3).ingredients[0]?.quantity).toBe(3);
    });

    it('clears the lower bound to the draft`s absent sentinel', () => {
        expect(setIngredientQuantityLow(values, 0, undefined).ingredients[0]?.quantity).toBeNaN();
    });

    it('leaves other fields on the line untouched', () => {
        const next = setIngredientQuantityLow(values, 0, 3);

        expect(next.ingredients[0]?.unit).toBe('tbsp');
        expect(next.title).toBe(values.title);
    });
});

describe('setIngredientQuantityHigh (U9)', () => {
    const values = makeRecipeFormValues();

    it('states the upper bound', () => {
        expect(setIngredientQuantityHigh(values, 0, 3).ingredients[0]?.quantityHigh).toBe(3);
    });

    it('REMOVES the key when the upper bound is cleared (never an explicit undefined)', () => {
        // Mirrors `setDifficulty`: `exactOptionalPropertyTypes` forbids storing `undefined`, and an absent
        // key is what `statedQuantity` reads as "one value, not a range".
        const stated = setIngredientQuantityHigh(values, 0, 3);
        const cleared = setIngredientQuantityHigh(stated, 0, undefined);

        expect('quantityHigh' in (cleared.ingredients[0] ?? {})).toBe(false);
    });

    it('does not touch the lower bound', () => {
        expect(setIngredientQuantityHigh(values, 0, 3).ingredients[0]?.quantity).toBe(2);
    });

    it('patches only the addressed line', () => {
        const twoLines = makeRecipeFormValues({
            ingredients: [
                { ingredientId: 'a', name: 'Flour', quantity: 2 },
                { ingredientId: 'b', name: 'Water', quantity: 1 },
            ],
        });

        const next = setIngredientQuantityHigh(twoLines, 1, 2);

        expect(next.ingredients[0]?.quantityHigh).toBeUndefined();
        expect(next.ingredients[1]?.quantityHigh).toBe(2);
    });
});

/**
 * U27 — THE SECTION FOLD, and the two ways it can be written wrong.
 *
 * `ingredientSections` is the ONE projection both form leaves render from, so a platform cannot fold
 * differently from the other. It is pure and total, and the cases below are written against the two
 * mistakes that produce a plausible-looking but wrong list:
 *
 *  1. **Grouping by LABEL IDENTITY instead of by consecutive run.** `[Dry][Wet][Dry]` would collapse to two
 *     sections and pull the third line up beside the first — REORDERING the recipe. A stored order must
 *     never move.
 *  2. **Emitting section chrome for an ungrouped recipe.** Most recipes will never group, and those must not
 *     look unfinished — an ungrouped list is ONE unlabelled section and the leaves render no heading for it.
 */
describe('U27 — ingredientSections (the consecutive-run fold)', () => {
    /** Form values carrying the given per-line group labels, in order. */
    const withGroups = (labels: readonly (string | undefined)[]): RecipeFormValues => ({
        ...makeRecipeFormValues(),
        ingredients: labels.map((groupLabel, i) => ({
            ingredientId: `ing-${i}`,
            name: `Food ${i}`,
            quantity: 1,
            ...(groupLabel === undefined ? {} : { groupLabel }),
        })),
    });

    it('an UNGROUPED recipe is ONE unlabelled section — no chrome, and the flat list is unchanged', () => {
        const sections = ingredientSections(withGroups([undefined, undefined, undefined]));

        expect(sections).toHaveLength(1);
        expect(sections[0]?.label).toBeUndefined();
        expect(sections[0]?.lines.map((entry) => entry.index)).toEqual([0, 1, 2]);
    });

    it('an EMPTY recipe folds to no sections at all', () => {
        expect(ingredientSections(withGroups([]))).toEqual([]);
    });

    it('splits into one section per label, in stored order', () => {
        const sections = ingredientSections(withGroups(['Dry', 'Dry', 'Wet']));

        expect(sections.map((section) => section.label)).toEqual(['Dry', 'Wet']);
        expect(sections[0]?.lines.map((entry) => entry.index)).toEqual([0, 1]);
        expect(sections[1]?.lines.map((entry) => entry.index)).toEqual([2]);
    });

    // ⛔ MISTAKE 1. Folding by label identity gives `[Dry(0,2)][Wet(1)]` — two sections, and line 2 rendered
    // above line 1. The recipe's own order would have silently changed.
    it('⛔ a label repeated NON-ADJACENTLY is TWO sections, in stored order — never merged', () => {
        const sections = ingredientSections(withGroups(['Dry', 'Wet', 'Dry']));

        expect(sections.map((section) => section.label)).toEqual(['Dry', 'Wet', 'Dry']);
        expect(sections.flatMap((section) => section.lines.map((entry) => entry.index))).toEqual([0, 1, 2]);
    });

    it('a MIXED recipe leads with the ungrouped run as an unlabelled section', () => {
        const sections = ingredientSections(withGroups([undefined, 'For the sauce', 'For the sauce']));

        expect(sections.map((section) => section.label)).toEqual([undefined, 'For the sauce']);
        expect(sections[0]?.lines.map((entry) => entry.index)).toEqual([0]);
        expect(sections[1]?.lines.map((entry) => entry.index)).toEqual([1, 2]);
    });

    it('an ungrouped run AFTER a section is its own unlabelled section, not folded back into the first', () => {
        const sections = ingredientSections(withGroups(['Dry', undefined]));

        expect(sections.map((section) => section.label)).toEqual(['Dry', undefined]);
    });

    // The fold is a PROJECTION: every line appears exactly once, and each entry's `index` addresses the same
    // line in `values.ingredients` — which is what every edit helper takes. An index that drifted would edit
    // the wrong row while looking perfectly correct on screen.
    it('is a lossless projection — every line appears once, and its index still addresses it', () => {
        const values = withGroups(['Dry', 'Wet', 'Dry', undefined]);
        const sections = ingredientSections(values);
        const entries = sections.flatMap((section) => section.lines);

        expect(entries).toHaveLength(values.ingredients.length);

        for (const entry of entries) {
            expect(values.ingredients[entry.index]).toBe(entry.line);
        }
    });
});

/**
 * U28 (was U27) — the ONE append transition, and a new line joins the section the cook is currently
 * building.
 *
 * ⚠️ REWRITTEN FROM `addIngredient`, which U28 DELETED. The old transition appended a BLANK, UNRESOLVED
 * line — the dead end this unit removes: `validateRecipeForm` refused it and `toCreateRecipeInput` dropped
 * it. `appendResolvedIngredient` takes a line the picker already resolved, so the section-inheritance rule
 * U27 established now sits on the path a cook actually walks (it used to sit ONLY on the dead one, which
 * meant the working picker path silently lost sectioning).
 *
 * ⛔ Its parameter is {@link ResolvedRecipeFormIngredient} — `ingredientId` narrowed to `string`. That is
 * the type-level half of "no path can create an unresolved row": the only remaining append transition
 * cannot EXPRESS one.
 *
 * ⚠️ The brief is explicit that "per-row typing is the wrong primary interaction" — a cook would type
 * "For the marinade" eight times. It appends at the END, so inheriting the LAST line's label is exactly
 * what building a section top-down means: name it once on the first row, then keep adding. Starting a new
 * section is still one edit (type a different label), and an ungrouped list stays ungrouped because there
 * is nothing to inherit.
 */
describe('U28 — appendResolvedIngredient inherits the section being built', () => {
    const lineWith = (
        over: Omit<Partial<ResolvedRecipeFormIngredient>, 'ingredientId'>,
    ): ResolvedRecipeFormIngredient => ({
        name: 'Onion',
        quantity: 1,
        ...over,
        ingredientId: 'ing-1',
    });

    const picked = (
        over: Omit<Partial<ResolvedRecipeFormIngredient>, 'ingredientId'> = {},
    ): ResolvedRecipeFormIngredient => ({
        name: 'Garlic',
        quantity: 1,
        ...over,
        ingredientId: 'ing-picked',
    });

    it('appends into the LAST line’s section', () => {
        const next = appendResolvedIngredient(
            { ...makeRecipeFormValues(), ingredients: [lineWith({ groupLabel: 'For the marinade' })] },
            picked(),
        );

        expect(next.ingredients[1]?.groupLabel).toBe('For the marinade');
    });

    it('appends UNGROUPED when the last line is ungrouped — nothing to inherit', () => {
        const next = appendResolvedIngredient({ ...makeRecipeFormValues(), ingredients: [lineWith({})] }, picked());

        expect(next.ingredients[1]).not.toHaveProperty('groupLabel');
    });

    it('appends UNGROUPED into an empty list', () => {
        const next = appendResolvedIngredient({ ...makeRecipeFormValues(), ingredients: [] }, picked());

        expect(next.ingredients[0]).not.toHaveProperty('groupLabel');
    });

    // ⛔ Only the SECTION is inherited. Inheriting the preparation would assert "finely chopped" about a
    // food the picker resolved without any such claim.
    it('⛔ inherits ONLY the section — never the preparation, the food, or the quantity', () => {
        const next = appendResolvedIngredient(
            {
                ...makeRecipeFormValues(),
                ingredients: [lineWith({ groupLabel: 'Dry', preparation: 'sifted', name: 'Flour' })],
            },
            picked({ name: 'Garlic', quantity: 3 }),
        );

        expect(next.ingredients[1]).not.toHaveProperty('preparation');
        expect(next.ingredients[1]?.name).toBe('Garlic');
        expect(next.ingredients[1]?.quantity).toBe(3);
        expect(next.ingredients[1]?.ingredientId).toBe('ing-picked');
    });

    // The trim/blank rule `sectionLabelOf` owns: a cleared or padded label is never propagated, so the next
    // line does not acquire a section of `'  '` that renders as an EMPTY heading.
    it('never inherits a BLANK or padded section label', () => {
        const blank = appendResolvedIngredient(
            { ...makeRecipeFormValues(), ingredients: [lineWith({ groupLabel: '   ' })] },
            picked(),
        );
        const padded = appendResolvedIngredient(
            { ...makeRecipeFormValues(), ingredients: [lineWith({ groupLabel: ' Dry ' })] },
            picked(),
        );

        expect(blank.ingredients[1]).not.toHaveProperty('groupLabel');
        expect(padded.ingredients[1]?.groupLabel).toBe('Dry');
    });

    it('is pure — the input values and their lines are untouched', () => {
        const values = { ...makeRecipeFormValues(), ingredients: [lineWith({ groupLabel: 'Dry' })] };
        const before = structuredClone(values);

        appendResolvedIngredient(values, picked());

        expect(values).toEqual(before);
    });

    /**
     * ⛔ THE MUTANT THIS EXISTS TO KILL: "restore the append-an-empty-row behaviour". `addIngredient` and
     * `blankIngredient` were the ONLY production constructors of an unresolved line; both are gone, and a
     * re-export of either would resurrect the dead end wholesale. Asserted against the PACKAGE's public
     * surface, not the module's, because the leaves import from `./props.js` while apps import from
     * `@commise/features-recipes` — a partial deletion that left the barrel intact would still ship it.
     */
    it('⛔ neither addIngredient nor blankIngredient is exported any more', async () => {
        const props = await import('../props.js');
        const formBarrel = await import('../index.js');
        const packageBarrel = await import('../../index.js');

        for (const module of [props, formBarrel, packageBarrel]) {
            expect(module).not.toHaveProperty('addIngredient');
            expect(module).not.toHaveProperty('blankIngredient');
        }
    });
});

/**
 * U27 — moving a line between sections is a SINGLE-FIELD update, which is the whole reason the wire models a
 * per-line label rather than a `(group, lines[])` structure: a structure needs a splice across two
 * positions, and a splice is where a line's other fields get dropped.
 */
describe('U27 — moving a line between sections preserves everything else', () => {
    it('changes only the group label', () => {
        const line: RecipeFormIngredient = {
            ingredientId: 'ing-1',
            name: 'Onion',
            quantity: 2,
            quantityHigh: 3,
            unit: 'cup',
            notes: 'a note',
            preparation: 'finely chopped',
            groupLabel: 'For the marinade',
            userCalories: 40,
        };
        const moved = updateIngredientAt({ ...makeRecipeFormValues(), ingredients: [line] }, 0, {
            groupLabel: 'For the topping',
        });

        expect(moved.ingredients[0]).toEqual({ ...line, groupLabel: 'For the topping' });
    });
});

/**
 * U28 — the note an UNRESOLVED row wears, and the reason a cook can act on.
 *
 * DESIGN PATTERN: the same Specification-to-copy adapter `unitClassNote` and `resolutionStatusLabel` are —
 * ONE mapping from a domain verdict to a localized string, shared by both platform leaves so they cannot
 * say different things about the same row.
 *
 * ⛔ ITS VERDICT COMES FROM `values`, NEVER FROM `errors`. Until U28 an unresolved row was marked only after
 * a submit attempt populated `errors.ingredients`, so a draft restored holding one rendered as an ordinary,
 * complete-looking row — and `toCreateRecipeInput` then dropped it in silence on save. The ingredient-entry
 * brief rules that out in as many words: "Do not design a row that looks complete but is silently
 * discarded." The note is what makes the row honest without hiding it.
 *
 * ⛔ It is also the SAME predicate `validateRecipeForm` blocks on (`isResolvedIngredientId`), not a second
 * copy — a leaf marking a different set of rows from the set that blocks the wizard is the drift sharing
 * one predicate exists to prevent.
 */
describe('U28 — unresolvedLineNote', () => {
    const noteMessages = { ingredientNoFoodNote: 'No food chosen — pick one from the search above.' };
    const m = noteMessages as unknown as RecipeFormMessages;

    it('returns the note for a line with no food', () => {
        expect(unresolvedLineNote(m, { ingredientId: null, name: 'Kale', quantity: 1 })).toBe(
            noteMessages.ingredientNoFoodNote,
        );
    });

    it('returns NOTHING for a resolved line — a settled row wears no warning', () => {
        expect(unresolvedLineNote(m, { ingredientId: 'ing-1', name: 'Kale', quantity: 1 })).toBeUndefined();
    });

    it('treats an EMPTY-STRING id as unresolved, exactly as the validator does', () => {
        // Mutation guard: a bare `!== null` check would pass a `''` id here while `validateRecipeForm`'s own
        // `isResolvedIngredientId` refused it — the leaf would show a clean row the wizard will not pass.
        expect(unresolvedLineNote(m, { ingredientId: '', name: 'Kale', quantity: 1 })).toBe(
            noteMessages.ingredientNoFoodNote,
        );
    });

    it('does not depend on anything else the line holds', () => {
        // A row can be unresolved AND fully filled in — that is exactly the state that looked complete.
        const filled = { ingredientId: null, name: 'Kale', quantity: 2, unit: 'cups', preparation: 'chopped' };

        expect(unresolvedLineNote(m, filled)).toBe(noteMessages.ingredientNoFoodNote);
    });
});

/**
 * U28 — the COMPILE-TIME half of "no path can create an unresolved row".
 *
 * ⛔ A runtime test cannot prove this and a source grep cannot either (a grep sees through no variable). The
 * guarantee is that the form's ONE append transition takes a line whose `ingredientId` is a `string`, so an
 * unresolved line is not a value that can be passed — the failure is a BUILD failure, before any test runs.
 */
describe('U28 — the append transition cannot express an unresolved line', () => {
    it('takes a line whose ingredientId is a plain string, not `string | null`', () => {
        expectTypeOf<Parameters<typeof appendResolvedIngredient>[1]>()
            .toHaveProperty('ingredientId')
            .toEqualTypeOf<string>();
    });

    it('⛔ a bare RecipeFormIngredient is NOT assignable to it', () => {
        expectTypeOf<RecipeFormIngredient>().not.toExtend<Parameters<typeof appendResolvedIngredient>[1]>();
    });

    it('a resolved line IS a RecipeFormIngredient (the narrowing adds nothing but the guarantee)', () => {
        expectTypeOf<ResolvedRecipeFormIngredient>().toExtend<RecipeFormIngredient>();
    });
});

describe('setMealType / mealTypeOptions (U34 — the closed axis, cleared by KEY REMOVAL)', () => {
    it('states a meal type', () => {
        expect(setMealType(makeRecipeFormValues(), 'dinner').mealType).toBe('dinner');
    });

    it('REMOVES the key when cleared, never stores an explicit undefined', () => {
        // Not a style point. `exactOptionalPropertyTypes` forbids the explicit `undefined`, and
        // `recipeFormValuesEqual` — the discard guard — compares by `JSON.stringify`, which DROPS an
        // `undefined`-valued key. A stored `undefined` would therefore compare equal to a removed key while
        // being a different object, so the two spellings must not both exist.
        const cleared = setMealType(makeRecipeFormValues({ mealType: 'dinner' }));

        expect('mealType' in cleared).toBe(false);
    });

    it('is idempotent: clearing an already-unstated draft changes nothing observable', () => {
        const values = makeRecipeFormValues();

        expect(setMealType(values)).toEqual(values);
    });

    it('touches no other field — meal type, tags and dietary flags are three separate axes', () => {
        const values = makeRecipeFormValues({ tags: ['weeknight'], dietaryFlags: ['vegan'] });
        const next = setMealType(values, 'brunch');

        expect(next.tags).toEqual(['weeknight']);
        expect(next.dietaryFlags).toEqual(['vegan']);
    });

    it('offers every vocabulary member plus an explicit "not stated" clear, in day order', () => {
        const options = mealTypeOptions(recipeFormMessages.en);

        expect(options.map((option) => option.value)).toEqual([...RECIPE_MEAL_TYPES, undefined]);

        for (const option of options) {
            expect(option.label.length).toBeGreaterThan(0);
        }
    });

    it('gives every option a DISTINCT label, so no two chips are indistinguishable by name', () => {
        const labels = mealTypeOptions(recipeFormMessages.en).map((option) => option.label);

        expect(new Set(labels).size).toBe(labels.length);
    });
});

/**
 * U25 / U35 — the note a NON-CANONICAL unit wears, and the fold that must not stand in front of it.
 *
 * DESIGN PATTERN: Specification-to-copy adapter — ONE mapping from `recipe-core`'s `classifyUnit` verdict
 * to a localized string, shared by both platform leaves so a unit cannot be marked differently on web and
 * mobile.
 *
 * ⛔ THIS FUNCTION LOWER-CASED ITS INPUT BEFORE ASKING (U35, owner ruling 2026-08-25). That was invisible
 * while `classifyUnit` lower-cased anyway, and it became a second fold in front of a case-SENSITIVE
 * verdict the moment `T` (tablespoon) and `t` (teaspoon) stopped being the same word: the surface would
 * have judged the unit the cook did NOT type. `classifyUnit` cleans its own input, so there was never a
 * reason to fold first — which is why these cases ask about the spelling as WRITTEN.
 *
 * ⚠️ HONEST LIMIT, stated rather than dressed up. No assertion on this function's RETURN can catch the
 * removed fold on its own: `T` and `t` are both canonical, so both carry no note either way. What the
 * fold cost was that the surface's verdict was computed for a different unit than the one on screen — a
 * latent defect the moment a third case-sensitive spelling or a per-class rendering lands. The
 * `classifyUnit`/`normalizeUnit` assertions below therefore state the verdict directly, and are labelled
 * as such rather than counted as coverage of the fold.
 *
 * ⛔ What the "capital prefix" case DOES catch is the NAIVE repair — deleting the `.toLowerCase()`
 * outright. `UNIT_VOCABULARY` holds lower-case canonical forms, so the prefix test still has to fold or a
 * cook typing `C` on the way to `Cup` is told "Unrecognised unit" mid-word.
 *
 * ⚠️ This suite is also new coverage for a function that had none of its own: it was reachable only
 * through `RecipeForm.test.tsx`, which exercises the canonical and unknown branches through the DOM and
 * cannot state the case-sensitivity contract directly.
 */
describe('U25 / U35 — unitClassNote', () => {
    const noteMessages = {
        ingredientUnitSubjectiveNote: 'A measure we cannot weigh.',
        ingredientUnitUnknownNote: 'Unrecognised unit.',
    };
    const m = noteMessages as unknown as RecipeFormMessages;

    it.each(['cup', 'Cup', 'CUPS', 'Tbsp.', 'ml', 'GRAM'])('marks the canonical unit %j with nothing', (unit) => {
        expect(unitClassNote(m, unit)).toBeUndefined();
    });

    it.each(['T', 't', 'T.', 't.'])('marks the case-sensitive %j as canonical — no note (U35)', (unit) => {
        expect(unitClassNote(m, unit)).toBeUndefined();
    });

    it('the verdict this adapter asks for is CASE-SENSITIVE for exactly the T/t pair (U35)', () => {
        // ⚠️ Stated directly, and labelled: this asserts `recipe-core`'s contract that the adapter now
        // consults with the spelling as written. It is NOT a guard on the removed `.toLowerCase()` — see
        // this suite's docstring for why no return-value assertion can be.
        expect(classifyUnit('T')).toBe('canonical');
        expect(classifyUnit('t')).toBe('canonical');
        expect(normalizeUnit('T')).toBe('tablespoon');
        expect(normalizeUnit('t')).toBe('teaspoon');
        expect(unitClassNote(m, 'T')).toBeUndefined();
    });

    it.each(['handful', 'Handfuls', 'to taste', 'To Taste.'])('marks the subjective %j with its note', (unit) => {
        expect(unitClassNote(m, unit)).toBe(noteMessages.ingredientUnitSubjectiveNote);
    });

    it.each(['blorp', 'zzz', 'quux'])('marks the unrecognised %j with its note', (unit) => {
        expect(unitClassNote(m, unit)).toBe(noteMessages.ingredientUnitUnknownNote);
    });

    it('withholds the unknown note while the value is still a PREFIX of a real unit', () => {
        // A cook mid-word on the way to `cup` must not be told they are wrong. `c` and `cu` are prefixes;
        // `cux` is not, and is judged.
        expect(unitClassNote(m, 'c')).toBeUndefined();
        expect(unitClassNote(m, 'cu')).toBeUndefined();
        expect(unitClassNote(m, 'cux')).toBe(noteMessages.ingredientUnitUnknownNote);
    });

    it('withholds it for a CAPITALISED prefix too — the vocabulary is lower-case, the typing is not', () => {
        // ⛔ MUTATION GUARD for the naive repair: deleting the prefix test's own `.toLowerCase()` because
        // the classification above stopped folding. `UNIT_VOCABULARY` holds `cup`, not `Cup`, so a cook
        // typing `C` on the way to `Cups` would be told "Unrecognised unit" while still mid-word.
        expect(unitClassNote(m, 'C')).toBeUndefined();
        expect(unitClassNote(m, 'Cu')).toBeUndefined();
        expect(unitClassNote(m, 'MILLIL')).toBeUndefined();
        // And the boundary still holds: a capitalised NON-prefix is judged like any other.
        expect(unitClassNote(m, 'CUX')).toBe(noteMessages.ingredientUnitUnknownNote);
    });

    it('carries NO note for an absent or blank unit — that is a unitless line, not a wrong one', () => {
        expect(unitClassNote(m)).toBeUndefined();
        expect(unitClassNote(m, '')).toBeUndefined();
        expect(unitClassNote(m, '   ')).toBeUndefined();
    });
});
