// @vitest-environment node
/**
 * Repo-wide guard: the DataStack's bootstrap handlers must SHIP, and must never fake success.
 *
 * ## The failure this pins
 *
 * `DataStack` provisions the `food_app` / `recipe_app` IAM-auth roles and their base databases through two
 * master-connected custom resources, bundled by `esbuild.mjs` into the package-root `dist-lambda/`. When
 * that directory is absent at synth time the stack falls back to an INLINE placeholder so that a bare
 * `cdk synth` still works.
 *
 * Two things then went wrong together:
 *
 *   1. `prod-deploy.yml` ran `npm run build` (tsc only — it does NOT bundle) and then invoked `cdk deploy`
 *      directly rather than the package's `deploy` script, which does `bundle:lambda && cdk deploy`. So
 *      `dist-lambda/` never existed in CI and the placeholder shipped every time.
 *   2. The placeholder RETURNED SUCCESS. CloudFormation recorded `CREATE_COMPLETE` for a 101-byte handler
 *      that created no role and no database.
 *
 * Prod therefore ran for four weeks with no `food_app` role at all, behind a green deploy, and the damage
 * surfaced only when the first food migration failed with `password authentication failed for user
 * "food_app"` — in a different service, weeks later, pointing at nothing resembling the cause.
 *
 * A no-op that reports success is strictly worse than a crash: it converts a loud, immediate, local failure
 * into a silent one that is discovered somewhere else entirely. Both halves are asserted here — the build
 * step must exist, and the fallback must refuse to claim success.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/prod-deploy.yml', import.meta.url));
const DATA_STACK = fileURLToPath(new URL('../lib/platform/data-stack.ts', import.meta.url));

interface WorkflowStep {
    readonly name?: string;
    readonly run?: string;
}

/** The single deploy job's steps, in file order. */
function steps(): readonly WorkflowStep[] {
    const doc = parse(readFileSync(WORKFLOW, 'utf8')) as {
        jobs: Record<string, { steps?: WorkflowStep[] }>;
    };

    return Object.values(doc.jobs)[0]?.steps ?? [];
}

describe('prod-deploy.yml — the DataStack bootstrap handlers are bundled before deploy', () => {
    it('bundles the global custom-resource handlers', () => {
        const bundling = steps().filter(
            (step) => /bundle:lambda/.test(step.run ?? '') && /packages\/infra\/global/.test(step.run ?? ''),
        );

        expect(
            bundling.length,
            'no step runs `bundle:lambda` for packages/infra/global, so dist-lambda/ is absent at synth and ' +
                'the DataStack ships an inline placeholder instead of the real bootstrap handlers',
        ).toBeGreaterThan(0);
    });

    it('bundles BEFORE the global CDK deploy that consumes the asset', () => {
        const all = steps();
        const bundleIndex = all.findIndex(
            (step) => /bundle:lambda/.test(step.run ?? '') && /packages\/infra\/global/.test(step.run ?? ''),
        );
        // The global deploy is the one that synthesizes DataStack (`--app .../infra/global/...`).
        const deployIndex = all.findIndex(
            (step) => /cdk deploy/.test(step.run ?? '') && /infra\/global/.test(step.run ?? ''),
        );

        expect(deployIndex, 'expected a `cdk deploy` step for the global infra app').toBeGreaterThan(-1);
        expect(
            bundleIndex,
            'the bundle step must precede the global cdk deploy — synth reads dist-lambda/ at deploy time',
        ).toBeLessThan(deployIndex);
    });
});

describe('DataStack — the missing-bundle placeholder never reports success', () => {
    const source = readFileSync(DATA_STACK, 'utf8');

    it('throws instead of returning a PhysicalResourceId on Create/Update', () => {
        // The exact shape that caused the outage: a handler whose only behaviour is to resolve with an ID.
        // If a placeholder ever returns success unconditionally again, this fails.
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
        // Custom resources re-run on PROPERTY change, not on code change. Without a property that tracks
        // which code shipped, a stage bootstrapped by the placeholder stays un-bootstrapped forever even
        // after the real bundle starts deploying — exactly prod's position before this fix.
        const occurrences = source.match(/codeSource: hasLambdaAsset \? 'bundle' : 'inline-stub'/g) ?? [];

        expect(occurrences, 'both the food and recipe custom resources need the codeSource property').toHaveLength(2);
    });
});
