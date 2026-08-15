/**
 * ADR-0007 sandbox nightly-shutdown scheduler infra: a least-privilege Lambda + a stop/start
 * EventBridge Scheduler pair (00:00 / 09:00 America/New_York), created by GlobalStack ONLY for the
 * sandbox stage (prod gets nothing → no prod diff, ADR-0002 discipline).
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

        template.resourceCountIs('AWS::Scheduler::Schedule', 2);

        const schedules = Object.values(template.findResources('AWS::Scheduler::Schedule')).map(
            (resource: any) => resource.Properties,
        );

        for (const schedule of schedules) {
            expect(schedule.ScheduleExpressionTimezone).toBe('America/New_York');
        }

        const expressions = schedules.map((schedule: any) => schedule.ScheduleExpression).sort();
        expect(expressions).toEqual(['cron(0 0 * * ? *)', 'cron(0 9 * * ? *)']);
    });

    it('passes the stop/start action to the Lambda target as structured input', () => {
        const template = schedulerTemplate();
        const inputs = Object.values(template.findResources('AWS::Scheduler::Schedule')).map((resource: any) =>
            JSON.parse(resource.Properties.Target.Input),
        );

        expect(inputs).toContainEqual({ action: 'stop' });
        expect(inputs).toContainEqual({ action: 'start' });
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

    it('creates the SandboxSchedulerStack (with its two schedules) ONLY for the sandbox stage', () => {
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
