/**
 * The arrival on the native ingredients field group (`docs/design/uiOverhaul/ingredientArrival.md`): after a pick on the
 * add field, the new row and the field show together, and the row wears the `selectedFill` tint until the cook moves on.
 *
 * - The leaf asks the field reveal host (`FieldRevealContext`) once per pick, only after the new row has laid out, for a
 *   committed pick on the trailing add row; never for a failed pick, a conflict or Change food.
 * - The tint is on while the cook has not moved past the pick, and is plain visual: no selected state is announced.
 * - Focus stays in the add field.
 *
 * react-native-web reports layout through one `ResizeObserver` and each node's `offsetHeight`, neither of which jsdom has,
 * so the test records the observer and reports a height through it (`BottomChromeFrame.native.test.tsx`'s method).
 */
import { role } from '@commise/ui/colors';
import { FieldRevealContext, type FieldRevealer } from '@commise/ui/field-reveal';
import { BackInterceptProvider } from '@commise/ui/back-intercept';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeIngredientNutrition, makeLookupRetry, withLineKeys } from '../../__fixtures__/index.js';
import { useFakeRowEditor } from '../../__fixtures__/useFakeRowEditor.js';
import type { LineCommitOutcome, LineCommitTarget } from '../../hooks/lineCommit.js';
import type { SettledRowCommit } from '../../hooks/useIngredientRowEditor.js';
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.native.js';
import type { IngredientLineKey } from '../lineKey.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';

const observer = vi.hoisted(() => {
    const recorded = { callback: undefined as ResizeObserverCallback | undefined, observed: new Set<Element>() };

    globalThis.ResizeObserver = class {
        public constructor(callback: ResizeObserverCallback) {
            recorded.callback = callback;
        }

        public observe(target: Element): void {
            recorded.observed.add(target);
        }

        public unobserve(target: Element): void {
            recorded.observed.delete(target);
        }

        public disconnect(): void {
            recorded.observed.clear();
        }
    } as unknown as typeof ResizeObserver;

    return recorded;
});

afterEach(() => {
    cleanup();
    observer.observed.clear();
});

const FLOUR = { ingredientId: 'ing_f', name: 'Flour', quantity: 2, unit: 'cup', isUserEntered: false } as const;
const SUGAR = { ingredientId: 'ing_s', name: 'Sugar', quantity: 1, unit: 'cup', isUserEntered: false } as const;
const SALT = { ingredientId: 'ing_t', name: 'Salt', quantity: 1, unit: 'tsp', isUserEntered: false } as const;
const KEYED = withLineKeys([FLOUR, SUGAR, SALT]);

const keyOf = (index: number): IngredientLineKey => {
    const line = KEYED[index];

    if (line === undefined) {
        throw new Error(`no line ${String(index)}`);
    }

    return line.key;
};

const rgb = (hex: string): string => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
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

const Harness: FC<{
    readonly settled?: SettledRowCommit;
    readonly movedPast?: boolean;
    /** A pick on the add field is in flight. */
    readonly inFlight?: boolean;
    /**
     * How many rows the draft holds. A pick's row mounts in the same render that settles it, so a test raises this with
     * the `settled` it passes: react-native-web watches a node's layout only if its `onLayout` was there at mount.
     */
    readonly lines?: number;
}> = ({ settled, movedPast, inFlight = false, lines = 1 }) => {
    const draft: RecipeFormValues = { ...defaultRecipeFormValues(), ingredients: KEYED.slice(0, lines) };
    const rowEditor = useFakeRowEditor(draft.ingredients, {
        editor: {
            ...(settled === undefined ? {} : { settled }),
            ...(movedPast === undefined ? {} : { movedPast }),
            pickInFlight: (target) => (inFlight && target.kind === 'newLine' ? PICKED : undefined),
        },
    });

    return (
        <BackInterceptProvider onUnhandled={() => false}>
            <RecipeIngredientsFields
                values={draft}
                onChange={() => undefined}
                nutrition={makeIngredientNutrition()}
                lookupRetry={makeLookupRetry()}
                rowEditor={rowEditor}
            />
        </BackInterceptProvider>
    );
};

