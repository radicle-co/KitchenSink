import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import picomatch from 'picomatch';
import { describe, expect, it } from 'vitest';

import { SELECTOR_SOURCES, scopeTask, type TaskFacts, type Workspace } from '../src/checkScope.js';

const WORKSPACES: readonly Workspace[] = [
    { name: '@commise/web', dir: 'packages/apps/commise/web' },
    { name: '@commise/features-recipes', dir: 'packages/apps/commise/features/recipes' },
    { name: '@commise/query', dir: 'packages/apps/commise/query' },
    { name: '@kitchensink/food-service', dir: 'packages/services/food-service' },
    { name: '@kitchensink/recipe-workers', dir: 'packages/services/recipe-workers' },
    { name: '@kitchensink/repo-guards', dir: 'packages/tools/repoGuards' },
    { name: '@kitchensink/e2e-plan', dir: 'packages/tools/e2ePlan' },
];

const FACTS: readonly TaskFacts[] = [
    { package: '@commise/web', cache: true, outsideInputs: [] },
    {
        package: '@commise/features-recipes',
        cache: true,
        outsideInputs: [
            'docs/design/variantDetailsMockup.html',
            'packages/services/food-service/src/foods/seed/data/curatedCatalog.jsonl',
        ],
    },
    { package: '@commise/query', cache: true, outsideInputs: [] },
    { package: '@kitchensink/food-service', cache: true, outsideInputs: [] },
    { package: '@kitchensink/repo-guards', cache: false, outsideInputs: [] },
];

const scope = (files: readonly string[], fullSuite = false) =>
    scopeTask({
        change: fullSuite ? { kind: 'full', reason: 'FULL_SUITE=1' } : { kind: 'files', files },
        workspaces: WORKSPACES,
        facts: FACTS,
    });

const seedsOf = (result: ReturnType<typeof scope>) =>
    result.kind === 'some' ? result.seeds.map((seed) => seed.id) : `all: ${result.reasons.join('; ')}`;

