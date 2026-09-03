/**
 * Repo-wide guard: the per-PR **ensure-exists** deploy gate (`.github/scripts/deploy-gate.sh`).
 *
 * ## The invariant this protects (issue #124)
 *
 * Every PR preview must be a COMPLETE ecosystem — recipe-service, recipe-workers AND food-service all
 * present for `pr-{N}`. Before this gate, each deploy job was gated purely on `dorny/paths-filter`, so a
 * recipe-only PR deployed no food service at all; `RECIPE_FOOD_SERVICE_URL` then named a host that did not
 * resolve and the ingredient typeahead silently degraded to `catalogAvailability: 'unavailable'` for the whole
 * preview. "Redeploy everything on every push" would fix that by brute force — and rebuild two Docker images
 * for a README-only push. This gate encodes the cheaper semantics instead:
 *
 *   > deploy when the sources CHANGED, **or** when the per-PR stack is absent / not in a usable state,
 *   > **or** when the origin it should be serving does not answer. Skip only when it is both unchanged and
 *   > already serving.
 *
 * So a fresh docs-only PR deploys the whole ecosystem once (nothing exists yet) and every later push to it
 * skips — while a torn-down or half-rolled-back preview self-heals on the next push.
 *
 * ## Why the predicates are executed as real `bash`
 *
 * Same reason as `prScope.test.ts`: a TypeScript re-implementation would be a SECOND copy of the decision
 * that could drift from the one CI actually runs. These tests shell out to the real script.
 *
 * The decision function is PURE (`changed`/`forced`/health-code/stack statuses in, verdict out); all I/O —
 * `aws cloudformation describe-stacks`, the health probe, `$GITHUB_OUTPUT` — lives in the `evaluate`
 * subcommand and is covered by `deployGate.integration.test.ts`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/deploy-gate.sh', import.meta.url));

/** One decision, as the script prints it. */
interface Decision {
    readonly deploy: boolean;
    /**
     * Whether a preview EXISTS to talk to, independent of whether this run deploys to it. The two
     * `deploy=false` outcomes mean opposite things and the workflow has to tell them apart — see the
     * `live` describe block below.
     */
    readonly live: boolean;
    readonly reason: string;
    readonly status: number;
}

/**
 * Run the pure `decide` subcommand.
 *
 * @param args - `<intent> <changed> <forced> <healthCode> [name=STATUS …]`.
 * @returns The parsed `deploy=` / `reason=` pair plus the exit status.
 * @sideEffect Spawns `bash`.
 */
