// @vitest-environment node
/**
 * Repo-wide guard: EVERY CDK app `prod-deploy.yml` deploys is wired into the deploy-graph closure, and every
 * cross-app import it can reach has a producer that same workflow can force (2026-09-02).
 *
 * ## The failure this catches
 *
 * `prod-deploy.yml` decided each deploy leg on its own `dorny/paths-filter` group. That answers "did this
 * leg's sources change" and cannot answer "is the leg this one DEPENDS ON going to run" — and those are
 * different questions. A change touching only `packages/services/identity-webhooks/**` set
 * `deploy_webhooks=true` and `deploy_global=false`, while `WebhooksStack` resolves
 * `kitchensink-service-logs-{stage}:IdentityServiceLogGroupName` — an export of `ServiceLogsStack`, which
 * ADR-0028 made a child of the GLOBAL app. The ADR recorded that the new stack "already deploys before both
 * consumers — so no deploy order changed": true of the ORDER, false of the GATE, because the earlier leg does
 * not run at all.
 *
 * Measured against the live account on 2026-09-02, `kitchensink-service-logs-prod` DOES NOT EXIST (ADR-0028
 * added it on 2026-08-30; prod has had no platform deploy since), so the next webhooks-only merge would have
 * failed inside `cdk deploy` on `No export named … found`. `IdentityServiceStack` imports the very same
 * export and had the identical hole — a second consumer the bug report never mentioned, and which only a
 * derivation could find.
 *
 * ## ⛔ Why nothing here is enumerated
 *
 * Three sets are DERIVED and cross-checked against each other, and none of them is written down:
 *
 *   A. **What the workflow deploys** — every `cdk deploy --app "…"` step in `prod-deploy.yml`, paired with
 *      the `deploy_*` flag its own `if:` reads. Both spellings are normalised (`node <pkg>/dist/bin/app.js`
 *      and `npx tsx <pkg>/bin/app.ts` name one source entrypoint), and the result must exist on disk — a
 *      derivation that quietly produced a path to nothing would vouch for an empty set.
 *   B. **What the closure is told** — the `flag=value@entrypoint` arguments the flags step passes to
 *      `deploy-gate.sh close`.
 *   C. **What the CDK source actually imports** — `buildManifest().crossAppImports`, read from every
 *      `Fn.importValue` by AST.
 *
 * A ≡ B is what stops the closure's argument list falling behind a new leg. C ⊆ A is what makes a NEW
 * cross-app import fail HERE, at commit time, rather than twenty minutes into a production deploy.
 *
 * A hand-maintained producer→consumer table would have been simpler and would rot: the ALB listener priority
 * collision, the stale NAT consumer list, ADR-0025's asset guard and the ADR index all cost this repository
 * the same lesson — a copy of a list cannot detect that the list grew.
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 *   1. `deploy_webhooks=…@…identity-webhooks/infra/bin/app.ts` deleted from the closure call → 'every app
 *      this workflow deploys is handed to the closure' reports it. This is the "a new leg was added and
 *      nobody told the gate" case.
 *   2. A synthetic `Fn.importValue('kitchensink-notifications-${stage}:TopicArn')` added to
 *      `WebhooksStack.ts` → 'every cross-app import a deployed app makes has a producer this workflow can
 *      force' reports it, because no app declares that stack. This is the "somebody wrote a new cross-app
 *      import" case, and it is the one an enumerated table cannot catch.
 *   3. The whole `close` invocation deleted from the flags step → 'the flags step closes the graph before
 *      publishing' reports it, and `prodDeployReachability.test.ts` reds alongside.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';
import { buildManifest } from '../../../../scripts/infrastructureManifest.mjs';

const WORKFLOW = path.join(repoRoot, '.github/workflows/prod-deploy.yml');

interface WorkflowStep {
    readonly name?: string;
    readonly id?: string;
    readonly if?: string;
    readonly run?: string;
    readonly env?: Readonly<Record<string, unknown>>;
}

/** The single deploy job's steps, in file order. */
function steps(): readonly WorkflowStep[] {
    const jobs = (parse(readFileSync(WORKFLOW, 'utf8')) as { jobs: Record<string, { steps?: WorkflowStep[] }> }).jobs;

    return Object.values(jobs)[0]?.steps ?? [];
}

