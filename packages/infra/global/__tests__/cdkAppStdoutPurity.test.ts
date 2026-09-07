// @vitest-environment node
/**
 * Repo-wide guard: a CDK app entrypoint MUST NOT let a dependency write to STDOUT.
 *
 * ## The failure this pins
 *
 * `.github/scripts/verify-deployment.sh` derives the stacks it verifies by running
 * `npx cdk ls --long --json --app "<the very string the deploy used>"` and reading the result as JSON. That
 * makes an app entrypoint's stdout a MACHINE-READABLE CHANNEL, not a log. `dotenv@17` disagreed: it prints
 *
 *     ◇ injected env (0) from packages/infra/global/.env // tip: ⌘ multiple files { path: [...] }
 *
 * on every `config()` call — including, measured, for a path that does not exist — and all seven CDK app
 * entrypoints in this repository call it before constructing their `App`. So every `cdk ls` emitted one
 * line of advertising ahead of the JSON, `jq` refused the document, and the post-deploy verifier reported
 * NOTHING across `sandbox-deploy.yml`, `prod-deploy.yml`, `sandbox-identity-deploy.yml` and
 * `sandbox-router-deploy.yml`. A vendor shipped an ad into our stdout with no PR and no diff, and the
 * dependency was declared `"dotenv": "*"`.
 *
 * ## Why a guard and not a shared `loadCdkEnv()` helper
 *
 * A helper would give uniformity for the seven call sites that use it, and nothing at all for the eighth
 * that calls `dotenv` directly — which is the shape of the mistake being prevented. This guard DISCOVERS
 * the apps (`cdkApps()`, by content, never a list) and judges whatever they actually do, so it covers the
 * helper case and the direct case identically. Seven literal `quiet: true` flags plus one discovering guard
 * is the honest KISS answer; a new shared module and seven new dependency edges to carry one line is not.
 *
 * ## Why the library is OBSERVED and not merely read
 *
 * The source assertion below can only prove that we ASK for silence. `crfEngineVersionParity.test.ts`
 * records what happens when a guard compares source text to source text: it "passed for years while
 * comparing two agreeing copies of the same wrong string". So the second half runs the INSTALLED dotenv in
 * a child process and looks at its actual stdout — and asserts BOTH directions, because a `quiet` flag that
 * a future release quietly ignores would leave the source assertion green while the pollutant returned. The
 * without-flag case is this file's own mutation test: if dotenv ever stops printing the banner at all, that
 * case fails and tells the next reader the flags may be retired.
 *
 * DESIGN PATTERN: Specification — a predicate over a discovered set, with no membership list of its own.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { cdkApps } from './cdkApps.js';
import { presentFiles, repoRoot } from './serviceSources.js';

/** A `dotenvConfig(...)` / `config(...)` call, however the entrypoint spelled the import. */
const DOTENV_CALL = /\b(?:dotenvConfig|dotenv\.config|config)\s*\(\s*\{([^}]*)\}\s*\)/gu;

/** Manifests that declare `dotenv`, discovered rather than listed. */
function manifestsDeclaringDotenv(): readonly string[] {
    return presentFiles(['package.json', 'packages/**/package.json'])
        .filter((file) => !file.includes('/dist/'))
        .filter((file) => {
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8')) as Record<
                string,
                Record<string, string> | undefined
            >;

            return ['dependencies', 'devDependencies'].some((section) => manifest[section]?.['dotenv'] !== undefined);
        });
}

describe('every CDK app entrypoint keeps stdout machine-readable', () => {
    it('discovers the apps at all — a guard over an empty set proves nothing', () => {
        expect(cdkApps().length).toBeGreaterThan(1);
    });

    it.each(cdkApps())('%s loads its .env QUIETLY', (app) => {
        const source = readFileSync(path.join(repoRoot, app), 'utf8');
        const calls = [...source.matchAll(DOTENV_CALL)];

        if (!source.includes('dotenv')) {
            // An app that never loads a .env cannot be polluted by one. Nothing to assert.
            return;
        }

        expect(calls.length, `${app} imports dotenv but no \`config({ … })\` call was found to check`).toBeGreaterThan(
            0,
        );

        for (const [, options] of calls) {
            expect(
                options,
                `${app} calls dotenv without \`quiet: true\`. dotenv@17 prints a banner to STDOUT, and this file's stdout is parsed as JSON by \`.github/scripts/verify-deployment.sh\` — one advertising line there makes the post-deploy verifier report nothing.`,
            ).toMatch(/quiet\s*:\s*true/u);
        }
    });

    it.each(manifestsDeclaringDotenv())('%s pins dotenv to a range rather than `*`', (manifest) => {
        const parsed = JSON.parse(readFileSync(path.join(repoRoot, manifest), 'utf8')) as Record<
            string,
            Record<string, string> | undefined
        >;
        const declared = parsed['dependencies']?.['dotenv'] ?? parsed['devDependencies']?.['dotenv'];

        // `*` let a MAJOR release land with no lockfile intent and no review. It is not the control — the
        // `quiet: true` flags and the observation below are — but a floating third-party range means CI and
        // a developer can be on different libraries for the same commit, which is what made this defect
        // arrive as a mystery rather than as a diff.
        expect(declared, `${manifest} declares \`"dotenv": "*"\``).not.toBe('*');
    });
});

describe('the INSTALLED dotenv actually honours the flag', () => {
    /**
     * Load a non-existent env file in a child process and return what it wrote to stdout.
     *
     * The path deliberately does not exist: dotenv@17 printed its banner even then, so "there is no .env
     * on this machine" was never protection.
     *
     * @param options - The literal options object, as source text.
     * @returns Whatever the child wrote to stdout.
     * @sideEffect Spawns node.
     */
    function stdoutOf(options: string): string {
        return execFileSync(process.execPath, ['-e', `require('dotenv').config(${options})`], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    }

    it('prints NOTHING with `quiet: true`', () => {
        expect(stdoutOf(`{ path: '/nonexistent/.env', quiet: true }`)).toBe('');
    });

    it('⛔ prints to stdout WITHOUT the flag — so the flags above are load-bearing, not decoration', () => {
        // The mutation test for this whole file. Should a future dotenv stop advertising, this case goes
        // red and says so: the flags may then be retired deliberately rather than rotting in place.
        expect(stdoutOf(`{ path: '/nonexistent/.env' }`)).not.toBe('');
    });
});
