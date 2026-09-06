/**
 * ADR-0007 sandbox scheduler infra: a least-privilege Lambda + the nightly STOP/START PAIR — 00:00 and
 * 09:00 America/New_York — created by GlobalStack ONLY for the sandbox stage (prod gets nothing → no prod
 * diff, ADR-0002 discipline).
 *
 * ## The 09:00 START was removed by ADR-0028 and RESTORED on 2026-09-03. Read why before removing it again.
 *
 * ADR-0028 deleted the start on one argument: it "would resurrect the whole tier every weekday morning
 * regardless of intent, silently undoing the reaper". That was true when it was written, and its premise
 * has since expired.
 *
 * ADR-0028's own amendment of 2026-08-30 made the shared ALB and identity service **deleted stacks** rather
 * than stopped ones. A schedule cannot create a stack. So after the reaper has run there is nothing for a
 * start to resurrect except the two things that were only ever STOPPED — the RDS instance and the NAT — and
 * those are the two the owner has ruled must follow the original clock (2026-09-03): _"The RDS should still
 * be stopped and started on the original schedule."_
 *
 * The STOP was never merely a backstop and still is not: AWS auto-restarts a stopped RDS instance after
 * SEVEN DAYS, and the nightly stop is what catches that within a day, every time — including in the weeks
 * when GitHub's best-effort scheduled workflows do not run at all. The START now carries the same property
 * in the other direction: a deploy landing inside the old 00:00–09:00 window no longer meets a stopped
 * database (ADR-0007 × ADR-0022, the `UPDATE_ROLLBACK_FAILED` wedge `sandbox-wake.sh` was written after).
 *
 * ⛔ The two schedules are EXACT INVERSES on purpose, because `runStop` and `runStart` are: `runStop`
 * records each service's prior desired count in SSM and `runStart` refuses to guess when it is missing.
 * Scheduling one without the other is what leaves that bookkeeping half-applied.
 */
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { NODE_LAMBDA_RUNTIME } from '@kitchensink/infra-security';
import { describe, it, expect } from 'vitest';

import { GlobalStack } from '../lib/platform/GlobalStack.js';
import { SandboxSchedulerStack } from '../lib/platform/SandboxSchedulerStack.js';

const env = { account: '123456789012', region: 'us-east-1' };

const schedulerTemplate = (): Template =>
    Template.fromStack(new SandboxSchedulerStack(new App(), 'SandboxScheduler-sandbox', { env, stage: 'sandbox' }));

