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
 * ## The stop starts the midnight reclaim (ADR-0061)
 *
 * The one schedule still fires once. Its input now carries the schedule's own `scheduledTime`, which names the night's
 * reclaim execution, and the stop ends by starting a Step Functions loop that deletes the stacks nothing uses. That
 * loop, its Lambda and the boundary of the Lambda's IAM are asserted at the bottom of this file.
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
import { SHARED_TIER_DELETE_ORDER } from '../lib/sandbox-scheduler/reclaim.js';
import { SCHEDULED_RULE_STAGE_TAG } from '../lib/sandbox-scheduler/scheduler.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };

/** The stage alarm topic the scheduler is handed, imported by ARN from a host stack in the same app. */
const ALARM_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:kitchensink-alarms-sandbox';
const alarmTopicIn = (app: App): sns.ITopic =>
    sns.Topic.fromTopicArn(new Stack(app, 'AlarmTopicHost', { env }), 'AlarmTopic', ALARM_TOPIC_ARN);

const schedulerTemplate = (logForwarderArn?: string): Template =>
    Template.fromStack(
        ((app) =>
            new SandboxSchedulerStack(app, 'SandboxScheduler-sandbox', {
                env,
                stage: 'sandbox',
                alarmsEnabled: false,
                alarmTopic: alarmTopicIn(app),
                ...(logForwarderArn === undefined ? {} : { logForwarderArn }),
            }))(testApp()),
    );

/** Whether an IAM resource pattern (`*` = any run of characters) matches `arn`. Pure. */
const iamMatches = (pattern: string, arn: string): boolean =>
    new RegExp(
        `^${pattern
            .split('*')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
            .join('.*')}$`,
        'u',
    ).test(arn);

