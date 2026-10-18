// @vitest-environment node
/**
 * Repo-wide guard: the deploy workflow's jobs restore the root `node_modules` the pipeline already cached instead of
 * running `npm ci` in every job, and they never write that entry back.
 *
 * ## The failure this pins
 *
 * Every infra job ran its own `npm ci --no-audit --no-fund`, about 72 seconds each, on a critical path of five chained
 * jobs. `_ci.yml`'s `install` job already saves the extracted tree under a key that is a pure function of the lockfile,
 * and thirty jobs restore it. A deploy workflow cannot `needs:` that job, but it does not need to: the entry is
 * addressed by key.
 *
 * ## What is asserted
 *
 * 1. **The key is the `install` job's key**, derived from `_ci.yml` rather than restated, so the two cannot diverge and
 *    leave the deploy jobs restoring an entry nobody writes.
 * 2. **The action only restores.** A save from a job that prunes dev dependencies would publish a damaged tree under the
 *    pristine key for thirty other jobs. And no `restore-keys`: a tree for another lockfile is a wrong tree.
 * 3. **`npm ci` is the fallback, gated on a miss**, so an evicted or absent entry costs the old install, not a failure.
 * 4. **No deploy-path job installs the root workspace by hand any more.** The subjects are discovered (every bare
 *    `npm ci` in the files below), not listed.
 *
 * DESIGN PATTERN: Specification module over parsed workflow and action files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

interface Step {
    readonly name?: string;
    readonly uses?: string;
    readonly if?: string;
    readonly run?: string;
    readonly with?: Record<string, unknown>;
}

const read = (file: string): string => readFileSync(join(repoRoot, file), 'utf8');
const ACTION = '.github/actions/installWorkspace/action.yml';
const actionSteps = (): readonly Step[] => (parse(read(ACTION)) as { runs: { steps: Step[] } }).runs.steps;

/** The `install` job's saved key in `_ci.yml`. */
function installJobKey(): string {
    const steps = (parse(read('.github/workflows/_ci.yml')) as { jobs: Record<string, { steps?: Step[] }> }).jobs[
        'install'
    ]?.steps;
    const save = steps?.find(({ uses }) => uses?.startsWith('actions/cache/save@'));

    return String(save?.with?.['key']);
}

describe('the root workspace is restored, not reinstalled, on the deploy path', () => {
    it('restores under exactly the key the install job saves', () => {
        const restore = actionSteps().find(({ uses }) => uses?.startsWith('actions/cache/restore@'));

        expect(installJobKey()).toMatch(/node-.*hashFiles\('package-lock\.json'\)/u);
        expect(restore?.with?.['key']).toBe(installJobKey());
    });

    it('only restores: it saves nothing and takes no restore-keys', () => {
        // Read from the parsed steps, not the text: the action's own comments name these things to forbid them.
        const caches = actionSteps().filter(({ uses }) => uses?.startsWith('actions/cache'));

        expect(caches).toHaveLength(1);
        expect(caches[0]?.uses).toMatch(/^actions\/cache\/restore@/u);
        expect(caches[0]?.with).not.toHaveProperty('restore-keys');
    });

    it('runs npm ci only on a miss', () => {
        const install = actionSteps().find(({ run }) => /npm ci/u.test(run ?? ''));

        expect(install?.if).toMatch(/cache-hit\s*!=\s*'true'/u);
    });

    it.each([
        '.github/actions/infra-package/action.yml',
        '.github/actions/infra-image/action.yml',
        '.github/workflows/deployInfra.yml',
        '.github/workflows/sandboxPreview.yml',
    ])('%s installs the root workspace through the action, never a bare npm ci', (file) => {
        const doc = parse(read(file)) as {
            runs?: { steps?: Step[] };
            jobs?: Record<string, { steps?: Step[] }>;
        };
        const steps = [...(doc.runs?.steps ?? []), ...Object.values(doc.jobs ?? {}).flatMap((job) => job.steps ?? [])];
        const bare = steps.filter(({ run }) => /(^|\n)\s*npm ci\b/u.test(run ?? '')).map(({ name }) => name);

        expect(bare, 'these steps run npm ci directly').toEqual([]);
        expect(steps.some(({ uses }) => uses?.endsWith('installWorkspace'))).toBe(true);
    });
});

/**
 * `resolve-sandbox` has no `needs:` on purpose, so that eight Playwright shards and the preview deploy are not delayed
 * by `install`; its comment concluded it "cannot restore the cache `install` saves". That holds only for the first run
 * of a new lockfile. The entry is addressed by key, so every later run restores it, and the job sits at the very start
 * of the longest chain: it gates the preview gate and the mobile build plan, and its `npm ci` was 135 seconds.
 */
describe('resolve-sandbox, the head of the preview chain, restores instead of reinstalling', () => {
    const job = (): { steps?: Step[] } | undefined =>
        (parse(read('.github/workflows/_ci.yml')) as { jobs: Record<string, { steps?: Step[] }> }).jobs[
            'resolve-sandbox'
        ];

    it('installs through the restore-first action', () => {
        const steps = job()?.steps ?? [];

        expect(steps.some(({ uses }) => uses?.endsWith('installWorkspace'))).toBe(true);
        expect(steps.filter(({ run }) => /(^|\n)\s*npm ci\b/u.test(run ?? ''))).toEqual([]);
    });

    it('needs no token: the root workspace install does not read GitHub Packages', () => {
        const action = parse(read(ACTION)) as { inputs: Record<string, { required?: boolean }> };

        expect(action.inputs['node-auth-token']?.required).toBe(false);
    });
});
