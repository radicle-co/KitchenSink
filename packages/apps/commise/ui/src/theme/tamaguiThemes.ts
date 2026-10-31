/**
 * @module theme/tamaguiThemes — the colour roles and the surface-tone table as Tamagui's `light` and `dark` themes.
 * Pure, and free of any Tamagui import.
 *
 * A theme key is a role name (`$paper`, `$ink`), or a surface tone's derived colour: `${tone}Fill`, `${tone}Press` and
 * `${tone}ChipFill`. The tone keys are generated from `SURFACE_TONE_NAMES`, never listed, so a tone added to the table
 * reaches the themes with no edit here.
 *
 * @pattern Adapter — the role and surface-tone registries projected into Tamagui's theme shape
 */
import {
    chipFillRoleOf,
    pressFillsOf,
    SURFACE_TONE_NAMES,
    SURFACE_TONES,
    type PressScheme,
} from '../surfaceTone/surfaceTone.js';
import { role, roleDark, type Role } from '../tokens/colors.js';

/** A theme key that a surface tone adds beside the roles. */
export type SurfaceToneThemeKey = `${(typeof SURFACE_TONE_NAMES)[number]}${'Fill' | 'Press' | 'ChipFill'}`;

/** One scheme's theme: every role, and each tone's fill, press and chip fill. */
export type TamaguiTheme = Readonly<Record<Role | SurfaceToneThemeKey, string>>;

/** Every surface-tone key, in table order. */
export const surfaceToneThemeKeys: readonly SurfaceToneThemeKey[] = SURFACE_TONE_NAMES.flatMap((tone) => [
    `${tone}Fill` as const,
    `${tone}Press` as const,
    `${tone}ChipFill` as const,
]);

function themeOf(colors: Readonly<Record<Role, string>>, scheme: PressScheme): TamaguiTheme {
    const press = pressFillsOf(colors, scheme);
    const toneEntries = SURFACE_TONE_NAMES.flatMap((tone) => [
        [`${tone}Fill`, colors[SURFACE_TONES[tone].fill]],
        [`${tone}Press`, press[tone]],
        [`${tone}ChipFill`, colors[chipFillRoleOf(tone, scheme)]],
    ]);

    return { ...colors, ...Object.fromEntries(toneEntries) } as TamaguiTheme;
}

export const tamaguiThemes: Readonly<Record<PressScheme, TamaguiTheme>> = {
    light: themeOf(role, 'light'),
    dark: themeOf(roleDark, 'dark'),
};
