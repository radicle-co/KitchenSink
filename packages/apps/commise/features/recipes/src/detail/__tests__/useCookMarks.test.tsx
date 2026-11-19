/**
 * `CookMarksProvider` + `useCookMarks` (blueprint A13): the binding a detail screen reads its marks through. Marks
 * belong to the provider's cook and the recipe — not to a screen — so two views of one recipe agree, a view that
 * unmounts and comes back finds them, and a change of cook ends them. A screen mounted with no provider fails loudly
 * rather than quietly keeping marks nobody can clear.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { CookMarksProvider } from '../CookMarksProvider.js';
import { memoryCookMarksBackend, type CookMarksBackend } from '../cookMarksStore.js';
import { useCookMarks } from '../useCookMarks.js';
import type { IngredientLineDigestInput } from '@kitchensink/cooking-core';

afterEach(cleanup);

/** Two identical butter lines and a flour line: the shape that the binding id could not tell apart (#155). */
const line = (over: Partial<IngredientLineDigestInput> = {}): IngredientLineDigestInput => ({
    ingredientId: '01JINGREDIENT0000000000000A',
    quantity: { kind: 'exact', value: 2 },
    unit: 'tbsp',
    displayText: 'butter',
    ...over,
});
const LINES = [line(), line(), line({ ingredientId: '01JINGREDIENT0000000000000B', displayText: 'flour' })];

function Probe({ recipeId, label }: { readonly recipeId: string; readonly label: string }) {
    const marks = useCookMarks(recipeId, LINES);

    return (
        <p aria-label={label}>
            {[...marks.checkedLines].join(',')}|{marks.currentStep ?? '-'}|{marks.hasMarks ? 'set' : 'none'}
        </p>
    );
}

const wrapperFor =
    (backend: CookMarksBackend, subject: string | undefined) =>
    ({ children }: { readonly children: ReactNode }) => (
        <CookMarksProvider subject={subject} backend={backend}>
            {children}
        </CookMarksProvider>
    );

