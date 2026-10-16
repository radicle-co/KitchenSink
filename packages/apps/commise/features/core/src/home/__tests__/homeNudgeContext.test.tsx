/**
 * The Home nudge context and its reader, once for both apps. `useHomeNudge` is the only correct way to touch the
 * context: a missing provider must be a stated error, not a silent no-op that leaves a gated tap dead.
 */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { HomeNudgeContext, useHomeNudge } from '../homeNudgeContext.js';

describe('useHomeNudge', () => {
    it('hands a widget the trigger the Home surface provided', () => {
        const trigger = vi.fn();
        const wrapper = ({ children }: { readonly children: ReactNode }) => (
            <HomeNudgeContext.Provider value={{ trigger }}>{children}</HomeNudgeContext.Provider>
        );

        const { result } = renderHook(() => useHomeNudge(), { wrapper });
        result.current.trigger();

        expect(trigger).toHaveBeenCalledTimes(1);
    });

    it('throws a stated error outside the Home widget surface', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderHook(() => useHomeNudge())).toThrow(
            'useHomeNudge must be used within the Home widget surface.',
        );

        errorSpy.mockRestore();
    });
});
