/**
 * The Tamagui themes are a projection of the colour roles and the surface-tone table, and nothing else. Every expected
 * value is read from `colors.ts` and `surfaceTone.ts`, so a palette or table change moves this test with it; what the
 * test pins is the SHAPE of the projection: which keys exist, and which source each one is read from.
 */
import { describe, expect, it } from 'vitest';

import {
    chipFillRoleOf,
    pressFillsOf,
    SURFACE_TONE_NAMES,
    SURFACE_TONES,
    type PressScheme,
} from '../../surfaceTone/surfaceTone.js';
import { role, roleDark, type Role } from '../../tokens/colors.js';
import { proTone, proToneDark } from '../../tokens/tones.js';
import {
    engineThemeKeys,
    proThemeKeys,
    surfaceToneThemeKeys,
    tamaguiThemes,
    TONE_THEME_KEYS,
    toneThemeName,
    toneThemeNames,
} from '../tamaguiThemes.js';

const roleNames = Object.keys(role) as Role[];

const sources: Readonly<Record<PressScheme, Readonly<Record<Role, string>>>> = { light: role, dark: roleDark };

describe('tamaguiThemes', () => {
    // Tamagui's own Sheet skin paints its overlay with the bare theme key `shadow-color`; a theme without it logs
    // `unknown color "shadow-color"` on a device, and that debug toast covers the screen and swallows taps. The key is the
    // scrim role, so the engine's own default and ours are the same colour.
    it.each([
        ['light', role],
        ['dark', roleDark],
    ] as const)('%s: supplies the keys Tamagui’s Sheet skin reads, from the scrim role', (scheme, colors) => {
        expect(tamaguiThemes[scheme]['shadow-color']).toBe(colors.scrim);
        expect([...engineThemeKeys]).toEqual(['shadow-color']);
    });

    // The PRO badge's pair is its own tone (`tones.ts`), not two text roles that equal it today by chance, so a change
    // to the PRO tone moves native with web (Tamagui audit H2).
    it.each([
        ['light', proTone],
        ['dark', proToneDark],
    ] as const)('%s: carries the PRO pair from the PRO tone', (scheme, tone) => {
        expect(tamaguiThemes[scheme].proFill).toBe(tone.fill);
        expect(tamaguiThemes[scheme].proInk).toBe(tone.text);
    });

    it('has a light and a dark theme, and one sub-theme per scheme and tone (H3)', () => {
        const names = SURFACE_TONE_NAMES.flatMap((tone) => [`light_${tone}`, `dark_${tone}`]);

        expect(Object.keys(tamaguiThemes).sort()).toEqual(['dark', 'light', ...names].sort());
        expect([...toneThemeNames].sort()).toEqual(names.sort());
        expect(toneThemeName('dark', 'paperOverlay')).toBe('dark_paperOverlay');
    });

    it.each(['light', 'dark'] as const)('%s: carries every role, and only roles and surface-tone keys', (scheme) => {
        const keys = Object.keys(tamaguiThemes[scheme]).sort();
        const toneKeys = TONE_THEME_KEYS.filter((key) => !(roleNames as string[]).includes(key));

        expect(keys).toEqual(
            [...roleNames, ...surfaceToneThemeKeys, ...proThemeKeys, ...engineThemeKeys, ...toneKeys].sort(),
        );
    });

    it('keeps the surface-tone keys apart from the role names, so no tone key can shadow a role', () => {
        const overlap = surfaceToneThemeKeys.filter((key) => (roleNames as string[]).includes(key));

        expect(overlap).toEqual([]);
        expect(surfaceToneThemeKeys).toHaveLength(SURFACE_TONE_NAMES.length * 3);
    });

    it.each(['light', 'dark'] as const)('%s: each role is the scheme’s own role colour', (scheme) => {
        for (const name of roleNames) {
            expect(tamaguiThemes[scheme][name], name).toBe(sources[scheme][name]);
        }
    });

    it.each(['light', 'dark'] as const)(
        '%s: each tone’s fill, press and chip fill come from the tone table',
        (scheme) => {
            const colors = sources[scheme];
            const press = pressFillsOf(colors, scheme);

            for (const tone of SURFACE_TONE_NAMES) {
                const theme = tamaguiThemes[scheme] as Readonly<Record<string, string>>;

                expect(theme[`${tone}Fill`], `${tone}Fill`).toBe(colors[SURFACE_TONES[tone].fill]);
                expect(theme[`${tone}Press`], `${tone}Press`).toBe(press[tone]);
                expect(theme[`${tone}ChipFill`], `${tone}ChipFill`).toBe(colors[chipFillRoleOf(tone, scheme)]);
            }
        },
    );

    it('differs between the schemes, so a dark device does not paint the light theme', () => {
        expect(tamaguiThemes.dark.paper).not.toBe(tamaguiThemes.light.paper);
        expect(tamaguiThemes.dark.ink).not.toBe(tamaguiThemes.light.ink);
    });
});

