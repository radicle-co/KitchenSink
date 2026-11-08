/**
 * The zero list is safe only while two things stay true, and each is a test here over the real tree.
 *
 * 1. No file that ships imports a test file. A path the selector zero-lists (a vitest test, a `__tests__` folder, a
 *    vitest config) is a path that cannot change what a screen does; one import from a shipped file breaks that.
 * 2. No source of the end-to-end suites reads a file the zero list names. A Playwright spec once screenshotted
 *    `docs/mockups/screens/*.html`; `docs/` is therefore not on the list, and markdown or the repo guards must not
 *    become inputs of a spec or a flow without this test failing.
 */
import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { buildImportGraph } from '../src/dependencyGraph.js';
import { isTestFile } from '../src/impactPolicy.js';
import { planChange } from '../src/planChange.js';
import { loadRepoModels, MOBILE_PROFILE, WEB_PROFILE } from '../src/repoModels.js';
import { isTestSupportCandidate, testingDirs } from '../src/testSupport.js';
import { readWorkspaces } from '../src/workspaces.js';

const repo = resolve(import.meta.dirname, '../../../..');

describe('the zero list, over the real tree', () => {
    it.each([WEB_PROFILE, MOBILE_PROFILE])('no file that ships imports a test file: $name', async (profile) => {
        const graph = await buildImportGraph(repo, { ...profile, includeTests: true });
        const violations = graph.files
            .filter((file) => !isTestFile(file))
            .flatMap((file) =>
                graph
                    .importsOf(file)
                    .filter((imported) => isTestFile(imported))
                    .map((imported) => `${file} imports ${imported}`),
            );

        // The web app keeps its unit tests beside the code, so its graph must hold some; a graph with none proves nothing.
        expect(profile.name === 'mobile' || graph.files.some((file) => isTestFile(file))).toBe(true);
        expect(violations).toEqual([]);
    });

    it('no source of the end-to-end suites names a markdown file or the repo guards', () => {
        const sources = [
            'packages/apps/commise/web/tests/e2e/**/*.ts',
            'packages/tools/e2e-fixtures/src/**/*.ts',
            'packages/tools/e2e-seed/src/**/*.ts',
        ]
            .flatMap((pattern) => globSync(pattern, { cwd: repo }))
            .filter((file) => !isTestFile(file) && !file.endsWith('.spec.ts-snapshots'));
        const offenders = sources.flatMap((file) => {
            const tree = ts.createSourceFile(
                file,
                readFileSync(join(repo, file), 'utf8'),
                ts.ScriptTarget.Latest,
                true,
            );
            const found: string[] = [];

            const visit = (node: ts.Node): void => {
                const text = ts.isStringLiteralLike(node)
                    ? node.text
                    : ts.isTemplateExpression(node)
                      ? node.head.text + node.templateSpans.map((span) => span.literal.text).join('')
                      : undefined;

                if (text !== undefined && (/\.md$/u.test(text) || text.includes('repoGuards'))) {
                    found.push(`${file}: ${text}`);
                }

                ts.forEachChild(node, visit);
            };

            visit(tree);

            return found;
        });

        expect(sources.length).toBeGreaterThan(20);
        expect(offenders).toEqual([]);
    });

    it('no Maestro flow or script names a markdown file or the repo guards', () => {
        const dir = 'packages/apps/commise/mobile/.maestro';
        const offenders = globSync(`${dir}/**/*.{yaml,js}`, { cwd: repo })
            .filter((file) =>
                readFileSync(join(repo, file), 'utf8')
                    .split('\n')
                    .filter((line) => !/^\s*#/u.test(line))
                    .some((line) => /\.md\b|repoGuards/u.test(line)),
            )
            .map((file) => file);

        expect(offenders).toEqual([]);
    });

    it('no file that ships imports test support: a package `testing` export or a __fixtures__ folder', async () => {
        const models = await loadRepoModels(repo);
        const dirs = testingDirs(readWorkspaces(repo));
        const candidates = [
            ...dirs.flatMap((dir) => globSync(`${dir}/**/*`, { cwd: repo })),
            ...globSync('packages/**/__fixtures__/**/*', { cwd: repo, exclude: (name) => name === 'node_modules' }),
        ].filter((file) => /\.[cm]?[jt]sx?$/u.test(file));
        const violations = candidates.flatMap((file) =>
            [...models.web.shippingImportersOf(file), ...models.mobile.shippingImportersOf(file)]
                .filter((importer) => !isTestSupportCandidate(importer, dirs))
                .map((importer) => `${importer} imports ${file}`),
        );

        expect(candidates.length).toBeGreaterThan(5);
        expect(violations).toEqual([]);
    });

    it('test support that a spec imports selects that spec, and is never zero-listed', async () => {
        const models = await loadRepoModels(repo);
        const dirs = testingDirs(readWorkspaces(repo));
        const support = [
            ...dirs.flatMap((dir) => globSync(`${dir}/**/*`, { cwd: repo })),
            ...globSync('packages/**/__fixtures__/**/*', { cwd: repo, exclude: (name) => name === 'node_modules' }),
        ].filter((file) => /\.[cm]?[jt]sx?$/u.test(file) && models.isTestSupport(file));
        const reachingATest = support.filter((file) =>
            [models.web, models.mobile].some((tier) => (tier.reachFile(file)?.tests.size ?? 0) > 0),
        );

        // The named case: the account package's `testing` export, which profile.spec.ts and utils/recipeApi.ts import.
        const account = 'packages/apps/commise/features/account/src/__fixtures__/index.ts';

        expect(reachingATest).toContain(account);

        for (const file of reachingATest) {
            // A package a service depends on is already global: the whole suite runs, whatever imports it.
            const global = models.serviceDirs.some((dir) => file.startsWith(`${dir}/`));
            const plan = await planChange([file], async () => models, { fullSuite: false });

            for (const tier of [models.web, models.mobile]) {
                expect(plan[tier.name].kind === 'some' || global, `${file} widens the ${tier.name} tier`).toBe(true);

                if (!global && (tier.reachFile(file)?.tests.size ?? 0) > 0) {
                    const selection = plan[tier.name];
                    const selected = selection.kind === 'some' ? selection.picks.length : Number.POSITIVE_INFINITY;

                    expect(selected, `${file} reaches a ${tier.name} test but selects none`).toBeGreaterThan(0);
                }
            }
        }
    });
});
