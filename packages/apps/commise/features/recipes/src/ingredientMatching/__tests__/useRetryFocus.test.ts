// @vitest-environment jsdom
/**
 * Hook test for `useRetryFocus`: the holder of `retryFocus.ts`'s memory now also exposes ATTENTION (`noteAttention`,
 * `ownsFocus`), so a host row handler can say "the cook is on this line" inside the press. Seen red first.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SendState } from '../retryFocus.js';
import { useRetryFocus } from '../useRetryFocus.js';

const FAILED = (key: string): SendState => ({ key, failed: true, sending: false });
const RETRYING = (key: string): SendState => ({ key, failed: true, sending: true });

describe('useRetryFocus - attention', () => {
    it('before the cook acts on a line, every line owns focus', () => {
        const { result } = renderHook(() => useRetryFocus([FAILED('milk'), FAILED('bread')]));

        expect(result.current.ownsFocus('milk')).toBe(true);
        expect(result.current.ownsFocus('bread')).toBe(true);
    });

    it('noteAttention moves ownership, and a retry that starts on the line left behind requests nothing', () => {
        let sends = [FAILED('milk'), FAILED('bread')];
        const { result, rerender } = renderHook(() => useRetryFocus(sends));

        act(() => {
            result.current.noteAttention('bread');
        });

        expect(result.current.ownsFocus('bread')).toBe(true);
        expect(result.current.ownsFocus('milk')).toBe(false);

        sends = [RETRYING('milk'), FAILED('bread')];
        rerender();

        expect(result.current('milk').landing.requested).toBe(false);
    });

    it('a retry on the attended line still asks for its landing control', () => {
        let sends = [FAILED('milk'), FAILED('bread')];
        const { result, rerender } = renderHook(() => useRetryFocus(sends));

        act(() => {
            result.current.noteAttention('milk');
        });
        sends = [RETRYING('milk'), FAILED('bread')];
        rerender();

        expect(result.current('milk').landing.requested).toBe(true);
    });

    it('noteAttention drops a request already standing for the line the cook has left', () => {
        let sends = [FAILED('milk'), FAILED('bread')];
        const { result, rerender } = renderHook(() => useRetryFocus(sends));

        sends = [RETRYING('milk'), FAILED('bread')];
        rerender();

        expect(result.current('milk').landing.requested).toBe(true);

        act(() => {
            result.current.noteAttention('bread');
        });

        expect(result.current('milk').landing.requested).toBe(false);
    });
});
