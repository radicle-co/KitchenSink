import { describe, expect, it } from 'vitest';

import { classifyPath, isTestFile, selectTier, type FileImpact } from '../src/impactPolicy.js';
import type { Reached } from '../src/reachability.js';

describe('classifyPath', () => {
    it.each([
        'docs/architecture/decisions/0083-impacted-tests.md',
        'specs/001-commise-recipe-app/spec.md',
        'README.md',
        'packages/apps/commise/web/README.md',
        'CLAUDE.md',
        'packages/apps/commise/web/src/components/__tests__/Panel.test.tsx',
        'packages/apps/commise/web/tests/__integration__/shell.integration.test.tsx',
        'packages/apps/commise/web/vitest.integration.config.ts',
        'packages/tools/repoGuards/__tests__/anything.test.ts',
        'packages/tools/repoGuards/tests/deployGate.integration.test.ts',
    ])('says %s cannot change a test result', (path) => {
        expect(classifyPath(path)).toEqual({ kind: 'irrelevant' });
    });

    it.each([
        ['packages/services/recipe/src/recipes/recipes.service.ts', /service/u],
        ['packages/schemas/recipe/src/schemas.ts', /schema/u],
        ['packages/clients/food-service/src/client.ts', /client/u],
        ['package-lock.json', /root/u],
        ['package.json', /root/u],
        ['turbo.json', /turbo/u],
        ['packages/apps/commise/mobile/turbo.json', /turbo/u],
        ['packages/apps/commise/web/playwright.config.ts', /Playwright/u],
        ['packages/apps/commise/mobile/.maestro/config.yaml', /Maestro/u],
    ])('says %s needs the whole suite', (path, reason) => {
        const result = classifyPath(path);

        expect(result?.kind).toBe('global');
        expect(result?.kind === 'global' ? result.reason : '').toMatch(reason);
    });

    it.each([
        'docs/mockups/screens/screenHome.html',
        'docs/plans/x.png',
        'specs/001-commise-recipe-app/mockup.json',
        'packages/tools/e2ePlan/src/planChange.ts',
        'packages/tools/e2e-fixtures/__fixtures__/make.ts',
        'packages/apps/commise/ui/src/testing/tamaguiTesting.native.tsx',
        '.github/workflows/_ci.yml',
        'packages/apps/commise/web/src/components/app/AppShell.tsx',
        'packages/apps/commise/ui/src/button/Button.tsx',
        'packages/apps/commise/mobile/.maestro/home.yaml',
        'packages/apps/commise/web/src/app/globals.css',
        '.github/workflows/_ci.yml',
    ])('leaves %s to the import graph', (path) => {
        expect(classifyPath(path)).toBeUndefined();
    });

    it('does not treat a folder named docs inside a package as the docs folder', () => {
        expect(classifyPath('packages/apps/commise/web/src/docs/Panel.tsx')).toBeUndefined();
    });
});

const reached = (parts: Partial<{ screens: string[]; tests: string[]; roots: string[] }> = {}): Reached => ({
    screens: new Set(parts.screens ?? []),
    tests: new Set(parts.tests ?? []),
    roots: parts.roots ?? [],
});

const coverage = new Map<string, ReadonlySet<string>>([
    ['a.spec.ts', new Set(['/a', '/'])],
    ['b.spec.ts', new Set(['/b', '/'])],
    ['everywhere.spec.ts', new Set(['*'])],
]);
const ALL_SCREENS = ['/', '/a', '/b'];

const select = (impacts: Readonly<Record<string, FileImpact>>, extra: { fullSuite?: boolean } = {}) =>
    selectTier({
        tier: 'web',
        impacts: new Map(Object.entries(impacts)),
        coverage,
        screens: ALL_SCREENS,
        fullSuite: extra.fullSuite ?? false,
    });

const ids = (selection: ReturnType<typeof select>): readonly string[] =>
    selection.kind === 'some' ? selection.picks.map((pick) => pick.id) : ['<all>'];

describe('isTestFile', () => {
    it.each([
        ['a.test.ts', true],
        ['x/__tests__/helper.ts', true],
        ['x/vitest.config.ts', true],
        ['x/vitest.integration.config.ts', true],
        ['x/tests/e2e/home.spec.ts', false],
        ['x/src/testing/stub.ts', false],
        ['x/__fixtures__/make.ts', false],
    ])('%s -> %s', (path, expected) => {
        expect(isTestFile(path)).toBe(expected);
    });
});

