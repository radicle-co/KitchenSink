// @vitest-environment node
/**
 * Every package that consumes `@radicle-co/*` resolves the scope from its OWN directory.
 *
 * ## The failure this was written after
 *
 * The scope mapping lived only in the repo-root `.npmrc`. npm reads a project `.npmrc` from the package
 * directory and does **not** walk up, so both shapes CI uses to install a CDK package lost it:
 *
 *     npm config get @radicle-co:registry                    (repo root)  -> https://npm.pkg.github.com
 *     cd packages/services/food-service/infra && npm config get …         -> undefined
 *     npm config get … --prefix packages/services/food-service/infra      -> undefined
 *
 * Measured, not reasoned about. Every CDK install would therefore have gone to registry.npmjs.org and 404'd
 * on a package published to GitHub Packages — after the publish was fixed, and after the deploy jobs were
 * given a token. Three separate failures in one chain, each of which would have surfaced one red push at a
 * time.
 *
 * ⛔ `actions/setup-node`'s `registry-url` is NOT the fix, which is why its absence is asserted here. That
 * input also rewrites the DEFAULT registry, so `aws-cdk-lib` and every other public dependency would be
 * fetched from GitHub Packages too. Scope mapping and auth belong in the package's own `.npmrc`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCOPE = '@radicle-co';

/** Packages that declare a dependency in the published scope, and therefore must resolve it. */
function consumers(): readonly string[] {
    return execFileSync('git', ['ls-files', '*/package.json'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .filter((file) => {
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                dependencies?: Record<string, string>;
                devDependencies?: Record<string, string>;
            };

            return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})].some(
                (name) => name.startsWith(`${SCOPE}/`),
            );
        })
        .map((file) => path.posix.dirname(file));
}

describe('the published scope resolves from the directory npm is invoked in', () => {
    it('is not vacuous: there are consumers of the scope', () => {
        expect(consumers().length).toBeGreaterThan(5);
    });

    it.each(consumers().map((dir) => [dir] as const))('%s maps the scope in its own .npmrc', (dir) => {
        const npmrc = path.join(repoRoot, dir, '.npmrc');

        expect(
            existsSync(npmrc),
            `${dir} depends on ${SCOPE}/* but has no .npmrc. npm reads a project .npmrc from the package ` +
                'directory and does NOT walk up, so a mapping that exists only at the repo root is invisible ' +
                'to `cd <dir> && npm install` and to `npm install --prefix <dir>` — both of which CI uses.',
        ).toBe(true);

        const text = readFileSync(npmrc, 'utf8');

        expect(text, 'the scope must point at GitHub Packages').toMatch(
            new RegExp(`${SCOPE}:registry\\s*=\\s*https://npm\\.pkg\\.github\\.com`, 'u'),
        );
        expect(text, 'GitHub Packages authenticates even a public read, so the token line must be present').toMatch(
            /\/\/npm\.pkg\.github\.com\/:_authToken=/u,
        );
    });

    it('no workflow sets setup-node `registry-url`, which would hijack the default registry', () => {
        const offenders = execFileSync('git', ['ls-files', '.github/workflows/*.yml'], {
            cwd: repoRoot,
            encoding: 'utf8',
        })
            .split('\n')
            .filter(Boolean)
            .flatMap((file) => {
                const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                    jobs?: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
                };
                const steps = Object.values(doc.jobs ?? {}).flatMap((job) => job.steps ?? []);

                return steps.some(
                    (step) => (step.uses ?? '').includes('actions/setup-node') && step.with?.['registry-url'],
                )
                    ? [file]
                    : [];
            });

        expect(
            offenders,
            '`registry-url` rewrites the DEFAULT registry, not just the scope, so every public dependency ' +
                'would be fetched from GitHub Packages. Put the scope and the auth token in the consuming ' +
                "package's own .npmrc instead.",
        ).toEqual([]);
    });
});
