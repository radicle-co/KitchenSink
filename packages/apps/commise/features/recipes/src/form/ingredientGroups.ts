/**
 * @module @commise/features-recipes/form — the ingredient groups' transitions (build spec §7.5.5): Move up and Move
 * down inside a group, Move to group…, Rename group, Remove group (keep its ingredients), and where an appended line
 * lands in the group it was added to.
 *
 * The data model is unchanged: a group is each line's own `groupLabel`, and the editor draws groups through ONE fold
 * over contiguous runs (`ingredientSections`, `./props.ts`). Every transition here therefore keeps a group's lines in
 * one run, so no group is drawn twice. A group no line is in yet (the cook's new, empty group) is view state, not
 * draft state: there is no line to carry its label.
 *
 * Pure: every function returns the next draft, and returns the SAME draft when nothing changes.
 *
 * @pattern Command — each exported transition is one undoable edit over the draft, applied by `applyDraftAction`
 */
import type { IngredientLineKey } from './lineKey.js';
import type { RecipeFormIngredient, RecipeFormValues } from './values.js';

/** A row's direction for Move up and Move down. */
export type MoveDirection = 'up' | 'down';

/**
 * The group a draft line belongs to: its label trimmed, with blank read as no group. Pure.
 *
 * ⛔ The draft needs this and the wire's `.trim()` cannot supply it: a cleared field leaves `''`, not `undefined`, and
 * `'Dry '` beside `'Dry'` would draw two headings a reader cannot tell apart. `toCreateRecipeInput` applies the same
 * rule on the way out, so what the editor shows and what the recipe saves are the same grouping.
 *
 * @param line - The draft line.
 * @returns The trimmed label, or `undefined` when the line has no group.
 */
export const groupLabelOf = (line: Pick<RecipeFormIngredient, 'groupLabel'>): string | undefined => {
    const label = line.groupLabel?.trim();

    return label === undefined || label === '' ? undefined : label;
};

/** The line with this group, the key dropped rather than set to `undefined` for no group. Pure. */
const withGroup = (line: RecipeFormIngredient, group: string | undefined): RecipeFormIngredient => {
    const { groupLabel: _dropped, ...rest } = line;

    return group === undefined ? rest : { ...rest, groupLabel: group };
};

/**
 * Each named group once, in the order it first appears. Pure.
 *
 * @param values - The draft.
 * @returns The labels.
 */
export const ingredientGroupLabels = (values: RecipeFormValues): readonly string[] => [
    ...new Set(values.ingredients.map(groupLabelOf).filter((label): label is string => label !== undefined)),
];

/**
 * Where a line lands among `lines`, by its own group: after the last line of that group; for no group, after the last
 * ungrouped line, or first when there is none (an unheaded run belongs at the top, not under another group's heading);
 * for a group no line is in yet, at the end. Pure.
 *
 * @param lines - The lines it joins.
 * @param line - The line, carrying the group it joins.
 * @returns The lines with it placed.
 */
export const placeIngredient = (
    lines: readonly RecipeFormIngredient[],
    line: RecipeFormIngredient,
): RecipeFormIngredient[] => {
    const group = groupLabelOf(line);
    const last = lines.map(groupLabelOf).lastIndexOf(group);
    const at = last >= 0 ? last + 1 : group === undefined ? 0 : lines.length;

    return [...lines.slice(0, at), line, ...lines.slice(at)];
};

/**
 * The index a line would swap with, or `undefined` when it cannot move that way: past an end of the list, or across
 * into another group (that is Move to group…'s job). Pure.
 */
const swapIndexOf = (
    values: RecipeFormValues,
    key: IngredientLineKey,
    direction: MoveDirection,
): number | undefined => {
    const { ingredients } = values;
    const index = ingredients.findIndex((each) => each.key === key);
    const other = direction === 'up' ? index - 1 : index + 1;
    const moving = ingredients[index];
    const neighbour = ingredients[other];

    if (index < 0 || moving === undefined || neighbour === undefined) {
        return undefined;
    }

    return groupLabelOf(moving) === groupLabelOf(neighbour) ? other : undefined;
};

