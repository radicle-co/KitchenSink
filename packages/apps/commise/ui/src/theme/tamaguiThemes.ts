/**
 * @module theme/tamaguiThemes — the colour roles, the surface-tone table and the cover tints as Tamagui's `light` and
 * `dark` themes.
 * Pure, and free of any Tamagui import.
 *
 * A theme key is a role name (`$paper`, `$ink`), or a surface tone's derived colour: `${tone}Fill`, `${tone}Press` and
 * `${tone}ChipFill`. The tone keys are generated from `SURFACE_TONE_NAMES`, never listed, so a tone added to the table
 * reaches the themes with no edit here. `proFill` and `proInk` are the PRO badge's own tone, so it moves with web. A
 * cover tint is `cover${Name}` (`$coverSteel`), generated from `COVER_TINT_NAMES`.
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
import { COVER_TINT_NAMES, coverTint, coverTintDark, type CoverTintName } from '../tokens/covers.js';
import { proTone, proToneDark, type Tone } from '../tokens/tones.js';

/** A theme key that a surface tone adds beside the roles. */
export type SurfaceToneThemeKey = `${(typeof SURFACE_TONE_NAMES)[number]}${'Fill' | 'Press' | 'ChipFill'}`;

/** The PRO badge's pair, from its own tone (`tones.ts`). */
export const proThemeKeys = ['proFill', 'proInk'] as const;

/** A theme key for the PRO pair. */
export type ProThemeKey = (typeof proThemeKeys)[number];

/** A theme key for a cover tint. */
export type CoverThemeKey = `cover${Capitalize<CoverTintName>}`;

/** One scheme's theme: every role, each tone's fill, press and chip fill, the PRO pair, and the cover tints. */
export type TamaguiTheme = Readonly<Record<Role | SurfaceToneThemeKey | ProThemeKey | CoverThemeKey, string>>;

const coverKeyOf = (name: CoverTintName): CoverThemeKey =>
    `cover${name.charAt(0).toUpperCase()}${name.slice(1)}` as CoverThemeKey;

/** Every cover-tint key, in table order. */
export const coverThemeKeys: readonly CoverThemeKey[] = COVER_TINT_NAMES.map(coverKeyOf);

/** Every surface-tone key, in table order. */
export const surfaceToneThemeKeys: readonly SurfaceToneThemeKey[] = SURFACE_TONE_NAMES.flatMap((tone) => [
    `${tone}Fill` as const,
    `${tone}Press` as const,
    `${tone}ChipFill` as const,
]);

function themeOf(
    colors: Readonly<Record<Role, string>>,
    scheme: PressScheme,
    pro: Tone,
    covers: Readonly<Record<CoverTintName, string>>,
): TamaguiTheme {
    const press = pressFillsOf(colors, scheme);
    const toneEntries = SURFACE_TONE_NAMES.flatMap((tone) => [
        [`${tone}Fill`, colors[SURFACE_TONES[tone].fill]],
        [`${tone}Press`, press[tone]],
        [`${tone}ChipFill`, colors[chipFillRoleOf(tone, scheme)]],
    ]);

    const coverEntries = COVER_TINT_NAMES.map((name) => [coverKeyOf(name), covers[name]]);

    return {
        ...colors,
        ...Object.fromEntries(toneEntries),
        ...Object.fromEntries(coverEntries),
        proFill: pro.fill,
        proInk: pro.text,
    } as TamaguiTheme;
}

export const tamaguiThemes: Readonly<Record<PressScheme, TamaguiTheme>> = {
    light: themeOf(role, 'light', proTone, coverTint),
    dark: themeOf(roleDark, 'dark', proToneDark, coverTintDark),
};
