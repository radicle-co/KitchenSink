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
 * 2. No workflow or composite action installs a package outside the root workspace (a CDK app, or any package that
 *    commits its own lockfile) with `npm install` (or `npm i`). `npm ci` installs exactly the lockfile and fails when
 *    the lockfile no longer matches the manifest; `npm install` rewrites it in silence.
 *
 * Both sides are discovered. The apps come from `cdkAppDirectories()`, which reads them out of the tree by content, and
 * each command's target comes from `commandsOf()`, shared with `installWorkspaceRestoreFirst.test.ts`: a step
 * `working-directory`, `--prefix` with a literal path or a loop variable over the app globs, a `cd`, and a composite
 * action's `${{ inputs.directory }}` resolved through its callers.
 *
 * DESIGN PATTERN: Specification module over the parsed workflow and action files.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
    ACTIONS_DIR,
    actionInputValues,
    cdkAppDirectories,
    commandsOf,
    ownLockfileDirectories,
    WORKFLOWS_DIR,
    type InstallStep,
} from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

interface Step extends InstallStep {
    readonly name?: string;
}

interface StepSite {
    readonly where: string;
    readonly step: Step;
    /** The composite action's reference, for a step that belongs to one. */
    readonly action?: string;
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
        const action = `./${path.posix.dirname(file)}`;
        const fromAction = (doc?.runs?.steps ?? []).map((step) => ({
            where: `${file} › ${step.name ?? '(unnamed)'}`,
            step,
            action,
        }));

        return [...fromJobs, ...fromAction];
    });
}

/** `npm install` or its alias `npm i`, as a whole command (not `npm ci`, not `npm run install`). */
const NPM_INSTALL = /^npm\s+(?:install|i)\b/u;

/** `npm ci`, `npm install` or `npm i`, as a whole command. */
const ANY_INSTALL = /^npm\s+(?:ci|install|i)\b/u;

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
        // The CDK apps and every other package with its own lockfile: an action shared by both kinds of caller is then
        // judged as installing them, rather than escaping because one caller is not a CDK app.
        const packages = new Set([...apps, ...ownLockfileDirectories()]);
        const inputs = actionInputValues();
        const installs = stepSites().flatMap(({ where, step, action }) =>
            commandsOf(step, packages, action === undefined ? undefined : inputs.get(action))
                .filter(({ text, inDirectories }) => inDirectories && ANY_INSTALL.test(text))
                .map(({ text }) => ({ where, text })),
        );
        const offenders = installs.filter(({ text }) => NPM_INSTALL.test(text)).map(({ where }) => where);

        // Non-vacuity: the guard finds the package installs it judges, so a parser that sees nothing cannot pass.
        expect(installs.length).toBeGreaterThan(0);
        expect(offenders, 'npm install rewrites a lockfile instead of failing on a mismatch; use npm ci').toEqual([]);
    });
});
