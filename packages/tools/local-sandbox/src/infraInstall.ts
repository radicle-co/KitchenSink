/**
 * @module infraInstall — which CDK app directories still need their own install, and how to install one.
 *
 * ⛔ NO CDK APP IS AN NPM WORKSPACE, ON PURPOSE. Each `infra/package.json` says so: `aws-cdk-lib` is 149 MB and
 * installs in that directory's OWN `node_modules`, never the root's. So `npm install` at the root, a fresh
 * worktree, or a hard-linked copy of the root `node_modules` brings in nothing for them. `local:up` then
 * failed at synth with "Cannot find module 'aws-cdk-lib'" for every app not yet installed by hand, and the
 * last full run got past it by symlinking three packages from the main checkout.
 *
 * ⚠️ Resolution is Node's own (this directory, then each ancestor) BUT BOUNDED at the repo root, so a copy hoisted
 * within this checkout counts, and neither a sibling app's copy nor another checkout's does. Installing is
 * `npm ci --prefix <dir>` from the app's committed lockfile, the form CI uses (`.github/actions/infra-package`), so a
 * local synth runs against the same `aws-cdk-lib` as CI's.
 */
import path from 'node:path';

import type { CdkApp } from './discoverApps.js';

/**
 * Whether Node would resolve `aws-cdk-lib` from a directory.
 *
 * @param dir - Absolute directory the synth runs in.
 * @param boundary - Absolute repo root; the walk stops there. ⛔ A worktree lives UNDER the main checkout, so without
 *   a bound Node's upward walk finds the MAIN checkout's `aws-cdk-lib` and this reports "resolves" - the very leak
 *   the by-hand symlinks made, and two copies of `aws-cdk-lib` break constructs that peer on it.
 * @param exists - Whether a file exists. Injected so this stays pure.
 * @returns `true` when this directory or any ancestor up to `boundary` holds `node_modules/aws-cdk-lib`. Pure.
 */
export function cdkLibResolvesFrom(dir: string, boundary: string, exists: (file: string) => boolean): boolean {
    for (let current = dir; ; current = path.dirname(current)) {
        if (exists(path.join(current, 'node_modules', 'aws-cdk-lib', 'package.json'))) {
            return true;
        }

        if (current === boundary || path.dirname(current) === current) {
            return false;
        }
    }
}

/**
 * The apps whose directory cannot resolve `aws-cdk-lib`.
 *
 * @param apps - The apps about to be synthesised.
 * @param repoRoot - Absolute repo root the apps' `packageDir` is relative to.
 * @param exists - Whether a file exists.
 * @returns The apps needing an install, in the order given. Pure.
 */
export function appsMissingCdkLib(
    apps: readonly CdkApp[],
    repoRoot: string,
    exists: (file: string) => boolean,
): readonly CdkApp[] {
    return apps.filter((app) => !cdkLibResolvesFrom(path.join(repoRoot, app.packageDir), repoRoot, exists));
}

/**
 * The npm arguments that install one CDK app from its committed lockfile, the way CI does. `npm ci`, never
 * `npm install`: the install must match CI's `aws-cdk-lib` exactly and fail when the lockfile no longer fits the
 * manifest. `--prefix`, not a cwd change: the directory is not a workspace, and a cwd inside the repo would make npm
 * walk up and install the ROOT workspaces instead.
 *
 * @param appDir - Absolute directory of the CDK app.
 * @returns The arguments after `npm`. Pure.
 */
export function cdkInstallArgs(appDir: string): readonly string[] {
    return ['ci', '--prefix', appDir, '--no-audit', '--no-fund'];
}

/**
 * What to tell a developer whose `npm ci --prefix <infra>` was refused for authentication.
 *
 * @param stderr - npm's stderr.
 * @returns The remedy, or `undefined` when the failure is not an authentication one. Pure.
 */
export function installFailureHint(stderr: string): string | undefined {
    if (!/\bE40[13]\b|\b40[13]\b/u.test(stderr)) {
        return undefined;
    }

    return (
        '@radicle-co/infra-shared is served by GitHub Packages, which authenticates even public reads. Export ' +
        'NODE_AUTH_TOKEN as a personal access token with read:packages (infra/.npmrc reads it), then re-run.'
    );
}
