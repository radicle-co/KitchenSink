/**
 * Invariants for the WEB leg of the backdrop-blur capability probe (`blurSupport.ts`).
 *
 * The probe exists so a glass surface can degrade HONESTLY: where a host cannot actually blur its backdrop,
 * painting the translucent tint anyway yields a washed-out, unblurred panel that was designed to sit over a
 * blur — so the surface must fall back to the tier's solid colour instead. On web `backdrop-filter` is
 * baseline across every browser the app supports, so this leg is unconditionally `true`; the interesting
 * (and load-bearing) branch is the native one, covered by `blurSupport.native.test.tsx` and by
 * `tokens/__tests__/gradients.test.ts`'s exhaustive `supportsNativeBlur` cases.
 */
import { describe, expect, it } from 'vitest';

import { isBlurSupported } from '../blurSupport.js';

describe('isBlurSupported (web leg)', () => {
    it('reports blur support, matching the `backdrop-filter` the web glass projection emits', () => {
        expect(isBlurSupported()).toBe(true);
    });

    it('is a stable, side-effect-free read — repeated calls agree', () => {
        expect(isBlurSupported()).toBe(isBlurSupported());
    });
});
