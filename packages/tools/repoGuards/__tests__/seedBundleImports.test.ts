// @vitest-environment node
/**
 * ⛔ THE SEED FUNCTION SHIPS NO HTTP CODE OF ITS OWN (curated catalog plan U3, R38).
 *
 * R38: the seed step calls no USDA API and no third-party host. The function is VPC-attached and reaches the internet
 * through ADR-0004's NAT, so nothing in the network stops it; only what its bundle holds does. So this builds the seed
 * asset exactly as the pipeline does (`seedAssetBuild.mjs`) and reads esbuild's metafile, keeping only the modules
 * whose code SURVIVES into `handler.js` (`bytesInOutput > 0`): a module the bundler reached and then dropped ships
 * nothing and calls nothing.
 *
 * Two rules over what survives:
 *
 * 1. No first-party module (anything outside `node_modules`: food's source and every workspace package it reaches)
 *    calls the global `fetch`, or imports `undici` or an HTTP module.
 * 2. Only the AWS SDK's own transport (`@smithy/*`, `@aws-sdk/*`) may import an HTTP module, and no `undici` ships.
 *    The IAM auth-token signer's credential chain bundles those providers; in Lambda the credentials come from the
 *    environment, and the only host they could ever address is AWS's.
 *
 * ⚠️ Why not the literal "no HTTP client in the bundle": rule 2's exception is unavoidable, and a rule the tree breaks
 * on day one is a rule somebody suppresses. And why not "no module under `packages/clients/`": the seed reads
 * `normalizeNdbNumber` from the USDA client package, which is pure and right to share with the API client; what
 * matters is that the client CLASS does not ship, which rule 1 checks file by file.
 *
 * DESIGN PATTERN: Specification over the bundler's own metafile, fired at fixture metafiles below as well as at the
 * real build.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const FOOD = path.join(repoRoot, 'packages', 'services', 'food-service');
const BUILDER = pathToFileURL(path.join(FOOD, 'seedAssetBuild.mjs')).href;

/** The slice of esbuild's metafile these rules read. */
interface Metafile {
    readonly inputs: Readonly<Record<string, { readonly imports: readonly { readonly path: string }[] }>>;
    readonly outputs: Readonly<
        Record<string, { readonly inputs: Readonly<Record<string, { readonly bytesInOutput: number }>> }>
    >;
}

/** A module path an HTTP request can be made through. `net`/`tls` are not here: `pg` connects through them. */
const HTTP_MODULE = /^(?:node:)?(?:http|https|http2)$|^undici(?:\/|$)/u;

/** The AWS SDK's own transport, which the signer's credential chain carries. */
const AWS_TRANSPORT = /node_modules\/@(?:smithy|aws-sdk)\//u;

/** A call to the global `fetch` — not a method named `fetch`, nor `fetchByKey(`. */
const GLOBAL_FETCH_CALL = /(?<![.\w$])fetch\s*\(/u;

/**
 * The modules whose code survives into the handler bundle, with what each imports. Pure.
 *
 * @param metafile - esbuild's metafile.
 * @returns Each surviving module's path, relative to the package root, and its import paths.
 */
function survivingModules(metafile: Metafile): readonly { readonly module: string; readonly imports: string[] }[] {
    return Object.entries(metafile.outputs)
        .filter(([output]) => output.endsWith('handler.js'))
        .flatMap(([, output]) => Object.entries(output.inputs))
        .filter(([, contribution]) => contribution.bytesInOutput > 0)
        .map(([module]) => ({ module, imports: (metafile.inputs[module]?.imports ?? []).map((entry) => entry.path) }));
}

/**
 * Every R38 violation in a metafile. Pure apart from `readSource`.
 *
 * @param metafile - esbuild's metafile.
 * @param readSource - Reads a first-party module's source, by its metafile path.
 * @returns One finding per offending module.
 */
function httpViolations(metafile: Metafile, readSource: (module: string) => string): readonly string[] {
    return survivingModules(metafile).flatMap(({ module, imports }) => {
        const http = imports.filter((entry) => HTTP_MODULE.test(entry));

        if (module.includes('node_modules/undici/')) {
            return [`${module}: undici ships in the seed bundle`];
        }

        if (module.includes('node_modules/')) {
            return http.length > 0 && !AWS_TRANSPORT.test(module)
                ? [`${module}: a dependency outside the AWS SDK's transport imports ${http.join(', ')}`]
                : [];
        }

        return [
            ...http.map((entry) => `${module}: first-party code imports ${entry}`),
            ...(GLOBAL_FETCH_CALL.test(readSource(module))
                ? [`${module}: first-party code calls the global fetch`]
                : []),
        ];
    });
}

const scratch = mkdtempSync(path.join(tmpdir(), 'seedBundleImports-'));

afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
});

