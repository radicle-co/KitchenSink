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

afterEach(cleanup);

function Probe({ recipeId, label }: { readonly recipeId: string; readonly label: string }) {
    const marks = useCookMarks(recipeId);

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
        const { result } = renderHook(() => useCookMarks('rec_1'), {
            wrapper: wrapperFor(memoryCookMarksBackend(), 'user_1'),
        });

        act(() => result.current.toggleLine('ing_a'));
        act(() => result.current.toggleStep(2));
        expect([...result.current.checkedLines]).toEqual(['ing_a']);
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
            const marks = useCookMarks('rec_1');

            return (
                <button type="button" onClick={() => marks.toggleLine('ing_a')}>
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

        expect(screen.getByLabelText('second view').textContent).toBe('ing_a|-|set');
        expect(screen.getByLabelText('other recipe').textContent).toBe('|-|none');
    });

    it('marks survive the view unmounting and coming back', () => {
        const backend = memoryCookMarksBackend();
        const first = renderHook(() => useCookMarks('rec_1'), { wrapper: wrapperFor(backend, 'user_1') });
        act(() => first.result.current.toggleStep(4));
        first.unmount();

        const second = renderHook(() => useCookMarks('rec_1'), { wrapper: wrapperFor(backend, 'user_1') });

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
            const marks = useCookMarks('rec_1');

            return (
                <button type="button" onClick={() => marks.toggleLine('ing_a')}>
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
        expect(screen.getByLabelText('marks').textContent).toBe('ing_a|-|set');

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

        expect(() => renderHook(() => useCookMarks('rec_1'))).toThrow(/CookMarksProvider/u);
    });
});