/** The host's revealer, recording what the add field asks. */
function hosted(props: Parameters<typeof Harness>[0] = {}) {
    const release = vi.fn();
    const revealer = vi.fn<FieldRevealer>(() => release);
    const tree = (next: Parameters<typeof Harness>[0]) => (
        <FieldRevealContext.Provider value={revealer}>
            <Harness {...next} />
        </FieldRevealContext.Provider>
    );
    const rendered = render(tree(props));

    return { revealer, release, rerender: (next: Parameters<typeof Harness>[0]) => rendered.rerender(tree(next)) };
}

const rowOf = (name: string): HTMLElement => {
    const row = screen.getByRole('button', { name: new RegExp(`Edit .*${name}`, 'u') }).closest('[role="listitem"]');

    if (!(row instanceof HTMLElement)) {
        throw new Error(`no row for ${name}`);
    }

    return row;
};

const tintOf = (name: string): string => getComputedStyle(rowOf(name)).backgroundColor;

/** The nodes the platform's layout pass watches that are rows. */
const watchedRows = (): Element[] => [...observer.observed].filter((node) => node.getAttribute('role') === 'listitem');

/** The node watching the add field's row: the one that holds the add field and is no row of the list. */
const watchedFieldRow = (): Element[] =>
    [...observer.observed].filter(
        (node) => node.getAttribute('role') !== 'listitem' && node.contains(screen.getByLabelText('Add an ingredient')),
    );

