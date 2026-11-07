/**
 * The screen recorder's two bundles. The Null Object ships in every build and must do nothing; the twin
 * (`useScreenTrace.maestro.ts`) is swapped in by Metro only for a test build and logs `COMMISE_SCREEN <Name>` once
 * per mount, which the Maestro runner collects from the device log.
 */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScreenTrace as nullObject } from '../../src/screenTrace/useScreenTrace.js';
import { useScreenTrace as twin } from '../../src/screenTrace/useScreenTrace.maestro.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useScreenTrace (the Null Object every build ships)', () => {
    it('logs nothing', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        renderHook(() => nullObject('HomeScreen'));

        expect(error).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });
});

describe('useScreenTrace (the test-build twin)', () => {
    it('logs the screen name, once per mount, on the error channel release builds keep', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { rerender } = renderHook(() => twin('HomeScreen'));
        rerender();
        rerender();

        expect(error).toHaveBeenCalledTimes(1);
        expect(error).toHaveBeenCalledWith('COMMISE_SCREEN HomeScreen');
    });

    it('logs again for a second mount of the same screen', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        renderHook(() => twin('login')).unmount();
        renderHook(() => twin('login'));

        expect(error).toHaveBeenCalledTimes(2);
    });
});
