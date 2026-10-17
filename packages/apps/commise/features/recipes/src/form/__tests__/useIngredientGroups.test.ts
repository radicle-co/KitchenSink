// @vitest-environment jsdom
/**
 * Tests for {@link useIngredientGroups}: the Ingredients section's groups (build spec §7.5.5), over a real draft reducer
 * (`applyDraftAction`) and the entry's real placement rule (`placementOf`), so what these cases hold is what the editor
 * does.
 *
 * Two review findings (2026-10-09) are held here:
 * - Medium 3: the add field's label and its pick read ONE placement, the entry's, so the field can never say "Add to
 *   Wet" while its pick lands in a recreated "Dry".
 * - Medium 4: every group edit is the editor's own transition (`dispatch`), so a settle that lands between the render
 *   that built a handler and the press that runs it is kept.
 */
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { makeRecipeFormValues, withLineKeys, type UnkeyedFormIngredient } from '../../__fixtures__/index.js';
import { editorMessages } from '../../editor/messages.js';
import { EMPTY_ENTRY, placementOf, withPlacement, type FieldPlacement } from '../../hooks/ingredientEntry.model.js';
import type { DraftAction } from '../draftAction.js';
import { recipeFormMessages } from '../messages.js';
import { applyDraftAction } from '../props.js';
import { useIngredientGroups } from '../useIngredientGroups.js';
import type { RecipeFormValues } from '../values.js';

const m = recipeFormMessages.en;
const add = editorMessages.en.ingredients;

const line = (name: string, groupLabel?: string): UnkeyedFormIngredient => ({
    ingredientId: `ing_${name}`,
    isUserEntered: false,
    name,
    quantity: 1,
    ...(groupLabel === undefined ? {} : { groupLabel }),
});

/** The editor's draft and the entry's placement, each held as the editor holds it. */
function renderGroups(lines: readonly UnkeyedFormIngredient[]) {
    return renderHook(() => {
        const [values, setValues] = useState<RecipeFormValues>(() =>
            makeRecipeFormValues({ ingredients: withLineKeys(lines) }),
        );
        const [placed, setPlaced] = useState<FieldPlacement | undefined>(undefined);
        const dispatch = (action: DraftAction): void => setValues((current) => applyDraftAction(current, action));
        const groups = useIngredientGroups({
            values,
            dispatch,
            entry: { placement: placementOf(withPlacement(EMPTY_ENTRY, placed), values.ingredients), place: setPlaced },
            requestTrailing: () => undefined,
            requestActions: () => undefined,
            m,
            add,
        });

        return { values, dispatch, groups, placed };
    });
}

const shape = (values: RecipeFormValues): string[] =>
    values.ingredients.map((each) => `${each.name ?? ''}/${each.groupLabel ?? '-'}`);

describe('useIngredientGroups — a group edit meets the draft as it is when it runs (Medium 4)', () => {
    it('a Move to group pressed after a settle landed keeps the settle', () => {
        const { result } = renderGroups([line('flour', 'Dry'), line('milk', 'Wet')]);
        const flour = result.current.values.ingredients[0]?.key;

        if (flour === undefined) {
            throw new Error('no flour');
        }

        act(() => result.current.groups.openMoveToGroup(flour));
        // The handler of THIS render; a settle lands before the cook's press runs it.
        const toWet = result.current.groups.moveToGroup.choices.find((choice) => choice.label === 'Wet')?.onSelect;

        act(() => result.current.dispatch({ kind: 'updateIngredientAt', index: 1, patch: { preparation: 'warm' } }));
        act(() => toWet?.());

        expect(shape(result.current.values)).toEqual(['milk/Wet', 'flour/Wet']);
        expect(result.current.values.ingredients[0]?.preparation).toBe('warm');
    });

    it('a Remove group pressed after a settle landed keeps the settle', () => {
        const { result } = renderGroups([line('flour', 'Dry'), line('milk', 'Wet')]);
        const remove = result.current.groups.decorate([{ key: 'dry', label: 'Dry', rows: [] }])[0]?.group
            ?.destructiveAction.onSelect;

        act(() => result.current.dispatch({ kind: 'updateIngredientAt', index: 1, patch: { preparation: 'warm' } }));
        act(() => remove?.());

        expect(shape(result.current.values)).toEqual(['flour/-', 'milk/Wet']);
        expect(result.current.values.ingredients[1]?.preparation).toBe('warm');
    });
});

describe('useIngredientGroups — the add field’s label reads the entry’s one placement (Medium 3)', () => {
    it('after the placed group’s last line moves out, the label follows the group being built', () => {
        const { result } = renderGroups([line('flour', 'Dry'), line('milk', 'Wet')]);
        const flour = result.current.values.ingredients[0]?.key;

        if (flour === undefined) {
            throw new Error('no flour');
        }

        const addToDry = result.current.groups.decorate([
            { key: 'dry', label: 'Dry', rows: [] },
            { key: 'wet', label: 'Wet', rows: [] },
        ])[0]?.addHere;

        act(() => (addToDry?.kind === 'button' ? addToDry.onPress() : undefined));
        expect(result.current.placed).toEqual({ group: 'Dry', madeByCook: false });
        expect(result.current.groups.trailingLabel).toBe('Add to Dry');

        act(() => result.current.groups.openMoveToGroup(flour));
        act(() => result.current.groups.moveToGroup.choices.find((choice) => choice.label === 'Wet')?.onSelect());

        expect(result.current.groups.trailingLabel).toBe('Add to Wet');
    });

    it('a group the cook names holds the field before any line is in it', () => {
        const { result } = renderGroups([line('milk', 'Wet')]);

        act(() => result.current.groups.addGroup.onOpen());
        act(() => result.current.groups.addGroup.field?.onChange('Herbs'));
        act(() => result.current.groups.addGroup.field?.onSubmit());

        expect(result.current.placed).toEqual({ group: 'Herbs', madeByCook: true });
        expect(result.current.groups.trailingLabel).toBe('Add to Herbs');
    });
});
