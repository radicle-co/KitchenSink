/**
 * The Cuisine field's headless hook (`docs/design/uiOverhaul/cuisineField.md` §3): the filter follows the cook's first
 * edit after focus, a pick and the cook's own words commit their canonical form, and the polite count changes only
 * after a pause in typing.
 */
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CUISINE_USE_OWN_KEY } from '../cuisineField.js';
import { useCuisineField } from '../useCuisineField.js';

/** The hook over a controlled value, as a leaf holds it. */
function renderField(initial: string) {
    return renderHook(() => {
        const [value, setValue] = useState(initial);

        return { value, field: useCuisineField({ value, onChange: setValue }) };
    });
}

const optionKeys = (field: ReturnType<typeof useCuisineField>) =>
    field.groups.flatMap((group) => group.options.map((option) => option.key));

afterEach(() => {
    vi.useRealTimers();
});

describe('useCuisineField', () => {
    it('lists all 90 on focus even over a committed value, and filters from the first edit', () => {
        const { result } = renderField('Thai');

        act(() => result.current.field.onFocus());
        expect(optionKeys(result.current.field)).toHaveLength(90);

        act(() => result.current.field.onValueChange('Thai m'));
        expect(optionKeys(result.current.field)).toEqual([CUISINE_USE_OWN_KEY]);
    });

    it('a new focus shows all 90 again', () => {
        const { result } = renderField('');

        act(() => result.current.field.onValueChange('ind'));
        expect(optionKeys(result.current.field)).toEqual(['Indian', 'Indonesian', CUISINE_USE_OWN_KEY]);

        act(() => result.current.field.onFocus());
        expect(optionKeys(result.current.field)).toHaveLength(90);
    });

    it('a pick commits the entry as the list spells it', () => {
        const { result } = renderField('');

        act(() => result.current.field.onValueChange('ind'));
        act(() => result.current.field.onSelect('Indonesian'));

        expect(result.current.value).toBe('Indonesian');
    });

    it('the Use option commits the cook’s own words in their canonical form', () => {
        const { result } = renderField('');

        act(() => result.current.field.onValueChange('  nyonya '));
        act(() => result.current.field.onSelect(CUISINE_USE_OWN_KEY));

        expect(result.current.value).toBe('Nyonya');
    });

    it.each([
        ['leaving the field', 'onBlur'],
        ['Enter or Done with nothing chosen', 'onSubmitWithoutChoice'],
    ] as const)('%s commits the typed text in its canonical form', (_name, handler) => {
        const { result } = renderField('');

        act(() => result.current.field.onValueChange('thai'));
        act(() => result.current.field[handler]());

        expect(result.current.value).toBe('Thai');
    });

    it('leaving an empty field leaves it empty', () => {
        const { result } = renderField('');

        act(() => result.current.field.onBlur());

        expect(result.current.value).toBe('');
    });

    it('changes the polite count only after a 500 ms pause in typing', () => {
        vi.useFakeTimers();
        const { result } = renderField('');
        expect(result.current.field.countAnnouncement).toBe('90 cuisines');

        act(() => result.current.field.onValueChange('i'));
        act(() => result.current.field.onValueChange('in'));
        act(() => result.current.field.onValueChange('ind'));
        act(() => {
            vi.advanceTimersByTime(499);
        });
        expect(result.current.field.countAnnouncement).toBe('90 cuisines');

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current.field.countAnnouncement).toBe('2 cuisines');
    });

    it('speaks the no-match note after the pause', () => {
        vi.useFakeTimers();
        const { result } = renderField('');

        act(() => result.current.field.onValueChange('nyonya'));
        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(result.current.field.countAnnouncement).toBe('No cuisines match “Nyonya”. You can use it as your own.');
        expect(result.current.field.status).toEqual({
            kind: 'note',
            text: 'No cuisines match “Nyonya”. You can use it as your own.',
        });
    });
});