/**
 * Normalise a `cdk deploy --app` argument to the SOURCE entrypoint it runs.
 *
 * Two spellings are in use — `node <pkg>/infra/dist/bin/app.js` for the packages this workflow builds with
 * `tsc`, and `npx tsx <pkg>/infra/bin/app.ts` for the two it runs straight from source. Both name one file,
 * and the manifest keys everything on the `.ts`.
 *
 * @param appArgument - The quoted value of `--app`.
 * @returns The repo-relative `bin/app.ts`. Pure.
 */
function entrypointOf(appArgument: string): string {
    return appArgument
        .replace(/^(?:node|npx tsx)\s+/u, '')
        .replace(/\/dist\/bin\/app\.js$/u, '/bin/app.ts')
        .trim();
}

/** Set A — every app the workflow deploys, mapped to the flag its own `if:` gates on. */
function deployedApps(): ReadonlyMap<string, string> {
    const found = new Map<string, string>();

    for (const step of steps()) {
        const app = /cdk deploy --app "([^"]+)"/u.exec(step.run ?? '')?.[1];

        if (app === undefined) {
            continue;
        }

        const flag = /steps\.flags\.outputs\.(deploy_[a-z_]+)/u.exec(step.if ?? '')?.[1];

        // A deploy step with no flag-derived guard would be UNGATED, which this guard cannot reason about
        // and a reader must not mistake for "covered". Surface it as an empty flag rather than skipping.
        found.set(entrypointOf(app), flag ?? '(ungated)');
    }

    return found;
}

/** The `Compute deploy flags` step, which this guard is anchored on by name. */
function flagsStep(): WorkflowStep & { readonly run: string } {
    const step = steps().find((candidate) => candidate.name === 'Compute deploy flags');

    if (step?.run === undefined) {
        throw new Error('prod-deploy.yml has no `Compute deploy flags` step — this guard is anchored on its name.');
    }

    return { ...step, run: step.run };
}

/** Set B — every app handed to `deploy-gate.sh close`, mapped to the flag it is given under. */
function closedApps(): ReadonlyMap<string, string> {
    const found = new Map<string, string>();

    for (const [, flag, entrypoint] of flagsStep().run.matchAll(/"(deploy_[a-z_]+)=\$[a-z_]+@([^"]+)"/gu)) {
        found.set(entrypoint as string, flag as string);
    }

    return found;
}

/** Set C — the cross-app import edges the CDK source actually declares. */
const manifest = buildManifest();

describe('prod-deploy.yml — the closure knows about every leg it gates', () => {
    it('deploys at least one app through a flag, so the derivations below are not vacuously true', () => {
        // The guard against the guard. A regex that stopped matching would make every assertion here pass on
        // two empty sets, which is the shape `deployGateStepGuards.test.ts` was written to avoid.
        expect(deployedApps().size).toBeGreaterThanOrEqual(5);
        expect(closedApps().size).toBeGreaterThanOrEqual(5);
    });

    it('derives entrypoints that actually exist, in both `--app` spellings', () => {
        // `node …/dist/bin/app.js` and `npx tsx …/bin/app.ts` must both normalise onto a real file. A silent
        // mis-normalisation would give the closure a key nothing ever matches, and it would look wired.
        const derived = [...deployedApps().keys()].sort();

        expect([...presentFiles(derived)].sort()).toEqual(derived);
    });

    it('every app this workflow deploys is handed to the closure, under the SAME flag', () => {
        // ⛔ A new leg whose app is not in the closure call is a leg the graph cannot close — and it would
        // look completely normal in review, because the leg itself is complete.
        expect(Object.fromEntries(closedApps())).toEqual(Object.fromEntries(deployedApps()));
    });

    it('gates every `cdk deploy` on a flag, so no leg escapes the closure by being ungated', () => {
        expect([...deployedApps()].filter(([, flag]) => flag === '(ungated)')).toEqual([]);
    });
});

