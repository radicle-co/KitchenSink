/**
 * Integration tier for the Maestro screen recorder, over the REAL tree: every screen the navigator or the auth gate
 * registers records itself under its own name in `maestroFlowScreens.tsv`, and the recorder cannot reach a production
 * bundle.
 *
 * Why a source scan and not a render: the hook is the whole contract, and a screen that forgets it is silent in exactly
 * the way the after-run check cannot tell from a flow that never reached it. The unit tests pin what the hook does; this
 * pins that every registry screen calls it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registeredMobileScreens } from '@kitchensink/e2e-plan/registeredMobileScreens';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const MOBILE_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const REPO = join(MOBILE_DIR, '../../../..');
const read = (path: string): string => readFileSync(join(MOBILE_DIR, path), 'utf8');

/** Screen names the flow registry lists. */
function tsvScreens(): readonly string[] {
    const names = read('tests/e2e/maestroFlowScreens.tsv')
        .split('\n')
        .filter((line) => line !== '' && !line.startsWith('#'))
        .flatMap((line) => (line.split('\t')[1] ?? '').split(',').map((name) => name.trim()));

    return [...new Set(names)].sort();
}

const moduleOf = (name: string): string | undefined =>
    ['.native.tsx', '.tsx', '.native.ts', '.ts']
        .map((ext) => `src/screens/${name}${ext}`)
        .find((file) => existsSync(join(MOBILE_DIR, file)));

// The registered screens are the selector's own (`mobileRegistry`), not a second scan of the navigator's import paths.
const registered = await registeredMobileScreens(REPO);

describe('the screen recorder reaches every registry screen', () => {
    it('finds the registry screens it is meant to check', () => {
        expect(registered.length).toBeGreaterThanOrEqual(10);
    });

    it.each([...new Set([...registered, ...tsvScreens()])])('%s calls useScreenTrace with its own name', (name) => {
        const file = moduleOf(name);

        expect(file, `${name} has no module in src/screens`).toBeDefined();
        expect(read(file ?? '')).toContain(`useScreenTrace('${name}')`);
    });
});

describe('a production build carries none of the recorder', () => {
    const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
        cwd: REPO,
        encoding: 'utf8',
    })
        .split('\0')
        .filter((file) => file !== '' && existsSync(join(REPO, file)));
    const mentions = (needle: string): string[] =>
        tracked
            .filter((file) => /\.(ts|tsx|cjs|js|mjs|json|sh|yml)$/u.test(file))
            .filter((file) => readFileSync(join(REPO, file), 'utf8').includes(needle));
    const isTest = (file: string): boolean => /(^|\/)(__tests__|tests)\//u.test(file);

    it('names the build flag only in the build script, the Metro config and the key that hashes it', () => {
        const where = mentions('COMMISE_SCREEN_TRACE').filter((file) => !isTest(file));

        expect(where.map((file) => relative('packages/apps/commise/mobile', file)).sort()).toEqual([
            'metro.config.cjs',
            'scripts/buildTestApp.sh',
            'turbo.json',
        ]);
    });

    it('hashes the flag into the content key of both test apps, so a cached app from before records nothing is rebuilt', () => {
        // turbo.json is JSONC; TypeScript's own parser reads the comments, so no regex has to strip them.
        const turbo = ts.parseConfigFileTextToJson('turbo.json', read('turbo.json')).config as {
            tasks: Record<string, { env: string[] }>;
        };

        expect(turbo.tasks['testApp:android']?.env).toContain('COMMISE_SCREEN_TRACE');
        expect(turbo.tasks['testApp:ios']?.env).toContain('COMMISE_SCREEN_TRACE');
    });

    it('writes the log line in one source file only', () => {
        const where = mentions('console.error(`COMMISE_SCREEN').filter((file) => !isTest(file));

        expect(where.filter((file) => file.startsWith('packages/apps/'))).toEqual([
            'packages/apps/commise/mobile/src/screenTrace/useScreenTrace.maestro.ts',
        ]);
    });

    it('keeps the Null Object free of any logging', () => {
        const source = ts.createSourceFile(
            'useScreenTrace.ts',
            read('src/screenTrace/useScreenTrace.ts'),
            ts.ScriptTarget.Latest,
        );
        const hook = source.statements.find(ts.isFunctionDeclaration);

        expect(hook?.name?.text).toBe('useScreenTrace');
        expect(hook?.body?.statements).toHaveLength(0);
        expect(source.statements.filter(ts.isImportDeclaration)).toHaveLength(0);
    });

    it('lets no source import a twin by name: only Metro may pick one', () => {
        const importers = globSync('{src,App.tsx}/**/*.{ts,tsx}', { cwd: MOBILE_DIR }).filter((file) =>
            /from '[^']*\.maestro(\.js)?'/u.test(read(file)),
        );

        expect(importers).toEqual([]);
    });
});