describe('selectTier', () => {
    it('selects nothing when every change is irrelevant', () => {
        expect(select({ 'docs/a.md': { kind: 'irrelevant' } })).toEqual({ kind: 'some', picks: [] });
    });

    it('selects nothing when nothing changed', () => {
        expect(select({})).toEqual({ kind: 'some', picks: [] });
    });

    it('selects the whole tier, naming the file, for a global change', () => {
        const selection = select({ 'package-lock.json': { kind: 'global', reason: 'root configuration' } });

        expect(selection).toEqual({ kind: 'all', reasons: ['package-lock.json: root configuration'] });
    });

    it('selects the whole tier for a file the graph does not reach', () => {
        const selection = select({ 'x.ts': { kind: 'unreached' } });

        expect(selection.kind).toBe('all');
        expect(selection.kind === 'all' ? selection.reasons[0] : '').toContain('x.ts');
    });

    it('selects the tests whose row names a screen the change reaches', () => {
        const selection = select({ 'leaf.ts': { kind: 'reaches', tiers: { web: reached({ screens: ['/a'] }) } } });

        expect(ids(selection)).toEqual(['a.spec.ts', 'everywhere.spec.ts']);
    });

    it('selects every test for a change that reaches every screen, rows with * included', () => {
        const selection = select({ 'ui.ts': { kind: 'reaches', tiers: { web: reached({ screens: ALL_SCREENS }) } } });

        expect(ids(selection)).toEqual(['a.spec.ts', 'b.spec.ts', 'everywhere.spec.ts']);
    });

    it('selects a test that imports the changed file, even if its row names no reached screen', () => {
        const selection = select({ 'util.ts': { kind: 'reaches', tiers: { web: reached({ tests: ['b.spec.ts'] }) } } });

        expect(ids(selection)).toEqual(['b.spec.ts']);
    });

    it('selects the whole tier when the change reaches a root in this tier', () => {
        const selection = select({ 'cfg.ts': { kind: 'reaches', tiers: { web: reached({ roots: ['layout.tsx'] }) } } });

        expect(selection).toEqual({
            kind: 'all',
            reasons: ['cfg.ts reaches layout.tsx, which every screen runs through'],
        });
    });

    it('does not widen this tier for a root the OTHER tier reaches', () => {
        const selection = select({ 'cfg.ts': { kind: 'reaches', tiers: { mobile: reached({ roots: ['App.tsx'] }) } } });

        expect(selection).toEqual({ kind: 'some', picks: [] });
    });

    it('gives a pick every reason it was chosen for', () => {
        const selection = select({
            'one.ts': { kind: 'reaches', tiers: { web: reached({ screens: ['/a'] }) } },
            'two.ts': { kind: 'reaches', tiers: { web: reached({ screens: ['/'] }) } },
        });
        const pick = selection.kind === 'some' ? selection.picks.find((entry) => entry.id === 'a.spec.ts') : undefined;

        expect(pick?.because).toContain('one.ts');
        expect(pick?.because).toContain('two.ts');
    });

    it('lets one widening change outvote any number of narrow ones', () => {
        const selection = select({
            'leaf.ts': { kind: 'reaches', tiers: { web: reached({ screens: ['/a'] }) } },
            'docs/a.md': { kind: 'irrelevant' },
            'x.ts': { kind: 'unreached' },
        });

        expect(selection.kind).toBe('all');
    });

    it('selects the whole tier, saying why, when FULL_SUITE is set', () => {
        const selection = select({ 'docs/a.md': { kind: 'irrelevant' } }, { fullSuite: true });

        expect(selection).toEqual({ kind: 'all', reasons: ['FULL_SUITE=1'] });
    });

    it('widens a tier the graph could not place the file in, unless the file provably belongs to the other platform', () => {
        const selection = select({
            'shared/x.ts': { kind: 'reaches', tiers: { mobile: reached({ screens: ['/a'] }) }, unattributed: ['web'] },
        });

        expect(selection).toEqual({
            kind: 'all',
            reasons: ["shared/x.ts: not in the web import graph, and not provably the other platform's"],
        });
    });

    it('widens, rather than skips, a kind of impact it does not know', () => {
        const selection = select({ 'x.ts': { kind: 'mystery' } as unknown as FileImpact });

        expect(selection.kind).toBe('all');
    });
});
