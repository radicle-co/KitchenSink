// @vitest-environment node
/**
 * Repo-wide guard: every CDK app in this repository must be DEPLOYED by some workflow.
 *
 * ## The failure this pins, for the second time
 *
 * `prodDeployReachability.test.ts` exists because the food and recipe prod legs "carried a full prod leg —
 * image push, CDK deploy, DB migration, smoke test — and neither had ever run". It gates the legs that are
 * PRESENT in `prod-deploy.yml`, so it can only ever ask whether a leg that exists is reachable. It cannot
 * ask whether a leg exists at all, and that is the shape the defect took the second time.
 *
 * `packages/services/ingredient-parser` (ADR-0025's Python CRF Lambda) shipped a stack, an asset builder, a
 * packaging guard, unit and integration tiers, and an `infra:deploy` script — and no workflow anywhere named
 * its app. Meanwhile `RecipeWorkersStack` deployed `RecipeParseLineFunction` into every stage carrying
 * `CRF_FUNCTION_NAME=kitchensink-ingredient-parser-{stage}` and an IAM grant to that ARN. Both halves were
 * green: the parser's own tests passed, the workers' stack tests passed, and the function the workers
 * invoked did not exist in any account. `crfInvoke.ts` maps a failed invoke to `unavailable` per line, and
 * the pipeline reads that as `single-engine llm` — so the two-engine parse degraded to one engine, silently,
 * behind green checks, which is ADR-0010's failure verbatim one service over.
 *
 * ## Why it is asserted this way
 *
 * The subject is DISCOVERED on both sides and enumerated on neither, because "a copy of a list cannot detect
 * that the list is incomplete" (ADR-0025 §3, on the `handle-sync-worker` outage) — and a hand-listed set of
 * apps is exactly the artefact that let this one be absent. Both derivations live in `./cdkApps.ts`, with the
 * reasoning for each; `deployVerificationCoverage.test.ts` asks a DIFFERENT question of the same two facts,
 * and a second copy of them would be the drift this whole family of guards exists to prevent.
 *
 * The reverse direction is gated too: a `--app` path that resolves to no discovered entrypoint is a typo or
 * a deleted app that a workflow still tries to deploy, and it fails the run rather than the deploy.
 *
 * ⛔ This guard deliberately does NOT assert WHICH workflow deploys an app, or that prod and sandbox agree.
 * Deployment topology is an ADR-0005/ADR-0010 decision — `@commise/web`'s router is sandbox-only on purpose,
 * and per-PR feature stages are not prod stages. What is not a decision is an app with no deployer at all.
 *
 * ⛔ Nor does it ask whether a deployed app WORKED. A stack can converge while a handler inside it is absent
 * or stale — the shape the CRF defect actually took — which is `deployVerificationCoverage.test.ts` and
 * `.github/scripts/verify-deployment.sh` one level down.
 *
 * DESIGN PATTERN: Specification module over two derivations — {@link cdkApps} and {@link deployedApps} are
 * independent readings of the same fact, compared for coverage. Neither side is the authority alone.
 */
import { describe, expect, it } from 'vitest';

import { cdkApps, deployedApps } from './cdkApps.js';

describe('CDK app deploy coverage', () => {
    it('discovers the repository’s CDK apps — the gate has not stopped seeing them', () => {
        // Vacuity guard: a discovery that silently finds nothing would make every assertion below pass.
        expect(cdkApps().length).toBeGreaterThan(1);
    });

    it('deploys every CDK app from some workflow', () => {
        const deployed = new Set(deployedApps().map(({ entrypoint }) => entrypoint));
        const undeployed = cdkApps().filter((app) => !deployed.has(app));

        expect(
            undeployed,
            'Every CDK app must be deployed by a workflow. An app with a stack, tests and an `infra:deploy` ' +
                'script that no pipeline ever runs is not "not yet wired" — it is a resource other stacks ' +
                'already reference by name and no account contains. See ADR-0025 and ADR-0010.',
        ).toEqual([]);
    });

    it('deploys only CDK apps that exist', () => {
        const apps = new Set(cdkApps());
        const dangling = deployedApps().filter(({ entrypoint }) => !apps.has(entrypoint));

        expect(
            dangling,
            'A workflow names a CDK entrypoint this repository does not define — a typo, or an app that ' +
                'was deleted while its deploy step stayed behind. Either way the deploy fails at run time.',
        ).toEqual([]);
    });
});
