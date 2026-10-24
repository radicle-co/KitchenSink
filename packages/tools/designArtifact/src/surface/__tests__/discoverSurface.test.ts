import { describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import { appendDirectEntries, toSurfaceEntries } from '../discoverSurface.js';
import { makeSurfaceEntry } from '../__fixtures__/makeSurfaceEntry.js';

describe('toSurfaceEntries', () => {
    const namesOf = (table: Readonly<Record<string, readonly string[]>>) => (file: string) => table[file] ?? [];

    it('emits one entry per exported name, in file order then export order', () => {
        const entries = toSurfaceEntries(
            ['/a/B.tsx', '/a/A.tsx'],
            namesOf({ '/a/B.tsx': ['B', 'Bb'], '/a/A.tsx': ['A'] }),
            'web',
        );

        expect(entries).toEqual([
            makeSurfaceEntry('B', { file: '/a/B.tsx' }),
            makeSurfaceEntry('Bb', { file: '/a/B.tsx' }),
            makeSurfaceEntry('A', { file: '/a/A.tsx' }),
        ]);
    });

    it('skips a file that exports nothing', () => {
        expect(toSurfaceEntries(['/a/None.tsx'], namesOf({}), 'web')).toEqual([]);
    });

    it('throws duplicate-name, naming the platform, the name and BOTH files', () => {
        expect.assertions(5);

        try {
            toSurfaceEntries(
                ['/a/One.tsx', '/b/Two.tsx'],
                namesOf({ '/a/One.tsx': ['Same'], '/b/Two.tsx': ['Same'] }),
                'native',
            );
        } catch (error) {
            expect(isDesignArtifactError(error)).toBe(true);
            const message = error instanceof Error ? error.message : '';

            expect(isDesignArtifactError(error) && error.code).toBe('duplicate-name');
            expect(message).toContain('native');
            expect(message).toContain('Same');
            expect(message).toContain('/a/One.tsx');
        }
    });

    it('also catches a duplicate inside ONE file', () => {
        expect(() => toSurfaceEntries(['/a/One.tsx'], namesOf({ '/a/One.tsx': ['Dup', 'Dup'] }), 'web')).toThrowError(
            /Dup/u,
        );
    });
});

describe('appendDirectEntries', () => {
    const base = [makeSurfaceEntry('Button', { file: '/a/Button.tsx' })];

    it('appends the entries after the existing ones, keeping their order', () => {
        const direct = [
            makeSurfaceEntry('ScrollFrame', { file: '/s/scrollFrame.tsx' }),
            makeSurfaceEntry('useSnackbar', { file: '/s/useSnackbar.ts' }),
        ];

        expect(appendDirectEntries(base, direct, 'native')).toEqual([...base, ...direct]);
    });

    it('throws duplicate-name when a direct entry reuses a discovered name, naming both files', () => {
        expect.assertions(3);

        try {
            appendDirectEntries(base, [makeSurfaceEntry('Button', { file: '/s/Other.tsx' })], 'native');
        } catch (error) {
            expect(isDesignArtifactError(error) && error.code).toBe('duplicate-name');
            expect((error as Error).message).toContain('/a/Button.tsx');
            expect((error as Error).message).toContain('/s/Other.tsx');
        }
    });

    it('throws duplicate-name when two direct entries share a name', () => {
        expect(() =>
            appendDirectEntries(
                [],
                [makeSurfaceEntry('X', { file: '/1.tsx' }), makeSurfaceEntry('X', { file: '/2.tsx' })],
                'web',
            ),
        ).toThrowError(/X/u);
    });
});
