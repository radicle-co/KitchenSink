// @vitest-environment node
/**
 * A SERVICE THAT SHIPS AS AN IMAGE MAY NOT IMPORT, FROM ITS PRODUCTION SOURCE, A PACKAGE IT DOES NOT DECLARE
 * AS A RUNTIME DEPENDENCY.
 *
 * An image service installs with `npm ci --omit=dev` from its pruned manifest, so a package that resolves on
 * a developer machine only because npm hoisted it to the root is absent at boot: `ERR_MODULE_NOT_FOUND`, a
 * crash loop, and every guard green. Measured 2026-10-01: food-service imported `@nestjs/throttler`, which
 * only recipe-service declared, and `serviceDockerfileDeps`, `prunedImageClosure`,
 * `serviceImageWorkspaceModules` and lint all passed. `turbo boundaries` sees the class, but only in the local
 * GATE, never in CI.
 *
 * The rule is `import-x/no-extraneous-dependencies` with `devDependencies: false`, switched on by the shared
 * config for every package that carries a `Dockerfile`, so a new image service is covered the day it exists.
 * A bundled Lambda inlines its imports, so it is out of scope.
 *
 * Probes are virtual (`lintText` at a `src/…` path) with type-aware parsing off, for the reasons
 * `restrictedImportsOverride.test.ts` records. Three directions per service: a dev-only package is reported
 * from production source, a runtime package is not, and a dev-only package is not reported from a unit test.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const RULE = 'import-x/no-extraneous-dependencies';

interface ImageService {
    readonly dir: string;
    readonly devOnly: string;
    readonly runtime: string;
}

/**
 * Every service directory with a `Dockerfile`, with one package it declares only for development and one it
 * declares for run time, both resolvable from the root `node_modules`. Discovered, never listed.
 *
 * @returns The image services.
 */
function imageServices(): ImageService[] {
    const servicesRoot = path.join(repoRoot, 'packages/services');

    return readdirSync(servicesRoot)
        .map((name) => path.join(servicesRoot, name))
        .filter((dir) => existsSync(path.join(dir, 'Dockerfile')))
        .map((dir) => {
            const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };
            const runtimeNames = Object.keys(manifest.dependencies ?? {});
            const resolvable = (name: string): boolean =>
                !name.startsWith('@types/') && existsSync(path.join(repoRoot, 'node_modules', name, 'package.json'));
            const devOnly = Object.keys(manifest.devDependencies ?? {}).find(
                (name) => !runtimeNames.includes(name) && resolvable(name),
            );
            const runtime = runtimeNames.find((name) => !name.startsWith('@kitchensink/') && resolvable(name));

            if (devOnly === undefined || runtime === undefined) {
                throw new Error(`${dir}: no resolvable dev-only and runtime package to probe with`);
            }

            return { dir, devOnly, runtime };
        });
}

/**
 * Lint one virtual file inside a service and return the messages of the rule under test, refusing a fatal
 * parse so that a probe that never ran cannot read as clean.
 *
 * @param service - The service.
 * @param relativePath - The probe's path inside the service.
 * @param specifier - The package the probe imports.
 * @returns The rule's messages.
 * @sideEffect Loads the service's ESLint config.
 */
async function ruleMessages(service: ImageService, relativePath: string, specifier: string): Promise<string[]> {
    const eslint = new ESLint({
        cwd: service.dir,
        overrideConfig: {
            languageOptions: { parserOptions: { project: false, projectService: false } },
            rules: tseslint.configs.disableTypeChecked.rules ?? {},
        },
    });
    const [result] = await eslint.lintText(`import * as probe from '${specifier}';\n\nexport const used = probe;\n`, {
        filePath: path.join(service.dir, relativePath),
    });

    if (result === undefined) {
        throw new Error(`${service.dir}: ESLint returned no result for ${relativePath}`);
    }

    const fatal = result.messages.filter((message) => message.fatal === true);

    expect(fatal).toEqual([]);

    return result.messages.filter((message) => message.ruleId === RULE).map((message) => message.message);
}

describe('an image service declares every package its production source imports', () => {
    const services = imageServices();

    it('discovers the image services (a vacuous pass here would hide every case below)', () => {
        expect(services.length).toBeGreaterThanOrEqual(3);
    });

    it.each(services)(
        '$dir reports a dev-only package imported from production source',
        async (service) => {
            expect(await ruleMessages(service, 'src/zzRuntimeProbe.ts', service.devOnly)).toHaveLength(1);
        },
        60_000,
    );

    it.each(services)(
        '$dir accepts a declared runtime package in production source',
        async (service) => {
            expect(await ruleMessages(service, 'src/zzRuntimeProbe.ts', service.runtime)).toEqual([]);
        },
        60_000,
    );

    it.each(services)(
        '$dir accepts a dev-only package in a unit test',
        async (service) => {
            expect(await ruleMessages(service, 'src/__tests__/zzRuntimeProbe.test.ts', service.devOnly)).toEqual([]);
        },
        60_000,
    );
});
