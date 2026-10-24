/**
 * Android elevation by LEVEL, not by shadow offset (`docs/design/uiOverhaul/buildSpec.md` §1.6).
 *
 * Android ignores `shadowOffset`/`shadowRadius`/`shadowOpacity`: it draws its own ambient and key shadows from
 * `elevation` alone, in dp, darker the higher the number. The projection used to copy each spec's `offsetY` into
 * `elevation`, so `md` (offset 4) and `xl` (offset 20) painted a 4 dp and a 20 dp Material shadow — the dark halo
 * around every Android card. The level map is the spec's own: one meaning per level, small numbers.
 *
 * iOS keeps the composed shadow, so the iOS half is asserted unchanged.
 *
 * Mutation lens: restore `elevation: spec.offsetY` and the level rows fail (`md` reads 4, `xl` 20, `glow` 0 survives
 * by coincidence, which is why the map is asserted whole).
 */
import { describe, expect, it } from 'vitest';

import { nativeTokens } from '../native.js';
import { elevation } from '../scale.js';

describe('nativeTokens.elevation — Android elevation by level', () => {
    it('maps each level to the spec’s elevation', () => {
        const levels = Object.fromEntries(
            Object.entries(nativeTokens.elevation).map(([level, shadow]) => [level, shadow.elevation]),
        );

        expect(levels).toEqual({ sm: 1, md: 2, lg: 3, xl: 6, glow: 0 });
    });

    it('no longer reads the elevation off the shadow’s vertical offset', () => {
        expect(nativeTokens.elevation.md.elevation).not.toBe(elevation.md.offsetY);
        expect(nativeTokens.elevation.xl.elevation).not.toBe(elevation.xl.offsetY);
    });

    it('rises with the level, so a higher surface always reads as higher', () => {
        const { sm, md, lg, xl } = nativeTokens.elevation;

        expect(sm.elevation).toBeLessThan(md.elevation);
        expect(md.elevation).toBeLessThan(lg.elevation);
        expect(lg.elevation).toBeLessThan(xl.elevation);
    });

    it('keeps the iOS shadow composed from the spec', () => {
        expect(nativeTokens.elevation.lg).toMatchObject({
            shadowOffset: { width: elevation.lg.offsetX, height: elevation.lg.offsetY },
            shadowRadius: elevation.lg.blur,
            shadowOpacity: elevation.lg.opacity,
        });
    });
});