/**
 * The sub-themes are partial: Tamagui 3 merges a sub-theme with its parents (`proxyThemeToParents`), so a tone theme
 * holds only the five keys that differ by tone and the role list is stated once, in the parent.
 */
describe('the surface-tone sub-themes (audit H3)', () => {
    const reserved = ['light', 'dark', 'primary', 'secondary', 'quiet', 'danger', 'selected'];

    it('names no tone with an underscore, a scheme word or a component word, which the name lookup would misread', () => {
        for (const tone of SURFACE_TONE_NAMES) {
            expect(tone, tone).not.toContain('_');
            expect(reserved, tone).not.toContain(tone);
        }
    });

    it('keeps the five tone keys apart from every role but ink, so a role cannot be shadowed', () => {
        const clash = TONE_THEME_KEYS.filter((key) => key !== 'ink' && (roleNames as string[]).includes(key));

        expect(clash).toEqual([]);
        expect([...TONE_THEME_KEYS].sort()).toEqual(['background', 'backgroundPress', 'borderColor', 'color', 'ink']);
    });

    it.each(['light', 'dark'] as const)(
        '%s: each tone theme holds exactly the five keys and reads the tone table',
        (scheme) => {
            const colors = sources[scheme];
            const press = pressFillsOf(colors, scheme);

            for (const tone of SURFACE_TONE_NAMES) {
                const theme = (tamaguiThemes as Readonly<Record<string, Readonly<Record<string, string>>>>)[
                    `${scheme}_${tone}`
                ];

                expect(Object.keys(theme ?? {}).sort(), tone).toEqual([...TONE_THEME_KEYS].sort());
                expect(theme?.['ink'], `${tone} ink`).toBe(colors[SURFACE_TONES[tone].ink]);
                expect(theme?.['color'], `${tone} color`).toBe(theme?.['ink']);
                expect(theme?.['background'], `${tone} background`).toBe(colors[SURFACE_TONES[tone].fill]);
                expect(theme?.['backgroundPress'], `${tone} backgroundPress`).toBe(press[tone]);
                expect(theme?.['borderColor'], `${tone} borderColor`).toBe(colors.lineControl);
            }
        },
    );

    it.each(['light', 'dark'] as const)('%s: the parent carries the same five keys at the canvas tone', (scheme) => {
        const parent = tamaguiThemes[scheme] as Readonly<Record<string, string>>;
        const colors = sources[scheme];
        const press = pressFillsOf(colors, scheme);

        expect(parent['ink']).toBe(colors.ink);
        expect(parent['color']).toBe(colors.ink);
        expect(parent['background']).toBe(colors[SURFACE_TONES.canvas.fill]);
        expect(parent['backgroundPress']).toBe(press.canvas);
        expect(parent['borderColor']).toBe(colors.lineControl);
    });

    it('is the only place an inverse surface’s ink differs from the page’s', () => {
        expect(tamaguiThemes['light_inverse'].ink).toBe(role.inverseInk);
        expect(tamaguiThemes['dark_inverse'].ink).toBe(roleDark.inverseInk);
        expect(tamaguiThemes['light_paper'].ink).toBe(role.ink);
    });
});
