/**
 * DISCOVERY predicates and the determinism the staleness guard depends on.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { discoverComponentFiles, isDocumentedComponentFile, isDocumentedDirectory } from '../discovery.js';
import { platformOf } from '../extract.js';
import { toJsonText } from '../serialize.js';

const FIXTURE_DIR = join(import.meta.dirname, '..', '__fixtures__', 'components');

describe('isDocumentedDirectory', () => {
    it.each(['__tests__', 'tests', '__fixtures__', '__mocks__', 'node_modules', 'dist', '.next', 'test-utils'])(
        'skips %s',
        (name) => {
            expect(isDocumentedDirectory(name)).toBe(false);
        },
    );

    it.each(['button', 'components', 'app'])('walks %s', (name) => {
        expect(isDocumentedDirectory(name)).toBe(true);
    });
});

describe('isDocumentedComponentFile', () => {
    it.each(['Button.tsx', 'Button.native.tsx', 'page.tsx'])('documents %s', (name) => {
        expect(isDocumentedComponentFile(name)).toBe(true);
    });

    // A test living beside its subject is a shape this repository uses, so the directory filter alone is not
    // enough — the suffix has to be excluded too.
    it.each(['Button.test.tsx', 'Button.native.test.tsx', 'flow.spec.tsx', 'props.ts', 'README.md'])(
        'excludes %s',
        (name) => {
            expect(isDocumentedComponentFile(name)).toBe(false);
        },
    );

    // A hook that returns a render callback needs JSX, so it is `.tsx` — but a `use`-prefixed module is a hook by
    // React's own convention (the rules-of-hooks lint keys on the same prefix), never a component, and the per-file
    // coverage guard would otherwise demand a component from it.
    it.each(['useHydratedNutrition.tsx', 'useThing.native.tsx'])('excludes the hook module %s', (name) => {
        expect(isDocumentedComponentFile(name)).toBe(false);
    });

    it.each(['User.tsx', 'UserCard.tsx', 'used.tsx', 'use.tsx'])(
        'still documents %s, which is not a hook name',
        (name) => {
            expect(isDocumentedComponentFile(name)).toBe(true);
        },
    );
});

describe('platformOf', () => {
    it('reads the platform from the file suffix', () => {
        expect(platformOf('/a/b/Button.native.tsx')).toBe('native');
        expect(platformOf('/a/b/Button.tsx')).toBe('web');
    });

    // The DIRECTORY is not the signal: a native leaf sits beside its web sibling, and a `native/` folder
    // holding a web leaf would be misread by a path-based rule.
    it('does not infer the platform from a directory called native', () => {
        expect(platformOf('/a/native/Button.tsx')).toBe('web');
    });
});

describe('discoverComponentFiles', () => {
    it('returns sorted paths, so the emitted catalogue never depends on directory order', () => {
        const found = discoverComponentFiles(FIXTURE_DIR);

        expect(found).toEqual([...found].sort());
        expect(found.length).toBeGreaterThan(0);
        expect(found.every((file) => file.endsWith('.tsx'))).toBe(true);
    });

    it('accepts a single file as well as a directory, for entry points like mobile App.tsx', () => {
        const file = join(FIXTURE_DIR, 'Badge.tsx');

        expect(discoverComponentFiles(file)).toEqual([file]);
    });
});

describe('toJsonText', () => {
    it('is stable and newline-terminated, which is what makes byte comparison a usable gate', () => {
        const value = { b: 1, a: [1, 2] };

        expect(toJsonText(value)).toBe(toJsonText(value));
        expect(toJsonText(value).endsWith('\n')).toBe(true);
    });

    // A timestamp or a version stamp would make the regenerate-and-diff guard fail on every run, and a guard
    // people learn to ignore is worse than no guard.
    it('embeds nothing that varies between runs', () => {
        expect(toJsonText({ a: 1 })).toBe('{\n    "a": 1\n}\n');
    });
});
