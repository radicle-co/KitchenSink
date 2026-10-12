/**
 * ADR-0007 / ADR-0060 sandbox scheduler infra: a least-privilege Lambda and ONE schedule — the midnight stop,
 * America/New_York — created by GlobalStack ONLY for the sandbox stage (prod gets nothing → no prod diff, ADR-0002
 * discipline).
 *
 * ## There is no daily start, and the absence is the decision (ADR-0060)
 *
 * The owner ruled on 2026-10-12: "no automatic or scheduled tasks or jobs except for the single one to check if the
 * sandbox is running at midnight and bringing every single sandbox down." The sandbox starts only when Sandbox Up is
 * pressed for a PR, through this function's per-PR `start`. A daily start resurrected the database and the NAT every
 * morning for nobody, and a CI wake-on-push restarted them inside the shutdown window.
 *
 * The stop stays, and is not merely a backstop: AWS auto-restarts a stopped RDS instance after SEVEN DAYS, and the
 * nightly stop is what catches that within a day.
 *
 * ## The scheduler is the only writer of a scheduled rule's state
 *
 * Every non-prod scheduled rule synthesizes DISABLED and tagged with its stage; `sync` switches it on only while its
 * stage is up. So this function may toggle EventBridge rules — and the grant is scoped to exactly the rules the CDK
 * gate tagged, with production refused by an explicit Deny.
 */
