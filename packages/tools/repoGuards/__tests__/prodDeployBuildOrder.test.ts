// @vitest-environment node
/**
 * `npm prune --omit=dev` is a ONE-WAY DOOR in `prod-deploy.yml`: every package build must happen before it.
 *
 * ## The failure this pins
 *
 * `nest build` is a devDependency binary (`@nestjs/cli`). The prune exists so the Docker images ship only
 * production dependencies — but it also deletes that binary from `node_modules/.bin`. So a package build
 * placed after the prune dies with:
 *
 *     sh -c nest build
 *     ERROR  run failed: command  exited (127)
 *
 * Exit 127 is "command not found", which reads like a broken toolchain rather than a step-ordering mistake.
 *
 * This is not hypothetical: it is exactly how the FIRST production deploy of the food and recipe services
 * failed. Their builds were written inline with their Docker steps, far down the file, on the far side of the
 * prune — while the identity leg had always (correctly) built at the top. Nothing caught it, because the
 * ordering only matters in `prod-deploy.yml`: `sandbox-deploy.yml` never prunes, so the same build lines are
 * fine there, and no local gate runs this workflow at all.
 *
 * ## Why it is asserted this way
 *
 * The invariant is positional, so the test reads STEP INDICES out of the parsed workflow rather than matching
 * text. It deliberately does not enumerate which services exist: any future `turbo run build` added after the
 * prune fails this test, including one for a service nobody has written yet.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/prod-deploy.yml', import.meta.url));

interface WorkflowStep {
    readonly name?: string;
    readonly run?: string;
}

/** The `Deploy Production` job's steps, in file order. */
function prodDeploySteps(): readonly WorkflowStep[] {
    const doc = parse(readFileSync(WORKFLOW, 'utf8')) as {
        jobs: Record<string, { steps?: WorkflowStep[] }>;
    };
    const [job] = Object.values(doc.jobs);

    return job?.steps ?? [];
}

describe('prod-deploy.yml — package builds precede the dev-dependency prune', () => {
    it('has exactly one prune step, and it is not the first thing in the job', () => {
        const steps = prodDeploySteps();
        const pruneIndices = steps
            .map((step, index) => ({ index, run: step.run ?? '' }))
            .filter(({ run }) => run.includes('npm prune'))
            .map(({ index }) => index);

        // If the prune is ever duplicated or removed, the positional assertions below become meaningless
        // rather than false — so anchor on it explicitly.
        expect(pruneIndices).toHaveLength(1);
        expect(pruneIndices[0]).toBeGreaterThan(0);
    });

    it('runs EVERY turbo build before the prune deletes nest and the other dev binaries', () => {
        const steps = prodDeploySteps();
        const pruneIndex = steps.findIndex((step) => (step.run ?? '').includes('npm prune'));
        const buildsAfterPrune = steps
            .map((step, index) => ({ index, name: step.name ?? '(unnamed)', run: step.run ?? '' }))
            .filter(({ index, run }) => index > pruneIndex && /turbo run build/.test(run));

        expect(
            buildsAfterPrune.map(({ name }) => name),
            'these steps run `turbo run build` after `npm prune --omit=dev`, so `nest build` will exit 127',
        ).toEqual([]);
    });

    it('builds every service whose Docker image the job pushes', () => {
        // The complement of the rule above: moving a build earlier must not mean DELETING it. Each image
        // push implies a package build somewhere before the prune.
        const steps = prodDeploySteps();
        const pruneIndex = steps.findIndex((step) => (step.run ?? '').includes('npm prune'));
        const buildFilters = steps
            .slice(0, pruneIndex)
            .flatMap(({ run }) => [...(run ?? '').matchAll(/--filter=(\S+)/g)].map((match) => match[1]));
        const pushedImages = steps
            .filter(({ run }) => /docker buildx build/.test(run ?? ''))
            .map(({ name }) => name ?? '');

        expect(pushedImages.length, 'expected the identity, food and recipe image pushes').toBeGreaterThanOrEqual(3);

        for (const service of [
            '@kitchensink/identity-service',
            '@kitchensink/food-service',
            '@kitchensink/recipe-service',
        ]) {
            expect(buildFilters, `${service} must be built before the prune`).toContain(service);
        }
    });
});