const decide = (...args: readonly string[]): Decision => {
    const result = spawnSync('bash', [SCRIPT, 'decide', ...args], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    const stdout = result.stdout ?? '';
    const deploy = /^deploy=(.*)$/m.exec(stdout)?.[1] ?? '';
    const live = /^live=(.*)$/m.exec(stdout)?.[1] ?? '';
    const reason = /^reason=(.*)$/m.exec(stdout)?.[1] ?? '';

    return { deploy: deploy === 'true', live: live === 'true', reason, status: result.status ?? -1 };
};

/** Statuses CloudFormation reports for a stack that is deployed and usable as-is. */
const USABLE_STATUSES = ['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE', 'IMPORT_COMPLETE'];

/**
 * Statuses that mean "there is no usable stack here". `ABSENT` is what the script substitutes when
 * `describe-stacks` fails; the rest are real resting states a wedged per-PR stack sits in.
 */
const UNUSABLE_STATUSES = [
    'ABSENT',
    'CREATE_FAILED',
    'ROLLBACK_COMPLETE',
    'ROLLBACK_FAILED',
    'DELETE_FAILED',
    'DELETE_COMPLETE',
    'DELETE_IN_PROGRESS',
    'REVIEW_IN_PROGRESS',
    'UPDATE_ROLLBACK_FAILED',
];

/**
 * Run the pure `close` subcommand and return every `name=value` line it printed.
 *
 * @param unmet - Space-separated `consumer>producer>export` tokens, or `''`.
 * @param legs - `<flag>=<true|false>@<entrypoint>` assignments.
 * @returns The emitted map plus the exit status.
 * @sideEffect Spawns `bash`.
 */
const close = (
    unmet: string,
    ...legs: readonly string[]
): { readonly flags: Record<string, string>; readonly reason: string; readonly status: number } => {
    const result = spawnSync('bash', [SCRIPT, 'close', unmet, ...legs], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    const flags: Record<string, string> = {};
    let reason = '';

    for (const line of (result.stdout ?? '').split('\n')) {
        const matched = /^([a-z_]+)=(.*)$/.exec(line);

        if (matched === null) {
            continue;
        }

        if (matched[1] === 'closure_reason') {
            reason = matched[2] ?? '';
        } else {
            flags[matched[1] as string] = matched[2] ?? '';
        }
    }

    return { flags, reason, status: result.status ?? -1 };
};

/** The four legs `prod-deploy.yml` gates, as `close` receives them. Recipe owns three CDK apps. */
const GLOBAL_LEG = 'deploy_global=false@packages/infra/global/bin/app.ts';
const WEBHOOKS_LEG = 'deploy_webhooks=true@packages/services/identity-webhooks/infra/bin/app.ts';
const SERVICE_LEG = 'deploy_service=false@packages/services/identity/infra/bin/app.ts';

/** The edge measured absent from the prod account on 2026-09-02. */
const SERVICE_LOGS_EDGE =
    'packages/services/identity-webhooks/infra/bin/app.ts>packages/infra/global/bin/app.ts>' +
    'kitchensink-service-logs-prod:IdentityServiceLogGroupName';

describe('deploy-gate.sh — the file exists where the workflows invoke it from', () => {
    it('is present at .github/scripts/deploy-gate.sh', () => {
        expect(existsSync(SCRIPT), `expected the deploy gate at ${SCRIPT}`).toBe(true);
    });
});

describe('deploy_gate_decide — "changed" always deploys', () => {
    it('deploys when the service sources changed on the PR', () => {
        const verdict = decide('true', 'true', 'false', '200', 'kitchensink-food-service-pr-73=UPDATE_COMPLETE');

        expect(verdict.deploy).toBe(true);
        expect(verdict.reason).toMatch(/changed/i);
    });

    // `changed` wins even when the stack is healthy — that is the ordinary "this PR edits the service" path,
    // and skipping it would ship a preview that does not contain the PR's own code.
    it('deploys on a change even when everything is already up and serving', () => {
        expect(decide('true', 'true', 'false', '200', 'a=UPDATE_COMPLETE', 'b=CREATE_COMPLETE').deploy).toBe(true);
    });
});

describe('deploy_gate_decide — a manual dispatch is unconditional', () => {
    // `workflow_dispatch` has no PR diff to filter on, so a dispatch must never be talked out of deploying.
    it('deploys when forced, regardless of change or health', () => {
        const verdict = decide('true', 'false', 'true', '200', 'a=UPDATE_COMPLETE');

        expect(verdict.deploy).toBe(true);
        expect(verdict.reason).toMatch(/dispatch|forced/i);
    });
});

describe('deploy_gate_decide — ensure-exists: an absent or wedged stack deploys anyway', () => {
    // THE issue-#124 case: a docs-only PR changes nothing, so `changed=false`, and nothing is deployed yet.
    it('deploys an unchanged service whose stack does not exist (the fresh docs-only PR)', () => {
        const verdict = decide('true', 'false', 'false', '000', 'kitchensink-food-service-pr-73=ABSENT');

        expect(verdict.deploy).toBe(true);
        expect(verdict.reason).toContain('kitchensink-food-service-pr-73');
        expect(verdict.reason).toMatch(/ABSENT/);
    });

    it.each(UNUSABLE_STATUSES)('deploys an unchanged service whose stack is %s', (status) => {
        const verdict = decide('true', 'false', 'false', '200', `kitchensink-food-service-pr-73=${status}`);

        expect(verdict.deploy).toBe(true);
        expect(verdict.reason).toContain(status);
    });

    // The recipe job deploys TWO stacks (workers, then service). Either one missing makes the preview
    // incomplete, so either one missing must re-run the job.
    it('deploys when ANY of several stacks is missing', () => {
        const first = decide(
            'true',
            'false',
            'false',
            '200',
            'kitchensink-recipe-workers-pr-73=ABSENT',
            'kitchensink-recipe-service-pr-73=UPDATE_COMPLETE',
        );

        expect(first.deploy).toBe(true);
        expect(first.reason).toContain('kitchensink-recipe-workers-pr-73');

        const second = decide(
            'true',
            'false',
            'false',
            '200',
            'kitchensink-recipe-workers-pr-73=UPDATE_COMPLETE',
            'kitchensink-recipe-service-pr-73=ABSENT',
        );

        expect(second.deploy).toBe(true);
        expect(second.reason).toContain('kitchensink-recipe-service-pr-73');
    });
});

describe('deploy_gate_decide — ensure-SERVING: a stack that exists but does not answer deploys anyway', () => {
    // A converged stack is not a working service: Fargate Spot reclamation, a task that cannot pull its
    // image, or a target group with no healthy members all leave CloudFormation reporting UPDATE_COMPLETE.
    it.each(['000', '404', '502', '503'])('deploys when the origin answered %s instead of 200', (code) => {
        const verdict = decide('true', 'false', 'false', code, 'kitchensink-food-service-pr-73=UPDATE_COMPLETE');

        expect(verdict.deploy).toBe(true);
        expect(verdict.reason).toContain(code);
    });

    // 000 is curl's "no response at all" — DNS failure, refused connection, TLS failure, timeout. It must
    // never be mistaken for a healthy service.
    it('names the transport failure rather than reporting a status when nothing answered', () => {
        expect(decide('true', 'false', 'false', '000', 'a=UPDATE_COMPLETE').reason).toMatch(
            /did not answer|no response/i,
        );
    });
});

describe('deploy_gate_decide — the ONLY skip: unchanged AND already serving', () => {
    it.each(USABLE_STATUSES)('skips an unchanged service whose stack is %s and origin returns 200', (status) => {
        const verdict = decide('true', 'false', 'false', '200', `kitchensink-food-service-pr-73=${status}`);

        expect(verdict.deploy).toBe(false);
        expect(verdict.reason).toMatch(/unchanged/i);
    });

    it('skips only when EVERY stack is usable', () => {
        const verdict = decide('true', 'false', 'false', '200', 'a=UPDATE_COMPLETE', 'b=CREATE_COMPLETE');

        expect(verdict.deploy).toBe(false);
    });
});

describe('deploy_gate_decide — misuse fails loudly instead of guessing', () => {
    // A gate that silently answers "skip" on bad input is how a preview ends up half-deployed with a green
    // check. Exit non-zero (and never print `deploy=false`) instead.
    it('refuses a decision with no stacks to reason about', () => {
        const verdict = decide('true', 'false', 'false', '200');

        expect(verdict.status).toBe(2);
        expect(verdict.deploy).toBe(false);
        expect(verdict.reason).toBe('');
    });

    it.each(['yes', 'TRUE', '1', ''])('refuses a non-boolean `changed` value %j', (changed) => {
        expect(decide('true', changed, 'false', '200', 'a=UPDATE_COMPLETE').status).toBe(2);
    });

    it.each(['yes', 'TRUE', '1', ''])('refuses a non-boolean `forced` value %j', (forced) => {
        expect(decide('true', 'false', forced, '200', 'a=UPDATE_COMPLETE').status).toBe(2);
    });

    it.each(['', 'ok', '20x'])('refuses a non-numeric health code %j', (code) => {
        expect(decide('true', 'false', 'false', code, 'a=UPDATE_COMPLETE').status).toBe(2);
    });

    it('refuses a stack argument that is not name=STATUS', () => {
        expect(decide('true', 'false', 'false', '200', 'kitchensink-food-service-pr-73').status).toBe(2);
    });

    it('refuses an unknown subcommand', () => {
        const result = spawnSync('bash', [SCRIPT, 'nonsense'], { encoding: 'utf8' });

        expect(result.status).toBe(2);
    });

    // ── `live` — the two "deploy=false" outcomes mean OPPOSITE things ────────────────────────────
    describe('live — is there a preview to talk to at all', () => {
        /**
         * ⛔ WHY A SECOND OUTPUT. `deploy=false` is emitted for two reasons that could not be more
         * different: "unchanged and already serving" (a healthy preview is RIGHT THERE) and
         * "intent is not live" (nothing exists — the stacks were reaped). The recipe job's post-gate
         * steps need the distinction: resolving this stage's food origin, reading the running task
         * definition and smoke-testing all presuppose that SOMETHING is deployed, while the build/push
         * steps presuppose that THIS RUN deploys.
         *
         * Without it, those steps were simply left unguarded so they would still run on an
         * unchanged-but-serving preview — which is deliberate (the smoke catches a half-wired preview
         * "even by a push that deployed nothing"). But with nothing deployed at all they cannot work:
         * `Sandbox Deploy` went red on every push to PR #91 for the whole time its stacks were reaped
         * (2026-08-27 onward), failing on `No food service is deployed at stage pr-91` — a permanently
         * red check whose meaning was "there is nothing to do". Red-over-nothing trains people to ignore
         * the check exactly as reliably as green-over-nothing does.
         */
        it('is FALSE only when intent is not live — nothing is deployed to talk to', () => {
            const verdict = decide('false', 'true', 'false', '000', 'kitchensink-food-service-pr-73=ABSENT');

            expect(verdict.deploy).toBe(false);
            expect(verdict.live).toBe(false);
        });

        it('is TRUE on the other skip — unchanged and already serving, so the preview is right there', () => {
            const verdict = decide('true', 'false', 'false', '200', 'a=UPDATE_COMPLETE');

            expect(verdict.deploy).toBe(false);
            expect(verdict.live).toBe(true);
        });

        it('is TRUE for every deploy verdict — a run that deploys has a preview by the end of it', () => {
            for (const verdict of [
                decide('true', 'true', 'false', '200', 'a=UPDATE_COMPLETE'), // changed
                decide('true', 'false', 'false', '200', 'a=ABSENT'), // ensure-exists
                decide('true', 'false', 'false', '000', 'a=UPDATE_COMPLETE'), // ensure-serving
                decide('false', 'false', 'true', '000', 'a=ABSENT'), // forced dispatch, intent dark
            ]) {
                expect(verdict.deploy).toBe(true);
                expect(verdict.live).toBe(true);
            }
        });

        it('a FORCED dispatch is live even with intent dark — the button is how a preview gets rebuilt', () => {
            const verdict = decide('false', 'false', 'true', '000', 'a=ABSENT');

            expect(verdict.live).toBe(true);
        });
    });

    // ── The on-demand amendment ──────────────────────────────────────────────────────────────────
    describe('intent — a reaped sandbox must not resurrect itself', () => {
        /**
         * ADR-0010 made an ABSENT stack a reason to DEPLOY, because a preview missing one of its services
         * is broken. Under the on-demand sandbox, absent stops meaning "broken" and starts meaning
         * "deliberately torn down at midnight" — so the ensure-exists rule, left alone, would rebuild every
         * environment on the first push after the reaper ran, silently, behind a green check. That is
         * ADR-0010's own failure mode running backwards.
         *
         * `intent` is the precondition that separates the two readings: it is live only while the PR
         * carries the `sandbox-up` label the button applies and the reconciler removes. It is a REQUIRED
         * first parameter rather than a defaulted one, because a default is a position — silently asserted
         * on behalf of every caller that never considered it.
         */
        it('does not deploy an absent stack when intent is not live', () => {
            const verdict = decide('false', 'false', 'false', '000', 'kitchensink-food-service-pr-73=ABSENT');

            expect(verdict.deploy).toBe(false);
            expect(verdict.reason).toMatch(/not live|no live sandbox|torn down/i);
        });

        it('does not deploy on a source change when intent is not live', () => {
            expect(decide('false', 'true', 'false', '200', 'a=UPDATE_COMPLETE').deploy).toBe(false);
        });

        it('does not deploy on an unhealthy origin when intent is not live', () => {
            expect(decide('false', 'false', 'false', '503', 'a=UPDATE_COMPLETE').deploy).toBe(false);
        });

        it('still deploys on a manual dispatch — the button IS the intent', () => {
            const verdict = decide('false', 'false', 'true', '000', 'a=ABSENT');

            expect(verdict.deploy).toBe(true);
        });

        it('preserves every ensure-exists behaviour while intent is live', () => {
            expect(decide('true', 'false', 'false', '200', 'a=ABSENT').deploy).toBe(true);
            expect(decide('true', 'true', 'false', '200', 'a=UPDATE_COMPLETE').deploy).toBe(true);
            expect(decide('true', 'false', 'false', '503', 'a=UPDATE_COMPLETE').deploy).toBe(true);
            expect(decide('true', 'false', 'false', '200', 'a=UPDATE_COMPLETE').deploy).toBe(false);
        });

        it.each(['', 'yes', 'TRUE', '1'])('rejects a non-boolean intent (%s)', (intent) => {
            expect(decide(intent, 'false', 'false', '200', 'a=UPDATE_COMPLETE').status).toBe(2);
        });
    });
});

/**
 * ## `close` — a consumer leg must never deploy without its producer
 *
 * `decide` above answers "should THIS leg run?" from that leg's own stacks. It cannot see the OTHER question
 * a per-leg gate has to answer: whether the leg this one DEPENDS ON is running too.
 *
 * `prod-deploy.yml` gated every leg independently on a `dorny/paths-filter` group, so a change touching only
 * `packages/services/identity-webhooks/**` set `deploy_webhooks=true` and `deploy_global=false`. ADR-0028 had
 * just moved the identity log group into `ServiceLogsStack` — a child of the GLOBAL app — recording that it
 * "already deploys before both consumers, so no deploy order changed". True of the ORDER, false of the GATE:
 * the earlier leg does not run at all. Measured against the account on 2026-09-02,
 * `kitchensink-service-logs-prod` DOES NOT EXIST, so the next webhooks-only merge would have died on
 * `No export named kitchensink-service-logs-prod:IdentityServiceLogGroupName found`. The identity-SERVICE leg
 * imports the very same export and had the identical hole — which the derivation found and the bug report
 * did not.
 *
 * ⛔ The edges are NOT enumerated here or anywhere. `scripts/infrastructureManifest.mjs` reads them from the
 * CDK source by AST and projects them to `docs/generated/infrastructure/cross-app-imports.tsv` under the same
 * regenerate-and-diff gate the manifest carries. This function RECEIVES them; it never knows them. A copy of
 * a list cannot detect that the list grew — the failure behind the ALB priority collision, the stale NAT
 * consumer table and ADR-0025's asset guard.
 *
 * `close` is PURE — unmet edges and current flag values in, closed flag values out. Deciding WHICH edges are
 * unmet needs CloudFormation and lives in `unmet-imports`, covered by `tests/deployGate.integration.test.ts`.
 */
describe('deploy_gate_close — an unmet import forces its producer leg', () => {
    it('forces the producer when a DEPLOYING consumer needs an export nothing published', () => {
        // The live defect, as itself.
        const verdict = close(SERVICE_LOGS_EDGE, GLOBAL_LEG, WEBHOOKS_LEG);

        expect(verdict.status).toBe(0);
        expect(verdict.flags['deploy_global']).toBe('true');
        expect(verdict.flags['deploy_webhooks']).toBe('true');
        expect(verdict.reason).toContain('kitchensink-service-logs-prod:IdentityServiceLogGroupName');
        expect(verdict.reason).toContain('deploy_global');
    });

    it('leaves the producer alone when the consumer that needs it is NOT deploying', () => {
        // ⛔ The narrowness is the whole design. "Force the producer whenever any consumer leg runs" makes
        // EVERY prod deploy a full platform rollout — RDS, VPC and edge included — for a webhooks typo.
        // "Force it whenever anything is missing" does the same from a food-only push. This rule fires only
        // where a deploy would otherwise FAIL, so it stops firing the moment the platform is whole.
        const verdict = close(
            SERVICE_LOGS_EDGE,
            GLOBAL_LEG,
            'deploy_webhooks=false@packages/services/identity-webhooks/infra/bin/app.ts',
        );

        expect(verdict.status).toBe(0);
        expect(verdict.flags['deploy_global']).toBe('false');
    });

    it('changes nothing when every import a deploying consumer needs is already published', () => {
        const verdict = close('', GLOBAL_LEG, WEBHOOKS_LEG, SERVICE_LEG);

        expect(verdict.status).toBe(0);
        expect(verdict.flags).toEqual({
            deploy_global: 'false',
            deploy_service: 'false',
            deploy_webhooks: 'true',
        });
        expect(verdict.reason).toMatch(/every|no unmet|nothing/iu);
    });

    it('forces the producer for ANY deploying consumer, not just the first one listed', () => {
        // A gate that stopped at the first matching edge would repair the leg somebody noticed and leave the
        // other one broken.
        const identityEdge =
            'packages/services/identity/infra/bin/app.ts>packages/infra/global/bin/app.ts>' +
            'kitchensink-service-logs-prod:IdentityServiceLogGroupName';
        const verdict = close(
            identityEdge,
            GLOBAL_LEG,
            'deploy_service=true@packages/services/identity/infra/bin/app.ts',
            'deploy_webhooks=false@packages/services/identity-webhooks/infra/bin/app.ts',
        );

        expect(verdict.flags['deploy_global']).toBe('true');
    });

    it('accepts one flag owning SEVERAL apps, because `deploy_recipe` owns three', () => {
        // recipe-service, recipe-workers and ingredient-parser share one flag by deliberate decision (a split
        // would let `parseLine` ship without the CRF Lambda it invokes). Any of the three importing across an
        // app boundary must force the producer.
        const verdict = close(
            'packages/services/recipe-service/infra/bin/app.ts>packages/infra/global/bin/app.ts>' +
                'kitchensink-alb-prod:SharedAlbHttpsListenerArn',
            GLOBAL_LEG,
            'deploy_recipe=true@packages/services/recipe-service/infra/bin/app.ts',
            'deploy_recipe=true@packages/services/recipe-workers/infra/bin/app.ts',
            'deploy_recipe=true@packages/services/ingredient-parser/infra/bin/app.ts',
        );

        expect(verdict.status).toBe(0);
        expect(verdict.flags['deploy_recipe']).toBe('true');
        expect(verdict.flags['deploy_global']).toBe('true');
    });

    it('IGNORES an unmet edge whose consumer this workflow does not deploy', () => {
        // `@commise/web`'s `SandboxRouterStack` imports from the global app and appears in the derived edge
        // list, but `prod-deploy.yml` does not deploy it — Vercel does. An edge for a leg that is not here is
        // not this gate's business, and erroring on it would red every prod deploy.
        const verdict = close(
            'packages/apps/commise/web/infra/bin/app.ts>packages/infra/global/bin/app.ts>' +
                'kitchensink-domain-prod:HostedZoneId',
            GLOBAL_LEG,
            WEBHOOKS_LEG,
        );

        expect(verdict.status).toBe(0);
        expect(verdict.flags['deploy_global']).toBe('false');
    });

    it('splits the edge list without GLOB-EXPANDING it', () => {
        // ⚠️ A bare `for leg in $unmet` word-splits AND glob-expands. A token carrying `[`, `*` or `?` would
        // be rewritten against the working directory or dropped entirely — and a dropped edge is a producer
        // that never gets forced, which is this gate's whole failure mode arriving silently.
        const bracketed =
            'packages/services/identity-webhooks/infra/bin/app.ts>packages/infra/global/bin/app.ts>' +
            'kitchensink-service-logs-prod:Log[Group]Name';
        const verdict = close(bracketed, GLOBAL_LEG, WEBHOOKS_LEG);

        expect(verdict.status).toBe(0);
        expect(verdict.flags['deploy_global']).toBe('true');
        expect(verdict.reason).toContain('Log[Group]Name');
    });

    it('REFUSES an unmet edge whose producer this workflow cannot deploy', () => {
        // ⛔ The asymmetry is deliberate. An unknown CONSUMER is out of scope; an unknown PRODUCER means a leg
        // IS deploying and the thing it depends on is not something this workflow can force — a hole no gate
        // can close. Exiting 2 makes that a decision somebody has to take, rather than a deploy that fails
        // twenty minutes later inside `cdk deploy` with a CloudFormation error.
        const verdict = close(
            'packages/services/identity-webhooks/infra/bin/app.ts>packages/services/food-service/infra/bin/app.ts>' +
                'kitchensink-food-service-prod:FoodServiceUrl',
            GLOBAL_LEG,
            WEBHOOKS_LEG,
        );

        expect(verdict.status).toBe(2);
    });
});

describe('deploy_gate_close — misuse fails loudly instead of guessing', () => {
    // Same contract as `decide`: a gate that answers "nothing to force" on malformed input is how a leg
    // deploys against a producer that was never checked, behind a green check.
    it.each(['deploy_global@packages/infra/global/bin/app.ts', 'deploy_global=false', 'deploy_global=false@'])(
        'refuses a leg assignment that is not flag=value@entrypoint (%j)',
        (leg) => {
            expect(close('', leg).status).toBe(2);
        },
    );

    it.each(['yes', 'TRUE', '1', ''])('refuses a non-boolean leg value %j', (value) => {
        expect(close('', `deploy_global=${value}@packages/infra/global/bin/app.ts`).status).toBe(2);
    });

    it.each(['a/bin/app.ts>b/bin/app.ts', '>b/bin/app.ts>x', 'a/bin/app.ts>>x'])(
        'refuses an edge token that does not name consumer, producer AND export (%j)',
        (edge) => {
            expect(close(edge, GLOBAL_LEG, WEBHOOKS_LEG).status).toBe(2);
        },
    );

    it('refuses when no legs are given at all', () => {
        expect(close('').status).toBe(2);
    });

    it('refuses one flag given two different values, which can only be a wiring mistake', () => {
        const verdict = close(
            '',
            'deploy_recipe=true@packages/services/recipe-service/infra/bin/app.ts',
            'deploy_recipe=false@packages/services/recipe-workers/infra/bin/app.ts',
        );

        expect(verdict.status).toBe(2);
    });
});
