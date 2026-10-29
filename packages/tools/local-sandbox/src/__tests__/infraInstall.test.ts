/**
 * Unit tests for `infraInstall` — which CDK app directories still need their own `npm install`.
 *
 * ## The defect
 *
 * No CDK app is an npm workspace (each `infra/package.json` says so: `aws-cdk-lib` is 149 MB and installs in
 * its OWN `node_modules`). So a fresh checkout or a new worktree — where `npm install` at the root, or a
 * hard-linked copy of the root `node_modules`, brings in nothing under `infra/` folders — has no `aws-cdk-lib`
 * for those apps. `local:up` then synthesised into "Cannot find module 'aws-cdk-lib'" and refused, and the
 * last full run worked around it by symlinking the packages from the main checkout. The fix is to install
 * what is missing, the way CI does (`npm install --prefix <dir>`), rather than to hope the setup was done.
 */
import { describe, expect, it } from 'vitest';

import type { CdkApp } from '../discoverApps.js';
import { appsMissingCdkLib, cdkLibResolvesFrom } from '../infraInstall.js';

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

        expect(cdkLibResolvesFrom('/repo/packages/services/a/infra', (file) => present.has(file))).toBe(true);
    });

    it('resolves upward like Node, so a hoisted copy at the root counts', () => {
        const present = new Set(['/repo/node_modules/aws-cdk-lib/package.json']);

        expect(cdkLibResolvesFrom('/repo/packages/services/a/infra', (file) => present.has(file))).toBe(true);
    });

    it('is false when no ancestor holds it', () => {
        expect(cdkLibResolvesFrom('/repo/packages/services/a/infra', () => false)).toBe(false);
    });

    it('does not count a sibling app: a copy next to the app is not on its resolution path', () => {
        const present = new Set(['/repo/packages/services/b/infra/node_modules/aws-cdk-lib/package.json']);

        expect(cdkLibResolvesFrom('/repo/packages/services/a/infra', (file) => present.has(file))).toBe(false);
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
