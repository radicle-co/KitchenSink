import { describe, expect, it } from 'vitest';

import { isTestSupportCandidate, testingDirs } from '../src/testSupport.js';
import type { WorkspacePackage } from '../src/workspaces.js';

const pkg = (dir: string, exports: unknown): WorkspacePackage => ({ name: dir, dir, exports, deps: [] });

describe('testingDirs', () => {
    it('is the folder of every target a package exports under a testing name', () => {
        const dirs = testingDirs([
            pkg('packages/ui', {
                '.': './src/index.ts',
                './testing/tamagui': './src/testing/tamaguiTesting.native.tsx',
                './testing/hardware-back': './src/testing/hardwareBack.native.ts',
                './button': './src/button/index.ts',
            }),
            pkg('packages/core', {
                './testing': { import: './src/testing/index.ts', default: './src/testing/index.ts' },
            }),
        ]);

        expect([...dirs].sort()).toEqual(['packages/core/src/testing', 'packages/ui/src/testing']);
    });

    it('reads a dist target as its src twin, since only src is ever in the tree', () => {
        expect(testingDirs([pkg('packages/x', { './testing': './dist/testing/index.js' })])).toEqual([
            'packages/x/src/testing',
        ]);
    });

    it('ignores a package with no testing export, or no exports at all', () => {
        expect(testingDirs([pkg('packages/a', { '.': './src/index.ts' }), pkg('packages/b', undefined)])).toEqual([]);
    });
});

describe('isTestSupportCandidate', () => {
    const dirs = ['packages/ui/src/testing'];

    it.each([
        ['packages/ui/src/testing/tamaguiTesting.native.tsx', true],
        ['packages/ui/src/testing/deep/helper.ts', true],
        ['packages/web/src/lib/__fixtures__/makeThing.ts', true],
        ['packages/ui/src/testingCenter/x.ts', false],
        ['packages/ui/src/button/index.ts', false],
        ['packages/ui/src/testing.ts', false],
    ])('%s -> %s', (file, expected) => {
        expect(isTestSupportCandidate(file, dirs)).toBe(expected);
    });
});
