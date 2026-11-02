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
    DEFAULT_SURFACE_TONE,
    pressFillsOf,
    SURFACE_TONE_NAMES,
    SURFACE_TONES,
    type PressScheme,
    type SurfaceTone,
} from '../surfaceTone/surfaceTone.js';
import { role, roleDark, type Role } from '../tokens/colors.js';
import { proTone, proToneDark, type Tone } from '../tokens/tones.js';

/** A theme key that a surface tone adds beside the roles. */
export type SurfaceToneThemeKey = `${(typeof SURFACE_TONE_NAMES)[number]}${'Fill' | 'Press' | 'ChipFill'}`;

/** The PRO badge's pair, from its own tone (`tones.ts`). */
export const proThemeKeys = ['proFill', 'proInk'] as const;

/** A theme key for the PRO pair. */
export type ProThemeKey = (typeof proThemeKeys)[number];

/**
 * The keys a surface tone sets: the ink a bare `Text` takes, and the four a Tamagui part reads. `color` is `ink` under
 * the name Tamagui reads; `ink` is also a role, so the parent already holds it.
 */
export const TONE_THEME_KEYS = ['ink', 'color', 'background', 'backgroundPress', 'borderColor'] as const;

/** A key a surface tone sets. */
export type ToneThemeKey = (typeof TONE_THEME_KEYS)[number];

/** A sub-theme: only the keys that differ by tone. Tamagui merges the rest from the parent. */
export type ToneTheme = Readonly<Record<ToneThemeKey, string>>;

/** One scheme's theme: every role, each tone's fill, press and chip fill, the PRO pair, and the tone keys. */
export type TamaguiTheme = Readonly<Record<Role | SurfaceToneThemeKey | ProThemeKey | ToneThemeKey, string>>;

/** A sub-theme's name: the scheme, an underscore, the tone. The one place the name is built. */
export type ToneThemeName = `${PressScheme}_${SurfaceTone}`;

/**
 * The name of one scheme's sub-theme for a tone. Pure.
 *
 * @param scheme - The colour scheme.
 * @param tone - The surface tone.
 */
export function toneThemeName(scheme: PressScheme, tone: SurfaceTone): ToneThemeName {
    return `${scheme}_${tone}`;
}

/** Every sub-theme name, both schemes, in table order. */
export const toneThemeNames: readonly ToneThemeName[] = (['light', 'dark'] as const).flatMap((scheme) =>
    SURFACE_TONE_NAMES.map((tone) => toneThemeName(scheme, tone)),
);

/** Every surface-tone key, in table order. */
export const surfaceToneThemeKeys: readonly SurfaceToneThemeKey[] = SURFACE_TONE_NAMES.flatMap((tone) => [
    `${tone}Fill` as const,
    `${tone}Press` as const,
    `${tone}ChipFill` as const,
]);

function toneThemeOf(colors: Readonly<Record<Role, string>>, scheme: PressScheme, tone: SurfaceTone): ToneTheme {
    const row = SURFACE_TONES[tone];
    const ink = colors[row.ink];

    return {
        ink,
        color: ink,
        background: colors[row.fill],
        backgroundPress: pressFillsOf(colors, scheme)[tone],
        borderColor: colors.lineControl,
    };
}

function themeOf(colors: Readonly<Record<Role, string>>, scheme: PressScheme, pro: Tone): TamaguiTheme {
    const press = pressFillsOf(colors, scheme);
    const toneEntries = SURFACE_TONE_NAMES.flatMap((tone) => [
        [`${tone}Fill`, colors[SURFACE_TONES[tone].fill]],
        [`${tone}Press`, press[tone]],
        [`${tone}ChipFill`, colors[chipFillRoleOf(tone, scheme)]],
    ]);

    return {
        ...colors,
        ...Object.fromEntries(toneEntries),
        proFill: pro.fill,
        proInk: pro.text,
        // The parent holds the tone keys at the canvas, so a Tamagui part outside every surface reads the page.
        ...toneThemeOf(colors, scheme, DEFAULT_SURFACE_TONE),
    } as TamaguiTheme;
}

const light = themeOf(role, 'light', proTone);

const dark = themeOf(roleDark, 'dark', proToneDark);

const sources = { light: role, dark: roleDark } as const;

/** The themes: `light`, `dark`, and a partial `${scheme}_${tone}` sub-theme for each tone. */
export const tamaguiThemes: Readonly<Record<PressScheme, TamaguiTheme> & Record<ToneThemeName, ToneTheme>> = {
    light,
    dark,
    ...(Object.fromEntries(
        toneThemeNames.map((name) => {
            const [scheme, tone] = name.split('_') as [PressScheme, SurfaceTone];

            return [name, toneThemeOf(sources[scheme], scheme, tone)];
        }),
    ) as Record<ToneThemeName, ToneTheme>),
};