/**
 * Whether a line can move up or down: the row's `⋯` shows the item only when it does something. Pure.
 *
 * @param values - The draft.
 * @param key - The line.
 * @param direction - Up or down.
 * @returns `true` when {@link moveIngredient} would move it.
 */
export const canMoveIngredient = (
    values: RecipeFormValues,
    key: IngredientLineKey,
    direction: MoveDirection,
): boolean => swapIndexOf(values, key, direction) !== undefined;

/**
 * Move a line one place up or down inside its group. Pure.
 *
 * @param values - The draft.
 * @param key - The line.
 * @param direction - Up or down.
 * @returns The next draft, or the same one when it cannot move.
 */
export const moveIngredient = (
    values: RecipeFormValues,
    key: IngredientLineKey,
    direction: MoveDirection,
): RecipeFormValues => {
    const other = swapIndexOf(values, key, direction);
    const index = values.ingredients.findIndex((each) => each.key === key);
    const moving = values.ingredients[index];
    const neighbour = other === undefined ? undefined : values.ingredients[other];

    if (other === undefined || moving === undefined || neighbour === undefined) {
        return values;
    }

    const ingredients = [...values.ingredients];

    ingredients[index] = neighbour;
    ingredients[other] = moving;

    return { ...values, ingredients };
};

/**
 * Move a line to a group, or out of every group, at the end of it (`placeIngredient`). Pure.
 *
 * @param values - The draft.
 * @param key - The line.
 * @param group - The group, or `undefined` for No group.
 * @returns The next draft, or the same one when the line is already there or is not in the draft.
 */
export const moveIngredientToGroup = (
    values: RecipeFormValues,
    key: IngredientLineKey,
    group: string | undefined,
): RecipeFormValues => {
    const moving = values.ingredients.find((each) => each.key === key);
    const target = group?.trim() === '' ? undefined : group?.trim();

    if (moving === undefined || groupLabelOf(moving) === target) {
        return values;
    }

    const rest = values.ingredients.filter((each) => each.key !== key);

    return { ...values, ingredients: placeIngredient(rest, withGroup(moving, target)) };
};

/**
 * The lines with each group's lines gathered into one run, where that group first appears, keeping their order. Pure.
 */
const joinRuns = (lines: readonly RecipeFormIngredient[]): RecipeFormIngredient[] => {
    const order = [...new Set(lines.map(groupLabelOf))];

    return order.flatMap((group) => lines.filter((each) => groupLabelOf(each) === group));
};

/**
 * Rename a group. A name another group already has merges the two into one run, where the first of them stood. Pure.
 *
 * @param values - The draft.
 * @param from - The group's current name.
 * @param to - Its new name; trimmed, and refused when blank (a blank label would silently ungroup the lines).
 * @returns The next draft, or the same one when nothing changes.
 */
export const renameIngredientGroup = (values: RecipeFormValues, from: string, to: string): RecipeFormValues => {
    const name = to.trim();

    if (name === '' || name === from || !values.ingredients.some((each) => groupLabelOf(each) === from)) {
        return values;
    }

    return {
        ...values,
        ingredients: joinRuns(
            values.ingredients.map((each) => (groupLabelOf(each) === from ? withGroup(each, name) : each)),
        ),
    };
};

/**
 * Remove a group and keep its lines: they join the ungrouped lines (`placeIngredient`), in their order. Pure.
 *
 * @param values - The draft.
 * @param label - The group.
 * @returns The next draft, or the same one when no line is in that group.
 */
export const removeIngredientGroup = (values: RecipeFormValues, label: string): RecipeFormValues => {
    const freed = values.ingredients.filter((each) => groupLabelOf(each) === label);

    if (freed.length === 0) {
        return values;
    }

    const kept = values.ingredients.filter((each) => groupLabelOf(each) !== label);

    return {
        ...values,
        ingredients: freed.reduce<RecipeFormIngredient[]>(
            (lines, each) => placeIngredient(lines, withGroup(each, undefined)),
            kept,
        ),
    };
};
