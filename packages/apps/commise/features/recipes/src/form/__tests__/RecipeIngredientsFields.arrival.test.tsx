// @vitest-environment jsdom
/**
 * The arrival on the web ingredients field group (`docs/design/uiOverhaul/ingredientArrival.md`): after a pick on the
 * add field, the page scrolls the new row and the field into view together (`ScrollHost.revealSpan`), and the row wears
 * the `selectedFill` tint until the cook moves on.
 *
 * - The scroll is asked for once per committed pick on the add field; never for a failed pick, a conflict or Change food,
 *   for a pick the cook typed over while it was in flight, or for one that settled before the group mounted.
 * - The tint is on while the cook has not moved past the pick; it carries no `aria-selected` and no text.
 * - Focus stays in the add field; the scroll host never moves it (`ScrollHost.test.tsx` pins that).
 * - Without a scroll host (a test, a screen with none) the group renders and ignores the arrival.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeIngredientNutrition, makeLookupRetry, withLineKeys } from '../../__fixtures__/index.js';
import { useFakeRowEditor } from '../../__fixtures__/useFakeRowEditor.js';
import type { LineCommitOutcome, LineCommitTarget } from '../../hooks/lineCommit.js';
import type { SettledRowCommit } from '../../hooks/useIngredientRowEditor.js';
import { ingredientAddFieldId, ingredientRowId } from '../fieldIds.js';
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.js';
import type { IngredientLineKey } from '../lineKey.js';
import { applyDraftAction } from '../props.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const scrollHost = vi.hoisted(() => ({
    revealSpan: undefined as undefined | ((topId: string, bottomId: string) => boolean),
    present: true,
}));

vi.mock('@commise/ui/scroll-host', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/ui/scroll-host')>()),
    useOptionalScrollHost: () => (scrollHost.present ? { revealSpan: scrollHost.revealSpan } : null),
}));

const revealSpan = vi.fn<(topId: string, bottomId: string) => boolean>(() => true);

beforeEach(() => {
    revealSpan.mockClear();
    scrollHost.revealSpan = revealSpan;
    scrollHost.present = true;
});

afterEach(cleanup);

const FLOUR = { ingredientId: 'ing_f', name: 'Flour', quantity: 2, unit: 'cup', isUserEntered: false } as const;
const SUGAR = { ingredientId: 'ing_s', name: 'Sugar', quantity: 1, unit: 'cup', isUserEntered: false } as const;
const KEYED = withLineKeys([FLOUR, SUGAR]);
const values = (): RecipeFormValues => ({ ...defaultRecipeFormValues(), ingredients: KEYED });

const keyOf = (index: number): IngredientLineKey => {
    const line = KEYED[index];

    if (line === undefined) {
        throw new Error(`no line ${String(index)}`);
    }

    return line.key;
};

const committed = (index: number): LineCommitOutcome => ({
    kind: 'committed',
    key: keyOf(index),
    binding: { ingredientId: 'ing_s', isUserEntered: false },
});

const PICKED = { kind: 'catalogFood', foodId: 'food_s', name: 'Sugar' } as const;

const settledOf = (target: LineCommitTarget, outcome: LineCommitOutcome): SettledRowCommit => ({
    origin: { kind: 'entry' },
    pick: PICKED,
    target,
    outcome,
});

const NEW_LINE: LineCommitTarget = { kind: 'newLine' };

const Harness: FC<{
    readonly settled?: SettledRowCommit;
    readonly movedPast?: boolean;
    /** A pick on the add field is in flight. */
    readonly inFlight?: boolean;
}> = ({ settled, movedPast, inFlight = false }) => {
    const [draft, setDraft] = useState(values);
    const rowEditor = useFakeRowEditor(draft.ingredients, {
        editor: {
            dispatch: (action) => setDraft((current) => applyDraftAction(current, action)),
            ...(settled === undefined ? {} : { settled }),
            ...(movedPast === undefined ? {} : { movedPast }),
            pickInFlight: (target) => (inFlight && target.kind === 'newLine' ? PICKED : undefined),
        },
    });

    return (
        <RecipeIngredientsFields
            values={draft}
            onChange={setDraft}
            nutrition={makeIngredientNutrition()}
            lookupRetry={makeLookupRetry()}
            rowEditor={rowEditor}
        />
    );
};

function hosted(props: Parameters<typeof Harness>[0] = {}) {
    const rendered = render(<Harness {...props} />);

    return { rerender: (next: Parameters<typeof Harness>[0]) => rendered.rerender(<Harness {...next} />) };
}

const rowOf = (key: IngredientLineKey): HTMLElement => {
    const row = document.getElementById(ingredientRowId(key));

    if (row === null) {
        throw new Error('no row');
    }

    return row;
};

