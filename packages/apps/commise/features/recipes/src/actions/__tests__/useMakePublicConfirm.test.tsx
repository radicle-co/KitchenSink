/**
 * {@link useMakePublicConfirm} - asking for Public on a private thing (UX SPECIFY 2026-10-15; plan 2026-10-14-009 Q5).
 * Where going public costs the cook something worth saying, the step is confirmed first, in the words of the consequence
 * the HOST decided (`recipeMakePublicConsequence` for a recipe, `makePublicConsequence` for a collection). The editor, the
 * recipe page's menu and the collection page ask through it; each says what applying Public means there.
 *
 * REWRITTEN for ADR-0073: the hook no longer derives the consequence from a paid-feature state. It takes the consequence,
 * so the recipe rule (slots) and the collection rule (Pro) share this one confirmation guard without sharing a rule.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMakePublicConfirm } from '../useMakePublicConfirm.js';

type Consequence = 'frees' | 'premium';

function mount(consequence: Consequence | 'none') {
    const apply = vi.fn<(done: () => void) => void>();
    const view = renderHook(() => useMakePublicConfirm<Consequence>({ consequence, fallback: 'frees', apply }));

    return { ...view, apply };
}

describe('useMakePublicConfirm', () => {
    it('with nothing to say it goes public at once, with no dialog', () => {
        const { result, apply } = mount('none');

        act(() => result.current.request());

        expect(apply).toHaveBeenCalledTimes(1);
        expect(result.current.dialog.open).toBe(false);
    });

    it.each(['frees', 'premium'] as const)(
        '⛔ with the %s consequence, asks first, with those words, and applies nothing yet',
        (consequence) => {
            const { result, apply } = mount(consequence);

            act(() => result.current.request());

            expect(result.current.dialog.open).toBe(true);
            expect(result.current.dialog.consequence).toBe(consequence);
            expect(apply).not.toHaveBeenCalled();
            expect(result.current.confirmed).toBe(false);
        },
    );

    it('Keep private closes the dialog and applies nothing', () => {
        const { result, apply } = mount('frees');

        act(() => result.current.request());
        act(() => result.current.dialog.onKeep());

        expect(result.current.dialog.open).toBe(false);
        expect(apply).not.toHaveBeenCalled();
        expect(result.current.confirmed).toBe(false);
    });

    it('Make public applies, and the dialog closes once the host says it is done', () => {
        const { result, apply } = mount('premium');

        act(() => result.current.request());
        act(() => result.current.dialog.onConfirm());

        expect(apply).toHaveBeenCalledTimes(1);
        expect(result.current.confirmed).toBe(true);
        // The recipe page keeps the dialog up while its write is in flight, and closes it on success.
        expect(result.current.dialog.open).toBe(true);

        act(() => apply.mock.calls[0]?.[0]());

        expect(result.current.dialog.open).toBe(false);
    });

    it('a consequence that settles to nothing while the dialog is up closes it (derived, never stored)', () => {
        let consequence: Consequence | 'none' = 'frees';
        const apply = vi.fn<(done: () => void) => void>();
        const { result, rerender } = renderHook(() =>
            useMakePublicConfirm<Consequence>({ consequence, fallback: 'frees', apply }),
        );

        act(() => result.current.request());
        expect(result.current.dialog.open).toBe(true);

        consequence = 'none';
        rerender();

        expect(result.current.dialog.open).toBe(false);
    });
});
