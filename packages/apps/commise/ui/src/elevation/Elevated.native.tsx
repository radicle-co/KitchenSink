/**
 * @module @commise/ui/elevation — the native design-system {@link Elevated}: the ONE place a native view takes a shadow
 * level from the elevation table. Each level draws the table's own offset, blur, opacity and Android elevation
 * (`nativeTokens.elevation`), and its shadow colour from the theme key derived from the same table
 * (`elevation<Level>Shadow`), so no caller types a shadow number or colour. On Android `elevation` draws only on the
 * view that carries the background, so a part that fills itself is a `styled(Elevated)`, not a child of one.
 * Styled with Tamagui only (ADR-0080).
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Variant — a closed `level` union rendered through Tamagui `variants`, which is the discriminated-union
 *     render map, so no `switch` is written
 */
import { styled, View } from 'tamagui';

import type { ElevationLevel } from '../theme/tamaguiThemes.js';
import { nativeTokens } from '../tokens/native.js';

const { elevation } = nativeTokens;

/** A view with a shadow level. */
export const Elevated = styled(View, {
    name: 'Elevated',
    // Kept, so a level that comes and goes never moves the view's children (`nativeFlattenFlips.test.ts`).
    collapsable: false,

    variants: {
        level: {
            sm: {
                shadowColor: '$elevationSmShadow',
                shadowOffset: elevation.sm.shadowOffset,
                shadowOpacity: elevation.sm.shadowOpacity,
                shadowRadius: elevation.sm.shadowRadius,
                elevation: elevation.sm.elevation,
            },
            md: {
                shadowColor: '$elevationMdShadow',
                shadowOffset: elevation.md.shadowOffset,
                shadowOpacity: elevation.md.shadowOpacity,
                shadowRadius: elevation.md.shadowRadius,
                elevation: elevation.md.elevation,
            },
            lg: {
                shadowColor: '$elevationLgShadow',
                shadowOffset: elevation.lg.shadowOffset,
                shadowOpacity: elevation.lg.shadowOpacity,
                shadowRadius: elevation.lg.shadowRadius,
                elevation: elevation.lg.elevation,
            },
            xl: {
                shadowColor: '$elevationXlShadow',
                shadowOffset: elevation.xl.shadowOffset,
                shadowOpacity: elevation.xl.shadowOpacity,
                shadowRadius: elevation.xl.shadowRadius,
                elevation: elevation.xl.elevation,
            },
        } satisfies Record<ElevationLevel, object>,
    } as const,
});