describe('SandboxSchedulerStack (ADR-0007)', () => {
    describe('⛔ the UpdateService blast radius', () => {
        // ⛔ THIS IS THE BOUNDARY BETWEEN "scale a preview down" AND "scale production down", so it is
        // asserted against the SYNTHESIZED policy rather than the source that produced it.
        //
        // The resource scope was `service/*sandbox*/*` alone. A per-PR preview's services live under a
        // cluster named `kitchensink-{svc}-pr-{N}-…`, which that pattern cannot reach — so the scheduler
        // could SELECT a per-PR service (once the selector was fixed) and then be DENIED by IAM. The two
        // halves only work together, which is why they land together.

        /** Whether an IAM resource pattern (`*` = any run of characters) matches `arn`. Pure. */
        const iamMatches = (pattern: string, arn: string): boolean =>
            new RegExp(
                `^${pattern
                    .split('*')
                    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
                    .join('.*')}$`,
                'u',
            ).test(arn);

        /** The resource patterns the synthesized policy grants `ecs:UpdateService` on. */
        function updateServiceResources(): readonly string[] {
            const policies = schedulerTemplate().findResources('AWS::IAM::Policy');
            const statements = Object.values(policies).flatMap(
                (policy) => policy['Properties']?.['PolicyDocument']?.['Statement'] ?? [],
            );
            const statement = statements.find((entry: { Action?: unknown }) => {
                const action = entry.Action;

                return (
                    action === 'ecs:UpdateService' || (Array.isArray(action) && action.includes('ecs:UpdateService'))
                );
            });

            if (!statement) {
                throw new Error('no statement grants ecs:UpdateService — this guard has gone blind');
            }

            const resources = (statement as { Resource?: unknown }).Resource;

            return (Array.isArray(resources) ? resources : [resources]).map(String);
        }

        const PROD_SERVICE = `arn:aws:ecs:${env.region}:${env.account}:service/kitchensink-food-service-prod-FoodServiceCluster442EDB29-xRt2eYoDUrGB/food-api`;
        const PER_PR_SERVICE = `arn:aws:ecs:${env.region}:${env.account}:service/kitchensink-food-service-pr-91-FoodServiceCluster442EDB29-QR9FHWWoNVeo/food-api`;
        const SHARED_SERVICE = `arn:aws:ecs:${env.region}:${env.account}:service/kitchensink-identity-service-sandbox-IdentityServiceCluster3A4949E2-jZsH9vmz0eP6/identity`;

        it('⛔ grants NOTHING on a production service', () => {
            // The real prod cluster name, verbatim from the live account. `*-pr-*` needs the literal
            // `-pr-`; `-prod-` supplies `-pro`, so prod is excluded by the PATTERN and not by convention.
            const patterns = updateServiceResources();

            expect(patterns.some((pattern) => iamMatches(pattern, PROD_SERVICE))).toBe(false);
        });

        it('⛔ grants on a per-PR preview service — the gap that made the selector inert', () => {
            expect(updateServiceResources().some((pattern) => iamMatches(pattern, PER_PR_SERVICE))).toBe(true);
        });

        it('still grants on the shared sandbox tier', () => {
            expect(updateServiceResources().some((pattern) => iamMatches(pattern, SHARED_SERVICE))).toBe(true);
        });

        it('⛔ can read cluster TAGS, without which every per-PR cluster reads as untagged', () => {
            // `DescribeClusters` with `include: ['TAGS']` is how the selector learns `Environment=pr-{N}`.
            // Absent the permission the call throws and the scheduler sees no per-PR cluster at all —
            // failing exactly the way the name-match already did, but less visibly.
            schedulerTemplate().hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: Match.objectLike({
                    Statement: Match.arrayWith([
                        Match.objectLike({ Action: Match.arrayWith(['ecs:DescribeClusters']) }),
                    ]),
                }),
            });
        });
    });

    it('provisions the scheduler Lambda on the repo-wide runtime pin, arm64', () => {
        // The handler depends on whether the esbuild bundle is present at synth: a bare synth uses the
        // self-consistent inline placeholder (`index.handler`), a bundled deploy swaps in the asset and
        // the `sandbox-scheduler/handler.handler` path. Both are valid — assert the invariant properties
        // and that the handler is one of the two (not pinned to the placeholder, which was the bug that
        // let the no-op placeholder ship unnoticed).
        schedulerTemplate().hasResourceProperties('AWS::Lambda::Function', {
            Handler: Match.stringLikeRegexp('(index|sandbox-scheduler/handler)\\.handler'),
            // Asserted against the shared pin, not a literal: the runtime is ONE decision
            // (@kitchensink/infra-security NODE_LAMBDA_RUNTIME, issue #143) and a literal here would have
            // to be edited in lockstep with every other site, which is what let Lambdas run nodejs22.x
            // while the repo pinned engines.node 24.x. That pin has its own drift guard.
            Runtime: NODE_LAMBDA_RUNTIME.name,
            Architectures: ['arm64'],
        });
    });

    it('creates exactly two EventBridge schedules, both in America/New_York', () => {
        const template = schedulerTemplate();

        template.resourceCountIs('AWS::Scheduler::Schedule', 2);

        const schedules = Object.values(template.findResources('AWS::Scheduler::Schedule')).map(
            (resource: any) => resource.Properties,
        );

        for (const schedule of schedules) {
            // DST-correct by timezone, never by a UTC hour. `America/New_York` is UTC-4 for eight months and
            // UTC-5 for four; a UTC cron would drift an hour twice a year and the drift is invisible until a
            // deploy lands in a window that was supposed to be open.
            expect(schedule.ScheduleExpressionTimezone).toBe('America/New_York');
        }

        // Both expressions PINNED, not merely counted. `day: '*'` with the weekDay field left as `?` is what
        // the CDK helper emits, and it is the difference between "every day" and a synth error — asserting
        // only the count would let a `cron(0 9 ? * * *)` typo through.
        const expressions = schedules.map((schedule: any) => schedule.ScheduleExpression).sort();
        expect(expressions).toEqual(['cron(0 0 * * ? *)', 'cron(0 9 * * ? *)']);
    });

    it('passes stop and start to the Lambda target as structured input, one each', () => {
        const template = schedulerTemplate();
        const inputs = Object.values(template.findResources('AWS::Scheduler::Schedule')).map((resource: any) =>
            JSON.parse(resource.Properties.Target.Input),
        );

        // ⛔ Set equality, not "contains a stop". `runStop` writes each ECS service's prior desired count to
        // SSM and `runStart` deliberately REFUSES to guess when that parameter is missing — so a schedule
        // that stops without a matching start strands whatever it scaled down, and a duplicate of either
        // action fires the bookkeeping twice.
        expect([...inputs].sort((a, b) => String(a.action).localeCompare(String(b.action)))).toEqual([
            { action: 'start' },
            { action: 'stop' },
        ]);
    });

    it('pairs each action with its own hour, so the two cannot be swapped unnoticed', () => {
        // The previous assertion proves both actions exist and the one before it proves both hours exist.
        // Neither catches the two being crossed — a start at midnight and a stop at nine, which synthesizes
        // cleanly, passes both, and shuts the sandbox down for the entire working day.
        const byAction = Object.fromEntries(
            Object.values(schedulerTemplate().findResources('AWS::Scheduler::Schedule')).map((resource: any) => [
                JSON.parse(resource.Properties.Target.Input).action,
                resource.Properties.ScheduleExpression,
            ]),
        );

        expect(byAction).toEqual({ stop: 'cron(0 0 * * ? *)', start: 'cron(0 9 * * ? *)' });
    });

    it('scopes IAM to exactly the rds/ecs/ec2/ssm actions it needs (no service-wildcard admin)', () => {
        const template = schedulerTemplate();
        const policies = Object.values(template.findResources('AWS::IAM::Policy'));
        const statements = policies.flatMap((policy: any) => policy.Properties.PolicyDocument.Statement as any[]);
        const actions = new Set(statements.flatMap((statement) => statement.Action as string[]));

        for (const action of [
            'rds:DescribeDBInstances',
            'rds:StopDBInstance',
            'rds:StartDBInstance',
            'ecs:ListClusters',
            'ecs:ListServices',
            'ecs:DescribeServices',
            'ecs:UpdateService',
            'ec2:DescribeInstances',
            'ec2:StopInstances',
            'ec2:StartInstances',
            'ssm:GetParameter',
            'ssm:PutParameter',
        ]) {
            expect(actions.has(action)).toBe(true);
        }

        // No service-wildcard admin (e.g. `rds:*`, `ec2:*`).
        for (const action of actions) {
            expect(action).not.toMatch(/^(rds|ecs|ec2|ssm|iam):\*$/);
            expect(action).not.toBe('*');
        }

        // The EC2 mutate statement is tag-scoped to sandbox, and SSM to the scheduler's param path.
        const ec2Mutate = statements.find(
            (statement) => Array.isArray(statement.Action) && statement.Action.includes('ec2:StopInstances'),
        );
        expect(JSON.stringify(ec2Mutate.Condition)).toContain('*sandbox*');

        const ssmStatement = statements.find(
            (statement) => Array.isArray(statement.Action) && statement.Action.includes('ssm:PutParameter'),
        );
        expect(JSON.stringify(ssmStatement.Resource)).toContain('parameter/kitchensink/sandbox-scheduler/');
    });
});

