// @vitest-environment node
/**
 * Repo-wide guard: the `codeQuality` job of `_ci.yml` installs the CDK apps a change touches.
 *
 * Why: every `infra/` app is deliberately outside the npm workspaces, so the root install holds no `aws-cdk-lib`.
 * Type-aware ESLint then reads every CDK type as an unresolved `any` and reports false `no-unsafe-*` findings on any
 * PR that touches an infra stack (88 on PR #470 at ca5f6599c). The fix is the one the `test` job's guards group uses
 * for infra-global: install the app's own packages, which needs `infra-shared` and `packages: read`.
 *
 * Two halves: the SELECTION (`touchedInfraApps.sh`, run against a real git repository) and the WIRING (the job
 * calls it and installs what it prints, before the scanners run).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/touchedInfraApps.sh');
const temps: string[] = [];

afterEach(() => {
    for (const dir of temps.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

/**
 * Build a repo whose base commit holds the given files, then a head commit that touches `changed`.
 *
 * @sideEffect Creates a temp directory, registered for removal.
 */
function touchedApps(baseFiles: readonly string[], changed: readonly string[]): string[] {
    const dir = mkdtempSync(path.join(tmpdir(), 'touchedInfraApps-'));

    temps.push(dir);
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'a@b.test');
    git(dir, 'config', 'user.name', 'a');

    for (const file of baseFiles) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), '{}');
    }

    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'base');

    for (const file of changed) {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), 'changed');
    }

    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'head');

    return execFileSync('bash', [SCRIPT, 'HEAD^'], { cwd: dir, encoding: 'utf8' }).split('\n').filter(Boolean);
}

const RECIPE = 'packages/services/recipe-service/infra';
const WEB = 'packages/apps/commise/web/infra';
const GLOBAL = 'packages/infra/global';
const LOCKS = [RECIPE, WEB, GLOBAL, 'tooling/codeQuality', 'shared/infra'].map((d) => `${d}/package-lock.json`);

describe('touchedInfraApps.sh', () => {
    it('names the app whose file changed, once, however many of its files changed', () => {
        expect(touchedApps(LOCKS, [`${RECIPE}/lib/RecipeServiceStack.ts`, `${RECIPE}/__tests__/a.test.ts`])).toEqual([
            RECIPE,
        ]);
    });

    it('names each touched app, at any depth, and infra-global', () => {
        expect(touchedApps(LOCKS, [`${WEB}/lib/x.ts`, `${GLOBAL}/lib/y.ts`, `${RECIPE}/bin/z.ts`])).toEqual([
            WEB,
            GLOBAL,
            RECIPE,
        ]);
    });

    it('names nothing for a change outside every infra app, even under another package with a lockfile', () => {
        expect(
            touchedApps(LOCKS, ['tooling/codeQuality/scan.mjs', 'packages/services/recipe-service/src/a.ts']),
        ).toEqual([]);
    });

    it('does not name an infra folder that has no lockfile to install from', () => {
        expect(touchedApps([], [`${RECIPE}/lib/a.ts`])).toEqual([]);
    });
});

interface Step {
    readonly name?: string;
    readonly run?: string;
    readonly env?: Record<string, string>;
    readonly 'working-directory'?: string;
}
interface Job {
    readonly needs?: string | string[];
    readonly permissions?: Record<string, string>;
    readonly steps: readonly Step[];
}

describe('_ci.yml codeQuality job', () => {
    const job = (
        yaml.parse(readFileSync(path.join(repoRoot, '.github/workflows/_ci.yml'), 'utf8')) as {
            jobs: Record<string, Job>;
        }
    ).jobs['codeQuality'] as Job;
    const install = job.steps.findIndex((s) => s.run?.includes('touchedInfraApps.sh'));
    const scan = job.steps.findIndex((s) => s.run?.includes('tooling/codeQuality/scan.mjs'));

    it('waits for infra-shared and may read GitHub Packages, which the app installs resolve from', () => {
        expect(job.needs).toContain('infra-shared');
        expect(job.permissions?.['packages']).toBe('read');
    });

    it('installs the touched apps with the package token, before the scanners run', () => {
        expect(install).toBeGreaterThan(-1);
        expect(install).toBeLessThan(scan);
        expect(job.steps[install]?.env?.['NODE_AUTH_TOKEN']).toBe('${{ secrets.GITHUB_TOKEN }}');
        expect(job.steps[install]?.run).toContain('npm ci');
    });
    it('resolves the diff base once, so the install and the scan cannot disagree about it', () => {
        const resolvers = job.steps.filter((step) => step.run?.includes('scqBase') && step.run.includes('>'));
        const recomputes = job.steps.filter(
            (step) => step.run?.includes('origin/main"') || step.run?.includes('HEAD^'),
        );

        expect(resolvers).toHaveLength(1);
        expect(recomputes).toEqual(resolvers);
        expect(job.steps.indexOf(resolvers[0] as Step)).toBeLessThan(install);
        expect(job.steps[install]?.run).toContain('scqBase');
        expect(job.steps[scan]?.run).toContain('scqBase');
    });
});
