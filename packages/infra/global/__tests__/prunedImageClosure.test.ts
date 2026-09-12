// @vitest-environment node
/**
 * A service image that installs from a pruned closure keeps BOTH halves of that contract: the Dockerfile
 * installs from the skeleton, and every workflow that builds it produces the skeleton first.
 *
 * ## The waste this exists to prevent returning
 *
 * The food image began `COPY node_modules ./node_modules` — the build context's root tree. npm workspaces
 * hoist to the root, so that one line shipped the union of every workspace's dependencies into a NestJS
 * service: Next.js, Expo, React Native, `expo-modules-core`, and ADR-0025's 94 MB Python CRF parser, none of
 * which it can execute. Measured on 2026-09-07: 2.1 GB of prod closure against 449 MB for food's own — and
 * the sandbox path is worse still, because only `prod-deploy.yml` prunes, so a preview image shipped the
 * full DEV tree.
 *
 * That cost is paid twice per deploy. Once pushing the layer to ECR, and again on every Fargate task start,
 * which pulls it inside the ECS stabilisation window that sits on the deploy's critical path.
 *
 * ## Why a guard rather than trusting the build to fail
 *
 * Half of this contract IS self-detecting: delete the prune step and the `COPY .docker-prune/food/json/`
 * fails loudly on a missing path. The other half is not. Someone repairing that failure has two options —
 * restore the prune step, or "simplify" the Dockerfile back to `COPY node_modules` — and the second one
 * builds clean, boots clean, passes every existing guard, and silently restores a ~1.5 GB image. Nothing
 * else in the tree would notice, because no test asserts what an image does NOT contain.
 *
 * ⛔ The workflow half is discovered, not enumerated: any workflow that builds this Dockerfile must produce
 * the skeleton, so a third pipeline added tomorrow is covered the day it lands. Both `_sandbox-preview.yml`
 * and `prod-deploy.yml` build it today, and the second was nearly missed — the change was written against
 * the sandbox path alone, which would have broken production deploys.
 *
 * ⚠️ Ordering against `npm prune --omit=dev` is NOT asserted here. `postPruneToolchain.test.ts` already owns
 * it and derives the answer from the manifests and the lockfile — it catches this exact step placed below
 * the prune, reporting `turbo: REMOVED by the prune`, which was verified by mutation rather than assumed.
 * A second copy of that rule here could disagree with the first.
 *
 * DESIGN PATTERN: Specification module over a pure predicate — {@link brokenPrunedImageContracts} is a
 * verdict over plain data, fired at deliberately-violating fakes as well as at the working tree.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const WORKFLOW_DIR = join(repoRoot, '.github', 'workflows');

/** The Dockerfile this contract governs, and the skeleton directory it installs from. */
const PRUNED_IMAGES: readonly { readonly dockerfile: string; readonly outDir: string }[] = [
    { dockerfile: 'packages/services/food-service/Dockerfile', outDir: '.docker-prune/food' },
];

/** What one pruned image looks like across the tree. */
export interface PrunedImageFacts {
    /** Repo-relative Dockerfile path. */
    readonly dockerfile: string;
    /** The skeleton directory its first stage installs from. */
    readonly outDir: string;
    /** Whether the Dockerfile COPYs the build context's ROOT `node_modules` — the shape this replaced. */
    readonly copiesRootNodeModules: boolean;
    /** Whether it installs from the skeleton. */
    readonly installsFromSkeleton: boolean;
    /** Workflow files that run `docker buildx build` against this Dockerfile. */
    readonly builders: readonly string[];
    /** Of those, the ones that never produce the skeleton. */
    readonly buildersMissingPrune: readonly string[];
}

/**
 * The ways a pruned image's contract can be broken.
 *
 * @param images - The facts for every pruned image.
 * @returns One explanatory line per breach, empty when all hold.
 */
export function brokenPrunedImageContracts(images: readonly PrunedImageFacts[]): readonly string[] {
    return images.flatMap((image) => {
        const findings: string[] = [];

        if (image.copiesRootNodeModules) {
            findings.push(
                `${image.dockerfile}: COPYs the context root node_modules, which ships every workspace's dependencies — install from ${image.outDir} instead`,
            );
        }

        if (!image.installsFromSkeleton) {
            findings.push(`${image.dockerfile}: does not install from ${image.outDir}`);
        }

        if (image.builders.length === 0) {
            findings.push(`${image.dockerfile}: no workflow builds it, so this contract is vacuous`);
        }

        for (const builder of image.buildersMissingPrune) {
            findings.push(
                `${builder}: builds ${image.dockerfile} without producing ${image.outDir} first — the COPY will fail`,
            );
        }

        return findings;
    });
}