describe('scopeTask', () => {
    it('runs everything when the whole suite is asked for', () => {
        expect(scope(['packages/apps/commise/query/src/a.ts'], true)).toEqual({
            kind: 'all',
            reasons: ['FULL_SUITE=1'],
        });
    });

    it('seeds the package that owns a changed file, beside the always-run tasks; dependents are the graph adapter’s job', () => {
        expect(seedsOf(scope(['packages/apps/commise/query/src/hooks/useThing.ts']))).toEqual([
            '@commise/query',
            '@kitchensink/repo-guards',
        ]);
    });

    it('attributes a deleted file by path alone', () => {
        expect(seedsOf(scope(['packages/commise-gone/x.ts']))).toMatch(/^all: /u);
        expect(seedsOf(scope(['packages/services/food-service/src/removed.ts']))).toEqual([
            '@kitchensink/food-service',
            '@kitchensink/repo-guards',
        ]);
    });

    it('gives a nested non-workspace folder to the workspace around it', () => {
        expect(seedsOf(scope(['packages/services/recipe-workers/infra/lib/stack.ts']))).toEqual([
            '@kitchensink/recipe-workers',
            '@kitchensink/repo-guards',
        ]);
    });

    it('does not mistake a sibling whose name shares a prefix for the owner', () => {
        expect(seedsOf(scope(['packages/apps/commise/webExtra/src/a.ts']))).toMatch(/^all: /u);
    });

    it.each([
        ['package.json', /outside every package/u],
        ['package-lock.json', /outside every package/u],
        ['tsconfig.json', /outside every package/u],
        ['.lintstagedrc.js', /outside every package/u],
        ['pyproject.toml', /outside every package/u],
        ['.github/workflows/_ci.yml', /outside every package/u],
        ['scripts/contractGenerate.mjs', /outside every package/u],
        ['docs/design/someOtherMockup.html', /outside every package/u],
        ['packages/infra/global/lib/stack.ts', /outside every package/u],
        ['turbo.json', /turbo/u],
        ['packages/apps/commise/web/turbo.json', /turbo/u],
        ['packages/tools/e2ePlan/src/checkScope.ts', /selector/u],
        ['packages/tools/e2ePlan/src/checkScopeGraph.ts', /selector/u],
        ['packages/tools/e2ePlan/bin/checkScope.ts', /selector/u],
    ])('widens %s to the whole tier', (path, reason) => {
        const result = scope(['packages/apps/commise/query/src/a.ts', path]);

        expect(result.kind).toBe('all');
        expect(result.kind === 'all' ? result.reasons.join('\n') : '').toMatch(reason);
    });

    it('ignores prose outside every package', () => {
        expect(seedsOf(scope(['docs/architecture/decisions/0091-x.md', 'CLAUDE.md', 'specs/001/spec.md']))).toEqual([
            '@kitchensink/repo-guards',
        ]);
    });

    it('treats markdown INSIDE a package as part of that package', () => {
        expect(seedsOf(scope(['packages/apps/commise/web/README.md']))).toEqual([
            '@commise/web',
            '@kitchensink/repo-guards',
        ]);
    });

    it('always runs a task turbo cannot cache, because its inputs are not expressible', () => {
        expect(seedsOf(scope([]))).toEqual(['@kitchensink/repo-guards']);
    });

    it('walks dependents only from a package a changed file is in', () => {
        const result = scope(['packages/services/food-service/src/foods/seed/data/curatedCatalog.jsonl']);
        const dependents = result.kind === 'some' ? result.seeds.map((seed) => [seed.id, seed.dependents]) : [];

        expect(dependents).toEqual([
            ['@commise/features-recipes', false],
            ['@kitchensink/food-service', true],
            ['@kitchensink/repo-guards', false],
        ]);
    });

    it('selects a task whose declared inputs outside its package changed', () => {
        expect(seedsOf(scope(['packages/services/food-service/src/foods/seed/data/curatedCatalog.jsonl']))).toEqual([
            '@commise/features-recipes',
            '@kitchensink/food-service',
            '@kitchensink/repo-guards',
        ]);
    });

    it('selects that task for a declared input outside every package, instead of widening', () => {
        expect(seedsOf(scope(['docs/design/variantDetailsMockup.html']))).toEqual([
            '@commise/features-recipes',
            '@kitchensink/repo-guards',
        ]);
    });

    it.each(['package-lock.json', 'package.json', '.github/workflows/_ci.yml', 'scripts/x.mjs'])(
        'still widens on %s even when a task declares it as an input',
        (file) => {
            const result = scopeTask({
                change: { kind: 'files', files: [file] },
                workspaces: WORKSPACES,
                facts: [{ package: '@commise/web', cache: true, outsideInputs: [file] }],
            });

            expect(result.kind).toBe('all');
        },
    );

    it('ignores a file outside every package that only ANOTHER task declares it reads', () => {
        const result = scopeTask({
            change: { kind: 'files', files: ['docs/generated/components/index.json'] },
            workspaces: WORKSPACES,
            facts: FACTS,
            declaredElsewhere: ['docs/generated/**'],
        });

        expect(seedsOf(result)).toEqual(['@kitchensink/repo-guards']);
    });

    it('still widens on a root file another task declares', () => {
        const result = scopeTask({
            change: { kind: 'files', files: ['package-lock.json'] },
            workspaces: WORKSPACES,
            facts: FACTS,
            declaredElsewhere: ['package-lock.json'],
        });

        expect(result.kind).toBe('all');
    });

    it('lists every file the selector command line imports among its own sources', () => {
        const root = resolve(import.meta.dirname, '../../../..');
        const own = picomatch([...SELECTOR_SOURCES]);
        const seen = new Set<string>();

        const walk = (file: string): void => {
            if (seen.has(file)) {
                return;
            }

            seen.add(file);

            for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from '(\.{1,2}\/[^']+)\.js'/gu)) {
                walk(resolve(dirname(file), `${spec ?? ''}.ts`));
            }
        };

        walk(resolve(root, 'packages/tools/e2ePlan/bin/checkScope.ts'));

        const missing = [...seen].map((file) => relative(root, file)).filter((file) => !own(file));

        expect(seen.size).toBeGreaterThan(5);
        expect(missing).toEqual([]);
    });

    it('keeps a long reason list to three and a count', () => {
        const many = Array.from({ length: 5 }, (_, i) => `packages/apps/commise/query/src/f${i}.ts`);
        const result = scope(many);
        const query = result.kind === 'some' ? result.seeds.find((seed) => seed.id === '@commise/query') : undefined;

        expect(query?.because).toMatch(/f2\.ts is in it; and 2 more$/u);
    });

    it('says why each package was seeded', () => {
        const result = scope(['packages/apps/commise/query/src/a.ts']);

        expect(result.kind === 'some' ? result.seeds : []).toEqual([
            { id: '@commise/query', because: 'packages/apps/commise/query/src/a.ts is in it', dependents: true },
            { id: '@kitchensink/repo-guards', because: 'turbo cannot cache it, so it always runs', dependents: false },
        ]);
    });
});
