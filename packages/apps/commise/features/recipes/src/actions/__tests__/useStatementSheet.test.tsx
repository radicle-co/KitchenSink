/**
 * `useStatementSheet`: the sheet's state and its Confirm (ADR-0095). Confirm with no answer does nothing; with an unusable
 * field it marks the field and sends nothing; with a usable answer it hands the host exactly what `statementWriteOf` says.
 */
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { phaseOf } from '../sourceStatement.js';
import { useStatementSheet } from '../useStatementSheet.js';

function mount() {
    const onAnswer = vi.fn();
    const { result } = renderHook(() => useStatementSheet({ locale: 'fr', onAnswer }));

    return { result, onAnswer };
}

describe('useStatementSheet', () => {
    it('sends nothing for a Confirm with no answer, and stays choosing', () => {
        const { result, onAnswer } = mount();

        act(() => result.current.confirm());

        expect(onAnswer).not.toHaveBeenCalled();
        expect(phaseOf(result.current.state)).toBe('choosing');
    });

    it('marks an unusable field and sends nothing, then sends once the field is fixed', () => {
        const { result, onAnswer } = mount();

        act(() => result.current.dispatch({ type: 'choose', answer: 'book' }));
        act(() => result.current.confirm());

        expect(onAnswer).not.toHaveBeenCalled();
        expect(phaseOf(result.current.state)).toBe('fieldError');

        act(() => result.current.dispatch({ type: 'bookTitle', text: 'Joy of Cooking' }));
        act(() => result.current.confirm());

        expect(onAnswer).toHaveBeenCalledWith({
            statement: {
                kind: 'book',
                citation: 'Joy of Cooking',
                wording: { version: 'statementBook.v1', locale: 'en' },
            },
            visibility: RecipeVisibility.PRIVATE,
        });
    });

    it('sends "I wrote this" as public with the wording in the locale of the catalog that served it (the screen asked for fr, English was shown)', () => {
        const { result, onAnswer } = mount();

        act(() => result.current.dispatch({ type: 'choose', answer: 'authored' }));
        act(() => result.current.confirm());

        expect(onAnswer).toHaveBeenCalledWith({
            statement: { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } },
            visibility: RecipeVisibility.PUBLIC,
        });
    });

    it('starts clean after a reset', () => {
        const { result } = mount();

        act(() => result.current.dispatch({ type: 'choose', answer: 'authored' }));
        act(() => result.current.reset());

        expect(phaseOf(result.current.state)).toBe('choosing');
    });
});
