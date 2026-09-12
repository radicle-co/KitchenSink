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

import { Template } from 'aws-cdk-lib/assertions';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { withoutComments } from './cdkApps.js';
import { DataStack } from '../lib/platform/DataStack.js';
import { NetworkStack } from '../lib/platform/NetworkStack.js';
import { testApp } from './testApp.js';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));
const DATA_STACK = fileURLToPath(new URL('../lib/platform/DataStack.ts', import.meta.url));

interface WorkflowStep {
    readonly name?: string;
    readonly run?: string;
    /** Where the step runs. Load-bearing for a package outside the npm workspace — see `bundlesGlobalHandlers`. */
    readonly 'working-directory'?: string;
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

    // ⚠️ THE ENTRYPOINT, not the package. `packages/infra/global` now holds TWO apps: `bin/app.ts`, which
    // owns `DataStack` and its bootstrap Lambdas, and `bin/account.ts`, which owns only the account's cost
    // guardrails and constructs no handler at all. Matching the package directory demanded a `bundle:lambda`
    // step from a workflow that deploys no Lambda — a bundle that would build nothing, to satisfy a guard
    // about a stack the app never constructs. What this guard is actually about is the app that owns
    // `DataStack`, so that is what it names.
    return /cdk deploy/.test(run) && /infra\/global\/bin\/app\.ts/.test(run);
}

/** True when this step bundles the global package's lambda handlers. */
function bundlesGlobalHandlers(step: WorkflowStep): boolean {
    // Comments stripped for the same reason as `deploysGlobalApp` above.
    const run = withoutComments(step.run ?? '');

    // ⚠️ THE PACKAGE MAY BE NAMED BY `working-directory:` RATHER THAN INSIDE THE COMMAND. `infra-global`
    // installs outside the npm workspace so `aws-cdk-lib` never reaches the root tree, which means npm can
    // no longer address it as `--workspace=packages/infra/global` — the step is now a bare `bundle:lambda`
    // run from that directory. Reading only `run:` reported both real deployers as never bundling at all,
    // which is this guard failing OPEN on a workflow that is correct.
    const target = `${run}\n${step['working-directory'] ?? ''}`;

    return /bundle:lambda/.test(run) && /packages\/infra\/global/.test(target);
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

/**
 * ⛔ EVERY BUNDLED HANDLER `DataStack` DEPLOYS MUST BE AN `esbuild.mjs` ENTRY POINT.
 *
 * `serviceInfraWiringInvariants.test.ts` asserts exactly this for `packages/services/*` — because
 * `recipe-workers/esbuild.mjs` once declared five entry points while its stack deployed six Lambdas, and the
 * sixth shipped code that was never bundled. That gate walks `packages/services`, so this package was never
 * covered by it, and `DataStack` now deploys three bundled handlers.
 *
 * Both sides are DERIVED and nothing is enumerated: the handlers come from `DataStack.ts`'s own string
 * literals in esbuild's `outbase: src` shape, and the entry points from the `entryPoints` binding in
 * `esbuild.mjs`. A handler added tomorrow is covered the day it is written.
 */
describe('DataStack bundles every handler it deploys', () => {
    const dataStack = readFileSync(DATA_STACK, 'utf8');
    const bundler = readFileSync(fileURLToPath(new URL('../esbuild.mjs', import.meta.url)), 'utf8');

    /**
     * The source file a `handler:` string resolves to under esbuild's `outbase: src` layout.
     *
     * `db-reaper/handler.handler` → `src/db-reaper/handler.ts`; the trailing segment is the EXPORT, not part
     * of the path.
     */
    const entryPointFor = (handler: string): string => `src/${handler.slice(0, handler.lastIndexOf('.'))}.ts`;

    /** Every bundled-handler string the stack names — `index.handler` is the inline stub, not a bundle. */
    const deployedHandlers = [...dataStack.matchAll(/'([a-z0-9-]+\/handler\.handler)'/g)].map(
        ([, handler]) => handler ?? '',
    );

    it('discovers the handlers — a gate that finds none passes vacuously', () => {
        // The role-model bootstrap (one function for every database since the role split) and the reaper.
        expect(deployedHandlers).toEqual(
            expect.arrayContaining(['db-bootstrap/handler.handler', 'db-reaper/handler.handler']),
        );
    });

    it.each(deployedHandlers)('bundles %s', (handler) => {
        expect(
            bundler,
            `DataStack deploys '${handler}' but esbuild.mjs does not bundle '${entryPointFor(handler)}' — the ` +
                'function would ship whatever else happens to be in dist-lambda/, or nothing at all',
        ).toContain(`'${entryPointFor(handler)}'`);
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
        const app = testApp();
        const network = new NetworkStack(app, 'Net-probe', { env: SYNTH_ENV, stage: 'prod' });
        const data = new DataStack(app, 'Data-probe', { env: SYNTH_ENV, network, stage: 'prod' });
        const resources = Template.fromStack(data).findResources('AWS::CloudFormation::CustomResource');
        const bootstraps = Object.values(resources).filter((resource) => resource.Properties?.service);

        expect(bootstraps, 'the identity, food and recipe bootstrap custom resources must be present').toHaveLength(3);

        for (const bootstrap of bootstraps) {
            // The value tracks which code shipped — the stub, or the bundle's own digest, so NEW bootstrap logic
            // re-runs it too — and must be one of those two shapes: not absent, and not a third thing a refactor
            // invented.
            expect(
                bootstrap.Properties?.codeSource,
                'a bootstrap custom resource with no codeSource never re-runs when the real bundle lands',
            ).toMatch(/^(bundle-[0-9a-f]{64}|inline-stub)$/);
        }
    });
});
