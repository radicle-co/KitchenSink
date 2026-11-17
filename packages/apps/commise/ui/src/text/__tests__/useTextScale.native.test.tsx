/**
 * `useTextScale` reads the system text scale from the context the design-system Text reads, so anything sized beside
 * text (a check box, a hairline inset) cannot draw from a second source. Under an override of that context the hook
 * follows the override.
 */
import { cleanup, renderHook } from '@testing-library/react';
import type { FC, PropsWithChildren } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DesignSystemTheme } from '../../tamagui/DesignSystemTheme.native.js';
import { useTextScale } from '../useTextScale.native.js';

afterEach(cleanup);

const under =
    (textScale: number): FC<PropsWithChildren> =>
    ({ children }) => (
        <DesignSystemTheme scheme="light" textScale={textScale}>
            {children}
        </DesignSystemTheme>
    );

describe('useTextScale', () => {
    it('answers the scale the design-system theme provides', () => {
        expect(renderHook(() => useTextScale(), { wrapper: under(1.5) }).result.current).toBe(1.5);
        expect(renderHook(() => useTextScale(), { wrapper: under(2) }).result.current).toBe(2);
    });
});
