/**
 * Unit tests for `infraInstall` — which CDK app directories still need their own install, and how to install one.
 *
 * ## The defect
 *
 * No CDK app is an npm workspace (each `infra/package.json` says so: `aws-cdk-lib` is 149 MB and installs in
 * its OWN `node_modules`). So a fresh checkout or a new worktree — where `npm install` at the root, or a
 * hard-linked copy of the root `node_modules`, brings in nothing under `infra/` folders — has no `aws-cdk-lib`
 * for those apps. `local:up` then synthesised into "Cannot find module 'aws-cdk-lib'" and refused, and the
 * last full run worked around it by symlinking the packages from the main checkout. The fix is to install
 * what is missing, the way CI does (`npm ci --prefix <dir>`, from the app's committed lockfile), rather than to hope the
 * setup was done.
 */
import { describe, expect, it } from 'vitest';

import type { CdkApp } from '../discoverApps.js';
import { appsMissingCdkLib, cdkInstallArgs, cdkLibResolvesFrom, installFailureHint } from '../infraInstall.js';

const app = (packageDir: string): CdkApp => ({
    packageName: `@kitchensink/${packageDir}`,
    packageDir,
    script: 'infra:synth',
    appCommand: 'tsx bin/app.ts',
    localSynthSkip: undefined,
});

describe('cdkLibResolvesFrom', () => {
    it('is true when the app directory holds its own aws-cdk-lib', () => {
        const present = new Set(['/repo/packages/services/a/infra/node_modules/aws-cdk-lib/package.json']);

        expect(cdkLibResolvesFrom('/repo/packages/services/a/infra', '/repo', (file) => present.has(file))).toBe(true);
    });

    it('resolves upward like Node, so a hoisted copy at the root counts', () => {
        const present = new Set(['/repo/node_modules/aws-cdk-lib/package.json']);

        expect(cdkLibResolvesFrom('/repo/packages/services/a/infra', '/repo', (file) => present.has(file))).toBe(true);
    });

    it('is false when no ancestor holds it', () => {
        expect(cdkLibResolvesFrom('/repo/packages/services/a/infra', '/repo', () => false)).toBe(false);
    });

    it("⛔ stops at the repo root: a copy in a PARENT of the checkout is another checkout's, not this one's", () => {
        // A worktree lives under the main checkout, so Node would happily resolve the MAIN checkout's aws-cdk-lib - the
        // leak the symlink workaround made by hand, and two copies of aws-cdk-lib break constructs that peer on it.
        const present = new Set(['/main/node_modules/aws-cdk-lib/package.json']);

        expect(
            cdkLibResolvesFrom('/main/.worktrees/w/packages/a/infra', '/main/.worktrees/w', (f) => present.has(f)),
        ).toBe(false);
    });

    it('does not count a sibling app: a copy next to the app is not on its resolution path', () => {
        const present = new Set(['/repo/packages/services/b/infra/node_modules/aws-cdk-lib/package.json']);

        expect(cdkLibResolvesFrom('/repo/packages/services/a/infra', '/repo', (file) => present.has(file))).toBe(false);
    });
});

describe('appsMissingCdkLib', () => {
    it('lists only the apps that cannot resolve aws-cdk-lib, in the order given', () => {
        const present = new Set(['/repo/packages/services/b/infra/node_modules/aws-cdk-lib/package.json']);
        const missing = appsMissingCdkLib(
            [app('packages/services/a/infra'), app('packages/services/b/infra'), app('packages/services/c/infra')],
            '/repo',
            (file) => present.has(file),
        );

        expect(missing.map((entry) => entry.packageDir)).toEqual([
            'packages/services/a/infra',
            'packages/services/c/infra',
        ]);
    });

    it('is empty when every app resolves it, so a ready checkout installs nothing', () => {
        expect(appsMissingCdkLib([app('packages/services/a/infra')], '/repo', () => true)).toEqual([]);
    });
});

describe('installFailureHint', () => {
    /**
     * Measured 2026-10-29 in a fresh worktree: every `infra/` install failed `E401`/`403` on `@radicle-co/infra-shared`,
     * which GitHub Packages serves only to an authenticated reader (even though it is public), and `infra/.npmrc` reads the
     * token from `NODE_AUTH_TOKEN`. A token without `read:packages` is refused the same way. That, not a missing step, is
     * why these directories are never installed by hand-copying; the message must say what to supply.
     */
    it.each(['npm error code E401', 'npm error 403 In most cases, you or one of your dependencies', 'E403'])(
        'names NODE_AUTH_TOKEN and read:packages for %j',
        (stderr) => {
            expect(installFailureHint(stderr)).toMatch(/NODE_AUTH_TOKEN.*read:packages/u);
        },
    );

    it('says nothing for a failure that is not an authentication one', () => {
        expect(installFailureHint('npm error code ENOTFOUND')).toBeUndefined();
    });
});

// `npm install` re-resolves the manifest's ranges and rewrites the lockfile, so a local synth could run against a
// different `aws-cdk-lib` from CI's. `npm ci` installs exactly the committed lockfile and fails on a mismatch.
describe('cdkInstallArgs', () => {
    it('installs the app from its lockfile with npm ci, by prefix', () => {
        expect(cdkInstallArgs('/repo/packages/infra/global')).toEqual([
            'ci',
            '--prefix',
            '/repo/packages/infra/global',
            '--no-audit',
            '--no-fund',
        ]);
    });
});
