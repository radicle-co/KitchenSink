import { describe, expect, it } from 'vitest';

import { chooseNativeVariant } from '../chooseNativeVariant.js';

const ROOT = '/repo/commise';

const existing = (...paths: string[]) => {
    const set = new Set(paths);

    return (path: string): boolean => set.has(path);
};

describe('chooseNativeVariant', () => {
    const importer = `${ROOT}/features/recipes/src/RecipeCard.native.tsx`;

    it.each([
        [
            'a repo importer and a repo target with a .native.tsx sibling',
            importer,
            `${ROOT}/ui/src/chip/Chip.tsx`,
            [`${ROOT}/ui/src/chip/Chip.native.tsx`],
            `${ROOT}/ui/src/chip/Chip.native.tsx`,
        ],
        [
            'a sibling that is .native.ts',
            importer,
            `${ROOT}/ui/src/icon/names.ts`,
            [`${ROOT}/ui/src/icon/names.native.ts`],
            `${ROOT}/ui/src/icon/names.native.ts`,
        ],
        [
            'both siblings exist: .tsx wins',
            importer,
            `${ROOT}/ui/src/a/A.ts`,
            [`${ROOT}/ui/src/a/A.native.tsx`, `${ROOT}/ui/src/a/A.native.ts`],
            `${ROOT}/ui/src/a/A.native.tsx`,
        ],
        [
            'a .web. target has the .web. stripped before the lookup',
            importer,
            `${ROOT}/ui/src/chip/Chip.web.tsx`,
            [`${ROOT}/ui/src/chip/Chip.native.tsx`],
            `${ROOT}/ui/src/chip/Chip.native.tsx`,
        ],
        [
            'a repo target with no native sibling',
            importer,
            `${ROOT}/ui/src/chip/Chip.tsx`,
            [],
            `${ROOT}/ui/src/chip/Chip.tsx`,
        ],
        [
            'a target that is already .native',
            importer,
            `${ROOT}/ui/src/chip/Chip.native.tsx`,
            [`${ROOT}/ui/src/chip/Chip.native.native.tsx`],
            `${ROOT}/ui/src/chip/Chip.native.tsx`,
        ],
        [
            'an importer inside node_modules (even under the repo)',
            `${ROOT}/web/node_modules/lib/index.js`,
            `${ROOT}/ui/src/chip/Chip.tsx`,
            [`${ROOT}/ui/src/chip/Chip.native.tsx`],
            `${ROOT}/ui/src/chip/Chip.tsx`,
        ],
        [
            'an importer outside the Commise tree',
            '/elsewhere/src/entry.ts',
            `${ROOT}/ui/src/chip/Chip.tsx`,
            [`${ROOT}/ui/src/chip/Chip.native.tsx`],
            `${ROOT}/ui/src/chip/Chip.tsx`,
        ],
        [
            'a target outside the Commise tree',
            importer,
            '/other/lib/Thing.tsx',
            ['/other/lib/Thing.native.tsx'],
            '/other/lib/Thing.tsx',
        ],
        [
            'a target in node_modules under the repo',
            importer,
            `${ROOT}/web/node_modules/pkg/Thing.js`,
            [`${ROOT}/web/node_modules/pkg/Thing.native.tsx`],
            `${ROOT}/web/node_modules/pkg/Thing.js`,
        ],
        [
            'a sibling directory that merely shares the root as a name prefix',
            importer,
            `${ROOT}-other/ui/Chip.tsx`,
            [`${ROOT}-other/ui/Chip.native.tsx`],
            `${ROOT}-other/ui/Chip.tsx`,
        ],
        [
            'a non-script asset (no source extension to swap)',
            importer,
            `${ROOT}/ui/src/icon/glyph.svg`,
            [`${ROOT}/ui/src/icon/glyph.svg.native.tsx`],
            `${ROOT}/ui/src/icon/glyph.svg`,
        ],
    ])('%s', (_label, from, resolved, present, expected) => {
        expect(chooseNativeVariant(from, resolved, existing(...present), ROOT)).toBe(expected);
    });

    it('is called with the exact candidate paths, tsx before ts', () => {
        const asked: string[] = [];

        chooseNativeVariant(
            importer,
            `${ROOT}/ui/src/a/A.js`,
            (path) => {
                asked.push(path);

                return false;
            },
            ROOT,
        );

        expect(asked).toEqual([`${ROOT}/ui/src/a/A.native.tsx`, `${ROOT}/ui/src/a/A.native.ts`]);
    });
});