describe('GlobalStack scheduler guard (ADR-0007 / no prod diff)', () => {
    const makeGlobal = (stage: string): GlobalStack =>
        new GlobalStack(new App(), `Global-${stage}`, {
            env,
            stackName: `kitchensink-global-${stage}`,
            stage,
            domainName: 'example.com',
        });

    it('creates the SandboxSchedulerStack (with BOTH schedules) ONLY for the sandbox stage', () => {
        const sandbox = makeGlobal('sandbox');

        expect(sandbox.sandboxScheduler).toBeInstanceOf(SandboxSchedulerStack);
        Template.fromStack(sandbox.sandboxScheduler!).resourceCountIs('AWS::Scheduler::Schedule', 2);
    });

    it('creates no scheduler for prod (guard leaves it undefined → prod template unchanged)', () => {
        expect(makeGlobal('prod').sandboxScheduler).toBeUndefined();
    });

    it('creates no scheduler for a dev/other stage', () => {
        expect(makeGlobal('dev').sandboxScheduler).toBeUndefined();
    });
});

// ── ADR-0028: the button and the reconciler must be able to FIND this function ────────────────────
/**
 * ADDED 2026-08-27, after a real defect.
 *
 * `runStop` records each service's prior desired count in SSM and only then scales it to zero; `runStart`
 * reads that value back and — deliberately — **refuses to guess** when it is missing, skipping the service
 * with a logged error. That contract is the whole reason the sandbox tier can be stopped safely.
 *
 * The first draft of `sandbox-reconcile.yml` bypassed it: it scaled services to 0 with a raw
 * `aws ecs update-service`, writing no SSM parameter. The shared sandbox IDENTITY service — which every
 * preview signs in against — would then have been stranded at zero, because `runStart` correctly declines
 * to invent a count. Previews would deploy and sign-in would be dead, with only a log line to say why.
 *
 * The fix is to stop reimplementing stop/start and invoke THIS function, which means both workflows have to
 * discover it. A CloudFormation export is how everything else in this repo crosses that boundary
 * (`cfn-export.sh`), so the name is exported rather than guessed from a pattern.
 */
describe('the scheduler function is discoverable by the workflows (ADR-0028)', () => {
    it('exports its function name under a STACK-qualified export', () => {
        // Qualified by stack name, not a literal: the app names this stack
        // `kitchensink-sandbox-scheduler-{stage}` while this harness constructs it directly, so pinning the
        // production string here would assert the harness rather than the invariant. What must hold is that
        // the export is unique per stack and ends in the agreed suffix, which is what `cfn-export.sh` looks
        // up.
        const outputs = Object.values(schedulerTemplate().findOutputs('*')) as { Export?: { Name?: string } }[];
        const names = outputs.flatMap((o) => (o.Export?.Name === undefined ? [] : [o.Export.Name]));

        expect(names.filter((name) => name.endsWith(':SchedulerFunctionName'))).toHaveLength(1);
    });

    it('the export actually names the function, not a literal', () => {
        const outputs = Object.values(schedulerTemplate().findOutputs('*')) as {
            Export?: { Name?: string };
            Value?: unknown;
        }[];
        const exported = outputs.find((o) => o.Export?.Name?.endsWith(':SchedulerFunctionName'));

        expect(exported).toBeDefined();
        expect(JSON.stringify(exported?.Value)).toContain('SandboxSchedulerFunction');
    });
});
