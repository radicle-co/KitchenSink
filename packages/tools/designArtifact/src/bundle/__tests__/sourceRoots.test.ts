import { describe, expect, it } from 'vitest';

import { bundleInputs, sourceRootsOf } from '../sourceRoots.js';

describe('bundleInputs', () => {
    it('resolves metafile keys against the build directory', () => {
        expect(bundleInputs(['src/a.tsx', '../ui/src/b.ts'], '/repo/web')).toEqual([
            '/repo/web/src/a.tsx',
            '/repo/ui/src/b.ts',
        ]);
    });

    it.each([
        ['stdin', '<stdin>'],
        ['a dependency', '../../node_modules/react-native-web/dist/View.js'],
        ['a virtual module', 'commise-runtime-globals:react'],
        ['a binary asset', 'assets/logo.png'],
    ])('drops %s', (_name, key) => {
        expect(bundleInputs([key, 'src/a.tsx'], '/repo/web')).toEqual(['/repo/web/src/a.tsx']);
    });

    it('keeps each kind of source file Tailwind can read', () => {
        const keys = ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mjs', 'f.html'];

        expect(bundleInputs(keys, '/w')).toHaveLength(keys.length);
    });
});

describe('sourceRootsOf', () => {
    it('collapses files to their directories, once each, sorted', () => {
        expect(sourceRootsOf(['/r/b/y.ts', '/r/a/x.ts', '/r/a/z.ts'])).toEqual(['/r/a', '/r/b']);
    });

    it('drops a directory that sits under another root, because @source is recursive', () => {
        expect(sourceRootsOf(['/r/ui/a.ts', '/r/ui/deep/b.ts', '/r/uix/c.ts'])).toEqual(['/r/ui', '/r/uix']);
    });

    it('answers nothing for nothing', () => {
        expect(sourceRootsOf([])).toEqual([]);
    });
});
