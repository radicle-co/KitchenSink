import { describe, expect, it } from 'vitest';

import { closureOf, type WorkspacePackage } from '../src/workspaces.js';

const pkg = (name: string, dir: string, deps: readonly string[] = []): WorkspacePackage => ({
    name,
    dir,
    exports: undefined,
    deps,
});

const packages = [
    pkg('@s/identity', 'packages/services/identity', ['@s/core', 'zod']),
    pkg('@s/recipe', 'packages/services/recipe', ['@s/core', '@s/client']),
    pkg('@s/core', 'packages/shared/core', ['@s/leaf']),
    pkg('@s/leaf', 'packages/shared/leaf'),
    pkg('@s/client', 'packages/clients/client', ['@s/core']),
    pkg('@s/fixtures', 'packages/tools/fixtures', ['@s/leaf2']),
    pkg('@s/leaf2', 'packages/shared/leaf2'),
    pkg('@s/ui', 'packages/apps/ui'),
    pkg('@s/web', 'packages/apps/web', ['@s/ui', '@s/core']),
];

describe('closureOf', () => {
    it('is the roots and everything they depend on, however deep', () => {
        expect([...closureOf(packages, ['packages/services/*'])].sort()).toEqual([
            'packages/clients/client',
            'packages/services/identity',
            'packages/services/recipe',
            'packages/shared/core',
            'packages/shared/leaf',
        ]);
    });

    it('does not reach a package that only an app depends on', () => {
        const closure = closureOf(packages, ['packages/services/*']);

        expect(closure.has('packages/apps/ui')).toBe(false);
        expect(closure.has('packages/apps/web')).toBe(false);
    });

    it('takes a root named by an exact folder, and several roots at once', () => {
        const closure = closureOf(packages, ['packages/services/*', 'packages/tools/fixtures']);

        expect(closure.has('packages/shared/leaf2')).toBe(true);
    });

    it('ignores a dependency that is not a workspace package, and survives a cycle', () => {
        const cyclic = [
            pkg('@c/a', 'packages/services/a', ['@c/b', 'left-pad']),
            pkg('@c/b', 'packages/shared/b', ['@c/a']),
        ];

        expect([...closureOf(cyclic, ['packages/services/*'])].sort()).toEqual([
            'packages/services/a',
            'packages/shared/b',
        ]);
    });
});
