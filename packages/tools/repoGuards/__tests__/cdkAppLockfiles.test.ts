// @vitest-environment node
/**
 * Repo-wide guard: every CDK app installs from a committed lockfile, with `npm ci`.
 *
 * ## The failure this pins
 *
 * The CDK apps live outside the npm workspace, each with its own manifest and `node_modules`. None had a lockfile, and
 * every workflow installed them with `npm install`, which resolves the manifest's ranges again on every run. So the
 * same commit synthesized against a different `aws-cdk-lib` from one run to the next: when 2.277.0 was published with
 * a newer Node runtime, cdk-nag's `AwsSolutions-L1` began to call every pinned `nodejs24.x` Lambda "not latest", and a
 * commit that passed in the morning failed in the afternoon with no change in this repository.
 *
 * ## What is asserted
 *
 * 1. Every CDK app directory has a `package-lock.json` that git tracks. A file that exists only on one machine does not
 *    count.
 * 2. No workflow or composite action installs a CDK app directory with `npm install` (or `npm i`). `npm ci` installs
 *    exactly the lockfile and fails when the lockfile no longer matches the manifest; `npm install` rewrites it in
 *    silence.
 *
 * Both sides are discovered. The apps come from `cdkApps()`, which reads them out of the tree by content, and an
 * install is recognised in each form the workflows use: a step `working-directory`, `--prefix` with a literal path or
 * with a loop variable over the app globs, and `cd` into the directory. A templated `working-directory` (a composite
 * action's `${{ inputs.directory }}`) counts as a CDK install, because the guard cannot see every caller's value and a
 * miss here is the silent direction.
 *
 * DESIGN PATTERN: Specification module over the parsed workflow and action files.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { globSync } from 'glob';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ACTIONS_DIR, cdkApps, WORKFLOWS_DIR, withoutComments } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly 'working-directory'?: string;
}

interface StepSite {
    readonly where: string;
    readonly step: Step;
}

/**
 * The directory that holds each CDK app's manifest: the parent of the entrypoint's `bin/`. Two entrypoints in one
 * package (`packages/infra/global` has `app.ts` and `account.ts`) are one directory. Impure.
 */
function cdkAppDirectories(): readonly string[] {
    return [...new Set(cdkApps().map((entrypoint) => path.posix.dirname(path.posix.dirname(entrypoint))))].toSorted();
}

/** Every step a runner executes, from each workflow job and each composite action. Impure. */
function stepSites(): readonly StepSite[] {
    const files = [...trackedFiles(WORKFLOWS_DIR), ...trackedFiles(ACTIONS_DIR)].filter((file) =>
        /\.ya?ml$/u.test(file),
    );

    return files.flatMap((file) => {
        const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
            jobs?: Record<string, { steps?: Step[] }>;
            runs?: { steps?: Step[] };
        } | null;
        const fromJobs = Object.entries(doc?.jobs ?? {}).flatMap(([job, { steps }]) =>
            (steps ?? []).map((step) => ({ where: `${file} › ${job} › ${step.name ?? '(unnamed)'}`, step })),
        );
        const fromAction = (doc?.runs?.steps ?? []).map((step) => ({
            where: `${file} › ${step.name ?? '(unnamed)'}`,
            step,
        }));

        return [...fromJobs, ...fromAction];
    });
}

/** Whether a step's commands reach a CDK app directory, in any of the forms the workflows use. Impure (globs). */
function targetsCdkApp(step: Step, apps: ReadonlySet<string>): boolean {
    const directory = step['working-directory'];

    if (directory !== undefined && (apps.has(directory) || directory.includes('${{'))) {
        return true;
    }

    const run = withoutComments(step.run ?? '');

    for (const [, prefix] of run.matchAll(/--prefix\s+"?([^"\s]+)"?/gu)) {
        if (prefix !== undefined && apps.has(prefix)) {
            return true;
        }
    }

    for (const [, variable, globs] of run.matchAll(/\bfor\s+(\w+)\s+in\s+([^;\n]+?)\s*;\s*do\b/gu)) {
        const prefixed = new RegExp(`--prefix\\s+"?\\$\\{?${variable ?? ''}\\}?"?`, 'u').test(run);
        const expanded = (globs ?? '')
            .split(/\s+/u)
            .filter((pattern) => pattern !== '')
            .flatMap((pattern) => globSync(pattern, { cwd: repoRoot }));

        if (prefixed && expanded.some((match) => apps.has(match))) {
            return true;
        }
    }

    return [...run.matchAll(/\bcd\s+"?([^"\s;&]+)"?/gu)].some(([, target]) => apps.has(target ?? ''));
}

/** `npm install` or its alias `npm i`, as a command (not `npm ci`, not `npm run install`). */
const NPM_INSTALL = /\bnpm\s+(?:install|i)\b/u;

describe('every CDK app installs from a committed lockfile', () => {
    const apps = cdkAppDirectories();

    it('discovers the CDK apps (non-vacuity)', () => {
        expect(apps).toContain('packages/infra/global');
        expect(apps.length).toBeGreaterThan(1);
    });

    it('tracks a package-lock.json in every CDK app directory', () => {
        const missing = apps.filter((app) => !trackedFiles(app).includes(`${app}/package-lock.json`));

        expect(missing, 'these CDK apps have no lockfile in git, so CI resolves their ranges afresh').toEqual([]);
    });

    it('installs every CDK app with npm ci, never npm install', () => {
        const appSet = new Set(apps);
        const sites = stepSites().filter(({ step }) => targetsCdkApp(step, appSet));
        const offenders = sites.filter(({ step }) => NPM_INSTALL.test(withoutComments(step.run ?? '')));

        // Non-vacuity: the guard finds the CDK installs it judges, so a parser that sees nothing cannot pass.
        expect(sites.length).toBeGreaterThan(0);
        expect(
            offenders.map(({ where }) => where),
            'npm install rewrites a lockfile instead of failing on a mismatch; use npm ci',
        ).toEqual([]);
    });
});
