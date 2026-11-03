/**
 * Both native line-height producers carry the iOS workaround for react/react-native#58970: the token projection
 * (`toNativeTypeStyle`, evaluated when the tokens load) and the design-system Text's scaler (`scaledTypeSize`, per call).
 * The platform and pixel scale are fixed BEFORE the modules load, so the modules are imported fresh for each platform.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { typeRole } from '../typography.js';

type Os = 'ios' | 'android';

/** Loads the producers fresh, as a device of platform `os` and pixel ratio 3 would. */
async function loadProducers(os: Os): Promise<{
    nativeTokens: (typeof import('../native.js'))['nativeTokens'];
    scaledTypeSize: (typeof import('../../text/scaledType.js'))['scaledTypeSize'];
}> {
    vi.resetModules();
    const rn = await import('react-native');
    Object.defineProperty(rn.Platform, 'OS', { value: os, configurable: true });
    vi.spyOn(rn.PixelRatio, 'get').mockReturnValue(3);

    return {
        nativeTokens: (await import('../native.js')).nativeTokens,
        scaledTypeSize: (await import('../../text/scaledType.js')).scaledTypeSize,
    };
}

beforeEach(() => {
    vi.resetModules();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('iOS line-height workaround reaches both producers', () => {
    it('shifts the token projection above the grid and leaves the token itself at 28', async () => {
        const { nativeTokens } = await loadProducers('ios');

        expect(typeRole.readingBody.lineHeight).toBe(28);
        expect(nativeTokens.type.readingBody.lineHeight).toBeCloseTo(28.001, 9);
        expect(nativeTokens.type.largeTitle.regular.lineHeight).toBeCloseTo(32.001, 9);
        expect(nativeTokens.type.body.lineHeight).toBeCloseTo(24.001, 9);
    });

    it('shifts the scaled leading after font scaling, from the raw token and not from the projection', async () => {
        const { scaledTypeSize } = await loadProducers('ios');

        expect(scaledTypeSize('readingBody', 1).lineHeight).toBeCloseTo(28.001, 9);
        // 28 * 1.3 = 36.4 pt = 109.2 px, which the grid takes to 110 px. A second shift of an already shifted base
        // would give 36.4+ then another ceil step.
        expect(scaledTypeSize('readingBody', 1.3).lineHeight).toBeCloseTo(110 / 3 + 0.001, 9);
        expect(scaledTypeSize('readingBody', 1.3).fontSize).toBeCloseTo(18 * 1.3, 9);
    });

    it('leaves both exact on Android', async () => {
        const { nativeTokens, scaledTypeSize } = await loadProducers('android');

        expect(nativeTokens.type.readingBody.lineHeight).toBe(28);
        expect(scaledTypeSize('readingBody', 1).lineHeight).toBe(28);
        expect(scaledTypeSize('readingBody', 1.3).lineHeight).toBeCloseTo(36.4, 9);
    });
});
