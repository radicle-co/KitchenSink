/**
 * Tests for {@link useIngredientsPaste} — the one composition of Paste a list both editor containers call (build spec
 * §7.5.4; D10): what the field group draws, whether the heading offers it, and the sheet. The paste hook is a double; the
 * sheet's state is the real one.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PasteIntoIngredients } from '../usePasteIntoIngredients.js';

const double = vi.hoisted(() => ({ current: undefined as PasteIntoIngredients | undefined }));

vi.mock('../usePasteIntoIngredients.js', () => ({
    usePasteIntoIngredients: () => double.current,
}));

import { useIngredientsPaste } from '../useIngredientsPaste.js';

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

const render = (over: Partial<PasteIntoIngredients>, lines: number, initiallyOpen = false) => {
    double.current = paste(over);

    return renderHook(() => useIngredientsPaste({ stored: false, dispatch: vi.fn(), lineCount: lines, initiallyOpen }));
};

describe('useIngredientsPaste', () => {
    it('an empty section offers paste beside the add field, not in its heading', () => {
        const { result } = render({}, 0);

        expect(result.current.inHeading).toBe(false);
        expect(result.current.view.onOpen).toBeDefined();
    });

    it('a section with lines offers it in its heading, and not beside the add field', () => {
        const { result } = render({}, 2);

        expect(result.current.inHeading).toBe(true);
        expect(result.current.view.onOpen).toBeUndefined();
    });

    it('⛔ once the recipe is stored (D10), nothing offers it', () => {
        const { result } = render({ available: false }, 2);

        expect(result.current.inHeading).toBe(false);
        expect(result.current.view.onOpen).toBeUndefined();
    });

    it('opening it from the section opens the sheet', () => {
        const { result } = render({}, 0);

        act(() => result.current.view.onOpen?.());

        expect(result.current.sheet.open).toBe(true);
    });

    it('Home’s first-run Paste ingredients opens the sheet at once', () => {
        expect(render({}, 0, true).result.current.sheet.open).toBe(true);
    });

    it('Publish waits while pasted lines are still joining the recipe', () => {
        expect(render({}, 0).result.current.pending).toBe(false);
        expect(
            render({ reading: [{ key: 'j:0', sourceLine: '2 cups flour', failed: false }] }, 0).result.current.pending,
        ).toBe(true);
        expect(render({ submitting: true }, 0).result.current.pending).toBe(true);
    });

    it('hands the field group the rows still reading, Try again, and the count said once a paste ends', () => {
        const retry = vi.fn();
        const reading = [{ key: 'j:0', sourceLine: '2 cups flour', failed: true }];
        const { result } = render({ reading, retry, added: { count: 3, occurrence: 2 } }, 1);

        expect(result.current.view).toMatchObject({ reading, onRetry: retry, added: { count: 3, occurrence: 2 } });
    });
});