describe('useCookMarks', () => {
    it('toggles lines and the current step, and clears both', () => {
        const { result } = renderHook(() => useCookMarks('rec_1', LINES), {
            wrapper: wrapperFor(memoryCookMarksBackend(), 'user_1'),
        });

        act(() => result.current.toggleLine(0));
        act(() => result.current.toggleStep(2));
        expect([...result.current.checkedLines]).toEqual([0]);
        expect(result.current.currentStep).toBe(2);
        expect(result.current.hasMarks).toBe(true);

        act(() => result.current.clear());
        expect(result.current.checkedLines.size).toBe(0);
        expect(result.current.currentStep).toBeUndefined();
        expect(result.current.hasMarks).toBe(false);
    });

    it('two views of one recipe show one set of marks', () => {
        const backend = memoryCookMarksBackend();

        const Toggler = () => {
            const marks = useCookMarks('rec_1', LINES);

            return (
                <button type="button" onClick={() => marks.toggleLine(0)}>
                    check
                </button>
            );
        };

        render(
            <CookMarksProvider subject="user_1" backend={backend}>
                <Toggler />
                <Probe recipeId="rec_1" label="second view" />
                <Probe recipeId="rec_2" label="other recipe" />
            </CookMarksProvider>,
        );

        act(() => screen.getByRole('button', { name: 'check' }).click());

        expect(screen.getByLabelText('second view').textContent).toBe('0|-|set');
        expect(screen.getByLabelText('other recipe').textContent).toBe('|-|none');
    });

    it('marks survive the view unmounting and coming back', () => {
        const backend = memoryCookMarksBackend();
        const first = renderHook(() => useCookMarks('rec_1', LINES), { wrapper: wrapperFor(backend, 'user_1') });
        act(() => first.result.current.toggleStep(4));
        first.unmount();

        const second = renderHook(() => useCookMarks('rec_1', LINES), { wrapper: wrapperFor(backend, 'user_1') });

        expect(second.result.current.currentStep).toBe(4);
    });

    it('a sign-out ends the cook’s marks', () => {
        const backend = memoryCookMarksBackend();
        const { rerender } = render(
            <CookMarksProvider subject="user_1" backend={backend}>
                <Probe recipeId="rec_1" label="marks" />
            </CookMarksProvider>,
        );

        const Toggler = () => {
            const marks = useCookMarks('rec_1', LINES);

            return (
                <button type="button" onClick={() => marks.toggleLine(0)}>
                    check
                </button>
            );
        };

        rerender(
            <CookMarksProvider subject="user_1" backend={backend}>
                <Toggler />
                <Probe recipeId="rec_1" label="marks" />
            </CookMarksProvider>,
        );
        act(() => screen.getByRole('button', { name: 'check' }).click());
        expect(screen.getByLabelText('marks').textContent).toBe('0|-|set');

        rerender(
            <CookMarksProvider subject={undefined} backend={backend}>
                <Probe recipeId="rec_1" label="marks" />
            </CookMarksProvider>,
        );

        expect(backend.keys()).toEqual([]);
        expect(screen.getByLabelText('marks').textContent).toBe('|-|none');
    });

    it('fails loudly with no provider', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderHook(() => useCookMarks('rec_1', LINES))).toThrow(/CookMarksProvider/u);
    });

    it('clearIngredientTicks drops the ticks and keeps the step; restoreIngredientTicks puts them back beside new ticks', () => {
        const { result } = renderHook(() => useCookMarks('rec_1', LINES), {
            wrapper: wrapperFor(memoryCookMarksBackend(), 'user_1'),
        });

        act(() => result.current.toggleLine(0));
        act(() => result.current.toggleLine(2));
        act(() => result.current.toggleStep(3));
        const cleared = [...result.current.checkedLines];

        act(() => result.current.clearIngredientTicks());
        expect(result.current.checkedLines.size).toBe(0);
        expect(result.current.currentStep).toBe(3);

        act(() => result.current.toggleLine(1));
        act(() => result.current.restoreIngredientTicks(cleared));
        expect([...result.current.checkedLines].sort()).toEqual([0, 1, 2]);
        expect(result.current.currentStep).toBe(3);
    });

    it('ticks ONE of two identical lines, and that tick survives a line inserted above (mutant: keying by ingredientId)', () => {
        const backend = memoryCookMarksBackend();
        const first = renderHook(({ lines }) => useCookMarks('rec_1', lines), {
            initialProps: { lines: LINES },
            wrapper: wrapperFor(backend, 'user_1'),
        });

        act(() => first.result.current.toggleLine(1));
        expect([...first.result.current.checkedLines]).toEqual([1]);

        const above = line({ ingredientId: '01JINGREDIENT0000000000000C', displayText: 'sugar' });
        first.rerender({ lines: [above, ...LINES] });

        expect([...first.result.current.checkedLines]).toEqual([2]);
    });

    it('a tick on an edited line drops, and the other lines keep theirs', () => {
        const backend = memoryCookMarksBackend();
        const first = renderHook(({ lines }) => useCookMarks('rec_1', lines), {
            initialProps: { lines: LINES },
            wrapper: wrapperFor(backend, 'user_1'),
        });

        act(() => first.result.current.toggleLine(2));
        act(() => first.result.current.toggleLine(0));
        first.rerender({
            lines: [
                LINES[0] ?? line(),
                LINES[1] ?? line(),
                line({ displayText: 'bread flour', ingredientId: '01JINGREDIENT0000000000000B' }),
            ],
        });

        expect([...first.result.current.checkedLines]).toEqual([0]);
    });

    it('an out-of-range position changes nothing and writes nothing (F2; mutant: no index guard)', () => {
        const backend = memoryCookMarksBackend();
        const setItem = vi.spyOn(backend, 'setItem');
        const { result } = renderHook(() => useCookMarks('rec_1', LINES), { wrapper: wrapperFor(backend, 'user_1') });

        act(() => result.current.toggleLine(9));
        act(() => result.current.toggleLine(-1));
        act(() => result.current.restoreIngredientTicks([9]));

        expect(setItem).not.toHaveBeenCalled();
        expect(backend.keys()).toEqual([]);
        expect(result.current.checkedLines.size).toBe(0);
    });

    it("clear then restore gives the same positions back, through the snapshot's keys", () => {
        const { result } = renderHook(() => useCookMarks('rec_1', LINES), {
            wrapper: wrapperFor(memoryCookMarksBackend(), 'user_1'),
        });

        act(() => result.current.toggleLine(0));
        act(() => result.current.clearIngredientTicks());
        act(() => result.current.restoreIngredientTicks([0]));

        expect([...result.current.checkedLines]).toEqual([0]);
    });
});
