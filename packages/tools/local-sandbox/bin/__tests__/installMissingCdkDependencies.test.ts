/**
 * `local:up` installs a CDK app the way CI does: `npm ci --prefix <dir>`, from the app's committed lockfile.
 *
 * `npm install` would re-resolve the manifest's ranges and rewrite the lockfile, so a local synth could run against a
 * different `aws-cdk-lib` from CI's. The workflow guard (`repoGuards` `cdkAppLockfiles`) reads only workflows and
 * actions, so this adapter's own command is pinned here, at the process boundary: `spawnSync` is stubbed and the
 * arguments it receives are the assertion.
 */
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CdkApp } from '../../src/discoverApps.js';

const spawnSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:child_process')>()),
    spawnSync,
}));

// No directory resolves `aws-cdk-lib`, so every app given needs an install.
vi.mock('node:fs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:fs')>()),
    existsSync: () => false,
}));

const { installMissingCdkDependencies, REPO_ROOT } = await import('../adapters.js');

const app: CdkApp = {
    packageName: '@kitchensink/fake-infra',
    packageDir: 'packages/services/fake/infra',
    script: 'infra:synth',
    appCommand: 'tsx bin/app.ts',
    localSynthSkip: undefined,
};

describe('installMissingCdkDependencies', () => {
    beforeEach(() => {
        spawnSync.mockReset();
    });

    it('installs each app with npm ci by prefix, never npm install', () => {
        spawnSync.mockReturnValue({ status: 0, stderr: '' });

        const result = installMissingCdkDependencies([app]);

        expect(spawnSync).toHaveBeenCalledTimes(1);
        expect(spawnSync).toHaveBeenCalledWith(
            'npm',
            ['ci', '--prefix', path.join(REPO_ROOT, app.packageDir), '--no-audit', '--no-fund'],
            { encoding: 'utf8' },
        );
        expect(result).toEqual({ installed: [app.packageDir], failed: [] });
    });

    it('reports a failed install with the tail of npm stderr', () => {
        spawnSync.mockReturnValue({ status: 1, stderr: 'npm error code EUSAGE\nnpm error lockfile out of sync' });

        const result = installMissingCdkDependencies([app]);

        expect(result.installed).toEqual([]);
        expect(result.failed).toEqual([
            { packageDir: app.packageDir, stderr: 'npm error code EUSAGE\nnpm error lockfile out of sync' },
        ]);
    });
});
