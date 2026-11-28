/**
 * @module testing/elevationShadow — the shadow a native view with an elevation level draws in the browser build the
 * test lane runs, read from the elevation table and the theme key of the level's colour.
 */
import { elevationThemeKeyOf, type ElevationLevel } from '../theme/tamaguiThemes.js';
import { nativeTokens } from '../tokens/native.js';

/**
 * The `box-shadow` Tamagui's web build writes for a level: the offset, the blur, and the theme colour mixed to the
 * level's opacity. Pure.
 *
 * @param level - A level of the elevation table that draws a shadow.
 * @returns The value, as `resolvedStyle` reads it.
 */
export function elevationBoxShadow(level: ElevationLevel): string {
    const spec = nativeTokens.elevation[level];
    const offset = `${String(spec.shadowOffset.width)}px ${String(spec.shadowOffset.height)}px`;
    const percent = String(Math.round(spec.shadowOpacity * 100));
    const colour = `color-mix(in srgb, var(--${elevationThemeKeyOf(level)}) ${percent}%, transparent)`;

    return `${offset} ${String(spec.shadowRadius)}px ${colour}`;
}
