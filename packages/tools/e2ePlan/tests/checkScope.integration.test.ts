/**
 * The changed-only selector over the REAL workspace graph and turbo.json (ADR-0091): a leaf change selects its
 * dependents and not the rest, a shared package selects its consumers, and a change the graph cannot see selects
 * everything. These are the properties a skipped check would hide, so they are asserted against turbo itself.
 */
import { describe, expect, it } from 'vitest';

import { loadTaskGraph, resolveTaskPackages } from '../src/checkScopeGraph.js';
import { scopeTask } from '../src/checkScope.js';
import { findRepoRoot } from '../src/repoRoot.js';

const repo = findRepoRoot(import.meta.dirname);

async function select(task: string, files: string[], group: string[] = []) {
    const graph = await loadTaskGraph(repo, task);
    const scope = scopeTask({
        change: { kind: 'files', files },
        workspaces: graph.workspaces,
        facts: graph.facts,
        declaredElsewhere: graph.declaredElsewhere,
    });

    return { scope, packages: await resolveTaskPackages(repo, scope, graph, group) };
}

describe('changed-only selection over the real graph', () => {
    it('selects a leaf package and its dependents, and nothing unrelated', async () => {
        const { packages } = await select('test', ['packages/apps/commise/query/src/queryClient.ts']);

        expect(packages).toContain('@commise/query');
        expect(packages).toContain('@commise/web');
        expect(packages).not.toContain('@kitchensink/food-service');
        expect(packages).not.toContain('@kitchensink/identity-service');
    });

    it('selects every consumer of a shared package', async () => {
        const { packages } = await select('test', ['packages/shared/recipe-core/src/recipe.types.ts']);

        expect(packages).toEqual(
            expect.arrayContaining(['@kitchensink/recipe-core', '@kitchensink/recipe-service', '@commise/web']),
        );
    });

    it('always runs the tasks turbo.json marks uncacheable', async () => {
        const { packages } = await select('test', ['packages/apps/commise/query/src/queryClient.ts']);

        expect(packages).toEqual(
            expect.arrayContaining([
                '@kitchensink/repo-guards',
                '@kitchensink/eslint',
                '@kitchensink/docgen-components',
            ]),
        );
    });

    it('selects a task whose declared outside input changed', async () => {
        const { packages } = await select('test', [
            'packages/services/food-service/src/foods/seed/data/curatedCatalog.jsonl',
        ]);

        expect(packages).toContain('@commise/features-recipes');
    });

    it.each(['package.json', 'package-lock.json', '.github/workflows/_ci.yml', 'tsconfig.json', 'pyproject.toml'])(
        'runs every package for a change to %s',
        async (file) => {
            const all = await select('typecheck', ['packages/tools/e2ePlan/__tests__/env.test.ts']);
            const widened = await select('typecheck', [file]);

            expect(widened.scope.kind).toBe('all');
            expect(widened.packages.length).toBeGreaterThan(all.packages.length);
        },
    );

    it('keeps a group filter as an intersection, never a union', async () => {
        const { packages } = await select(
            'test',
            ['packages/apps/commise/query/src/queryClient.ts'],
            ['--filter=./packages/services/*'],
        );

        expect(packages).not.toContain('@commise/query');
        expect(packages).not.toContain('@kitchensink/repo-guards');
    });

    it('checks the format of every package when the shared Prettier config changes', async () => {
        const everything = await select('format:check', ['package.json']);
        const shared = await select('format:check', ['packages/tools/prettier/index.json']);

        // Equal, not merely larger: a package that formats without declaring `@kitchensink/prettier` has no graph edge
        // to it, and would be skipped here.
        expect(everything.scope.kind).toBe('all');
        expect(shared.packages).toEqual(everything.packages);
    });

    it('does not widen lint or typecheck for the regenerated component catalogue, which only a test reads', async () => {
        for (const task of ['lint', 'typecheck']) {
            const { scope } = await select(task, ['docs/generated/components/index.json']);

            expect(scope.kind).toBe('some');
        }
    });
});
