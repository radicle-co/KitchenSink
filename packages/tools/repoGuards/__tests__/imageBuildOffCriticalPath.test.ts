// @vitest-environment node
/**
 * Repo-wide guard: a service image is BUILT AND PUSHED in a job of its own that starts at once, and the job that
 * deploys it only CONSUMES the pushed tag.
 *
 * ## The failure this pins
 *
 * `recipe-service`'s deploy job spent about 13 minutes, of which 4.3 were `docker buildx build` (no layer cache) and
 * 1.3 the push, and that job sits at the END of the longest chain in the preview (global, recipe-schema,
 * recipe-workers, recipe-service). Nothing about the image depends on that chain: it is built from the commit and
 * tagged by the commit. Building it inside the deploy job put ~6 minutes of independent work on the critical path.
 *
 * ## What is asserted, and why each part is load-bearing
 *
 * 1. **A deploy job never builds.** An `infra-package` call that names an `ecr-repo` carries none of the build
 *    inputs (`dockerfile`, `image-build-context`, `prune-dir`), and the action holds no `docker buildx build`. A
 *    build left in the deploy path silently restores the serial cost.
 * 2. **Every pushed image has its own job, with no `needs`.** The image job starts with the workflow. One `needs`
 *    edge to a deploy job puts the build back behind the chain.
 * 3. **The deploy job needs the image job for the SAME repository.** Otherwise it could reach `cdk deploy` before
 *    the tag exists and point ECS at nothing.
 * 4. **The image job follows the deploy selection exactly.** It runs only when the run deploys AND the package is
 *    selected, so a `deploy: false` checks run, which every pull request makes, pushes nothing. And the deploy job
 *    is not SKIPPED when the image job is (the `!cancelled()` pattern), because a deselected package must never skip
 *    its dependents.
 * 5. **The deploy job proves the tag is there** before it deploys (`ecrImagePresent`), so a skipped or failed push
 *    is a red job and not a task that cannot pull.
 * 6. **The build keeps ensure-exists and push-verdict semantics, and is layer-cached** per image
 *    (`ecrEnsureRepo.sh`, `ecrPushVerdict.sh`, `ecrRecordRelease.sh`, a `type=gha` cache scoped to the repository).
 *
 * DESIGN PATTERN: Specification module over the parsed workflow and action; each clause is a pure predicate.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

interface Step {
    readonly uses?: string;
    readonly if?: string;
    readonly run?: string;
    readonly with?: Record<string, string>;
}

interface Job {
    readonly needs?: string | readonly string[];
    readonly if?: string;
    readonly steps?: readonly Step[];
}

const read = (file: string): string => readFileSync(join(repoRoot, file), 'utf8');
const jobs = (): Record<string, Job> =>
    (parse(read('.github/workflows/deployInfra.yml')) as { jobs: Record<string, Job> }).jobs;
const needsOf = (job: Job): readonly string[] => (job.needs === undefined ? [] : [job.needs].flat());
const stepUsing = (job: Job, action: string): Step | undefined => job.steps?.find(({ uses }) => uses?.endsWith(action));

const ACTION = '.github/actions/infra-image/action.yml';
const BUILD_INPUTS = ['dockerfile', 'image-build-context', 'prune-dir'] as const;

/** The deploy jobs: every job whose `infra-package` call ships an image. */
function deployJobs(): readonly [string, Job, Step][] {
    return Object.entries(jobs()).flatMap(([name, job]) => {
        const step = stepUsing(job, 'infra-package');

        return step?.with?.['ecr-repo'] ? [[name, job, step] as [string, Job, Step]] : [];
    });
}

/** The image jobs: every job that calls `infra-image`. */
function imageJobs(): readonly [string, Job, Step][] {
    return Object.entries(jobs()).flatMap(([name, job]) => {
        const step = stepUsing(job, 'infra-image');

        return step ? [[name, job, step] as [string, Job, Step]] : [];
    });
}