describe('SandboxSchedulerStack (ADR-0007)', () => {
    describe('⛔ the UpdateService blast radius', () => {
        // ⛔ THIS IS THE BOUNDARY BETWEEN "scale a preview down" AND "scale production down", so it is
        // asserted against the SYNTHESIZED policy rather than the source that produced it.
        //
        // The resource scope was `service/*sandbox*/*` alone. A per-PR preview's services live under a
        // cluster named `kitchensink-{svc}-pr-{N}-…`, which that pattern cannot reach — so the scheduler
        // could SELECT a per-PR service (once the selector was fixed) and then be DENIED by IAM. The two
        // halves only work together, which is why they land together.

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

        it('⛔ grants NOTHING on a FOREIGN application`s per-PR cluster (ADR-0061 review)', () => {
            // The account also hosts another application. `service/*-pr-*/*` matched its `-pr-` clusters too.
            const foreign = `arn:aws:ecs:${env.region}:${env.account}:service/armoury-api-pr-5-Cluster-X/api`;

            expect(updateServiceResources().some((pattern) => iamMatches(pattern, foreign))).toBe(false);
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
        ).toEqual([
            {
                expression: 'cron(0 0 * * ? *)',
                timezone: 'America/New_York',
                // ADR-0061: the input now carries the schedule's own time, which names the night's reclaim execution
                // (the idempotency key). It was `{ action: 'stop' }` alone before the reclaim existed. The token is
                // EventBridge Scheduler's context attribute, resolved when the schedule fires.
                input: { action: 'stop', scheduledTime: '<aws.scheduler.scheduled-time>' },
            },
        ]);
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
        // The SCHEDULER function, found by its description: the reclaim function (ADR-0061) shares the handler pattern.
        const [functionId] = Object.keys(
            template.findResources('AWS::Lambda::Function', {
                Properties: { Description: Match.stringLikeRegexp('midnight stop') },
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

/**
 * ADR-0061: the midnight stop ends by starting a Step Functions loop that calls a reclaim Lambda once a minute. The
 * Lambda can delete CloudFormation stacks, so everything about what it may delete is asserted against the SYNTHESIZED
 * template: the IAM boundary by set equality, the loop's shape by walking its states, and the cost of a bad night by
 * the places a failure can end.
 */
describe('the midnight reclaim (ADR-0061)', () => {
    type Statement = {
        Sid?: string;
        Effect: string;
        Action: string | string[];
        Resource: unknown;
        Condition?: Record<string, Record<string, unknown>>;
    };
    type State = {
        Type: string;
        Next?: string;
        Seconds?: number;
        Resource?: string;
        Parameters?: Record<string, unknown>;
        Retry?: { ErrorEquals: string[]; MaxAttempts?: number }[];
        Catch?: { ErrorEquals: string[]; Next: string; ResultPath?: string }[];
        Choices?: { Next: string; Variable?: string; And?: unknown[]; BooleanEquals?: boolean }[];
        Default?: string;
        TimeoutSeconds?: number;
    };
    type Definition = { StartAt: string; States: Record<string, State>; TimeoutSeconds?: number };

    const actionsOf = (statement: Statement): string[] =>
        Array.isArray(statement.Action) ? statement.Action : [statement.Action];

    /** The reclaim function's logical id, found by its handler (or the placeholder's) and its description. */
    function reclaimFunctionId(template: Template): string {
        const [id] = Object.entries(template.findResources('AWS::Lambda::Function'))
            .filter(([, resource]) => String(resource['Properties']?.['Description']).includes('reclaim'))
            .map(([key]) => key);

        if (id === undefined) {
            throw new Error('no reclaim function — this guard has gone blind');
        }

        return id;
    }

    /** The statements attached to the role of one function. */
    function statementsOf(template: Template, functionId: string): Statement[] {
        const role = template.findResources('AWS::Lambda::Function')[functionId]?.['Properties']?.['Role'] as
            { 'Fn::GetAtt': [string, string] } | undefined;

        if (role === undefined) {
            throw new Error(`${functionId} has no execution role`);
        }

        const roleId = role['Fn::GetAtt'][0];

        return Object.values(template.findResources('AWS::IAM::Policy'))
            .filter((policy: any) => (policy.Properties.Roles as { Ref: string }[]).some((role) => role.Ref === roleId))
            .flatMap((policy: any) => policy.Properties.PolicyDocument.Statement as Statement[]);
    }

    /**
     * The state machine definition, with every intrinsic (a Lambda ARN) replaced by a placeholder so it parses.
     */
    function definition(template: Template): Definition {
        const [machine] = Object.values(template.findResources('AWS::StepFunctions::StateMachine'));
        const raw = machine?.['Properties']?.['DefinitionString'] as { 'Fn::Join': [string, unknown[]] } | string;
        const text =
            typeof raw === 'string'
                ? raw
                : raw['Fn::Join'][1].map((part) => (typeof part === 'string' ? part : '<REF>')).join('');

        return JSON.parse(text) as Definition;
    }

    const FORWARDER = 'arn:aws:lambda:us-east-1:123456789012:function:log-forwarder';
    const template = schedulerTemplate();
    const allowed = (statements: Statement[]): Statement[] => statements.filter((s) => s.Effect === 'Allow');

    describe('the reclaim function', () => {
        it('is on the repo-wide runtime pin, arm64, and NOT in a VPC', () => {
            const fn = template.findResources('AWS::Lambda::Function')[reclaimFunctionId(template)]?.['Properties'];

            expect(fn['Runtime']).toBe(NODE_LAMBDA_RUNTIME.name);
            expect(fn['Architectures']).toEqual(['arm64']);
            // ⛔ ADR-0004: a VPC-attached Lambda would be a NAT consumer. This one reaches only public AWS endpoints.
            expect(fn['VpcConfig']).toBeUndefined();
            expect(fn['Handler']).toMatch(/(index|sandbox-scheduler\/reclaimHandler)\.handler/u);
        });

        it('has its own explicit log group, deleted with the stack, and drained when the forwarder is known', () => {
            const logGroups = Object.values(template.findResources('AWS::Logs::LogGroup'));

            expect(logGroups.length).toBeGreaterThanOrEqual(3);
            expect(new Set(logGroups.map((group) => group['DeletionPolicy']))).toEqual(new Set(['Delete']));

            const drained = schedulerTemplate(FORWARDER);
            const filters = Object.values(drained.findResources('AWS::Logs::SubscriptionFilter'));

            // The scheduler's group and the reclaim's group are drained. The state machine's group is not, by ADR-0042.
            expect(filters).toHaveLength(2);
            expect(JSON.stringify(filters)).toContain('SandboxReclaimLogGroup');
            expect(JSON.stringify(filters)).toContain('SandboxSchedulerLogGroup');
            expect(JSON.stringify(filters)).not.toContain('ReclaimStateMachineLogGroup');
        });

        it('both functions report to Sentry through the platform DSN parameter', () => {
            const parameters = template.toJSON()['Parameters'] as Record<string, { Default?: string }>;
            const [dsnParameter] = Object.entries(parameters).filter(
                ([, value]) => value.Default === '/kitchensink/sandbox/sentry/platform-dsn',
            );

            expect(dsnParameter).toBeDefined();

            for (const fn of Object.values(template.findResources('AWS::Lambda::Function'))) {
                expect(fn['Properties']['Environment']['Variables']['SENTRY_DSN']).toEqual({
                    Ref: dsnParameter?.[0],
                });
            }
        });
    });

    describe('⛔ the reclaim role is the whole boundary (set equality)', () => {
        const statements = statementsOf(template, reclaimFunctionId(template));

        it('holds exactly these actions and no others', () => {
            expect(new Set(allowed(statements).flatMap(actionsOf))).toEqual(
                new Set([
                    'cloudformation:DescribeStacks',
                    'rds:DescribeDBInstances',
                    'ec2:DescribeInstances',
                    'ecs:ListClusters',
                    'ecs:DescribeClusters',
                    'ecs:ListServices',
                    'ecs:DescribeServices',
                    'ecs:ListTasks',
                    'ecs:DescribeTasks',
                    'cloudformation:DeleteStack',
                    'ecs:DeleteService',
                    'ecs:StopTask',
                ]),
            );
        });

        it('reads on * and mutates only on named resources', () => {
            const reads = allowed(statements).filter((s) => s.Resource === '*');

            expect(new Set(reads.flatMap(actionsOf))).toEqual(
                new Set([
                    'cloudformation:DescribeStacks',
                    'rds:DescribeDBInstances',
                    'ec2:DescribeInstances',
                    'ecs:ListClusters',
                    'ecs:DescribeClusters',
                    'ecs:ListServices',
                    'ecs:DescribeServices',
                    'ecs:ListTasks',
                    'ecs:DescribeTasks',
                ]),
            );
            expect(reads.every((s) => actionsOf(s).every((a) => /:(Describe|List)/u.test(a)))).toBe(true);
        });

        it('allows DeleteStack on per-PR stacks tagged pr-*, and on exactly the shared-tier allowlist tagged sandbox', () => {
            const deletes = allowed(statements).filter((s) => actionsOf(s).includes('cloudformation:DeleteStack'));
            const base = `arn:aws:cloudformation:${env.region}:${env.account}:stack`;
            const perPr = deletes.find(
                (s) => (s.Condition?.['StringLike'] ?? {})['aws:ResourceTag/Environment'] === 'pr-*',
            );
            const shared = deletes.find(
                (s) => (s.Condition?.['StringEquals'] ?? {})['aws:ResourceTag/Environment'] === 'sandbox',
            );

            expect(deletes).toHaveLength(2);
            expect(perPr?.Resource).toBe(`${base}/kitchensink-*-pr-*/*`);
            // The resources come from the TypeScript allowlist, which `reclaimShellParity.test.ts` holds to the shell.
            expect(shared?.Resource).toEqual(SHARED_TIER_DELETE_ORDER.map((name) => `${base}/${name}/*`));
        });

        it('allows DeleteService and StopTask only on kitchensink- per-PR clusters', () => {
            const ecs = allowed(statements).filter(
                (s) => actionsOf(s).includes('ecs:DeleteService') || actionsOf(s).includes('ecs:StopTask'),
            );
            const base = `arn:aws:ecs:${env.region}:${env.account}`;

            expect(ecs.map((s) => [actionsOf(s), s.Resource])).toEqual(
                expect.arrayContaining([
                    [['ecs:DeleteService'], `${base}:service/kitchensink-*-pr-*/*`],
                    [['ecs:StopTask'], `${base}:task/kitchensink-*-pr-*/*`],
                ]),
            );
            expect(ecs).toHaveLength(2);
        });

        it('⛔ DeleteService also needs the service itself tagged Environment=pr-*; StopTask has no tag condition', () => {
            // Services carry the App-level tag (asserted in the food and recipe stack suites); tasks are untagged, so a
            // tag condition on StopTask would make it deny everything.
            const byAction = (action: string): Statement | undefined =>
                allowed(statements).find((s) => actionsOf(s).includes(action));

            expect(byAction('ecs:DeleteService')?.Condition).toEqual({
                StringLike: { 'aws:ResourceTag/Environment': 'pr-*' },
            });
            expect(byAction('ecs:StopTask')?.Condition).toBeUndefined();
        });

        it.each([
            ['a foreign application`s per-PR cluster', 'armoury-api-pr-5-Cluster-X', false],
            ['a lookalike prefix', 'xkitchensink-food-service-pr-5-Cluster-X', false],
            ['production', 'kitchensink-food-service-prod-FoodServiceCluster442EDB29-xRt2eYoDUrGB', false],
            [
                'the shared sandbox cluster',
                'kitchensink-identity-service-sandbox-IdentityServiceCluster3A4949E2-jZ',
                false,
            ],
            ['a real per-PR cluster', 'kitchensink-food-service-pr-91-FoodServiceCluster442EDB29-QR9FHWWoNVeo', true],
            ['a real per-PR recipe cluster', 'kitchensink-recipe-service-pr-7-RecipeCluster1A2B3C4D-AbCdEf', true],
        ])('⛔ the ECS grants match %s: %s -> %s', (_label, cluster, matches) => {
            const base = `arn:aws:ecs:${env.region}:${env.account}`;
            const resources = allowed(statements)
                .filter((s) => actionsOf(s).includes('ecs:DeleteService') || actionsOf(s).includes('ecs:StopTask'))
                .map((s) => String(s.Resource));

            expect(resources.some((pattern) => iamMatches(pattern, `${base}:service/${cluster}/api`))).toBe(matches);
            expect(resources.some((pattern) => iamMatches(pattern, `${base}:task/${cluster}/0123abcd`))).toBe(matches);
        });

        it('⛔ DENIES a production-tagged resource, and DENIES any DeleteStack that names a role', () => {
            const denies = statements.filter((s) => s.Effect === 'Deny');
            const production = denies.find((s) => s.Condition?.['StringEquals'] !== undefined);
            const roleArn = denies.find((s) => s.Condition?.['Null'] !== undefined);

            expect(actionsOf(production!).sort()).toEqual([
                'cloudformation:DeleteStack',
                'ecs:DeleteService',
                'ecs:StopTask',
            ]);
            expect(production?.Condition).toEqual({ StringEquals: { 'aws:ResourceTag/Environment': 'production' } });
            expect(production?.Resource).toBe('*');
            expect(actionsOf(roleArn!)).toEqual(['cloudformation:DeleteStack']);
            expect(roleArn?.Condition).toEqual({ Null: { 'cloudformation:RoleArn': 'false' } });
            expect(denies).toHaveLength(2);
        });

        it('⛔ can pass no role and create or change nothing', () => {
            const actions = statements.flatMap(actionsOf);

            expect(
                actions.filter((a) => /PassRole|Create|Update|ChangeSet|SetStackPolicy|ExecuteChangeSet|:\*$/u.test(a)),
            ).toEqual([]);
        });
    });

    describe('the scheduler function starts the loop and nothing else about it', () => {
        it('may start exactly the one state machine', () => {
            const schedulerId = Object.entries(template.findResources('AWS::Lambda::Function'))
                .filter(([, resource]) => String(resource['Properties']?.['Description']).includes('midnight stop'))
                .map(([key]) => key)[0] as string;
            const starts = statementsOf(template, schedulerId).filter((s) =>
                actionsOf(s).includes('states:StartExecution'),
            );

            expect(starts).toHaveLength(1);
            expect(actionsOf(starts[0]!)).toEqual(['states:StartExecution']);
            expect(JSON.stringify(starts[0]!.Resource)).toContain('ReclaimStateMachine');
        });

        it('is told which state machine, and the state machine`s ARN is exported', () => {
            const [stateMachineId] = Object.keys(template.findResources('AWS::StepFunctions::StateMachine'));
            const schedulerEnvironments = Object.values(template.findResources('AWS::Lambda::Function')).map(
                (fn) => fn['Properties']['Environment']['Variables']['RECLAIM_STATE_MACHINE_ARN'],
            );

            expect(schedulerEnvironments).toContainEqual({ Ref: stateMachineId });

            const outputs = Object.values(template.findOutputs('*')) as { Export?: { Name?: string } }[];

            expect(outputs.filter((o) => o.Export?.Name?.endsWith(':ReclaimStateMachineArn'))).toHaveLength(1);
        });
    });

    describe('the state machine', () => {
        const [machine] = Object.values(template.findResources('AWS::StepFunctions::StateMachine'));
        const flow = definition(template);
        const states = flow.States;
        const entries = Object.entries(states);

        it('is a Standard machine with logging at ALL (no execution data) and X-Ray tracing', () => {
            expect(machine?.['Properties']['StateMachineType']).toBe('STANDARD');
            expect(machine?.['Properties']['TracingConfiguration']).toEqual({ Enabled: true });
            expect(machine?.['Properties']['LoggingConfiguration']).toMatchObject({
                Level: 'ALL',
                IncludeExecutionData: false,
            });
            expect(JSON.stringify(machine?.['Properties']['LoggingConfiguration'])).toContain(
                'ReclaimStateMachineLogGroup',
            );
        });

        it('⛔ has NO execution-level timeout: a timed-out execution cannot run its Catch', () => {
            expect(flow.TimeoutSeconds).toBeUndefined();
            expect(machine?.['Properties']['DefinitionString']).toBeDefined();
        });

        it('waits a minute, then reclaims, then decides', () => {
            const start = states[flow.StartAt]!;

            expect(start).toMatchObject({ Type: 'Wait', Seconds: 60 });

            const reclaim = states[start.Next!]!;

            expect(reclaim.Type).toBe('Task');
            expect(reclaim.Parameters).toEqual({
                kind: 'step',
                'iteration.$': '$.iteration',
                maxIterations: 120,
            });
            expect(states[reclaim.Next!]!.Type).toBe('Choice');
        });

        it('loops: not-complete increments the iteration and waits again', () => {
            const start = states[flow.StartAt]!;
            const choice = states[states[start.Next!]!.Next!]!;
            const next = states[choice.Default!]!;

            expect(next.Type).toBe('Pass');
            expect(JSON.stringify(next)).toContain('States.MathAdd');
            expect(next.Next).toBe(flow.StartAt);
        });

        it('⛔ retries a throwing step, and CATCHES whatever is left into a report', () => {
            const start = states[flow.StartAt]!;
            const reclaim = states[start.Next!]!;
            const report = states[reclaim.Catch![0]!.Next]!;

            expect(reclaim.Retry!.some((retry) => retry.ErrorEquals.includes('States.TaskFailed'))).toBe(true);
            expect(reclaim.Catch).toHaveLength(1);
            expect(reclaim.Catch![0]!.ErrorEquals).toEqual(['States.ALL']);
            expect(reclaim.Catch![0]!.ResultPath).toBe('$.error');
            expect(report.Parameters).toMatchObject({ kind: 'report', 'error.$': '$.error' });
            // ADR-0061 review (N2): the report runs in the SAME function as the step, so it shares the step's failure
            // domain. It retries on its own account, including a handler that threw, before the run gives up silently.
            expect(report.Retry!.some((retry) => retry.ErrorEquals.includes('States.TaskFailed'))).toBe(true);
            expect(report.Retry!.every((retry) => (retry.MaxAttempts ?? 0) >= 2)).toBe(true);
            expect(states[report.Next!]!.Type).toBe('Fail');
        });

        it('⛔ every terminal state either succeeds or is reached only from a step that announced', () => {
            const start = states[flow.StartAt]!;
            const reclaimName = start.Next!;
            const reportName = states[reclaimName]!.Catch![0]!.Next;
            const choice = states[states[reclaimName]!.Next!]!;
            const failedBranch = choice.Choices!.find((rule) => JSON.stringify(rule).includes('failed'))!;
            const fails = entries.filter(([, state]) => state.Type === 'Fail').map(([name]) => name);
            const predecessors = (target: string): string[] =>
                entries
                    .filter(([, state]) =>
                        [
                            state.Next,
                            state.Default,
                            ...(state.Choices ?? []).map((rule) => rule.Next),
                            ...(state.Catch ?? []).map((c) => c.Next),
                        ].includes(target),
                    )
                    .map(([name]) => name);

            expect(fails).toHaveLength(2);

            for (const fail of fails) {
                // Either the report step (announces `reclaim-crashed`) or the Choice's failed branch (the step announced
                // `stacks-left-behind` before it returned). Nothing else may end in Fail.
                expect(
                    predecessors(fail).every((name) => name === reportName || name === states[reclaimName]!.Next),
                ).toBe(true);
            }

            expect(failedBranch.Next).toBeDefined();
            expect(entries.filter(([, state]) => state.Type === 'Succeed')).toHaveLength(1);
        });

        it('may invoke only the reclaim function', () => {
            const [machineRole] = Object.values(template.findResources('AWS::IAM::Policy')).filter((policy: any) =>
                JSON.stringify(policy.Properties.PolicyDocument).includes('lambda:InvokeFunction'),
            );
            const invokes = (machineRole as any).Properties.PolicyDocument.Statement.filter((s: Statement) =>
                actionsOf(s).includes('lambda:InvokeFunction'),
            ) as Statement[];

            expect(invokes).toHaveLength(1);
            expect(JSON.stringify(invokes[0]!.Resource)).toContain(reclaimFunctionId(template));
        });
    });
});
