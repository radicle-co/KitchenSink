/**
 * The changed-only selector's command line (ADR-0091), run as a process: where it reads the change from, that it hands
 * turbo every flag that is not a `--filter`, that it says why it runs nothing, and that a change it cannot read runs
 * everything instead of nothing.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const BIN = resolve(import.meta.dirname, '../bin/checkScope.ts');
// A package nothing depends on. e2e-plan is not one: repo-guards' graph guards import it (ADR-0091).
const LEAF = JSON.stringify(['packages/tools/cookbook-import/src/runImport.ts']);

const scope = (env: Record<string, string>, ...args: string[]) =>
    spawnSync('npx', ['tsx', BIN, ...args], {
        encoding: 'utf8',
        env: { ...process.env, FULL_SUITE: '', CHECK_SCOPE_FULL: '', CHECK_SCOPE_FILES: '', ...env },
    });

const listed = (result: ReturnType<typeof scope>): string[] =>
    JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '[]') as string[];

describe('bin/checkScope.ts', () => {
    it('lists the changed package and what depends on it, and nothing unrelated', () => {
        const packages = listed(scope({ CHECK_SCOPE_FILES: LEAF }, 'list', 'format:check'));

        expect(packages).toContain('@kitchensink/cookbook-import');
        expect(packages).not.toContain('@kitchensink/food-service');
    });

    it.each<Record<string, string>>([{ FULL_SUITE: '1' }, { CHECK_SCOPE_FULL: 'a push checks everything' }])(
        'lists every package when %o',
        (env) => {
            const all = listed(scope({ ...env, CHECK_SCOPE_FILES: LEAF }, 'list', 'format:check'));

            expect(all.length).toBeGreaterThan(20);
            expect(all).toContain('@commise/web');
        },
    );

    it('runs everything, with a warning, when it cannot read the change', () => {
        const result = scope({ CHECK_SCOPE_FILES: '{"not":"a list"}' }, 'list', 'format:check');

        expect(result.stderr).toMatch(/could not read the change/u);
        expect(listed(result).length).toBeGreaterThan(20);
    });

    it('hands turbo every flag that is not a filter, and only the selected packages', () => {
        const result = scope(
            { CHECK_SCOPE_FILES: LEAF },
            'run',
            'format:check',
            '--filter=./packages/tools/*',
            '--dry=json',
        );
        const dry = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as { tasks: { package: string }[] };

        const selected = listed(
            scope({ CHECK_SCOPE_FILES: LEAF }, 'list', 'format:check', '--filter=./packages/tools/*'),
        );

        expect(result.status).toBe(0);
        expect([...new Set(dry.tasks.map((task) => task.package))].sort()).toEqual(selected);
        expect(selected).toContain('@kitchensink/cookbook-import');
        expect(selected.length).toBeLessThan(10);
    });

    it('says why, and succeeds, when no package needs the task', () => {
        const result = scope({ CHECK_SCOPE_FILES: LEAF }, 'run', 'format:check', '--filter=./packages/services/*');

        expect(result.status).toBe(0);
        expect(result.stderr).toMatch(/::notice::No package needs format:check/u);
    });

    it('refuses a command it does not know', () => {
        expect(scope({}, 'frobnicate').status).toBe(2);
    });
});