const tinted = (index: number): boolean => rowOf(keyOf(index)).classList.contains('bg-selected-fill');

const addField = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>('Add an ingredient');

describe('RecipeIngredientsFields (web) — an arrival', () => {
    it('gives every row an id the page can find it by', () => {
        hosted();

        expect(rowOf(keyOf(0)).tagName).toBe('LI');
        expect(rowOf(keyOf(1)).tagName).toBe('LI');
        expect(addField().id).toBe(ingredientAddFieldId);
    });

    it('shows the new row with the add field, once, for a committed pick on the add field', () => {
        const { rerender } = hosted();
        expect(revealSpan).not.toHaveBeenCalled();

        rerender({ settled: settledOf(NEW_LINE, committed(1)) });

        expect(revealSpan).toHaveBeenCalledExactlyOnceWith(ingredientRowId(keyOf(1)), ingredientAddFieldId);
    });

    it('asks nothing more on a re-render of the same pick', () => {
        const { rerender } = hosted();
        const settled = settledOf(NEW_LINE, committed(1));
        rerender({ settled });

        rerender({ settled });
        rerender({ settled });

        expect(revealSpan).toHaveBeenCalledTimes(1);
    });

    it('asks again for the next pick', () => {
        const { rerender } = hosted();
        rerender({ settled: settledOf(NEW_LINE, committed(0)) });

        rerender({ settled: settledOf(NEW_LINE, committed(1)) });

        expect(revealSpan).toHaveBeenCalledTimes(2);
        expect(revealSpan).toHaveBeenLastCalledWith(ingredientRowId(keyOf(1)), ingredientAddFieldId);
    });

    it('tints the new row with selectedFill, and only that row, with nothing announced', () => {
        const { rerender } = hosted();

        rerender({ settled: settledOf(NEW_LINE, committed(1)) });

        expect(tinted(1)).toBe(true);
        expect(tinted(0)).toBe(false);
        expect(rowOf(keyOf(1)).getAttribute('aria-selected')).toBeNull();
    });

    it('fades the tint with a motion-safe transition, so reduced motion clears it at once', () => {
        hosted();

        expect(rowOf(keyOf(1)).className).toContain('motion-safe:transition-colors');
        expect(rowOf(keyOf(1)).className).toContain('motion-safe:duration-150');
    });

    it('clears the tint once the cook moves past the pick', () => {
        const { rerender } = hosted();
        const settled = settledOf(NEW_LINE, committed(1));
        rerender({ settled });

        rerender({ settled, movedPast: true });

        expect(tinted(1)).toBe(false);
    });

    it('clears the tint when the cook types in the add field', () => {
        const { rerender } = hosted();
        rerender({ settled: settledOf(NEW_LINE, committed(1)) });

        fireEvent.change(addField(), { target: { value: 'sa' } });

        expect(tinted(1)).toBe(false);
    });

    it.each([
        ['a failed pick', settledOf(NEW_LINE, { kind: 'failed' })],
        ['a conflict', settledOf(NEW_LINE, { kind: 'conflict' })],
        ['Change food on an existing row', settledOf({ kind: 'line', key: keyOf(1) }, committed(1))],
    ] as const)('scrolls nothing and tints nothing for %s', (_case, settled) => {
        const { rerender } = hosted();

        rerender({ settled });

        expect(revealSpan).not.toHaveBeenCalled();
        expect(tinted(1)).toBe(false);
    });

    it('scrolls nothing for a commit that settled before the field group mounted', () => {
        hosted({ settled: settledOf(NEW_LINE, committed(1)) });

        expect(revealSpan).not.toHaveBeenCalled();
        expect(tinted(1)).toBe(false);
    });

    it('scrolls nothing and tints nothing when the cook typed while the pick was in flight', () => {
        const { rerender } = hosted({ inFlight: true });
        fireEvent.change(addField(), { target: { value: 'pa' } });

        rerender({ settled: settledOf(NEW_LINE, committed(1)) });

        expect(revealSpan).not.toHaveBeenCalled();
        expect(tinted(1)).toBe(false);
    });

    it('leaves focus in the add field', () => {
        const { rerender } = hosted();
        addField().focus();

        rerender({ settled: settledOf(NEW_LINE, committed(1)) });

        expect(document.activeElement).toBe(addField());
    });

    it('renders and tints without a scroll host, and scrolls nothing', () => {
        scrollHost.present = false;
        const { rerender } = hosted();

        act(() => rerender({ settled: settledOf(NEW_LINE, committed(1)) }));

        expect(revealSpan).not.toHaveBeenCalled();
        expect(tinted(1)).toBe(true);
    });
});
