/**
 * Unit tests for `ingredientGroups.ts` — the ingredient groups' pure transitions (build spec §7.5.5): move a line up or
 * down inside its group, move it to another group, rename a group, remove a group keeping its lines, and place an
 * appended line at the end of the group it was added to.
 *
 * The invariant every transition is held to: the ONE fold (`ingredientSections`) reads contiguous runs, so a group that
 * ends up split in two draws two headings with one name. Each case states the whole resulting order and grouping, and
 * a property checks that no transition here ever produces a split group from an unsplit draft.
 */
import { describe, expect, it } from 'vitest';

import {
    canMoveIngredient,
    groupLabelOf,
    ingredientGroupLabels,
    moveIngredient,
    moveIngredientToGroup,
    placeIngredient,
    removeIngredientGroup,
    renameIngredientGroup,
} from '../ingredientGroups.js';
import { mintedLineKey, type IngredientLineKey } from '../lineKey.js';
import { ingredientSections } from '../props.js';
import type { RecipeFormIngredient, RecipeFormValues } from '../values.js';
import { makeRecipeFormValues } from '../../__fixtures__/index.js';

const key = (name: string): IngredientLineKey => mintedLineKey(name);

const line = (name: string, group?: string): RecipeFormIngredient => ({
    key: key(name),
    ingredientId: `ing_${name}`,
    name,
    isUserEntered: false,
    quantity: 1,
    ...(group === undefined ? {} : { groupLabel: group }),
});

const draft = (...lines: RecipeFormIngredient[]): RecipeFormValues => ({
    ...makeRecipeFormValues(),
    ingredients: lines,
});

/** The draft as `name/group` pairs, in order: what a cook sees, top to bottom. */
const shape = (values: RecipeFormValues): string[] =>
    values.ingredients.map((each) => `${each.name ?? ''}/${groupLabelOf(each) ?? '-'}`);

/** Whether any label appears in two separate runs: the fold would draw its heading twice. */
const hasSplitGroup = (values: RecipeFormValues): boolean => {
    const labels = ingredientSections(values).map((section) => section.label ?? '\u0000none');

    return new Set(labels).size !== labels.length;
};

const SAUCE = draft(line('salt'), line('oil', 'Sauce'), line('garlic', 'Sauce'), line('lamb', 'Main'));

describe('groupLabelOf', () => {
    it('trims, and reads a blank label as no group (the fold and the wire read it the same way)', () => {
        expect(groupLabelOf(line('a', '  Sauce '))).toBe('Sauce');
        expect(groupLabelOf(line('a', '   '))).toBeUndefined();
        expect(groupLabelOf(line('a'))).toBeUndefined();
    });
});

describe('ingredientGroupLabels', () => {
    it('lists each named group once, in the order it first appears', () => {
        expect(ingredientGroupLabels(SAUCE)).toEqual(['Sauce', 'Main']);
    });

    it('is empty for an ungrouped recipe', () => {
        expect(ingredientGroupLabels(draft(line('a'), line('b')))).toEqual([]);
    });
});

describe('moveIngredient (⋯ Move up / Move down, SC 2.5.7)', () => {
    it('swaps a line with the one above it inside its group', () => {
        expect(shape(moveIngredient(SAUCE, key('garlic'), 'up'))).toEqual([
            'salt/-',
            'garlic/Sauce',
            'oil/Sauce',
            'lamb/Main',
        ]);
    });

    it('swaps a line with the one below it inside its group', () => {
        expect(shape(moveIngredient(SAUCE, key('oil'), 'down'))).toEqual([
            'salt/-',
            'garlic/Sauce',
            'oil/Sauce',
            'lamb/Main',
        ]);
    });

    it('never crosses a group boundary: the first of a group does not move up into the group above', () => {
        expect(moveIngredient(SAUCE, key('oil'), 'up')).toBe(SAUCE);
        expect(moveIngredient(SAUCE, key('garlic'), 'down')).toBe(SAUCE);
    });

    it('returns the same draft for the list ends and for a key that is not there', () => {
        expect(moveIngredient(SAUCE, key('salt'), 'up')).toBe(SAUCE);
        expect(moveIngredient(SAUCE, key('lamb'), 'down')).toBe(SAUCE);
        expect(moveIngredient(SAUCE, key('nope'), 'down')).toBe(SAUCE);
    });

    it('moves freely in an ungrouped list', () => {
        const plain = draft(line('a'), line('b'), line('c'));

        expect(shape(moveIngredient(plain, key('c'), 'up'))).toEqual(['a/-', 'c/-', 'b/-']);
    });
});

describe('canMoveIngredient', () => {
    it('agrees with moveIngredient for every line and direction', () => {
        for (const each of SAUCE.ingredients) {
            for (const direction of ['up', 'down'] as const) {
                expect(canMoveIngredient(SAUCE, each.key, direction)).toBe(
                    moveIngredient(SAUCE, each.key, direction) !== SAUCE,
                );
            }
        }
    });
});