import { Stack, aws_sns as sns, type App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { NODE_LAMBDA_RUNTIME } from '@radicle-co/infra-shared/security';
import { describe, it, expect } from 'vitest';

import { GlobalStack } from '../lib/platform/GlobalStack.js';
import { SandboxSchedulerStack } from '../lib/platform/SandboxSchedulerStack.js';
import { SCHEDULED_RULE_STAGE_TAG } from '../lib/sandbox-scheduler/scheduler.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };

/** The stage alarm topic the scheduler is handed, imported by ARN from a host stack in the same app. */
const ALARM_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:kitchensink-alarms-sandbox';
const alarmTopicIn = (app: App): sns.ITopic =>
    sns.Topic.fromTopicArn(new Stack(app, 'AlarmTopicHost', { env }), 'AlarmTopic', ALARM_TOPIC_ARN);

const schedulerTemplate = (): Template =>
    Template.fromStack(
        ((app) =>
            new SandboxSchedulerStack(app, 'SandboxScheduler-sandbox', {
                env,
                stage: 'sandbox',
                alarmsEnabled: false,
                alarmTopic: alarmTopicIn(app),
            }))(testApp()),
    );

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
            // `DescribeClusters` with `include: ['TAGS']` is how the selector learns a cluster's `Environment`.
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
            // (@radicle-co/infra-shared/security NODE_LAMBDA_RUNTIME, issue #143) and a literal here would have
            // to be edited in lockstep with every other site, which is what let Lambdas run nodejs22.x
            // while the repo pinned engines.node 24.x. That pin has its own drift guard.
            Runtime: NODE_LAMBDA_RUNTIME.name,
            Architectures: ['arm64'],
        });
    });

    it('⛔ creates exactly ONE schedule — the midnight stop, America/New_York (ADR-0060)', () => {
        const schedules = Object.values(schedulerTemplate().findResources('AWS::Scheduler::Schedule')).map(
            (resource: any) => resource.Properties,
        );

        // ⛔ Pinned as the WHOLE set, so a restored start fails here rather than merely adding a row. DST-correct by
        // timezone, never by a UTC hour: `America/New_York` is UTC-4 for eight months and UTC-5 for four.
        expect(
            schedules.map((schedule: any) => ({
                expression: schedule.ScheduleExpression,
                timezone: schedule.ScheduleExpressionTimezone,
                input: JSON.parse(schedule.Target.Input),
            })),
        ).toEqual([{ expression: 'cron(0 0 * * ? *)', timezone: 'America/New_York', input: { action: 'stop' } }]);
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
            'events:ListRules',
            'events:ListTagsForResource',
            'events:EnableRule',
            'events:DisableRule',
        ]) {
            expect(actions.has(action)).toBe(true);
        }

        // No service-wildcard admin (e.g. `rds:*`, `ec2:*`).
        for (const action of actions) {
            expect(action).not.toMatch(/^(rds|ecs|ec2|ssm|iam|events):\*$/);
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
        new GlobalStack(testApp(), `Global-${stage}`, {
            env,
            stackName: `kitchensink-global-${stage}`,
            stage,
            alarmsEnabled: true,
            domainName: 'example.com',
        });

    it('creates the SandboxSchedulerStack (with its one schedule) ONLY for the sandbox stage', () => {
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
 * The first draft of `sandboxReconcile.yml` bypassed it: it scaled services to 0 with a raw
 * `aws ecs update-service`, writing no SSM parameter. The shared sandbox IDENTITY service — which every
 * preview signs in against — would then have been stranded at zero, because `runStart` correctly declines
 * to invent a count. Previews would deploy and sign-in would be dead, with only a log line to say why.
 *
 * The fix is to stop reimplementing stop/start and invoke THIS function, which means both workflows have to
 * discover it. A CloudFormation export is how everything else in this repo crosses that boundary
 * (`cfnExport.sh`), so the name is exported rather than guessed from a pattern.
 */
describe('the scheduler function is discoverable by the workflows (ADR-0028)', () => {
    it('exports its function name under a STACK-qualified export', () => {
        // Qualified by stack name, not a literal: the app names this stack
        // `kitchensink-sandbox-scheduler-{stage}` while this harness constructs it directly, so pinning the
        // production string here would assert the harness rather than the invariant. What must hold is that
        // the export is unique per stack and ends in the agreed suffix, which is what `cfnExport.sh` looks
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

/**
 * Oct 6–7 2026: the 09:00 start failed with `InsufficientDBInstanceCapacity` on two mornings, the run still
 * returned success, and nothing told anyone that the sandbox stayed down. A failed run now fails the
 * invocation (`assertRunSucceeded`), and this alarm turns that into a notification.
 */
describe('a failed scheduler run raises an alarm', () => {
    const withAlarms = (alarmsEnabled: boolean): Template =>
        Template.fromStack(
            ((app) =>
                new SandboxSchedulerStack(app, 'SandboxScheduler-sandbox', {
                    env,
                    stage: 'sandbox',
                    alarmsEnabled,
                    alarmTopic: alarmTopicIn(app),
                }))(testApp()),
        );

    it('alarms on any error of the scheduler function, and publishes to the stage alarm topic', () => {
        const template = withAlarms(true);
        const [functionId] = Object.keys(
            template.findResources('AWS::Lambda::Function', {
                Properties: { Handler: Match.stringLikeRegexp('sandbox-scheduler|index') },
            }),
        );

        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            Namespace: 'AWS/Lambda',
            MetricName: 'Errors',
            Dimensions: [{ Name: 'FunctionName', Value: { Ref: functionId } }],
            Threshold: 1,
            ComparisonOperator: 'GreaterThanOrEqualToThreshold',
            EvaluationPeriods: 1,
            TreatMissingData: 'notBreaching',
            AlarmActions: [ALARM_TOPIC_ARN],
        });
        // The stage topic already exists (MessageSubstrateStack); a second, sandbox-only topic would escape the
        // prod-stage cdk-nag census (`nagRulesAtZero.integration.test.ts`).
        template.resourceCountIs('AWS::SNS::Topic', 0);
    });

    it('creates no alarm while the stage has alarms switched off (alarmFeatureFlag)', () => {
        withAlarms(false).resourceCountIs('AWS::CloudWatch::Alarm', 0);
    });

    it('retries a failed stop briefly and never into the next day', () => {
        const schedules = Object.values(withAlarms(true).findResources('AWS::Scheduler::Schedule')) as {
            Properties: {
                Target: { RetryPolicy?: { MaximumRetryAttempts: number; MaximumEventAgeInSeconds: number } };
            };
        }[];

        expect(schedules.map(({ Properties }) => Properties.Target.RetryPolicy)).toEqual([
            { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 },
        ]);
    });
});

describe('GlobalStack hands the scheduler the stage alarm settings', () => {
    it('passes alarmsEnabled and the alert email through to the scheduler', () => {
        const global = new GlobalStack(testApp(), 'Global-sandbox', {
            env,
            stackName: 'kitchensink-global-sandbox',
            stage: 'sandbox',
            alarmsEnabled: true,
            domainName: 'example.com',
        });
        const template = Template.fromStack(global.sandboxScheduler!);
        const [alarm] = Object.values(template.findResources('AWS::CloudWatch::Alarm')) as {
            Properties: { AlarmActions: unknown[] };
        }[];

        // The action is the messaging stack's alarm topic, imported across stacks.
        expect(JSON.stringify(alarm?.Properties.AlarmActions)).toContain('MessageSubstrateAlarmTopic');
    });
});

/**
 * ADR-0060: the scheduler is the ONLY writer of a scheduled rule's state, so it holds the grant to toggle one — and
 * nothing more. The scope is asserted against the SYNTHESIZED policy, in both directions.
 *
 * `events:EnableRule`/`DisableRule` act on the `rule-on-default-event-bus` resource type, whose condition keys include
 * `aws:ResourceTag/${TagKey}` (AWS Service Authorization Reference for `events`, read 2026-10-12 from
 * `servicereference.us-east-1.amazonaws.com/v1/events/events.json`). So the tag the CDK gate stamps IS an enforceable
 * boundary: a rule that never went through the gate — every production rule — cannot be toggled.
 */
describe('the rule-toggle grant (ADR-0060)', () => {
    type Statement = {
        Sid?: string;
        Effect: string;
        Action: string | string[];
        Resource: unknown;
        Condition?: Record<string, Record<string, unknown>>;
    };

    function statements(): Statement[] {
        return Object.values(schedulerTemplate().findResources('AWS::IAM::Policy')).flatMap(
            (policy: any) => policy.Properties.PolicyDocument.Statement as Statement[],
        );
    }

    const actionsOf = (statement: Statement): string[] =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action];

    const TOGGLES = ['events:EnableRule', 'events:DisableRule'];

    it('allows toggling ONLY a rule tagged with a sandbox or preview stage', () => {
        const allows = statements().filter(
            (statement) =>
                statement.Effect === 'Allow' && actionsOf(statement).some((action) => TOGGLES.includes(action)),
        );

        expect(allows).toHaveLength(1);
        expect(actionsOf(allows[0]!).sort()).toEqual([...TOGGLES].sort());
        expect(allows[0]!.Condition).toEqual({
            StringLike: { [`aws:ResourceTag/${SCHEDULED_RULE_STAGE_TAG}`]: ['sandbox', 'pr-*'] },
        });
        // …and only within this repository's rule namespace, in an account that hosts another application.
        expect(JSON.stringify(allows[0]!.Resource)).toContain(':rule/kitchensink-*');
    });

    it('⛔ DENIES toggling any rule tagged Environment=production, whatever else it carries', () => {
        const deny = statements().find(
            (statement) =>
                statement.Effect === 'Deny' && actionsOf(statement).some((action) => TOGGLES.includes(action)),
        );

        expect(deny).toBeDefined();
        expect(actionsOf(deny!).sort()).toEqual([...TOGGLES].sort());
        expect(deny!.Condition).toEqual({ StringEquals: { 'aws:ResourceTag/Environment': 'production' } });
    });

    it('reads tags only on rules in its namespace, and lists rules where IAM offers no resource scope', () => {
        const byAction = (action: string): Statement | undefined =>
            statements().find((statement) => statement.Effect === 'Allow' && actionsOf(statement).includes(action));

        expect(JSON.stringify(byAction('events:ListTagsForResource')?.Resource)).toContain(':rule/kitchensink-*');
        // `ListRules` has no resource type in the service reference, so `*` is the only valid scope.
        expect(byAction('events:ListRules')?.Resource).toBe('*');
    });
});
