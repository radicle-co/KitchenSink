import { describe, expect, it } from 'vitest';

import { mobileRegistry } from '../src/mobileScreens.js';

const importers: Readonly<Record<string, readonly string[]>> = {
    'm/src/screens/HomeScreen.tsx': ['m/src/navigation/stacks.tsx'],
    'm/src/screens/profile.tsx': ['m/src/navigation/stacks.tsx'],
    'm/src/screens/login.tsx': ['m/src/components/AuthGate.tsx'],
    'm/src/screens/AppRoot.tsx': ['m/App.tsx'],
    'm/src/screens/helper.tsx': ['m/src/screens/HomeScreen.tsx'],
    'm/src/screens/Detail.native.tsx': ['m/src/navigation/stacks.tsx'],
};

const registry = mobileRegistry({
    screensDir: 'm/src/screens',
    registrars: ['m/src/navigation/', 'm/src/components/AuthGate.tsx'],
    roots: ['m/App.tsx', 'm/app.config.ts'],
    files: [
        ...Object.keys(importers),
        'm/src/screens/Detail.tsx',
        'm/src/navigation/stacks.tsx',
        'm/src/components/AuthGate.tsx',
    ],
    importersOf: (file) => importers[file] ?? [],
});

describe('mobileRegistry', () => {
    it('makes a screen of each module in the screens folder that a registrar imports', () => {
        expect([...registry.screens].sort()).toEqual(['Detail', 'HomeScreen', 'login', 'profile']);
    });

    it('does not make a screen of a module only the app root or another screen imports', () => {
        expect(registry.terminals.screenEntries.has('m/src/screens/AppRoot.tsx')).toBe(false);
        expect(registry.terminals.screenEntries.has('m/src/screens/helper.tsx')).toBe(false);
    });

    it('names a screen by its file without the .native part, and enters it through both variants', () => {
        expect(registry.terminals.screenEntries.get('m/src/screens/Detail.native.tsx')).toEqual(['Detail']);
        expect(registry.terminals.screenEntries.get('m/src/screens/Detail.tsx')).toEqual(['Detail']);
    });

    it('treats the app root, the config and every registrar as a root', () => {
        expect([...registry.terminals.roots].sort()).toEqual([
            'm/App.tsx',
            'm/app.config.ts',
            'm/src/components/AuthGate.tsx',
            'm/src/navigation/stacks.tsx',
        ]);
    });
});
