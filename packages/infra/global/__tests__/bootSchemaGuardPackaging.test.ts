// @vitest-environment node
/**
 * Repo-wide guard: **the boot-time schema check can actually find the migrations it checks against.**
 *
 * ## Why this needs a gate rather than care
 *
 * Each service's `schemaCurrency.ts` resolves this release's `.sql` as its OWN SIBLING — one path that is
 * correct both from source and inside the image, because the build mirrors `src/` into `dist/src/` and the
 * Dockerfile copies the SQL to the matching place. That is the whole reason the module lives beside
 * `migrations/` instead of anywhere more natural.
 *
 * ⛔ Get the copy wrong and NOTHING FAILS. The check ships in `warn` (a boot assertion that fails closed can
 * crash-loop a service), so a missing directory produces one log line per start and a guard permanently
 * unable to see the thing it was added to see — green everywhere, useful nowhere. And the day someone sets
 * `SCHEMA_CURRENCY_MODE=enforce`, the same mistake refuses every boot, on a release that changed nothing
 * about it.
 *
 * ⛔ IT ENUMERATES NOTHING. The subjects are the `schemaCurrency.ts` modules found in the tree, the source
 * directory is derived from each module's own location, and the expected COPY destination is derived from
 * that. A fourth service is covered the day it lands, and none of the three names appears here except as
 * the anchor.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** One service's boot-guard module, with everything derived from where it sits. */
interface BootGuardModule {
    /** Repo-relative path of the module. */
    readonly file: string;
    /** The service package directory, e.g. `packages/services/recipe-service`. */
    readonly servicePackage: string;
    /** Repo-relative path of the migrations directory that must sit beside it. */
    readonly sourceMigrations: string;
    /** Repo-relative path the Dockerfile must copy them to, mirroring `src/` into `dist/src/`. */
    readonly imageMigrations: string;
    readonly contents: string;
}

/** Every boot-guard module in the tree, found rather than listed. */
function bootGuardModules(): readonly BootGuardModule[] {
    return globSync('packages/services/*/src/**/schemaCurrency.ts', { cwd: REPO_ROOT, ignore: '**/node_modules/**' })
        .sort()
        .map((file) => {
            const service = file.split('/')[2] ?? '';
            const servicePackage = `packages/services/${service}`;
            const relativeToSrc = path.posix.dirname(file).slice(`${servicePackage}/src/`.length);

            return {
                file,
                servicePackage,
                sourceMigrations: path.posix.join(servicePackage, 'src', relativeToSrc, 'migrations'),
                imageMigrations: path.posix.join(servicePackage, 'dist/src', relativeToSrc, 'migrations'),
                contents: readFileSync(path.join(REPO_ROOT, file), 'utf8'),
            };
        });
}

describe('the boot schema check can find its own migrations', () => {
    it('finds the modules at all — a vacuous pass here would assert nothing below', () => {
        // ⛔ The ANCHOR. Every assertion below is a filter over this list; a glob that stopped matching would
        // turn them into assertions over nothing, which is the one way a guard like this rots unnoticed.
        expect(bootGuardModules().map((module) => module.servicePackage)).toStrictEqual([
            'packages/services/food-service',
            'packages/services/identity',
            'packages/services/recipe-service',
        ]);
    });

    it('resolves the migrations as its own SIBLING, which is what makes one path work in both places', () => {
        // A module that probed a list of candidate paths would carry a branch only ever taken in one of the
        // two environments — the "invisible if you built before" class this repo has been bitten by.
        const wrong = bootGuardModules()
            .filter(
                (module) =>
                    !/join\(dirname\(fileURLToPath\(import\.meta\.url\)\), 'migrations'\)/u.test(module.contents),
            )
            .map((module) => module.file);

        expect(wrong, 'these modules do not resolve `migrations` beside themselves').toStrictEqual([]);
    });

    it('sits beside a REAL migrations directory holding .sql', () => {
        const empty = bootGuardModules()
            .filter((module) => {
                const dir = path.join(REPO_ROOT, module.sourceMigrations);

                return !existsSync(dir) || readdirSync(dir).filter((file) => file.endsWith('.sql')).length === 0;
            })
            .map((module) => `${module.file}: no .sql beside it at ${module.sourceMigrations}`);

        expect(empty).toStrictEqual([]);
    });

    it('⛔ has its migrations COPIED into the image, at the path the compiled module will resolve', () => {
        const missing = bootGuardModules().flatMap((module) => {
            const dockerfile = path.join(REPO_ROOT, module.servicePackage, 'Dockerfile');

            if (!existsSync(dockerfile)) {
                return [`${module.servicePackage}: has a boot schema check but no Dockerfile to package it`];
            }

            const expected = `COPY ${module.sourceMigrations} ./${module.imageMigrations}`;

            return readFileSync(dockerfile, 'utf8').includes(expected)
                ? []
                : [
                      `${module.servicePackage}/Dockerfile is missing:\n    ${expected}\n` +
                          'Without it the boot check reports a packaging fault on every start — silently, ' +
                          'because it ships in `warn` — and refuses every boot the day anyone sets ' +
                          'SCHEMA_CURRENCY_MODE=enforce.',
                  ];
        });

        expect(missing).toStrictEqual([]);
    });

    it('⛔ can be FLIPPED — every such service declares SCHEMA_CURRENCY_MODE on its task definition', () => {
        // ⛔ A soak with no ending is just a permanently disabled check. The mode ships as `warn` and the
        // flip to `enforce` has to be a DEPLOY-TIME setting: if the only way to arm it were editing three
        // services' source, nobody would, and the guard would sit reporting into a log forever.
        //
        // Asserted on the STACK SOURCE, like everything else in this file, and on the shared resolver
        // rather than on the literal: `schemaCurrencyEnvironment` normalises an unrecognised value to
        // `warn` at synth using the SAME function the running service calls, so a deploy cannot set a value
        // the runtime silently ignores.
        const missing = bootGuardModules().flatMap((module) => {
            const stacks = globSync(`${module.servicePackage}/infra/lib/*ServiceStack.ts`, {
                cwd: REPO_ROOT,
                ignore: '**/node_modules/**',
            });

            if (stacks.length === 0) {
                return [`${module.servicePackage}: has a boot schema check but no service stack to configure it`];
            }

            return stacks
                .filter(
                    (stack) =>
                        !readFileSync(path.join(REPO_ROOT, stack), 'utf8').includes('schemaCurrencyEnvironment('),
                )
                .map(
                    (stack) =>
                        `${stack}: its tasks run the boot schema check but the stack never sets ` +
                        'SCHEMA_CURRENCY_MODE, so the mode can never be moved off `warn` without a code change',
                );
        });

        expect(missing).toStrictEqual([]);
    });

    it('runs the check BEFORE the server listens, in every service that has one', () => {
        // ⛔ Ordering is the point. Once the mode is `enforce`, a refusal must happen before the task can be
        // registered healthy and take traffic; after `listen` it would serve requests against a schema it
        // had already decided was wrong.
        const late = bootGuardModules().flatMap((module) => {
            const source = readFileSync(path.join(REPO_ROOT, module.servicePackage, 'src/main.ts'), 'utf8');
            const check = source.search(/verify\w*SchemaCurrent\(/u);
            const listen = source.search(/app\.listen\(/u);

            if (check === -1) {
                return [`${module.servicePackage}/src/main.ts never calls its schema-currency check`];
            }

            return check < listen ? [] : [`${module.servicePackage}/src/main.ts checks the schema after listen()`];
        });

        expect(late).toStrictEqual([]);
    });
});