describe('an image is built off the deploy critical path', () => {
    it('discovers the three service images, so nothing below is vacuous', () => {
        expect(
            deployJobs()
                .map(([name]) => name)
                .sort(),
        ).toEqual(['food-service', 'identity', 'recipe-service']);
        expect(imageJobs()).toHaveLength(3);
    });

    it.each(BUILD_INPUTS)('no deploy job passes `%s`: the deploy never builds', (input) => {
        for (const [name, , step] of deployJobs()) {
            expect(step.with, `${name} still hands the deploy action a build input`).not.toHaveProperty(input);
        }
    });

    it('the deploy action holds no docker build', () => {
        const action = read('.github/actions/infra-package/action.yml');

        expect(action).not.toMatch(/docker buildx build/u);
        expect(action).not.toMatch(/ecrPushVerdict\.sh/u);
    });

    it('every image job starts at once: it needs nothing', () => {
        for (const [name, job] of imageJobs()) {
            expect(needsOf(job), `${name} waits on another job, which puts the build back on a chain`).toEqual([]);
        }
    });

    it('every deploy job needs the image job that pushes ITS repository', () => {
        for (const [name, job, step] of deployJobs()) {
            const pushers = imageJobs()
                .filter(([, , image]) => image.with?.['ecr-repo'] === step.with?.['ecr-repo'])
                .map(([imageName]) => imageName);

            expect(pushers, `no image job pushes ${String(step.with?.['ecr-repo'])}`).toHaveLength(1);
            expect(needsOf(job), `${name} can deploy before its image exists`).toContain(pushers[0]);
        }
    });

    it('an image job runs only when the run deploys and the package is selected', () => {
        for (const [name, job, step] of imageJobs()) {
            const condition = job.if ?? '';
            const deployJob = deployJobs().find(
                ([, , deploy]) => deploy.with?.['ecr-repo'] === step.with?.['ecr-repo'],
            );

            expect(condition, name).toMatch(/inputs\.deploy\b/u);
            expect(condition, name).toContain(`' ${deployJob?.[0] ?? '?'} '`);
        }
    });

    it('a skipped image job never skips its deploy job', () => {
        for (const [name, job] of deployJobs()) {
            const condition = job.if ?? '';

            expect(condition, `${name} needs an explicit if: a skipped need skips it otherwise`).toMatch(
                /!cancelled\(\)/u,
            );
            expect(condition, name).toMatch(/needs\.image-[a-z-]+\.result\s*!=\s*'failure'/u);
        }
    });

    it('the deploy job confirms the tag exists before it deploys', () => {
        const action = read('.github/actions/infra-package/action.yml');
        const confirm = action.indexOf('ecrImagePresent.sh');
        const deploy = action.indexOf('- name: Deploy\n');

        expect(confirm).toBeGreaterThan(-1);
        expect(confirm).toBeLessThan(deploy);
    });
});

describe('the image action keeps the registry semantics and caches its layers', () => {
    const action = read(ACTION);

    it.each(['ecrEnsureRepo.sh', 'ecrPushVerdict.sh', 'ecrRecordRelease.sh', 'imageTag.sh'])('runs %s', (script) => {
        expect(action).toContain(`bash .github/scripts/${script}`);
    });

    it('asks for the verdict before building, and records after pushing', () => {
        const at = (needle: string): number => action.indexOf(needle);

        expect(at('bash .github/scripts/ecrPushVerdict.sh')).toBeLessThan(at('uses: docker/build-push-action'));
        expect(at('uses: docker/build-push-action')).toBeLessThan(at('bash .github/scripts/ecrRecordRelease.sh'));
    });

    it('builds only when the verdict says push', () => {
        const step = (parse(action) as { runs: { steps: Step[] } }).runs.steps.find(({ uses }) =>
            uses?.startsWith('docker/build-push-action@'),
        );

        expect(step?.if ?? '').toMatch(/verdict\s*==\s*'push'/u);
    });

    it('reads and writes a gha layer cache scoped to the repository, without attestations', () => {
        const step = (parse(action) as { runs: { steps: Step[] } }).runs.steps.find(({ uses }) =>
            uses?.startsWith('docker/build-push-action@'),
        );
        const withs = step?.with ?? {};

        expect(withs['cache-from']).toMatch(/type=gha,scope=\$\{\{\s*inputs\.ecr-repo\s*\}\}/u);
        expect(withs['cache-to']).toMatch(/type=gha,scope=\$\{\{\s*inputs\.ecr-repo\s*\}\},mode=min/u);
        // An attestation manifest turns the pushed image into an index and changes the digest the production
        // release ledger records; the pre-split build produced a plain image.
        expect(String(withs['provenance'])).toBe('false');
        expect(String(withs['sbom'])).toBe('false');
    });
});
