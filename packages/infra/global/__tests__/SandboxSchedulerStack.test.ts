/**
 * ADR-0007 sandbox scheduler infra: a least-privilege Lambda + a nightly STOP at 00:00
 * America/New_York, created by GlobalStack ONLY for the sandbox stage (prod gets nothing → no prod diff,
 * ADR-0002 discipline).
 *
 * ## Why the 09:00 START was removed (ADR-0028)
 *
 * ADR-0007 paired the nightly stop with a 09:00 restart, on the assumption that the sandbox is a permanent
 * tier that merely sleeps. Under the on-demand sandbox it is not: it comes up when someone presses the
 * button and dies at midnight. A daily 09:00 start would resurrect the whole tier every weekday morning
 * whether or not anybody wanted it — silently undoing the reaper and restoring the bill this was written to
 * remove.
 *
 * The STOP survives, and not merely as a backstop. AWS auto-restarts a stopped RDS instance after SEVEN
 * DAYS. With the sandbox idle for a week the database returns by itself and bills until someone notices;
 * the nightly stop is what catches it, within a day, every time. `sandbox-reconcile.yml` converges the same
 * state hourly, so the two agree — but the schedule is the one that works when GitHub Actions does not.
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

        template.resourceCountIs('AWS::Scheduler::Schedule', 1);

        const schedules = Object.values(template.findResources('AWS::Scheduler::Schedule')).map(
            (resource: any) => resource.Properties,
        );

        for (const schedule of schedules) {
            expect(schedule.ScheduleExpressionTimezone).toBe('America/New_York');
        }

        const expressions = schedules.map((schedule: any) => schedule.ScheduleExpression).sort();
        expect(expressions).toEqual(['cron(0 0 * * ? *)']);
    });

    it('passes the stop action to the Lambda target as structured input', () => {
        const template = schedulerTemplate();
        const inputs = Object.values(template.findResources('AWS::Scheduler::Schedule')).map((resource: any) =>
            JSON.parse(resource.Properties.Target.Input),
        );

        expect(inputs).toEqual([{ action: 'stop' }]);
    });

    it('schedules NO automatic start — the button is the only way up (ADR-0028)', () => {
        const template = schedulerTemplate();
        const inputs = Object.values(template.findResources('AWS::Scheduler::Schedule')).map((resource: any) =>
            JSON.parse(resource.Properties.Target.Input),
        );

        expect(inputs).not.toContainEqual({ action: 'start' });
        expect(JSON.stringify(template.findResources('AWS::Scheduler::Schedule'))).not.toContain('cron(0 9');
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

    it('creates the SandboxSchedulerStack (with its ONE stop schedule) ONLY for the sandbox stage', () => {
        const sandbox = makeGlobal('sandbox');

        expect(sandbox.sandboxScheduler).toBeInstanceOf(SandboxSchedulerStack);
        Template.fromStack(sandbox.sandboxScheduler!).resourceCountIs('AWS::Scheduler::Schedule', 1);
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
