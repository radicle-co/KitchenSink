import { describe, expect, it } from 'vitest';

import { specRoutes } from '../src/specRoutes.js';

const sources: Readonly<Record<string, string>> = {
    'e2e/a.spec.ts': "page.goto(route('/recipes')); signIn(page);",
    'e2e/b.spec.ts': "page.goto(route('/profile'));",
    'e2e/utils/auth.ts': "export const signIn = (p) => p.goto(route('/'));",
    'e2e/utils/deep.ts': 'export const go = (p, path) => p.goto(route(path));',
    'src/app/page.tsx': "route('/not-a-visit')",
    'e2e/utils/basePath.ts': 'export const route = (path) => pseudoRoute(path); ',
};
const imports: Readonly<Record<string, readonly string[]>> = {
    'e2e/a.spec.ts': ['e2e/utils/auth.ts', 'src/app/page.tsx'],
    'e2e/utils/auth.ts': ['e2e/utils/deep.ts', 'e2e/utils/basePath.ts'],
};

describe('specRoutes', () => {
    const found = specRoutes({
        dir: 'e2e',
        specs: ['e2e/a.spec.ts', 'e2e/b.spec.ts'],
        definitions: ['e2e/utils/basePath.ts'],
        importsOf: (file) => imports[file] ?? [],
        read: (file) => sources[file] ?? '',
    });

    it('collects what a spec visits and what the helpers it imports visit', () => {
        expect([...(found.get('e2e/a.spec.ts')?.paths ?? [])].sort()).toEqual(['/', '/recipes']);
    });

    it('follows helpers of helpers, and flags a helper that visits a path it was handed', () => {
        expect(found.get('e2e/a.spec.ts')?.dynamic).toBe(true);
        expect(found.get('e2e/b.spec.ts')).toEqual({ paths: ['/profile'], dynamic: false });
    });

    it('does not count a route helper definition as a visit', () => {
        const direct = specRoutes({
            dir: 'e2e',
            specs: ['e2e/b.spec.ts'],
            definitions: ['e2e/utils/basePath.ts'],
            importsOf: () => ['e2e/utils/basePath.ts'],
            read: (file) => sources[file] ?? '',
        });

        expect(direct.get('e2e/b.spec.ts')?.dynamic).toBe(false);
    });

    it('does not follow an import out of the test folder, where a route() call is not a visit', () => {
        expect(found.get('e2e/a.spec.ts')?.paths).not.toContain('/not-a-visit');
    });
});