describe('prod-deploy.yml — every reachable cross-app import has a producer this workflow can force', () => {
    /**
     * ⛔ THE ASSERTION THIS FILE EXISTS FOR. It reads the CDK SOURCE, not a table, so a `Fn.importValue`
     * written tomorrow is covered tomorrow. `deploy-gate.sh close` refuses at run time when a deploying
     * consumer's producer is not a leg it was given; this makes that refusal a COMMIT-time failure instead of
     * a failed production deploy.
     */
    it('has a deployable producer for every edge whose consumer this workflow deploys', () => {
        const deployed = deployedApps();
        const orphaned = manifest.crossAppImports
            .filter(
                (edge: { consumerEntrypoint: string; producerEntrypoint: string }) =>
                    deployed.has(edge.consumerEntrypoint) && !deployed.has(edge.producerEntrypoint),
            )
            .map(
                (edge: { consumerEntrypoint: string; producerEntrypoint: string; exportName: string }) =>
                    `${edge.consumerEntrypoint} needs ${edge.exportName} from ${edge.producerEntrypoint}`,
            );

        expect(
            orphaned,
            'these apps deploy from prod-deploy.yml and import an export produced by a CDK app the same ' +
                'workflow does not deploy — nothing can order that, so the deploy fails on `No export named …`',
        ).toEqual([]);
    });

    it('reports no import whose producer the manifest could not name at all', () => {
        // An unresolved import is an edge the closure cannot see. `deploy-gate.sh unmet-imports` refuses to
        // run against an edge file carrying one; this says the same thing at the source.
        expect(manifest.unresolvedImports).toEqual([]);
    });

    it('still sees the ADR-0028 edge, so this suite cannot pass on an empty graph', () => {
        // If the derivation silently returned nothing, every assertion above would pass. This is the canary.
        const logGroupEdges = manifest.crossAppImports.filter((edge: { exportName: string }) =>
            /^kitchensink-service-logs-\{\w+\}:IdentityServiceLogGroupName$/u.test(edge.exportName),
        );

        expect(logGroupEdges.map((edge: { consumerEntrypoint: string }) => edge.consumerEntrypoint).sort()).toEqual([
            'packages/services/identity-webhooks/infra/bin/app.ts',
            'packages/services/identity/infra/bin/app.ts',
        ]);
    });
});

describe('prod-deploy.yml — the probe and the closure are wired to each other, in that order', () => {
    it('probes the exports BEFORE the flags that every later `if:` reads', () => {
        // A probe that ran after the flags could not change one. Positional, for the reason
        // `prodDeployMigrationOrder.test.ts` gives: the invariant is about WHERE a step sits.
        const order = steps().map((step) => step.id ?? step.name ?? '');

        expect(order.indexOf('imports')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('imports')).toBeLessThan(order.indexOf('flags'));
    });

    it('resolves the exports with the shared helper, never an open-coded `list-exports`', () => {
        // ADR-0005: `list-exports --query …` is wrong per PAGE and was wrong in ten places. The probe reaches
        // CloudFormation only through `deploy-gate.sh`, which reaches it only through `cfn-export.sh`.
        const probe = steps().find((step) => step.id === 'imports');

        expect(probe?.run).toContain('deploy-gate.sh unmet-imports');
        expect(probe?.run).not.toContain('list-exports');
    });

    it('the flags step closes the graph before publishing, and reads the probe as DATA', () => {
        const step = flagsStep();

        expect(step.run).toContain('deploy-gate.sh close');
        // zizmor `template-injection`: the value arrives through `env:`, so it can never be script text.
        expect(Object.values(step.env ?? {}).join(' ')).toContain('steps.imports.outputs.unmet_imports');
        expect(step.run).not.toContain('${{');
    });
});
