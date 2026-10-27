/**
 * @module @commise/ui/surface-tone — the native {@link Surface}: a `View` that paints its tone's fill and states the tone
 * to every control inside it. Paint and statement are one fact, read from one row of the table (`surfaceTone.ts`), so a
 * surface cannot paint paper while its buttons press as if on the canvas.
 *
 * Colour is read from the theme at render, never from a static sheet (D15), so the surface repaints with the scheme.
 *
 * @pattern Ambient Context — the provider half: a surface states its tone once, and the controls inside read it
 */
import type { FC } from 'react';
import { View } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import type { SurfaceProps } from './props.js';
import { surfaceFill } from './surfaceFill.js';
import { SurfaceToneScope } from './surfaceToneContext.js';

/** A native surface: painted, and stated. */
export const Surface: FC<SurfaceProps> = ({ tone, children, accessibilityLabel, style }) => {
    const theme = useTheme();

    return (
        <SurfaceToneScope tone={tone}>
            <View
                style={[{ backgroundColor: surfaceFill(theme, tone) }, style]}
                aria-label={accessibilityLabel}
                role={accessibilityLabel === undefined ? undefined : 'group'}
            >
                {children}
            </View>
        </SurfaceToneScope>
    );
};
