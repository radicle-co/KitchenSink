import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { describe, expect, it } from 'vitest';

import { shimAliases } from '../shimAliases.js';

describe('shimAliases', () => {
    it('maps the web build next modules to existing absolute files', () => {
        const aliases = shimAliases('web');

        expect(Object.keys(aliases).sort()).toEqual(['next/link', 'next/navigation']);

        for (const file of Object.values(aliases)) {
            expect(isAbsolute(file)).toBe(true);
            expect(existsSync(file)).toBe(true);
        }
    });

    it('maps the native build native modules to existing absolute files', () => {
        const aliases = shimAliases('native');

        expect(Object.keys(aliases).sort()).toEqual([
            '@tamagui/animations-react-native',
            'expo-linear-gradient',
            'react-native',
            'react-native-safe-area-context',
        ]);

        for (const file of Object.values(aliases)) {
            expect(isAbsolute(file)).toBe(true);
            expect(existsSync(file)).toBe(true);
        }
    });

    it('points each specifier at its own shim', () => {
        expect(shimAliases('web')['next/link']).toMatch(/nextLink\.tsx$/);
        expect(shimAliases('web')['next/navigation']).toMatch(/nextNavigation\.ts$/);
        expect(shimAliases('native')['react-native']).toMatch(/reactNative\.ts$/);
        expect(shimAliases('native')['react-native-safe-area-context']).toMatch(/safeAreaContext\.tsx$/);
        expect(shimAliases('native')['expo-linear-gradient']).toMatch(/linearGradient\.tsx$/);
    });

    /**
     * The device driver cannot run here: its browser entry throws, and its native entry is built for Tamagui's native
     * core while this build loads the web core (mixing them changed hook order and broke every overlay). The native
     * test lanes face the same build and use `@commise/ui`'s CSS stand-in, so the artifact uses it too.
     */
    it("points the Tamagui animation driver at the design system's CSS stand-in", () => {
        expect(shimAliases('native')['@tamagui/animations-react-native']).toMatch(
            /\/commise\/ui\/src\/testing\/animationsShim\.ts$/u,
        );
    });
});
