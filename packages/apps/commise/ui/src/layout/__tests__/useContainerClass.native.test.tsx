/**
 * `useContainerClass` (native): the container class of the width content gets — the WINDOW less its gutters, because
 * native never shows a sidebar (`docs/design/uiOverhaul/buildSpec.md` §1.2). The rule itself is the pure
 * `containerClass.ts` (its boundary table is `containerClass.test.ts`); this proves the hook feeds it the window width,
 * less the gutters, and follows a rotation.
 *
 * react-native-web's `Dimensions` reads the root element's size on a resize event, so a test resizes that.
 *
 * Mutation lens: feed the raw window width (no gutters) and the 640 px row reads `regular`; read the height and the
 * rotation row fails.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useContainerClass } from '../useContainerClass.native.js';

/** Resize the window's width: react-native-web's `Dimensions` reads the root element's width on a resize event. */
function windowWidth(width: number): void {
    Object.defineProperty(document.documentElement, 'clientWidth', { value: width, configurable: true });
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
}

afterEach(() => {
    Reflect.deleteProperty(document.documentElement, 'clientWidth');
    act(() => {
        window.dispatchEvent(new Event('resize'));
    });
});

describe('useContainerClass (native)', () => {
    it('is narrow on a phone', () => {
        windowWidth(390);

        expect(renderHook(() => useContainerClass()).result.current).toBe('narrow');
    });

    // 640 is `medium` (24 px gutters), leaving 592 px: still narrow. The raw window would read `regular`.
    it('subtracts the gutters before classifying', () => {
        windowWidth(640);

        expect(renderHook(() => useContainerClass()).result.current).toBe('narrow');
    });

    it('follows a rotation from a portrait to a landscape tablet', () => {
        windowWidth(744);
        const { result } = renderHook(() => useContainerClass());

        expect(result.current).toBe('regular');

        windowWidth(1133);

        expect(result.current).toBe('wide');
    });
});