/**
 * Read the Dockerfiles and workflows, and derive each pruned image's facts.
 *
 * @returns The facts, in declaration order.
 * @sideEffect Reads the working tree.
 */
function prunedImageFacts(): readonly PrunedImageFacts[] {
    const workflows = readdirSync(WORKFLOW_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .map((file) => ({ file, text: readFileSync(join(WORKFLOW_DIR, file), 'utf8') }));

    // ⛔ THE SECOND KIND OF BUILDER. `deploy-infra.yml` builds every service image through the composite
    // action, which parameterises BOTH halves this guard matches on: the Dockerfile path and the prune
    // directory are inputs (`docker buildx build -f "${DOCKERFILE}"`, `--out-dir=".docker-prune/${PRUNE_DIR}"`),
    // so the literals live at the CALL SITE and a text scan of the workflows sees neither. Scanning text
    // alone silently dropped this builder to zero and left `prod-deploy.yml` asserting on its own.
    const callSites = Object.entries(
        (
            parse(readFileSync(join(WORKFLOW_DIR, 'deploy-infra.yml'), 'utf8')) as {
                jobs?: Record<string, { steps?: { uses?: string; with?: Record<string, string> }[] }>;
            }
        ).jobs ?? {},
    ).flatMap(([job, definition]) => {
        const step = (definition.steps ?? []).find(({ uses }) => uses?.endsWith('infra-package'));

        return step?.with?.['dockerfile'] ? [{ job, inputs: step.with }] : [];
    });

    return PRUNED_IMAGES.map(({ dockerfile, outDir }) => {
        const text = readFileSync(join(repoRoot, dockerfile), 'utf8');
        const textBuilders = workflows
            .filter((workflow) => workflow.text.includes('docker buildx build') && workflow.text.includes(dockerfile))
            .map((workflow) => ({
                file: workflow.file,
                prunes: new RegExp(`turbo prune[^\\n]*${outDir}`).test(workflow.text),
            }));

        // The call site prunes iff it SELECTED the turbo strategy and pointed it at this image's directory —
        // the same two facts the regex above reads out of a literal command.
        const actionBuilders = callSites
            .filter(({ inputs }) => inputs['dockerfile'] === dockerfile)
            .map(({ job, inputs }) => ({
                file: `deploy-infra.yml::${job}`,
                prunes:
                    inputs['image-build-context'] === 'turbo-prune' &&
                    `.docker-prune/${inputs['prune-dir'] ?? ''}` === outDir,
            }));

        const builders = [...textBuilders, ...actionBuilders];

        return {
            dockerfile,
            outDir,
            // Anchored: `COPY node_modules …` from the context root, not `COPY --from=deps /app/node_modules`.
            copiesRootNodeModules: /^COPY\s+node_modules\s/m.test(text),
            installsFromSkeleton: text.includes(outDir),
            builders: builders.map(({ file }) => file),
            buildersMissingPrune: builders.filter(({ prunes }) => !prunes).map(({ file }) => file),
        };
    });
}

/** A fact set that satisfies every clause, for the unit cases to vary one field at a time. */
function intact(): PrunedImageFacts {
    return {
        dockerfile: 'packages/services/food-service/Dockerfile',
        outDir: '.docker-prune/food',
        copiesRootNodeModules: false,
        installsFromSkeleton: true,
        builders: ['deploy-infra.yml::food-service', 'prod-deploy.yml'],
        buildersMissingPrune: [],
    };
}

describe('brokenPrunedImageContracts', () => {
    it('is quiet when both halves hold', () => {
        expect(brokenPrunedImageContracts([intact()])).toEqual([]);
    });

    it('catches a Dockerfile "simplified" back to the wholesale COPY', () => {
        expect(brokenPrunedImageContracts([{ ...intact(), copiesRootNodeModules: true }])).toEqual([
            expect.stringContaining('ships every workspace'),
        ]);
    });

    it('catches a workflow that builds the image without producing the skeleton', () => {
        expect(brokenPrunedImageContracts([{ ...intact(), buildersMissingPrune: ['prod-deploy.yml'] }])).toEqual([
            expect.stringContaining('prod-deploy.yml'),
        ]);
    });

    it('refuses to pass vacuously when nothing builds the image', () => {
        expect(brokenPrunedImageContracts([{ ...intact(), builders: [], buildersMissingPrune: [] }])).toEqual([
            expect.stringContaining('vacuous'),
        ]);
    });
});

/** Where a bare specifier can be written, ignoring the same text inside a comment. */
/**
 * The packages the Dockerfile deletes after installing.
 *
 * @param dockerfile - Repo-relative Dockerfile path.
 * @returns The deleted package names, in declaration order.
 * @sideEffect Reads the working tree.
 */
export function deletedPackages(dockerfile: string): readonly string[] {
    const line = readFileSync(join(repoRoot, dockerfile), 'utf8')
        .split('\n')
        .find((candidate) => candidate.startsWith('RUN rm -rf node_modules/'));

    return [...(line ?? '').matchAll(/node_modules\/(@?[^\s]+)/g)].map(([, name]) => name as string);
}

describe('no image deletes packages out of the tree it just installed', () => {
    /**
     * ⛔ THE INVARIANT INVERTED, and the history is the argument for it.
     *
     * `food-service/Dockerfile` used to end with
     * `rm -rf node_modules/aws-cdk-lib node_modules/aws-cdk node_modules/constructs node_modules/prettier
     * node_modules/webpack` — ~200 MB of a 449 MB tree — and this suite guarded the deletions by proving each
     * name was unreachable from food's runtime import closure. The guard was sound and it earned its keep
     * (it REFUSED `react-dom`, which is reachable through `@tanstack/react-query`, after the container had
     * already booted cleanly without it).
     *
     * But it was guarding the wrong thing. Those packages were in the image because they were DECLARED as
     * production dependencies — `aws-cdk-lib`/`constructs`/the CLI at the root, which every service image
     * copies. Deleting them afterwards is a housekeeping fix for a declaration bug: invisible to every other
     * image, silently divergent from what the lockfile says shipped, and it outlived its own reason.
     *
     * The declarations are correct now — CDK belongs to the `infra/` packages, and the root declares no
     * production dependencies at all — so nothing needs deleting.
     *
     * ⚠️ The reachability ORACLE that judged those deletions is gone with them — some 150 lines that walked
     * the service's `dist`, every shipped workspace `dist`, and `node_modules` transitively, to decide whether
     * a named package was truly unreachable. It was good work and it earned its keep once (it REFUSED
     * `react-dom`, reachable through `@tanstack/react-query`, after the container had already booted cleanly
     * without it). But it judged a practice that no longer happens, and machinery kept "in case" is exactly
     * the weight this file now argues against. The rule below is the guard; if a deletion is ever
     * reintroduced, it fails here and whoever needs the analysis can restore it from history.
     */
    it('no Dockerfile removes anything from node_modules', () => {
        const offenders = execFileSync('git', ['ls-files', '*Dockerfile'], { cwd: repoRoot, encoding: 'utf8' })
            .split('\n')
            .filter(Boolean)
            .filter((file) => deletedPackages(file).length > 0)
            .map((file) => `${file} deletes ${deletedPackages(file).join(', ')}`);

        expect(
            offenders,
            'Fix where the package is DECLARED instead. A deletion here does not apply to any other image, ' +
                'diverges from the lockfile, and outlives the reason it was added — which is exactly what ' +
                'happened to the list this replaced.',
        ).toEqual([]);
    });
});

describe("food's image installs its own dependency closure, on every path that builds it", () => {
    it('is not vacuous: both known pipelines build it', () => {
        const [food] = prunedImageFacts();

        // ⚠️ `deploy-infra.yml::food-service`, not `_sandbox-preview.yml`: the preview's two deploy jobs were
        // retired so one workflow owns every `cdk deploy`, and the image build went with them.
        expect(food?.builders).toEqual(expect.arrayContaining(['deploy-infra.yml::food-service', 'prod-deploy.yml']));
    });

    it('holds across the Dockerfile and every workflow that builds it', () => {
        expect(brokenPrunedImageContracts(prunedImageFacts())).toEqual([]);
    });
});
