import { describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import type { Surface } from '../discoverSurface.js';
import { assertSurfaceChecks, surfaceProblems } from '../surfaceChecks.js';
import type { SurfaceCheckInput } from '../surfaceChecks.js';

const entry = (name: string) => ({
    name,
    file: `/ui/${name}.tsx`,
    kind: name.startsWith('use') ? ('hook' as const) : ('component' as const),
});
const REASON = 'Artifact-only native component that draws nothing of its own, so a preview would be an empty box.';

const surface: Surface = {
    web: [entry('Button'), entry('Chip'), entry('useThing')],
    native: [entry('Button'), entry('Chip'), entry('ScrollFrame')],
};

function input(overrides: Partial<SurfaceCheckInput> = {}): SurfaceCheckInput {
    return {
        surface,
        cards: [
            { name: 'Button', uses: ['Button'], platforms: 'both' },
            { name: 'Chip', uses: ['Chip'], platforms: 'both' },
        ],
        boards: [{ file: 'Home.dc.html', html: '<x component-from-global-scope="Commise.Button">' }],
        uncarded: { ScrollFrame: REASON },
        ...overrides,
    };
}

describe('surfaceProblems', () => {
    it('is empty when cards, boards and the uncarded table all agree with the surface', () => {
        expect(surfaceProblems(input())).toEqual([]);
    });

    describe('a card against the surface, per platform it draws', () => {
        it.each([
            ['both', ['web', 'native']],
            ['web', ['web']],
            ['native', ['native']],
        ] as const)(
            'a %s card using a name neither platform exports names exactly the platforms it draws',
            (platforms, drawn) => {
                const problems = surfaceProblems(
                    input({
                        cards: [
                            { name: 'Button', uses: ['Button'], platforms: 'both' },
                            { name: 'Chip', uses: ['Chip', 'Ghost'], platforms },
                        ],
                    }),
                );

                expect(problems).toEqual(
                    drawn.map((platform) => `Chip uses Ghost, which the ${platform} surface does not export`),
                );
            },
        );

        it('does not blame the platform a card does not draw', () => {
            const problems = surfaceProblems(
                input({
                    surface: { web: surface.web, native: [entry('Button')] },
                    cards: [
                        { name: 'Button', uses: ['Button'], platforms: 'both' },
                        { name: 'Chip', uses: ['Chip'], platforms: 'web' },
                    ],
                    uncarded: {},
                }),
            );

            expect(problems).toEqual(expect.not.arrayContaining([expect.stringContaining('native surface')]));
        });
    });

    it('names a board that mounts a component the surface does not export, on its own platform', () => {
        const problems = surfaceProblems(
            input({
                boards: [
                    {
                        file: 'A.dc.html',
                        html: '<x component-from-global-scope="Commise.Native.Chip"><y component-from-global-scope="Commise.Ghost"><z component-from-global-scope="Commise.Native.ScrollFrame">',
                    },
                    { file: 'B.dc.html', html: '<y component-from-global-scope="Commise.Native.Nope">' },
                ],
            }),
        );

        expect(problems).toEqual([
            'A.dc.html mounts Commise.Ghost, which is not exported',
            'B.dc.html mounts Commise.Native.Nope, which is not exported',
        ]);
    });

    it('names a discovered component that has neither a card nor an UNCARDED entry', () => {
        const problems = surfaceProblems(input({ uncarded: {} }));

        expect(problems).toEqual(['ScrollFrame has no card and no UNCARDED entry']);
    });

    it('does not treat a hook as a component that needs a card', () => {
        expect(surfaceProblems(input())).toEqual([]);
    });

    describe('UNCARDED stays honest', () => {
        it('refuses an entry that is not a discovered component', () => {
            expect(surfaceProblems(input({ uncarded: { ScrollFrame: REASON, Gone: REASON } }))).toEqual([
                'UNCARDED lists Gone, which is not a discovered component',
            ]);
        });

        it('refuses an entry that has a card now', () => {
            expect(surfaceProblems(input({ uncarded: { ScrollFrame: REASON, Chip: REASON } }))).toEqual([
                'UNCARDED lists Chip, which has a card; remove the entry',
            ]);
        });

        it('refuses an entry with no real reason', () => {
            expect(surfaceProblems(input({ uncarded: { ScrollFrame: 'because' } }))).toEqual([
                'UNCARDED lists ScrollFrame without a reason',
            ]);
        });
    });

    describe('a card against the surface, in reverse', () => {
        it('names a card for a component the surface does not export on a platform the card draws', () => {
            const problems = surfaceProblems(
                input({
                    cards: [
                        { name: 'Button', uses: ['Button'], platforms: 'both' },
                        { name: 'Chip', uses: ['Chip'], platforms: 'both' },
                        { name: 'Orphan', uses: ['Button'], platforms: 'both' },
                        { name: 'ScrollFrame', uses: ['Button'], platforms: 'web' },
                    ],
                    uncarded: {},
                }),
            );

            expect(problems).toEqual([
                'Orphan is a card for a component the web surface does not export',
                'Orphan is a card for a component the native surface does not export',
                'ScrollFrame is a card for a component the web surface does not export',
            ]);
        });

        it('does not demand a card for the platform it does not draw', () => {
            const problems = surfaceProblems(
                input({
                    cards: [
                        { name: 'Button', uses: ['Button'], platforms: 'both' },
                        { name: 'Chip', uses: ['Chip'], platforms: 'both' },
                        { name: 'ScrollFrame', uses: ['ScrollFrame'], platforms: 'native' },
                    ],
                    uncarded: {},
                }),
            );

            expect(problems).toEqual([]);
        });
    });
});

describe('assertSurfaceChecks', () => {
    it('passes silently when nothing is wrong', () => {
        expect(() => assertSurfaceChecks(input())).not.toThrow();
    });

    it('throws surface-mismatch listing every problem at once', () => {
        const failure = (() => {
            try {
                assertSurfaceChecks(
                    input({
                        uncarded: {},
                        boards: [{ file: 'A', html: '<x component-from-global-scope="Commise.Ghost">' }],
                    }),
                );
            } catch (error) {
                return error;
            }

            return undefined;
        })();

        expect(isDesignArtifactError(failure) && failure.code).toBe('surface-mismatch');
        expect(failure).toHaveProperty('message', expect.stringContaining('A mounts Commise.Ghost'));
        expect(failure).toHaveProperty('message', expect.stringContaining('ScrollFrame has no card'));
    });
});
