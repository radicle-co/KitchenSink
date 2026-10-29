/**
 * @module infraInstall — which CDK app directories still need their own `npm install`.
 *
 * ⛔ NO CDK APP IS AN NPM WORKSPACE, ON PURPOSE. Each `infra/package.json` says so: `aws-cdk-lib` is 149 MB and
 * installs in that directory's OWN `node_modules`, never the root's. So `npm install` at the root, a fresh
 * worktree, or a hard-linked copy of the root `node_modules` brings in nothing for them. `local:up` then
 * failed at synth with "Cannot find module 'aws-cdk-lib'" for every app not yet installed by hand, and the
 * last full run got past it by symlinking three packages from the main checkout.
 *
 * ⚠️ Resolution is Node's own (this directory, then each ancestor), so a copy hoisted to a parent counts and a
 * sibling app's copy does not. Installing is `npm install --prefix <dir>`, the form CI uses
 * (`.github/actions/infra-package`); the infra directories carry no lockfile, so `npm ci` would refuse.
 */
import path from 'node:path';

import type { CdkApp } from './discoverApps.js';

/**
 * Whether Node would resolve `aws-cdk-lib` from a directory.
 *
 * @param dir - Absolute directory the synth runs in.
 * @param exists - Whether a file exists. Injected so this stays pure.
 * @returns `true` when this directory or any ancestor holds `node_modules/aws-cdk-lib`. Pure.
 */
export function cdkLibResolvesFrom(dir: string, exists: (file: string) => boolean): boolean {
    for (let current = dir; ; current = path.dirname(current)) {
        if (exists(path.join(current, 'node_modules', 'aws-cdk-lib', 'package.json'))) {
            return true;
        }

        if (path.dirname(current) === current) {
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
    return apps.filter((app) => !cdkLibResolvesFrom(path.join(repoRoot, app.packageDir), exists));
}