/**
 * Build the real seed asset into a scratch directory, as the pipeline builds it, and return its metafile.
 *
 * @returns The metafile.
 * @sideEffect Runs esbuild in a child `node`.
 */
function buildRealMetafile(): Metafile {
    const run = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            'const { buildSeedAsset } = await import(process.argv[1]); const { metafile } = await buildSeedAsset({ packageRoot: process.argv[2], outdir: process.argv[3] }); process.stdout.write(JSON.stringify(metafile));',
            BUILDER,
            FOOD,
            path.join(scratch, 'distSeed'),
        ],
        { encoding: 'utf8', maxBuffer: 1 << 28 },
    );

    expect(run.status, run.stderr).toBe(0);

    return JSON.parse(run.stdout) as Metafile;
}

/** A metafile in which `module` survives, importing `imports`. */
function fixture(module: string, imports: readonly string[], bytesInOutput = 10): Metafile {
    return {
        inputs: { [module]: { imports: imports.map((entry) => ({ path: entry })) } },
        outputs: { 'distSeed/lambdas/seed/handler.js': { inputs: { [module]: { bytesInOutput } } } },
    };
}

describe('R38: the seed bundle ships no HTTP code of its own', () => {
    let metafile: Metafile | undefined;

    const real = (): Metafile => {
        metafile ??= buildRealMetafile();

        return metafile;
    };

    it('reads a real bundle, so the rules below are not vacuous', { timeout: 120_000 }, () => {
        const modules = survivingModules(real()).map(({ module }) => module);

        expect(modules.length).toBeGreaterThan(100);
        expect(modules).toContain('src/lambdas/seed/handler.ts');
        expect(modules).toContain('src/foods/seed/catalog/catalogSeedTransaction.ts');
        // The rules see imports: `pg` connects through `net`, and the signer's chain through the SDK's HTTP handler.
        expect(survivingModules(real()).some(({ imports }) => imports.includes('net'))).toBe(true);
        expect(survivingModules(real()).some(({ imports }) => imports.some((entry) => HTTP_MODULE.test(entry)))).toBe(
            true,
        );
    });

    it('⛔ holds for the real seed bundle', { timeout: 120_000 }, () => {
        expect(httpViolations(real(), (module) => readFileSync(path.resolve(FOOD, module), 'utf8'))).toStrictEqual([]);
    });

    it.each<[string, Metafile, string, string]>([
        [
            'a first-party module that calls fetch',
            fixture('../../clients/usda/src/UsdaApiClient.ts', []),
            'export const go = () => fetch("https://api.nal.usda.gov");',
            'first-party code calls the global fetch',
        ],
        ['a first-party module that imports node:https', fixture('src/x.ts', ['node:https']), '', 'imports node:https'],
        ['a first-party module that imports undici', fixture('src/x.ts', ['undici']), '', 'imports undici'],
        [
            'a dependency outside the AWS SDK that imports http',
            fixture('../../../node_modules/axios/lib/adapters/http.js', ['http']),
            '',
            'outside the AWS SDK',
        ],
        ['undici itself', fixture('../../../node_modules/undici/index.js', []), '', 'undici ships'],
    ])('⛔ fails %s', (_case, fixtureMetafile, source, finding) => {
        const violations = httpViolations(fixtureMetafile, () => source);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain(finding);
    });

    it.each<[string, Metafile, string]>([
        [
            'the AWS SDK’s HTTP handler',
            fixture('../../../node_modules/@smithy/node-http-handler/dist-cjs/index.js', ['node:https']),
            '',
        ],
        ['pg’s socket', fixture('../../../node_modules/pg/lib/connection.js', ['net', 'tls']), ''],
        ['a method named fetchByKey', fixture('src/x.ts', []), 'this.fetchByKey(key); source.fetch(key);'],
        ['a module the bundler dropped', fixture('src/x.ts', ['undici'], 0), 'fetch("https://x")'],
    ])('does not fail %s', (_case, fixtureMetafile, source) => {
        expect(httpViolations(fixtureMetafile, () => source)).toStrictEqual([]);
    });
});
