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
});
