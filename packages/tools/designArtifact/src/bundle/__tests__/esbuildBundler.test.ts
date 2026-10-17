import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COMMISE_ROOT } from '../../config.js';
import { isDesignArtifactError } from '../../errors.js';
import type { BundleRequest } from '../bundler.js';
import { EsbuildBundler, esbuildOptionsFor } from '../esbuildBundler.js';

const aliasesFor = (platform: 'web' | 'native'): Readonly<Record<string, string>> =>
    platform === 'web' ? { 'next/link': '/shims/nextLink.tsx' } : { 'react-native': '/shims/reactNative.ts' };

const request = (platform: 'web' | 'native', resolveDir = '/work'): BundleRequest => ({
    entrySource: 'export const a = 1;',
    globalName: 'G',
    platform,
    resolveDir,
});

describe('esbuildOptionsFor', () => {
    it('describes a web build: web tsconfig, web aliases, no `global` rewrite', () => {
        const options = esbuildOptionsFor(request('web', `${COMMISE_ROOT}/web`), aliasesFor);

        expect(options).toMatchObject({
            bundle: true,
            format: 'iife',
            globalName: 'G',
            platform: 'browser',
            write: false,
            jsx: 'automatic',
            absWorkingDir: `${COMMISE_ROOT}/web`,
            tsconfig: `${COMMISE_ROOT}/web/tsconfig.json`,
            alias: { 'next/link': '/shims/nextLink.tsx' },
            stdin: { contents: 'export const a = 1;', resolveDir: `${COMMISE_ROOT}/web`, loader: 'ts' },
        });
        expect(options.define).not.toHaveProperty('global');
        expect(options.resolveExtensions).toBeUndefined();
    });

    it('describes a native build: native aliases, `global` rewritten to window, .web extensions first', () => {
        const options = esbuildOptionsFor(request('native', `${COMMISE_ROOT}/mobile`), aliasesFor);

        expect(options.alias).toEqual({ 'react-native': '/shims/reactNative.ts' });
        expect(options.define?.['global']).toBe('window');
        expect(options.tsconfig).toBeUndefined();
        expect(options.resolveExtensions?.slice(0, 3)).toEqual(['.web.tsx', '.web.ts', '.web.js']);
        expect(options.resolveExtensions).toContain('.tsx');
    });

    it.each(['web', 'native'] as const)('defines the process and dev flags at build time on %s', (platform) => {
        expect(esbuildOptionsFor(request(platform), aliasesFor).define).toMatchObject({
            'process.env.NODE_ENV': '"production"',
            __DEV__: 'false',
        });
    });

    it('defines EXPO_OS as ios on native only: a web build must not claim to be an iOS app', () => {
        expect(esbuildOptionsFor(request('native'), aliasesFor).define).toMatchObject({
            'process.env.EXPO_OS': '"ios"',
        });
        expect(esbuildOptionsFor(request('web'), aliasesFor).define).not.toHaveProperty('process.env.EXPO_OS');
    });

    it('asks for a metafile, which is where the bundle’s real inputs come from', () => {
        expect(esbuildOptionsFor(request('web'), aliasesFor).metafile).toBe(true);
    });

    it.each(['web', 'native'] as const)('registers the runtime-globals plugin on %s', (platform) => {
        const names = esbuildOptionsFor(request(platform), aliasesFor).plugins?.map((plugin) => plugin.name);

        expect(names?.[0]).toBe('runtimeGlobals');
    });

    it('registers the native-first plugin on native only, after runtime globals', () => {
        const native = esbuildOptionsFor(request('native'), aliasesFor).plugins?.map((plugin) => plugin.name);
        const web = esbuildOptionsFor(request('web'), aliasesFor).plugins?.map((plugin) => plugin.name);

        expect(native).toEqual(['runtimeGlobals', 'nativeFirst']);
        expect(web).toEqual(['runtimeGlobals']);
    });

    it('asks the alias source for the request platform only', () => {
        const asked: string[] = [];

        esbuildOptionsFor(request('native'), (platform) => {
            asked.push(platform);

            return {};
        });

        expect(asked).toEqual(['native']);
    });
});

describe('EsbuildBundler', () => {
    let dir = '';

    beforeAll(() => {
        dir = realpathSync(mkdtempSync(join(tmpdir(), 'esbuildBundler-')));
        writeFileSync(join(dir, 'rn.ts'), "export const View = 'shim-view';");
        writeFileSync(join(dir, 'tsconfig.json'), '{}');
    });

    afterAll(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    const run = (code: string): Record<string, unknown> => {
        const context = { window: {}, G: undefined as unknown };

        runInNewContext(`${code}\nthis.G = G;`, context);

        return context.G as Record<string, unknown>;
    };

    it('builds a self-contained IIFE assigned to the requested global', async () => {
        const bundler = new EsbuildBundler(() => ({}));
        const { script: code } = await bundler.bundle({
            ...request('web', dir),
            entrySource: 'export const answer = 42;',
        });

        expect(code).toMatch(/^var G = /u);
        expect(run(code)['answer']).toBe(42);
    });

    it('applies the injected alias map for the platform', async () => {
        const bundler = new EsbuildBundler(() => ({ 'react-native': join(dir, 'rn.ts') }));
        const { script: code } = await bundler.bundle({
            ...request('native', dir),
            entrySource: "import { View } from 'react-native'; export { View };",
        });

        expect(run(code)['View']).toBe('shim-view');
    });

    it('returns the source files it read, as absolute paths, without stdin or dependencies', async () => {
        writeFileSync(join(dir, 'used.ts'), 'export const used = 1;');
        const bundler = new EsbuildBundler(() => ({}));
        const { inputs } = await bundler.bundle({
            ...request('web', dir),
            entrySource: "export { used } from './used.js';",
        });

        expect(inputs).toEqual([join(dir, 'used.ts')]);
    });

    it('replaces process.env and __DEV__ at build time, so nothing reads window.process at runtime', async () => {
        const bundler = new EsbuildBundler(() => ({}));
        const { script: code } = await bundler.bundle({
            ...request('native', dir),
            entrySource:
                'export const env = process.env.NODE_ENV; export const os = process.env.EXPO_OS; export const dev = __DEV__; export const g = typeof global;',
        });

        expect(run(code)).toMatchObject({ env: 'production', os: 'ios', dev: false });
        expect(code).not.toMatch(/window\.process/u);
    });

    it('fails with bundle-failed and esbuild’s message when an import does not resolve', async () => {
        const bundler = new EsbuildBundler(() => ({}));

        expect.assertions(3);

        try {
            await bundler.bundle({
                ...request('web', dir),
                entrySource: "import 'definitely-not-installed-anywhere';",
            });
        } catch (error) {
            expect(isDesignArtifactError(error)).toBe(true);
            expect(isDesignArtifactError(error) && error.code).toBe('bundle-failed');
            expect(error instanceof Error && error.message).toContain('definitely-not-installed-anywhere');
        }
    });
});
