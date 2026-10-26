/**
 * `nativeTokens.touchTarget` — the one touch floor a native pressable row or control keeps. Before it existed, leaves
 * each declared their own `48` (`ROW_MIN_HEIGHT`, `TARGET_DP`, a bare `minHeight: 48`), so the floor could drift one
 * screen at a time. The floor is Android's 48 dp, which iOS's 44 pt minimum sits under; the web leaves' matching floor
 * is Tailwind's `min-h-12` (12 × 0.25 rem = 48 px).
 */
import { describe, expect, it } from 'vitest';

import { nativeTokens } from '../native.js';

describe('nativeTokens.touchTarget', () => {
    it('is the 48 dp Android touch floor', () => {
        expect(nativeTokens.touchTarget).toBe(48);
    });

    it('is never under the 44 pt iOS minimum', () => {
        expect(nativeTokens.touchTarget).toBeGreaterThanOrEqual(44);
    });
});