/** Report `height`, and a `top` inside the parent, for `nodes`, as the platform's layout pass does. */
async function layOut(nodes: Element[], height: number, top = 0): Promise<void> {
    for (const node of nodes) {
        Object.defineProperty(node, 'offsetHeight', { value: height, configurable: true });
        Object.defineProperty(node, 'offsetTop', { value: top, configurable: true });
    }

    await act(async () => {
        observer.callback?.(
            nodes.map((target) => ({ target }) as unknown as ResizeObserverEntry),
            {} as ResizeObserver,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

/** The new row lays out at `height`. */
const layOutRow = (height: number): Promise<void> => layOut(watchedRows(), height);

const NEW_LINE: LineCommitTarget = { kind: 'newLine' };

beforeEach(() => {
    observer.observed.clear();
});

describe('RecipeIngredientsFields (native) — an arrival', () => {
    it('asks the field reveal host once, after the new row has laid out, for the row above the field', async () => {
        const { revealer, rerender } = hosted();
        expect(revealer).not.toHaveBeenCalled();

        rerender({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });
        // The row has not laid out, so its height is not known: nothing is asked yet.
        expect(revealer).not.toHaveBeenCalled();

        await layOutRow(60);

        // The row's 60 dp and the 4 dp between the list and the field.
        expect(revealer).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ kind: 'arrival', below: 0, above: 64 }),
        );
    });

    /**
     * REWRITTEN 2026-10-14: this used to lay out the add field's LABEL and expect its height plus a 4 dp gap the combobox
     * added by hand. The combobox now reads its field row's own `y` (the label block and the gap under it, as laid out),
     * so the case lays out the field row and proves that `y` is what reaches the host.
     */
    it('adds where the add field’s row sits under its label, as laid out, to the distance from the row', async () => {
        const { revealer, rerender } = hosted();
        await layOut(watchedFieldRow(), 0, 24);

        rerender({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });
        await layOutRow(60);

        // 60 dp of row, 4 dp to the combobox, and its field row 24 dp down under the label.
        expect(revealer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'arrival', above: 88 }));
    });

    /**
     * ⛔ ONE AUTHORITY FOR THE GAP BETWEEN THE LIST AND THE ADD FIELD. The distance the leaf asks for adds that gap, and the
     * section's stack lays it out; if they were two numbers, a change to one would ask for a span the screen does not
     * have, and every assertion pinned to a literal would still pass. So this reads the gap the stack RENDERS.
     */
    it('adds the gap the section actually lays out between its list and the add field', async () => {
        const { revealer, rerender } = hosted();
        rerender({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });
        const stack = screen.getByRole('list').parentElement;

        if (stack === null) {
            throw new Error('the list has no stack around it');
        }

        const rendered = Number.parseFloat(getComputedStyle(stack).gap);

        expect(rendered).toBeGreaterThan(0);

        await layOutRow(60);

        expect(revealer).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ kind: 'arrival', above: 60 + rendered }),
        );
    });

    it('asks nothing more when the new row grows', async () => {
        const { revealer, rerender } = hosted();
        rerender({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });
        await layOutRow(60);

        await layOutRow(96);

        expect(revealer).toHaveBeenCalledTimes(1);
    });

    it('tints the new row with selectedFill, and only that row', async () => {
        const { rerender } = hosted();
        rerender({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });
        await layOutRow(60);

        expect(tintOf('Sugar')).toBe(rgb(role.selectedFill));
        expect(tintOf('Flour')).not.toBe(rgb(role.selectedFill));
    });

    it('announces nothing for the tint: the row is not marked selected', async () => {
        const { rerender } = hosted();
        rerender({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });
        await layOutRow(60);

        const row = rowOf('Sugar');

        expect(row.getAttribute('aria-selected')).toBeNull();
        expect(within(row).queryByText(/selected|new/iu)).toBeNull();
    });

    it('clears the tint and releases the ask once the cook has moved past the pick', async () => {
        const { release, rerender } = hosted();
        const settled = settledOf(NEW_LINE, committed(1));
        rerender({ settled, lines: 2 });
        await layOutRow(60);

        rerender({ settled, movedPast: true, lines: 2 });

        expect(tintOf('Sugar')).not.toBe(rgb(role.selectedFill));
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('typing in the add field moves past the pick: no tint is left behind', async () => {
        const { rerender } = hosted();
        rerender({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });
        await layOutRow(60);

        fireEvent.change(screen.getByLabelText<HTMLInputElement>('Add an ingredient'), { target: { value: 'sa' } });

        expect(tintOf('Sugar')).not.toBe(rgb(role.selectedFill));
    });

    it.each([
        ['a failed pick', settledOf(NEW_LINE, { kind: 'failed' })],
        ['a conflict', settledOf(NEW_LINE, { kind: 'conflict' })],
        ['Change food on an existing row', settledOf({ kind: 'line', key: keyOf(1) }, committed(1))],
    ] as const)('asks nothing and tints nothing for %s', async (_case, settled) => {
        const { revealer, rerender } = hosted();

        rerender({ settled, lines: 2 });
        await layOutRow(60);

        expect(revealer).not.toHaveBeenCalled();
        expect(tintOf('Sugar')).not.toBe(rgb(role.selectedFill));
    });

    it('asks nothing for a commit that settled before the field group mounted', async () => {
        const { revealer } = hosted({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });

        await layOutRow(60);

        expect(revealer).not.toHaveBeenCalled();
        expect(tintOf('Sugar')).not.toBe(rgb(role.selectedFill));
    });

    it('asks nothing and tints nothing when the cook typed in the add field while the pick was in flight', async () => {
        const { revealer, rerender } = hosted({ inFlight: true });
        fireEvent.change(screen.getByLabelText<HTMLInputElement>('Add an ingredient'), { target: { value: 'pa' } });

        rerender({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });
        await layOutRow(60);

        expect(revealer).not.toHaveBeenCalled();
        expect(tintOf('Sugar')).not.toBe(rgb(role.selectedFill));
    });

    it('leaves focus where it was', async () => {
        const { rerender } = hosted();
        const field = screen.getByLabelText<HTMLInputElement>('Add an ingredient');
        field.focus();

        rerender({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });
        await layOutRow(60);

        expect(document.activeElement).toBe(field);
    });

    it('asks again for the next pick', async () => {
        const { revealer, rerender } = hosted();
        rerender({ settled: settledOf(NEW_LINE, committed(1)), lines: 2 });
        await layOutRow(60);

        rerender({ settled: settledOf(NEW_LINE, committed(2)), lines: 3 });
        await layOutRow(72);

        expect(revealer).toHaveBeenCalledTimes(2);
        expect(revealer).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'arrival', above: 76 }));
    });
});
