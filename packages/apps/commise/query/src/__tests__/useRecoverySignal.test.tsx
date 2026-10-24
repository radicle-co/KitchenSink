import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useRecoverySignal } from '../useRecoverySignal.js';

describe('useRecoverySignal', () => {
    it('advances its signal on every recovery, through a callback whose identity never changes', () => {
        const { result, rerender } = renderHook(() => useRecoverySignal());
        const { onRecovered } = result.current;

        expect(result.current.signal).toBe(0);
        act(() => onRecovered());
        act(() => onRecovered());
        rerender();

        expect(result.current.signal).toBe(2);
        expect(result.current.onRecovered).toBe(onRecovered);
    });
});
