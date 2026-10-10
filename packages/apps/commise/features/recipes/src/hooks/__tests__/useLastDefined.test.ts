// @vitest-environment jsdom
/**
 * Tests for {@link useLastDefined}: a surface that is closing keeps showing what it last showed. The value while it is
 * defined; while it is `undefined`, the last value it held; before it has held one, `undefined`.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLastDefined } from '../useLastDefined.js';

/** Render the hook over `values`, one render each, and return what it answered at each. */
function answersOver(values: readonly (string | undefined)[]): readonly (string | undefined)[] {
    const [first, ...rest] = values;
    const { result, rerender } = renderHook((value: string | undefined) => useLastDefined(value), {
        initialProps: first,
    });
    const answers = [result.current];

    for (const value of rest) {
        rerender(value);
        answers.push(result.current);
    }

    return answers;
}

describe('useLastDefined', () => {
    it.each([
        ['undefined before any value', [undefined, undefined], [undefined, undefined]],
        ['a value while it is defined', ['a', 'b'], ['a', 'b']],
        ['the mount value once it goes', ['a', undefined, undefined], ['a', 'a', 'a']],
        ['the value from a later render once it goes', [undefined, 'a', undefined], [undefined, 'a', 'a']],
        ['the newest value, never an older one', ['a', undefined, 'b', undefined], ['a', 'a', 'b', 'b']],
    ] as const)('answers %s', (_case, values, expected) => {
        expect(answersOver(values)).toEqual(expected);
    });

    it('answers the same object it was given, not a copy', () => {
        const value = { name: 'saffron' };
        const initialProps: { readonly name: string } | undefined = value;
        const { result, rerender } = renderHook((current: typeof initialProps) => useLastDefined(current), {
            initialProps,
        });

        rerender(undefined);

        expect(result.current).toBe(value);
    });
});