describe('moveIngredientToGroup (⋯ Move to group…)', () => {
    it('moves a line to the END of another group and takes its label', () => {
        expect(shape(moveIngredientToGroup(SAUCE, key('lamb'), 'Sauce'))).toEqual([
            'salt/-',
            'oil/Sauce',
            'garlic/Sauce',
            'lamb/Sauce',
        ]);
    });

    it('"No group" moves a line to the end of the ungrouped lines', () => {
        expect(shape(moveIngredientToGroup(SAUCE, key('garlic'), undefined))).toEqual([
            'salt/-',
            'garlic/-',
            'oil/Sauce',
            'lamb/Main',
        ]);
    });

    it('"No group" with no ungrouped line yet puts the line first, where an unheaded run belongs', () => {
        const grouped = draft(line('oil', 'Sauce'), line('lamb', 'Main'));

        expect(shape(moveIngredientToGroup(grouped, key('lamb'), undefined))).toEqual(['lamb/-', 'oil/Sauce']);
    });

    it('a group nothing is in yet (a new, empty group) receives the line at the end of the list', () => {
        expect(shape(moveIngredientToGroup(SAUCE, key('salt'), 'Garnish'))).toEqual([
            'oil/Sauce',
            'garlic/Sauce',
            'lamb/Main',
            'salt/Garnish',
        ]);
    });

    it('drops the label key rather than writing `groupLabel: undefined` for No group', () => {
        const next = moveIngredientToGroup(SAUCE, key('oil'), undefined);

        expect(next.ingredients.find((each) => each.key === key('oil'))).not.toHaveProperty('groupLabel');
    });

    it('returns the same draft when the line is already in that group, or not there', () => {
        expect(moveIngredientToGroup(SAUCE, key('oil'), 'Sauce')).toBe(SAUCE);
        expect(moveIngredientToGroup(SAUCE, key('nope'), 'Sauce')).toBe(SAUCE);
    });
});

describe('renameIngredientGroup (group ⋯ Rename group)', () => {
    it('renames every line of the group, keeping order', () => {
        expect(shape(renameIngredientGroup(SAUCE, 'Sauce', 'Dressing'))).toEqual([
            'salt/-',
            'oil/Dressing',
            'garlic/Dressing',
            'lamb/Main',
        ]);
    });

    it('trims the new name, and refuses a blank one (a blank label would silently ungroup the lines)', () => {
        expect(shape(renameIngredientGroup(SAUCE, 'Sauce', '  Dressing '))[1]).toBe('oil/Dressing');
        expect(renameIngredientGroup(SAUCE, 'Sauce', '   ')).toBe(SAUCE);
    });

    it('renaming onto another group merges the two into ONE run, where the first of them stood', () => {
        const merged = renameIngredientGroup(SAUCE, 'Main', 'Sauce');

        expect(shape(merged)).toEqual(['salt/-', 'oil/Sauce', 'garlic/Sauce', 'lamb/Sauce']);
        expect(hasSplitGroup(merged)).toBe(false);
    });
});

describe('removeIngredientGroup (group ⋯ Remove group, keep its ingredients)', () => {
    it('keeps every line and drops the group, joining them to the ungrouped lines', () => {
        const next = removeIngredientGroup(SAUCE, 'Main');

        expect(shape(next)).toEqual(['salt/-', 'lamb/-', 'oil/Sauce', 'garlic/Sauce']);
        expect(hasSplitGroup(next)).toBe(false);
    });

    it('in a recipe with no ungrouped line, the freed lines lead the list', () => {
        const grouped = draft(line('oil', 'Sauce'), line('lamb', 'Main'));

        expect(shape(removeIngredientGroup(grouped, 'Main'))).toEqual(['lamb/-', 'oil/Sauce']);
    });

    it('returns the same draft for a group that does not exist', () => {
        expect(removeIngredientGroup(SAUCE, 'Nope')).toBe(SAUCE);
    });
});

describe('placeIngredient (an appended line added to a chosen group)', () => {
    it('lands at the end of its group', () => {
        expect(shape({ ...SAUCE, ingredients: placeIngredient(SAUCE.ingredients, line('lemon', 'Sauce')) })).toEqual([
            'salt/-',
            'oil/Sauce',
            'garlic/Sauce',
            'lemon/Sauce',
            'lamb/Main',
        ]);
    });

    it('an ungrouped line lands at the end of the ungrouped lines', () => {
        expect(shape({ ...SAUCE, ingredients: placeIngredient(SAUCE.ingredients, line('pepper')) })).toEqual([
            'salt/-',
            'pepper/-',
            'oil/Sauce',
            'garlic/Sauce',
            'lamb/Main',
        ]);
    });
});

describe('no transition splits a group', () => {
    const transitions: readonly ((values: RecipeFormValues) => RecipeFormValues)[] = [
        (values) => moveIngredient(values, key('garlic'), 'up'),
        (values) => moveIngredientToGroup(values, key('salt'), 'Main'),
        (values) => moveIngredientToGroup(values, key('lamb'), undefined),
        (values) => moveIngredientToGroup(values, key('oil'), 'Garnish'),
        (values) => renameIngredientGroup(values, 'Sauce', 'Main'),
        (values) => removeIngredientGroup(values, 'Sauce'),
    ];

    it.each(transitions.map((transition, index) => ({ index, transition })))('transition $index', ({ transition }) => {
        expect(hasSplitGroup(transition(SAUCE))).toBe(false);
    });
});
