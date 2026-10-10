/**
 * Tests for {@link usePasteListSheet} — the Paste a list sheet's state (build spec §7.5.4): open or closed, the pasted
 * text and its count, and the add that hands the text to the paste. The paste itself is a double.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PasteIntoIngredients } from '../usePasteIntoIngredients.js';
import { usePasteListSheet } from '../usePasteListSheet.js';

const COPY = { lineTooLong: 'Line {line} is too long.', tooManyLines: 'Too many.' };

const paste = (over: Partial<PasteIntoIngredients> = {}): PasteIntoIngredients => ({
    available: true,
    submit: vi.fn(),
    submitting: false,
    failed: false,
    clearFailure: vi.fn(),
    acceptedCount: 0,
    reading: [],
    retry: vi.fn(),
    added: undefined,
    ...over,
});

function render(initial: PasteIntoIngredients, initiallyOpen = false) {
    return renderHook(({ current }) => usePasteListSheet(current, { initiallyOpen, copy: COPY }), {
        initialProps: { current: initial },
    });
}

describe('usePasteListSheet', () => {
    it('opens on request, forgetting a failed send from before', () => {
        const clearFailure = vi.fn();
        const { result } = render(paste({ clearFailure }));

        act(() => result.current.setOpen(true));

        expect(result.current.open).toBe(true);
        expect(clearFailure).toHaveBeenCalledTimes(1);
    });

    it('opens at once for Home’s first-run Paste ingredients, while paste is offered', () => {
        expect(render(paste(), true).result.current.open).toBe(true);
        expect(render(paste({ available: false }), true).result.current.open).toBe(false);
    });

    it('counts the lines as the cook pastes, and adds nothing at 0', () => {
        const submit = vi.fn();
        const { result } = render(paste({ submit }));

        act(() => result.current.setText('2 cups flour\n\n1 tsp salt'));
        expect(result.current.model.lineCount).toBe(2);

        act(() => result.current.setText('   '));
        act(() => result.current.add());
        expect(submit).not.toHaveBeenCalled();
    });

    it('adding sends the text; the sheet stays open until the job is accepted, then closes empty', () => {
        const submit = vi.fn();
        const { result, rerender } = render(paste({ submit }));
        act(() => result.current.setOpen(true));
        act(() => result.current.setText('2 cups flour'));

        act(() => result.current.add());
        expect(submit).toHaveBeenCalledWith('2 cups flour');
        expect(result.current.open).toBe(true);

        rerender({ current: paste({ submit, acceptedCount: 1 }) });

        expect(result.current.open).toBe(false);
        expect(result.current.text).toBe('');
    });

    it('a refused send keeps the sheet open with the text, so the cook can try again', () => {
        const { result, rerender } = render(paste());
        act(() => result.current.setOpen(true));
        act(() => result.current.setText('2 cups flour'));
        act(() => result.current.add());

        rerender({ current: paste({ failed: true }) });

        expect(result.current.open).toBe(true);
        expect(result.current.text).toBe('2 cups flour');
    });
});
