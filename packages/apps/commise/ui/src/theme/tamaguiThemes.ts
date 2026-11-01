/**
 * @module theme/tamaguiThemes — the colour roles and the surface-tone table as Tamagui's `light` and `dark` themes.
 * Pure, and free of any Tamagui import.
 *
 * A theme key is a role name (`$paper`, `$ink`), or a surface tone's derived colour: `${tone}Fill`, `${tone}Press` and
 * `${tone}ChipFill`. The tone keys are generated from `SURFACE_TONE_NAMES`, never listed, so a tone added to the table
 * reaches the themes with no edit here. `proFill` and `proInk` are the PRO badge's own tone, so it moves with web.
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
import { proTone, proToneDark, type Tone } from '../tokens/tones.js';

/** A theme key that a surface tone adds beside the roles. */
export type SurfaceToneThemeKey = `${(typeof SURFACE_TONE_NAMES)[number]}${'Fill' | 'Press' | 'ChipFill'}`;

/** The PRO badge's pair, from its own tone (`tones.ts`). */
export const proThemeKeys = ['proFill', 'proInk'] as const;

/** A theme key for the PRO pair. */
export type ProThemeKey = (typeof proThemeKeys)[number];

/** One scheme's theme: every role, each tone's fill, press and chip fill, and the PRO pair. */
export type TamaguiTheme = Readonly<Record<Role | SurfaceToneThemeKey | ProThemeKey, string>>;

/** Every surface-tone key, in table order. */
export const surfaceToneThemeKeys: readonly SurfaceToneThemeKey[] = SURFACE_TONE_NAMES.flatMap((tone) => [
    `${tone}Fill` as const,
    `${tone}Press` as const,
    `${tone}ChipFill` as const,
]);

function themeOf(colors: Readonly<Record<Role, string>>, scheme: PressScheme, pro: Tone): TamaguiTheme {
    const press = pressFillsOf(colors, scheme);
    const toneEntries = SURFACE_TONE_NAMES.flatMap((tone) => [
        [`${tone}Fill`, colors[SURFACE_TONES[tone].fill]],
        [`${tone}Press`, press[tone]],
        [`${tone}ChipFill`, colors[chipFillRoleOf(tone, scheme)]],
    ]);

    return { ...colors, ...Object.fromEntries(toneEntries), proFill: pro.fill, proInk: pro.text } as TamaguiTheme;
}

export const tamaguiThemes: Readonly<Record<PressScheme, TamaguiTheme>> = {
    light: themeOf(role, 'light', proTone),
    dark: themeOf(roleDark, 'dark', proToneDark),
};
