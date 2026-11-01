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
import { proThemeKeys, surfaceToneThemeKeys, tamaguiThemes } from '../tamaguiThemes.js';

const roleNames = Object.keys(role) as Role[];

const sources: Readonly<Record<PressScheme, Readonly<Record<Role, string>>>> = { light: role, dark: roleDark };

describe('tamaguiThemes', () => {
    // The PRO badge's pair is its own tone (`tones.ts`), not two text roles that equal it today by chance, so a change
    // to the PRO tone moves native with web (Tamagui audit H2).
    it.each([
        ['light', proTone],
        ['dark', proToneDark],
    ] as const)('%s: carries the PRO pair from the PRO tone', (scheme, tone) => {
        expect(tamaguiThemes[scheme].proFill).toBe(tone.fill);
        expect(tamaguiThemes[scheme].proInk).toBe(tone.text);
    });

    it('has exactly a light and a dark theme', () => {
        expect(Object.keys(tamaguiThemes).sort()).toEqual(['dark', 'light']);
    });

    it.each(['light', 'dark'] as const)('%s: carries every role, and only roles and surface-tone keys', (scheme) => {
        const keys = Object.keys(tamaguiThemes[scheme]).sort();

        expect(keys).toEqual([...roleNames, ...surfaceToneThemeKeys, ...proThemeKeys].sort());
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
