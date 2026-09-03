// @vitest-environment node
/**
 * Repo-wide guard: EVERY workflow that deploys the global infra app must bundle its custom-resource
 * handlers first, and the missing-bundle placeholder must never fake success.
 *
 * ## The failure this pins
 *
 * `DataStack` provisions the `food_app` / `recipe_app` IAM-auth roles and their base databases through two
 * master-connected custom resources, bundled by `esbuild.mjs` into the package-root `dist-lambda/`. When
 * that directory is absent at synth time the stack falls back to an INLINE placeholder, so that a bare
 * `cdk synth` (and the snapshot tests) still work without a bundle step.
 *
 * Two faults combined:
 *
 *   1. The deploying workflows ran `npm run build` (tsc only — it does NOT bundle) and then invoked
 *      `cdk deploy` directly, rather than the package's `deploy` script, which is
 *      `bundle:lambda && cdk deploy`. So `dist-lambda/` never existed in CI and the placeholder shipped.
 *   2. The placeholder RETURNED SUCCESS. CloudFormation recorded `CREATE_COMPLETE` for a 101-byte handler
 *      that created no role and no database.
 *
 * Prod therefore ran for four weeks with no `food_app` role at all, behind green deploys, and the damage
 * surfaced only when the first food migration failed with `password authentication failed for user
 * "food_app"` — in a different service, weeks later, pointing nowhere near the cause. Measured at the time:
 * all four bootstrap functions across BOTH stages were 217/219-byte stubs.
 *
 * A no-op that reports success is strictly worse than a crash: it converts a loud, immediate, local failure
 * into a silent one discovered somewhere else entirely.
 *
 * ## Why it is asserted this way
 *
 * The workflow list is DISCOVERED, not hardcoded. The original guard named `prod-deploy.yml` only, which is
 * exactly how `sandbox-identity-deploy.yml` — the other deployer of this same app — kept the defect after
 * prod was fixed. Any future workflow that deploys the global app is covered the moment it is added.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { withoutComments } from './cdkApps.js';
import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));
const DATA_STACK = fileURLToPath(new URL('../lib/platform/DataStack.ts', import.meta.url));

interface WorkflowStep {
    readonly name?: string;
    readonly run?: string;
}

/** Every `run:` body in a workflow, flattened across all jobs, in file order. */
function runSteps(file: string): readonly WorkflowStep[] {
    const doc = parse(readFileSync(WORKFLOW_DIR + file, 'utf8')) as {
        jobs?: Record<string, { steps?: WorkflowStep[] }>;
    };

    return Object.values(doc.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

/** True when this step deploys the GLOBAL infra CDK app (the one that owns DataStack). */
function deploysGlobalApp(step: WorkflowStep): boolean {
    // ⛔ COMMENTS STRIPPED FIRST — prose is not code. `prod-deploy.yml`'s "Compute deploy flags" step
    // carries a comment mentioning `cdk deploy` while a real line names `packages/infra/global/bin/app.ts`,
    // so the raw text satisfied both halves and the step matched at index 4, putting the apparent "global
    // deploy" BEFORE the bundle step and reddening this guard against a correctly-ordered workflow. Its
    // sibling `prodDeployMigrationOrder.test.ts` was repaired for the same reason on the same day.
    const run = withoutComments(step.run ?? '');

    return /cdk deploy/.test(run) && /infra\/global/.test(run);
}

/** True when this step bundles the global package's lambda handlers. */
function bundlesGlobalHandlers(step: WorkflowStep): boolean {
    // Comments stripped for the same reason as `deploysGlobalApp` above.
    const run = withoutComments(step.run ?? '');

    return /bundle:lambda/.test(run) && /packages\/infra\/global/.test(run);
}

/**
 * Workflows that deploy the global app — discovered by reading them, so the set cannot silently grow past
 * this guard.
 */
function globalDeployWorkflows(): readonly string[] {
    return readdirSync(WORKFLOW_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .filter((file) => runSteps(file).some(deploysGlobalApp));
}

describe('every workflow that deploys the global infra app bundles its handlers first', () => {
    const workflows = globalDeployWorkflows();

    it('finds the known deployers (guard is wired to real files)', () => {
        // Anchor: if this list ever empties — a rename, a restructure — the per-workflow assertions below
        // would vacuously pass. Naming the two known deployers keeps that from going unnoticed.
        expect(workflows).toContain('prod-deploy.yml');
        expect(workflows).toContain('sandbox-identity-deploy.yml');
    });

    it.each(workflows)('%s bundles the handlers before deploying the global app', (file) => {
        const steps = runSteps(file);
        const bundleIndex = steps.findIndex(bundlesGlobalHandlers);
        const deployIndex = steps.findIndex(deploysGlobalApp);

        expect(
            bundleIndex,
            `${file} never runs \`bundle:lambda\` for packages/infra/global, so dist-lambda/ is absent at ` +
                'synth and DataStack ships the inline placeholder instead of the real bootstrap handlers',
        ).toBeGreaterThan(-1);
        expect(
            bundleIndex,
            `${file} bundles AFTER its global cdk deploy — synth reads dist-lambda/ at deploy time`,
        ).toBeLessThan(deployIndex);
    });

    it.each(workflows)('%s bundles before the prune that would delete esbuild', (file) => {
        const steps = runSteps(file);
        const bundleIndex = steps.findIndex(bundlesGlobalHandlers);
        const pruneIndex = steps.findIndex((step) => /npm prune/.test(step.run ?? ''));

        if (pruneIndex === -1) {
            // Not every deployer prunes; nothing to order against.
            return;
        }

        // `bundle:lambda` runs esbuild, a devDependency. `npm prune --omit=dev` removes it, so a bundle step
        // on the far side of the prune dies with exit 127 — the same one-way door that broke the food and
        // recipe image builds. Ordering, not presence, is the invariant here.
        expect(
            bundleIndex,
            `${file} bundles after \`npm prune --omit=dev\`, which deletes esbuild → exit 127`,
        ).toBeLessThan(pruneIndex);
    });
});

/** A synth-only account/region; nothing here is deployed. */
const SYNTH_ENV = { account: '123456789012', region: 'us-east-1' };

describe('DataStack — the missing-bundle placeholder never reports success', () => {
    const source = readFileSync(DATA_STACK, 'utf8');

    it('throws instead of returning a PhysicalResourceId on Create/Update', () => {
        // The exact shape that caused the outage: a handler whose only behaviour is to resolve with an ID.
        const silentNoOp = /exports\.handler\s*=\s*async\s*\(e\)\s*=>\s*\(\{\s*PhysicalResourceId/;

        expect(
            silentNoOp.test(source),
            'the inline fallback resolves with a PhysicalResourceId unconditionally — that is the ' +
                'success-returning no-op that let prod deploy with no food_app/recipe_app role',
        ).toBe(false);
        expect(source, 'the fallback must throw so a bundle-less deploy fails loudly').toMatch(/throw new Error\(/);
    });

    it('still no-ops on Delete, so a stack delete cannot wedge on it', () => {
        // A throwing Delete would strand the stack in DELETE_FAILED — the placeholder has to let go.
        expect(source).toMatch(/RequestType === 'Delete'/);
    });

    it('re-runs the bootstrap when the handler flips from placeholder to real bundle', () => {
        // Custom resources re-run on PROPERTY change, not on code change. Without a property tracking which
        // code shipped, a stage bootstrapped by the placeholder stays un-bootstrapped forever even after the
        // real bundle starts deploying — exactly prod's position before this fix.
        //
        // REWRITTEN 2026-08-18 to assert the SYNTHESIZED TEMPLATE rather than to grep this file for the
        // literal `codeSource: hasLambdaAsset ? …`. The grep proved a string appeared in a source file, which
        // is not the invariant: it would pass on a `codeSource` computed into a variable that never reached
        // a resource, and it broke the moment the expression was refactored (the probe moved to module scope
        // to stop two stacks in one synth disagreeing) even though the property it guards was untouched.
        // Reading it off the template proves the property is actually ON both custom resources, which is the
        // thing CloudFormation compares.
        const app = new App();
        const network = new NetworkStack(app, 'Net-probe', { env: SYNTH_ENV, stage: 'prod' });
        const data = new DataStack(app, 'Data-probe', { env: SYNTH_ENV, network, stage: 'prod' });
        const resources = Template.fromStack(data).findResources('AWS::CloudFormation::CustomResource');
        const bootstraps = Object.values(resources).filter(
            (resource) => resource.Properties?.foodDatabaseName || resource.Properties?.recipeDatabaseName,
        );

        expect(bootstraps, 'both the food and recipe bootstrap custom resources must be present').toHaveLength(2);

        for (const bootstrap of bootstraps) {
            // The value tracks which code shipped, so it must be one of the two known states — not absent,
            // and not some third thing a refactor invented.
            expect(
                bootstrap.Properties?.codeSource,
                'a bootstrap custom resource with no codeSource never re-runs when the real bundle lands',
            ).toMatch(/^(bundle|inline-stub)$/);
        }
    });
});
